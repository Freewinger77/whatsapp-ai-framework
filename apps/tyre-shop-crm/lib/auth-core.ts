import { createHmac, timingSafeEqual } from "node:crypto";
import { authSecret, COOKIE_NAME, dashboardPassword } from "./config";

export { COOKIE_NAME };

export function gateToken(password = dashboardPassword(), secret = authSecret()): string {
  return createHmac("sha256", secret || "smt-crm").update(password).digest("hex");
}

export function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordOk(password: string): boolean {
  const expected = dashboardPassword();
  if (!expected) return false;
  return tokensMatch(gateToken(password), gateToken(expected));
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  };
}

export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    const ua = request.headers.get("user-agent") || "";
    return /vercel-cron/i.test(ua);
  }
  const header = request.headers.get("authorization") || "";
  const bearer = header.replace(/^Bearer\s+/i, "");
  return tokensMatch(bearer, secret);
}
