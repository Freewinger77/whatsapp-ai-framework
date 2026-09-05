/** UK-first E.164. Used as the customer fallback dedupe key. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && /^\+\d{8,15}$/.test(digits)) return digits;
  const only = digits.replace(/\D/g, "");
  if (!only) return null;
  if (only.startsWith("44") && only.length >= 11) return `+${only}`;
  if (only.startsWith("0") && only.length >= 10) return `+44${only.slice(1)}`;
  if (only.length === 10 && only.startsWith("7")) return `+44${only}`;
  if (only.length >= 8 && only.length <= 15) return `+${only}`;
  return null;
}
