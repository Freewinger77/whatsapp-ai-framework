/** London-facing labels used by the RapidScreen dashboard. */

const LONDON = "Europe/London";

export function londonParts(at: Date | string): Record<string, string> {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return {};
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: LONDON,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
}

export function londonDateKey(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatLeadWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = londonParts(iso);
  if (!p.weekday) return "—";
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute}`;
}

export function formatCallbackWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = londonParts(iso);
  if (!p.weekday) return "—";
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

export function formatPollTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatPollClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = londonParts(iso);
  return p.hour ? `${p.hour}:${p.minute}` : "—";
}

export function formatActivityWhen(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const p = londonParts(iso);
  if (!p.hour) return "—";
  if (londonDateKey(iso) === londonDateKey(now)) return `${p.hour}:${p.minute}`;
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

export function formatDayRange(fromKey: string, toKey: string): string {
  const a = labelFromKey(fromKey);
  const b = labelFromKey(toKey);
  if (!a || !b) return "";
  return `${a} – ${b}`;
}

function labelFromKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(noon);
}

export function formatUkPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  let local = digits;
  if (digits.startsWith("44") && digits.length >= 12) local = `0${digits.slice(2)}`;
  if (local.startsWith("07") && local.length === 11) return `${local.slice(0, 5)} ${local.slice(5)}`;
  return String(raw).trim();
}

export function whatsappHref(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  let e164 = digits;
  if (digits.startsWith("0") && digits.length >= 10) e164 = `44${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("7")) e164 = `44${digits}`;
  if (e164.length < 10) return null;
  return `https://wa.me/${e164}`;
}

export function leadDisplayName(name: string | null | undefined): { text: string; missing: boolean } {
  const text = String(name || "").trim();
  if (!text || /^unknown|no caller|no name$/i.test(text)) return { text: "No caller ID", missing: true };
  return { text, missing: false };
}

export function periodTitle(days: number): string {
  if (days <= 7) return "This week";
  if (days <= 30) return "Last 30 days";
  return "Last 90 days";
}

export function periodVsLabel(days: number): string {
  if (days <= 7) return "last week";
  if (days <= 30) return "last 30 days";
  return "last 90 days";
}

export function periodKpiLabel(noun: string, days: number): string {
  if (days <= 7) return `${noun} this week`;
  if (days <= 30) return `${noun} last 30 days`;
  return `${noun} last 90 days`;
}

export function periodScope(days: number): string {
  if (days <= 7) return "this week";
  if (days <= 30) return "the last 30 days";
  return "the last 90 days";
}

export function changeArrow(value: number | null | undefined): { arrow: string; color: string; abs: string } | null {
  if (value == null) return null;
  if (value === 0) return { arrow: "", color: "var(--black-80)", abs: "0" };
  if (value > 0) return { arrow: "↑", color: "rgb(48,209,88)", abs: String(Math.abs(value)) };
  return { arrow: "↓", color: "rgb(255,59,48)", abs: String(Math.abs(value)) };
}

export function listPages(count: number, perPage: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / perPage);
}

export function formatActivityLine(kind: string, message: string): string {
  const k = (kind || "").toLowerCase();
  if (k.startsWith("poll")) {
    if (/no new|0 new|scraped 0|new_count.?0/i.test(message)) return "Poller ran · no new rows";
    return message ? `Poller ran · ${message}` : "Poller ran";
  }
  return message || kind || "—";
}
