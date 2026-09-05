/** In-hours: Mon–Sat 09:00–17:00 Europe/London. Sunday and evenings are out of hours. */

export const IN_HOURS_TIMEZONE = "Europe/London";
export const IN_HOURS_DAYS = [1, 2, 3, 4, 5, 6] as const; // Mon–Sat, ISO weekday
export const IN_HOURS_START = 9;
export const IN_HOURS_END = 17;

function londonParts(at: Date): { weekday: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: IN_HOURS_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    weekday: weekdayMap[parts.weekday] ?? 7,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function isInHours(at: Date | string | null | undefined): boolean {
  if (!at) return false;
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return false;
  const { weekday, hour, minute } = londonParts(date);
  if (!IN_HOURS_DAYS.includes(weekday as (typeof IN_HOURS_DAYS)[number])) return false;
  const minutes = hour * 60 + minute;
  return minutes >= IN_HOURS_START * 60 && minutes < IN_HOURS_END * 60;
}

export function npsBucket(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export function npsHeadline(scores: number[]): number | null {
  if (!scores.length) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 10000) / 100;
}
