import { mkdirSync, writeFileSync } from "node:fs";
import { extractAntiforgery, parseHtmlTables } from "../lib/smt/parse";

const origin = "https://admin.sellmoretyres.com";
const email = process.env.SMT_EMAIL || "";
const password = process.env.SMT_PASSWORD || "";
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
  await new Promise((r) => setTimeout(r, 350));
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "User-Agent": "Mozilla/5.0", Origin: origin, Cookie: cookieHeader(), ...headers },
    body,
    redirect: "manual",
  });
  merge(res);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return req(method, path, body, headers);
  }
  const loc = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && loc) {
    return req("GET", loc.startsWith("http") ? loc : loc);
  }
  return { status: res.status, url: res.url || url, text: await res.text() };
}

async function main() {
  const login = await req("GET", "/Account/Login");
  const token = extractAntiforgery(login.text);
  if (!token) throw new Error("no token");
  await req(
    "POST",
    "/",
    new URLSearchParams({
      __RequestVerificationToken: token,
      Email: email,
      Password: password,
      RememberMe: "true",
      ReturnUrl: "",
    }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" },
  );

  mkdirSync("/tmp/smt-live/leads", { recursive: true });
  const paths = [
    "/FittingCentre",
    "/FittingCentre/CRM/EnquiriesView/110103",
    "/FittingCentre/CRM/ExportEnquiries",
    "/FittingCentre/CRM/PhoneEnquiries",
    "/FittingCentre/PhoneEnquiries",
    "/FittingCentre/CRM/Callbacks",
    "/FittingCentre/CRM/CallBacks",
    "/FittingCentre/CRM/Calls",
    "/FittingCentre/Notifications",
    "/FittingCentre/Activity",
    "/FittingCentre/Services/RequestFormServices",
  ];
  for (const path of paths) {
    const page = await req("GET", path);
    const slug = path.replace(/\W+/g, "_").replace(/^_+|_+$/g, "");
    writeFileSync(`/tmp/smt-live/leads/${slug}.html`, page.text);
    const title = page.text.match(/<title>([^<]+)</i)?.[1] || "";
    const bounced = /Admin Login/i.test(page.text);
    const tables = parseHtmlTables(page.text).map((t) => `${t.headers.join("|")}:${t.rows.length}`);
    const text = page.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 240);
    console.log(JSON.stringify({ path, status: page.status, title, bounced, tables, text }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
