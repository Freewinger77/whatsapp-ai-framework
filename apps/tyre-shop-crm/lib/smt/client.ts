import { SMT_MODE, SMT_ORIGIN } from "../config";
import { isInHours } from "../hours";
import { toE164 } from "../phone";
import {
  coerceJsonList,
  customersFromCsv,
  customersFromTable,
  enquiriesFromTable,
  extractAjaxUrl,
  extractAntiforgery,
  extractHeadlineNps,
  extractPaginationTotal,
  jsonTotal,
  npsFromTable,
  parseHtmlTables,
  pickMainTable,
  testimonialsFromTable,
} from "./parse";
import { createMockClient } from "./mock";
import { CRM_PATHS, type ListPage, type SmtCustomer, type SmtEnquiry, type SmtNps, type SmtPing, type SmtTestimonial } from "./types";

interface CookieJar {
  [name: string]: string;
}

function parseSetCookie(header: string): CookieJar {
  const jar: CookieJar = {};
  const [pair] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq === -1) return jar;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (name) jar[name] = value;
  return jar;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

export interface SmtClient {
  login(): Promise<void>;
  ensureSession(): Promise<void>;
  ping(): Promise<SmtPing>;
  listCustomers(page?: number, pageSize?: number): Promise<ListPage<SmtCustomer>>;
  listEnquiries(page?: number, pageSize?: number): Promise<ListPage<SmtEnquiry>>;
  listNps(page?: number, pageSize?: number): Promise<ListPage<SmtNps>>;
  listTestimonials(page?: number, pageSize?: number): Promise<ListPage<SmtTestimonial>>;
  exportCustomersCsv(): Promise<SmtCustomer[]>;
  headlineNps(): Promise<number | null>;
}

export class LiveSmtClient implements SmtClient {
  private cookies: CookieJar = {};
  private loggedIn = false;
  private lastLoginAt = 0;
  private cachedHeadlineNps: number | null = null;

  constructor(
    private readonly email = process.env.SMT_EMAIL || "",
    private readonly password = process.env.SMT_PASSWORD || "",
    private readonly origin = SMT_ORIGIN,
  ) {}

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private mergeCookies(res: Response): void {
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    const list = typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : [];
    if (list.length) {
      for (const c of list) Object.assign(this.cookies, parseSetCookie(c));
      return;
    }
    const raw = res.headers.get("set-cookie");
    if (raw) Object.assign(this.cookies, parseSetCookie(raw));
  }

  private async raw(
    method: string,
    path: string,
    body?: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; text: string; url: string; res: Response }> {
    const url = path.startsWith("http") ? path : `${this.origin}${path}`;
    const reqHeaders: Record<string, string> = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      Origin: this.origin,
      Referer: `${this.origin}${CRM_PATHS.login}`,
      "User-Agent": UA,
      ...headers,
    };
    const cookie = this.cookieHeader();
    if (cookie) reqHeaders.Cookie = cookie;
    const res = await fetch(url, {
      method,
      headers: reqHeaders,
      body,
      redirect: "manual",
    });
    this.mergeCookies(res);
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = location.startsWith("http") ? location : `${this.origin}${location}`;
      return this.raw("GET", next, undefined, { Referer: url });
    }
    const text = await res.text();
    return { status: res.status, text, url: res.url || url, res };
  }

  async login(): Promise<void> {
    if (!this.email || !this.password) {
      throw new Error("SMT_EMAIL / SMT_PASSWORD are not set");
    }
    const loginPage = await this.raw("GET", CRM_PATHS.login);
    if (loginPage.status !== 200) {
      throw new Error(`SMT login page failed (${loginPage.status})`);
    }
    const token = extractAntiforgery(loginPage.text);
    if (!token) {
      throw new Error("SMT login page had no __RequestVerificationToken");
    }
    const form = new URLSearchParams({
      __RequestVerificationToken: token,
      ReturnUrl: "",
      Email: this.email,
      Password: this.password,
      RememberMe: "true",
    });
    const posted = await this.raw("POST", CRM_PATHS.loginPost, form.toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${this.origin}${CRM_PATHS.login}`,
    });
    const bouncedToLogin =
      /Account\/Login/i.test(posted.url) ||
      /Admin Login/i.test(posted.text) ||
      /Email is required|Password is required|not valid/i.test(posted.text);
    if (posted.status >= 400 || bouncedToLogin) {
      throw new Error(`SMT login failed (${posted.status}) — check SMT_EMAIL / SMT_PASSWORD`);
    }
    this.loggedIn = true;
    this.lastLoginAt = Date.now();
  }

  async ensureSession(): Promise<void> {
    const stale = Date.now() - this.lastLoginAt > 45 * 60 * 1000;
    if (!this.loggedIn || stale) {
      await this.login();
    }
  }

  async ping(): Promise<SmtPing> {
    try {
      if (!this.email || !this.password) {
        return { ok: false, detail: "SMT credentials not set" };
      }
      await this.ensureSession();
      const hub = await this.raw("GET", CRM_PATHS.hub);
      if (hub.status !== 200 || /Admin Login/i.test(hub.text)) {
        return { ok: false, detail: `CRM hub ${hub.status}` };
      }
      const nps = await this.headlineNps();
      return { ok: true, detail: "authenticated", headlineNps: nps };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async headlineNps(): Promise<number | null> {
    await this.ensureSession();
    const page = await this.raw("GET", CRM_PATHS.nps);
    this.cachedHeadlineNps = extractHeadlineNps(page.text);
    return this.cachedHeadlineNps;
  }

  private async listHtml<T>(
    path: string,
    page: number,
    pageSize: number,
    map: (table: ReturnType<typeof pickMainTable>) => T[],
  ): Promise<ListPage<T>> {
    await this.ensureSession();
    const qs = path.includes("?") ? "&" : "?";
    const url = `${path}${qs}page=${page}&Page=${page}&pageSize=${pageSize}&length=${pageSize}&start=${(page - 1) * pageSize}`;
    const res = await this.raw("GET", url, undefined, {
      Referer: `${this.origin}${CRM_PATHS.hub}`,
      "X-Requested-With": "XMLHttpRequest",
    });
    const ajax = extractAjaxUrl(res.text);
    if (ajax && ajax !== path) {
      const xhr = await this.tryXhr<T>(ajax, page, pageSize, map);
      if (xhr.items.length || xhr.total) return xhr;
    }
    try {
      const asJson = JSON.parse(res.text) as unknown;
      const rows = coerceJsonList(asJson);
      if (rows.length) {
        const fakeTable = {
          headers: Object.keys(rows[0] || {}),
          rows: rows.map((r) => Object.values(r).map((v) => String(v ?? ""))),
          ids: rows.map((r) => String(r.id ?? r.Id ?? r.customerId ?? r.enquiryId ?? "") || null),
        };
        const items = map(fakeTable);
        return {
          items,
          page,
          pageSize,
          total: jsonTotal(asJson, items.length),
          hasMore: items.length >= pageSize,
          source: "xhr",
          url,
        };
      }
    } catch {
      /* HTML */
    }
    const table = pickMainTable(parseHtmlTables(res.text));
    const items = map(table);
    const total = extractPaginationTotal(res.text);
    return {
      items,
      page,
      pageSize,
      total,
      hasMore: items.length >= pageSize || (total != null && page * pageSize < total),
      source: "html",
      url,
    };
  }

  private async tryXhr<T>(
    ajaxPath: string,
    page: number,
    pageSize: number,
    map: (table: ReturnType<typeof pickMainTable>) => T[],
  ): Promise<ListPage<T>> {
    const start = (page - 1) * pageSize;
    const body = new URLSearchParams({
      draw: String(page),
      start: String(start),
      length: String(pageSize),
      sEcho: String(page),
      iDisplayStart: String(start),
      iDisplayLength: String(pageSize),
    });
    const res = await this.raw("POST", ajaxPath, body.toString(), {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${this.origin}${CRM_PATHS.hub}`,
    });
    let rows: Record<string, unknown>[] = [];
    let total: number | null = null;
    try {
      const json = JSON.parse(res.text) as unknown;
      rows = coerceJsonList(json);
      total = jsonTotal(json, rows.length);
    } catch {
      const table = pickMainTable(parseHtmlTables(res.text));
      const items = map(table);
      return {
        items,
        page,
        pageSize,
        total: extractPaginationTotal(res.text),
        hasMore: items.length >= pageSize,
        source: "html",
        url: ajaxPath,
      };
    }
    const fakeTable = {
      headers: rows[0] ? Object.keys(rows[0]) : [],
      rows: rows.map((r) =>
        Array.isArray(r)
          ? (r as unknown as unknown[]).map((v) => String(v ?? ""))
          : Object.values(r).map((v) => String(v ?? "")),
      ),
      ids: rows.map((r) =>
        Array.isArray(r) ? null : String(r.id ?? r.Id ?? r.customerId ?? r.enquiryId ?? "") || null,
      ),
    };
    const items = map(fakeTable);
    return {
      items,
      page,
      pageSize,
      total,
      hasMore: total != null ? page * pageSize < total : items.length >= pageSize,
      source: "xhr",
      url: ajaxPath,
    };
  }

  listCustomers(page = 1, pageSize = 50): Promise<ListPage<SmtCustomer>> {
    return this.listHtml(CRM_PATHS.customers, page, pageSize, (table) =>
      table ? customersFromTable(table) : [],
    );
  }

  listEnquiries(page = 1, pageSize = 50): Promise<ListPage<SmtEnquiry>> {
    return this.listHtml(CRM_PATHS.enquiries, page, pageSize, (table) =>
      table ? enquiriesFromTable(table) : [],
    );
  }

  listNps(page = 1, pageSize = 50): Promise<ListPage<SmtNps>> {
    return this.listHtml(CRM_PATHS.nps, page, pageSize, (table) => (table ? npsFromTable(table) : []));
  }

  listTestimonials(page = 1, pageSize = 50): Promise<ListPage<SmtTestimonial>> {
    return this.listHtml(CRM_PATHS.testimonials, page, pageSize, (table) =>
      table ? testimonialsFromTable(table) : [],
    );
  }

  async exportCustomersCsv(): Promise<SmtCustomer[]> {
    await this.ensureSession();
    const res = await this.raw("GET", CRM_PATHS.customersExport, undefined, {
      Accept: "text/csv,application/vnd.ms-excel,*/*",
      Referer: `${this.origin}${CRM_PATHS.customers}`,
    });
    if (res.status !== 200 || /Admin Login/i.test(res.text) || /<html/i.test(res.text.slice(0, 200))) {
      return [];
    }
    return customersFromCsv(res.text);
  }
}

export function createSmtClient(): SmtClient {
  if (SMT_MODE === "mock") return createMockClient();
  return new LiveSmtClient();
}

export function enrichEnquiry(row: SmtEnquiry): SmtEnquiry {
  return {
    ...row,
    phoneE164: row.phoneE164 || toE164(row.phone),
    inHours: isInHours(row.enquiredAt),
  };
}
