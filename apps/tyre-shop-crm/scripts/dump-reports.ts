import { mkdirSync, writeFileSync } from "node:fs";
import { extractAntiforgery } from "../lib/smt/parse";

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
  await new Promise((r) => setTimeout(r, 400));
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
  const pages = [
    "/FittingCentre/Reports",
    "/FittingCentre/Reports/NewCustomers",
    "/FittingCentre/Reports/ExistingCustomers",
    "/FittingCentre/Reports/BookingAverageTotals",
    "/FittingCentre/Reports/ViewTyreBookings",
    "/FittingCentre/Reports/BookingTotals",
    "/FittingCentre/Reports/BrandsSold",
  ];
  mkdirSync("/tmp/smt-live/reports", { recursive: true });
  for (const path of pages) {
    const page = await req("GET", path);
    const slug = path.split("/").pop() || "hub";
    writeFileSync(`/tmp/smt-live/reports/${slug}.html`, page.text);
    const text = page.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400);
    console.log(path, page.status, text.slice(0, 220));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
