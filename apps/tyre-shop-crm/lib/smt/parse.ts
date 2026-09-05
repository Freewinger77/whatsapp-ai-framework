import { createHash } from "node:crypto";
import { isInHours } from "../hours";
import { toE164 } from "../phone";
import type { SmtCustomer, SmtEnquiry, SmtHomeActivity, SmtNps, SmtTestimonial } from "./types";

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractAntiforgery(html: string): string | null {
  const named = html.match(
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i,
  );
  if (named?.[1]) return named[1];
  const reverse = html.match(
    /value="([^"]+)"[^>]*name="__RequestVerificationToken"/i,
  );
  return reverse?.[1] ?? null;
}

export function extractAjaxUrl(html: string): string | null {
  const patterns = [
    /ajax\s*:\s*['"]([^'"]+)['"]/i,
    /ajax\s*:\s*\{\s*url\s*:\s*['"]([^'"]+)['"]/i,
    /sAjaxSource\s*:\s*['"]([^'"]+)['"]/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1] && !match[1].startsWith("data:")) return match[1];
  }
  return null;
}

export function extractHeadlineNps(html: string): number | null {
  const percent = html.match(/id="percentage">\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
  if (percent) {
    const n = Number(percent[1]);
    return Number.isFinite(n) ? n : null;
  }
  const match = html.match(/Your NPS Score Is:[\s\S]{0,80}?([0-9]+(?:\.[0-9]+)?)\s*%/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function extractPageInfo(html: string): { page: number; pages: number } | null {
  const page = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (!page) return null;
  return { page: Number(page[1]), pages: Number(page[2]) };
}

export function isJunkListRow(cells: string[]): boolean {
  const text = cells.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^page\s+\d+\s+of\s+\d+/i.test(text)) return true;
  if (/^(<<|< prev|next >|>>)$/i.test(text)) return true;
  return false;
}

export function extractPaginationTotal(html: string): number | null {
  const showing = html.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i);
  if (showing) return Number(showing[1].replace(/,/g, ""));
  return null;
}

function slugId(parts: Array<string | number | null | undefined>): string {
  const raw = parts.map((p) => String(p ?? "").trim().toLowerCase()).join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function londonWallToIso(
  year: string,
  month: string,
  day: string,
  hh: string,
  mm: string,
  ss: string,
): string | null {
  const wall = `${year}-${month}-${day}T${hh}:${mm}:${ss}`;
  for (const offset of ["+01:00", "+00:00"] as const) {
    const date = new Date(`${wall}${offset}`);
    if (Number.isNaN(date.getTime())) continue;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hh &&
      parts.minute === mm &&
      parts.second === ss
    ) {
      return date.toISOString();
    }
  }
  const fallback = new Date(wall);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

export function parseUkDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw);
  if (!text) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    return londonWallToIso(iso[1], iso[2], iso[3], iso[4] || "00", iso[5] || "00", iso[6] || "00");
  }
  const uk = text.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (uk) {
    const day = uk[1].padStart(2, "0");
    const month = uk[2].padStart(2, "0");
    const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    const hh = (uk[4] || "0").padStart(2, "0");
    const mm = (uk[5] || "0").padStart(2, "0");
    const ss = (uk[6] || "0").padStart(2, "0");
    return londonWallToIso(year, month, day, hh, mm, ss);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface HtmlTable {
  headers: string[];
  rows: string[][];
  ids: Array<string | null>;
}

export function parseHtmlTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html))) {
    const block = tableMatch[1];
    const headers: string[] = [];
    const thRe = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
    let th: RegExpExecArray | null;
    while ((th = thRe.exec(block))) headers.push(decodeEntities(th[1]));
    const rows: string[][] = [];
    const ids: Array<string | null> = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(block))) {
      const rowHtml = tr[1];
      if (/<th\b/i.test(rowHtml) && !/<td\b/i.test(rowHtml)) continue;
      const cells: string[] = [];
      const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(rowHtml))) cells.push(decodeEntities(td[1]));
      if (!cells.length) continue;
      if (isJunkListRow(cells)) continue;
      rows.push(cells);
      ids.push(extractRowId(rowHtml));
    }
    if (headers.length || rows.length) tables.push({ headers, rows, ids });
  }
  return tables;
}

export function extractRowId(rowHtml: string): string | null {
  const href = rowHtml.match(
    /href="[^"]*(?:CustomerView|EnquiriesView|NPSView|View|Details|Edit)\/(\d+)"/i,
  );
  if (href?.[1]) return href[1];
  const query = rowHtml.match(
    /[?&](?:nps|TestimonialID|id|customerId|enquiryId)=(\d+)/i,
  );
  if (query?.[1]) return query[1];
  const lbl = rowHtml.match(/id="(?:lbl_|enquiryTag-)(\d+)"/i);
  if (lbl?.[1]) return lbl[1];
  const dataId =
    rowHtml.match(/data-(?:id|customerid|enquiryid|npsid)="(\d+)"/i) ||
    rowHtml.match(/data-id='(\d+)'/i);
  return dataId?.[1] ?? null;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const idx = normalized.findIndex((h) => h === key || h.includes(key));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  if (index < 0) return "";
  return row[index] || "";
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function customersFromTable(table: HtmlTable): SmtCustomer[] {
  const h = table.headers;
  const firstI = headerIndex(h, "firstname");
  const lastI = headerIndex(h, "lastname");
  const nameI = firstI >= 0 ? -1 : headerIndex(h, "name", "customer", "customername");
  const emailI = headerIndex(h, "email", "emailaddress");
  const phoneI = headerIndex(h, "contactnumber", "phone", "mobile", "telephone", "tel");
  const postI = headerIndex(h, "postcode", "post", "zip");
  const vrnI = headerIndex(h, "vrn", "reg", "registration");
  const sourceI = headerIndex(h, "source");
  const stageI = headerIndex(h, "stage", "status");
  const bookingI = headerIndex(h, "lastbooking", "lastorder", "lastvisit");
  return table.rows.map((row, i) => {
    const firstName = firstI >= 0 ? cell(row, firstI) : "";
    const lastName = lastI >= 0 ? cell(row, lastI) : "";
    const name =
      firstName || lastName ? `${firstName} ${lastName}`.trim() : cell(row, nameI) || cell(row, 0);
    const phone = cell(row, phoneI) || null;
    const phoneE164 = toE164(phone);
    const smtId = table.ids[i] || phoneE164 || slugId(["customer", name, cell(row, emailI), phone]);
    const split = firstName || lastName ? { firstName, lastName } : splitName(name);
    return {
      smtId,
      name,
      firstName: split.firstName,
      lastName: split.lastName,
      email: cell(row, emailI) || null,
      phone,
      phoneE164,
      postcode: cell(row, postI) || null,
      source: cell(row, sourceI) || null,
      stage: cell(row, stageI) || null,
      lastBookingAt: parseUkDate(cell(row, bookingI)),
      raw: {
        vrn: cell(row, vrnI) || null,
        ...Object.fromEntries(h.map((header, idx) => [header || `col${idx}`, row[idx] ?? ""])),
      },
    };
  });
}

export function enquiriesFromTable(table: HtmlTable): SmtEnquiry[] {
  const h = table.headers;
  const nameI = headerIndex(h, "name", "customer");
  const emailI = headerIndex(h, "email");
  const phoneI = headerIndex(h, "phone", "mobile", "telephone");
  const statusI = headerIndex(h, "status", "stage");
  const sourceI = headerIndex(h, "source");
  const notesI = headerIndex(h, "notes", "comment", "message");
  const dateI = headerIndex(h, "date", "created", "enquired", "received");
  return table.rows.map((row, i) => {
    const name = cell(row, nameI) || cell(row, 0);
    const phone = cell(row, phoneI) || null;
    const enquiredAt = parseUkDate(cell(row, dateI));
    const smtId = table.ids[i] || slugId(["enquiry", name, phone, enquiredAt]);
    return {
      smtId,
      customerSmtId: null,
      name,
      email: cell(row, emailI) || null,
      phone,
      phoneE164: toE164(phone),
      status: normalizeEnquiryStatus(cell(row, statusI)),
      source: cell(row, sourceI) || "Enquiry Received",
      notes: cell(row, notesI) || null,
      channel: "email",
      message: null,
      tags: null,
      enquiredAt,
      inHours: isInHours(enquiredAt),
      raw: Object.fromEntries(h.map((header, idx) => [header || `col${idx}`, row[idx] ?? ""])),
    };
  });
}

export function npsFromTable(table: HtmlTable): SmtNps[] {
  const h = table.headers;
  const scoreI = headerIndex(h, "score");
  const dateI = headerIndex(h, "date");
  const reasonI = headerIndex(h, "reason");
  const commentI = headerIndex(h, "comment", "comments");
  const nameI = headerIndex(h, "name", "customer");
  const phoneI = headerIndex(h, "phone", "mobile");
  const items: SmtNps[] = [];
  table.rows.forEach((row, i) => {
    const score = Number(cell(row, scoreI === -1 ? 0 : scoreI).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(score) || score < 0 || score > 10) return;
    const scoredAt = parseUkDate(cell(row, dateI));
    const name = cell(row, nameI) || null;
    const phone = cell(row, phoneI) || null;
    const reason = cell(row, reasonI) || null;
    const comment = cell(row, commentI) || null;
    items.push({
      smtId: table.ids[i] || slugId(["nps", score, scoredAt, phone, name, reason, comment]),
      score,
      reason,
      comment,
      name,
      phone,
      phoneE164: toE164(phone),
      scoredAt,
      raw: Object.fromEntries(h.map((header, idx) => [header || `col${idx}`, row[idx] ?? ""])),
    });
  });
  return items;
}

export function testimonialsFromTable(table: HtmlTable): SmtTestimonial[] {
  const h = table.headers;
  const nameI = headerIndex(h, "name", "customer");
  const quoteI = headerIndex(h, "quote", "testimonial", "comment", "review");
  const dateI = headerIndex(h, "date", "published");
  return table.rows
    .map((row, i) => {
      const name = cell(row, nameI) || cell(row, 0);
      const quote = cell(row, quoteI) || cell(row, Math.min(1, row.length - 1));
      const publishedAt = parseUkDate(cell(row, dateI));
      return {
        smtId: table.ids[i] || slugId(["testimonial", name, quote, publishedAt]),
        name,
        quote,
        publishedAt,
        raw: Object.fromEntries(h.map((header, idx) => [header || `col${idx}`, row[idx] ?? ""])),
      };
    })
    .filter((row) => row.name.trim() || row.quote.trim());
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function parseSmtHomeClock(time: string, day: string): string | null {
  const clock = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  const date = day.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!clock || !date) return parseUkDate(`${day} ${time}`);
  let hour = Number(clock[1]);
  const minute = clock[2];
  const ap = clock[3].toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  const month = MONTHS[date[2].toLowerCase()];
  if (!month) return null;
  return londonWallToIso(date[3], month, date[1].padStart(2, "0"), String(hour).padStart(2, "0"), minute, "00");
}

export function activityFromHome(html: string): SmtHomeActivity[] {
  const block = html.match(/<section class="recent-activity">([\s\S]*?)<\/section>/i)?.[1] || html;
  const items: SmtHomeActivity[] = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let li: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((li = liRe.exec(block))) {
    const chunk = li[1];
    const title = decodeEntities(chunk.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] || "");
    if (!title) continue;
    const time = decodeEntities(chunk.match(/at\s*<strong>([^<]+)<\/strong>/i)?.[1] || "");
    const day = decodeEntities(chunk.match(/on\s*<strong>([^<]+)<\/strong>/i)?.[1] || "");
    const href =
      chunk.match(/href="([^"]*(?:EnquiriesView|NPSView|Bookings\/View)[^"]*)"/i)?.[1] || null;
    const viewId =
      href?.match(/EnquiriesView\/(\d+)/i)?.[1] ||
      href?.match(/[?&]nps=(\d+)/i)?.[1] ||
      href?.match(/Bookings\/View\/(\d+)/i)?.[1] ||
      null;
    const at = time && day ? parseSmtHomeClock(time, day) : null;
    let kind: SmtHomeActivity["kind"] = "other";
    if (/phone enquiry/i.test(title) || /fa-phone/i.test(chunk)) kind = "phone_enquiry";
    else if (/^enquiry received/i.test(title) || /fa-envelope/i.test(chunk)) kind = "email_enquiry";
    else if (/nps/i.test(title)) kind = "nps";
    else if (/order received/i.test(title)) kind = "order";
    const key = `${kind}|${at || title}|${viewId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind, title, at, href, viewId });
  }
  return items;
}

export function phoneLeadsFromActivity(items: SmtHomeActivity[]): SmtEnquiry[] {
  return items
    .filter((item) => item.kind === "phone_enquiry")
    .map((item) => {
      const smtId = item.viewId || slugId(["phone", item.at, item.title]);
      return {
        smtId,
        customerSmtId: null,
        name: "Phone enquiry",
        email: null,
        phone: null,
        phoneE164: null,
        status: "New enquiry",
        source: "Phone Enquiry Received",
        notes: null,
        channel: "phone" as const,
        message: null,
        tags: null,
        enquiredAt: item.at,
        inHours: isInHours(item.at),
        raw: { ...item },
      };
    });
}

export function enquiriesFromExportCsv(text: string): SmtEnquiry[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  const idx = (...names: string[]) => headerIndex(headers, ...names);
  const nameI = idx("name");
  const emailI = idx("email");
  const phoneI = idx("phone", "telephone");
  const messageI = idx("message");
  const notesI = idx("notes");
  const dateI = idx("datecreated", "date", "created");
  const tagsI = idx("tags");
  return rows.slice(1).map((row) => {
    const name = cell(row, nameI) || cell(row, 0);
    const phone = cell(row, phoneI) || null;
    const email = cell(row, emailI) || null;
    const enquiredAt = parseUkDate(cell(row, dateI));
    const message = decodeEntities(cell(row, messageI)) || null;
    const notes = decodeEntities(cell(row, notesI)) || null;
    const tags = cell(row, tagsI) || null;
    return {
      smtId: slugId(["enquiry-export", name, phone, email, enquiredAt]),
      customerSmtId: null,
      name,
      email,
      phone,
      phoneE164: toE164(phone),
      status: "New enquiry",
      source: "Enquiry Received",
      notes,
      channel: "email" as const,
      message,
      tags,
      enquiredAt,
      inHours: isInHours(enquiredAt),
      raw: Object.fromEntries(headers.map((header, i) => [header || `col${i}`, row[i] ?? ""])),
    };
  });
}

export function londonDayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function enquiryExportMatchKey(row: {
  phoneE164?: string | null;
  email?: string | null;
  name?: string | null;
  enquiredAt?: string | null;
}): string | null {
  const day = londonDayKey(row.enquiredAt);
  const phone = (row.phoneE164 || "").replace(/\s+/g, "");
  const email = (row.email || "").trim().toLowerCase();
  if (phone && day) return `p:${phone}|${day}`;
  if (email && day) return `e:${email}|${day}`;
  if (phone) return `p:${phone}`;
  if (email) return `e:${email}`;
  return null;
}

function normalizeEnquiryStatus(raw: string): string {
  const text = raw.trim();
  if (!text) return "New enquiry";
  if (/^resolved$/i.test(text)) return "Resolved";
  if (/^new\s*enquir/i.test(text) || /^new$/i.test(text)) return "New enquiry";
  return text;
}

export function pickMainTable(tables: HtmlTable[], minCols = 3): HtmlTable | null {
  const ranked = tables
    .filter((t) => {
      const head = t.headers.join(" ").toLowerCase();
      if (head === "key" || head.includes("detractors")) return false;
      return t.rows.length && t.headers.length >= Math.min(minCols, t.headers.length);
    })
    .sort((a, b) => b.rows.length - a.rows.length);
  return ranked[0] ?? tables.find((t) => t.rows.length && t.headers.join(" ").toLowerCase() !== "key") ?? null;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

export function customersFromCsv(text: string): SmtCustomer[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const table: HtmlTable = {
    headers,
    rows: rows.slice(1),
    ids: rows.slice(1).map((r) => {
      const idIdx = headers.findIndex((h) => /^(id|customerid)$/i.test(h.trim()));
      return idIdx >= 0 ? r[idIdx] || null : null;
    }),
  };
  return customersFromTable(table);
}

export function coerceJsonList(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  for (const key of ["aaData", "data", "items", "results", "rows", "customers", "enquiries"]) {
    if (Array.isArray(obj[key])) {
      return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export function jsonTotal(data: unknown, fallback: number): number | null {
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  const raw = obj.iTotalRecords ?? obj.iTotalDisplayRecords ?? obj.total ?? obj.recordsTotal;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
