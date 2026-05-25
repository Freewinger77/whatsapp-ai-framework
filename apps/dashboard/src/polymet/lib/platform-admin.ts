const DEFAULT_PLATFORM_ADMIN_EMAILS = ["arslan@tryrapidscreen.com"];

export function isPlatformAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return getPlatformAdminEmailSet().has(normalizeEmail(email));
}

function getPlatformAdminEmailSet() {
  const configured = parseEmailList(import.meta.env.VITE_WASUP_PLATFORM_ADMIN_EMAILS);
  return new Set([...configured, ...DEFAULT_PLATFORM_ADMIN_EMAILS].map(normalizeEmail));
}

function parseEmailList(value: string | undefined) {
  return (value || "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
