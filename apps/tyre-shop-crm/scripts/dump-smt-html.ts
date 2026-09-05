import { mkdirSync, writeFileSync } from "node:fs";
import { extractAjaxUrl, extractAntiforgery, extractHeadlineNps, extractPaginationTotal, parseHtmlTables } from "../lib/smt/parse";

const origin = "https://admin.sellmoretyres.com";
const email = process.env.SMT_EMAIL || "";
const password = process.env.SMT_PASSWORD || "";
const out = "/tmp/smt-live";
mkdirSync(out, { recursive: true });

const cookies = new Map<string, string>();

function cookieHeader() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function merge(res: Response) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function req(method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Origin: origin,
      Cookie: cookieHeader(),
      ...headers,
    },
    body,
    redirect: "manual",
  });
  merge(res);
  const loc = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && loc) {
    return req("GET", loc.startsWith("http") ? loc : loc);
  }
  const text = await res.text();
  return { status: res.status, url: res.url || url, text };
}

async function main() {
  const login = await req("GET", "/Account/Login");
  const token = extractAntiforgery(login.text);
  if (!token) throw new Error("no antiforgery");
  const form = new URLSearchParams({
    __RequestVerificationToken: token,
    ReturnUrl: "",
    Email: email,
    Password: password,
    RememberMe: "true",
  });
  const posted = await req("POST", "/", form.toString(), {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: `${origin}/Account/Login`,
  });
  writeFileSync(`${out}/after-login.html`, posted.text);
  console.log("login", posted.status, posted.url, posted.text.includes("Admin Login"));

  const pages = [
    "/FittingCentre/CRM",
    "/FittingCentre/CRM/Customers",
    "/FittingCentre/CRM/Customers/List",
    "/FittingCentre/CRM/Customers/Export",
    "/FittingCentre/CRM/Enquiries",
    "/FittingCentre/CRM/Enquiries/List",
    "/FittingCentre/CRM/NPS",
    "/FittingCentre/CRM/NPS/List",
    "/FittingCentre/CRM/Testimonials",
    "/FittingCentre/CRM/Testimonials/List",
    "/FittingCentre/Reports",
    "/FittingCentre/Reports/BrandsSold",
  ];

  for (const path of pages) {
    const page = await req("GET", path, undefined, { Referer: `${origin}/FittingCentre/CRM` });
    const slug = path.replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
    writeFileSync(`${out}/${slug}.html`, page.text);
    const tables = parseHtmlTables(page.text);
    console.log(
      path,
      page.status,
      "ajax=",
      extractAjaxUrl(page.text),
      "nps=",
      extractHeadlineNps(page.text),
      "total=",
      extractPaginationTotal(page.text),
      "tables=",
      tables.map((t) => `${t.headers.join("|")}:${t.rows.length}`),
      page.text.slice(0, 80).replace(/\s+/g, " "),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
