export const SHOP_NAME = process.env.SHOP_NAME || "Tyres 4 U";
export const PLATFORM = "sellmoretyres";
export const SMT_ORIGIN = (process.env.SMT_ORIGIN || "https://admin.sellmoretyres.com").replace(
  /\/$/,
  "",
);
export const SMT_MODE = (process.env.SMT_MODE || "live").toLowerCase() === "mock" ? "mock" : "live";
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60_000);
export const TIMEZONE = process.env.TZ || "Europe/London";

export const TRACKED_KINDS = ["customers", "enquiries", "nps", "testimonials"] as const;
export type TrackedKind = (typeof TRACKED_KINDS)[number];

export const COOKIE_NAME = "smt_gate";

export function dashboardPassword(): string {
  return process.env.DUNDEE_DASHBOARD_PASSWORD || "";
}

export function authSecret(): string {
  return process.env.CRM_AUTH_SECRET || process.env.WEBHOOK_SECRET || dashboardPassword();
}

export function supabaseUrl(): string {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

export function supabaseSecret(): string {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
