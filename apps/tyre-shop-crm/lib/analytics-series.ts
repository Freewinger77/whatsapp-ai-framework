/** Pure series builders for dashboard charts. Dates are Europe/London calendar days. */

export const LONDON = "Europe/London";

export type LeadPoint = {
  at: string | null;
  firstSeenAt?: string | null;
  inHours: boolean;
  channel: string | null;
};

export type CustomerPoint = {
  firstSeenAt: string | null;
};

export type DayBucket = {
  date: string;
  label: string;
  leads: number;
  email: number;
  phone: number;
  customers: number;
  inHours: number;
  outHours: number;
};

export type DashboardSeries = {
  days: number;
  from: string;
  to: string;
  series: DayBucket[];
  mix: {
    email: number;
    phone: number;
    leads: number;
    customers: number;
    inHours: number;
    outHours: number;
  };
  pct: {
    afterHours: number | null;
    phoneOfLeads: number | null;
    emailOfLeads: number | null;
    newCustomersOfAll: number | null;
    vsPrevious: {
      leads: number | null;
      email: number | null;
      phone: number | null;
      customers: number | null;
    };
  };
};

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

export function londonDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(noon);
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return noon.toISOString().slice(0, 10);
}

export function lastLondonDays(count: number, now = new Date()): string[] {
  const today = londonDateKey(now);
  const n = Math.max(1, Math.min(366, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => shiftDateKey(today, i - (n - 1)));
}

export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function emptyBucket(date: string): DayBucket {
  return {
    date,
    label: londonDayLabel(date),
    leads: 0,
    email: 0,
    phone: 0,
    customers: 0,
    inHours: 0,
    outHours: 0,
  };
}

function isPhone(channel: string | null): boolean {
  return (channel || "").toLowerCase() === "phone";
}

export function buildDashboardSeries(
  days: number,
  leads: LeadPoint[],
  customers: CustomerPoint[],
  allCustomerCount: number,
  now = new Date(),
): DashboardSeries {
  const keys = lastLondonDays(days, now);
  const from = keys[0];
  const to = keys[keys.length - 1];
  // Previous window: the same number of London days immediately before `from`.
  const previous = Array.from({ length: keys.length }, (_, i) => shiftDateKey(from, i - keys.length));

  const map = new Map(keys.map((k) => [k, emptyBucket(k)]));
  const prev = { leads: 0, email: 0, phone: 0, customers: 0 };

  for (const row of leads) {
    const key = londonDateKey(row.at || row.firstSeenAt || "");
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) {
      bucket.leads += 1;
      if (isPhone(row.channel)) bucket.phone += 1;
      else bucket.email += 1;
      if (row.inHours) bucket.inHours += 1;
      else bucket.outHours += 1;
    } else if (previous.includes(key)) {
      prev.leads += 1;
      if (isPhone(row.channel)) prev.phone += 1;
      else prev.email += 1;
    }
  }

  for (const row of customers) {
    const key = londonDateKey(row.firstSeenAt || "");
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.customers += 1;
    else if (previous.includes(key)) prev.customers += 1;
  }

  const series = keys.map((k) => map.get(k) || emptyBucket(k));
  const mix = series.reduce(
    (acc, d) => {
      acc.email += d.email;
      acc.phone += d.phone;
      acc.leads += d.leads;
      acc.customers += d.customers;
      acc.inHours += d.inHours;
      acc.outHours += d.outHours;
      return acc;
    },
    { email: 0, phone: 0, leads: 0, customers: 0, inHours: 0, outHours: 0 },
  );

  return {
    days: keys.length,
    from,
    to,
    series,
    mix,
    pct: {
      afterHours: pct(mix.outHours, mix.leads),
      phoneOfLeads: pct(mix.phone, mix.leads),
      emailOfLeads: pct(mix.email, mix.leads),
      newCustomersOfAll: pct(mix.customers, allCustomerCount),
      vsPrevious: {
        leads: pctChange(mix.leads, prev.leads),
        email: pctChange(mix.email, prev.email),
        phone: pctChange(mix.phone, prev.phone),
        customers: pctChange(mix.customers, prev.customers),
      },
    },
  };
}
