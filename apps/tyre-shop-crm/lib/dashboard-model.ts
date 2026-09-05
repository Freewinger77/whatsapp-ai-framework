import type { DayBucket } from "./analytics-series";

export type EnquiryRow = {
  smt_id: string;
  name: string;
  phone: string | null;
  channel: string | null;
  in_hours: boolean;
  enquired_at: string | null;
  first_seen_at?: string | null;
};

export type ConversionPerson = {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  enquiryCount: number;
  customerSmtId: string;
};

export type ConversionData = {
  emailLeadRows: number;
  uniqueBooked: number;
  matchedRows: number;
  openRows: number;
  rowPct: number;
  peoplePct: number;
  uniqueLeadPeople: number;
  people: ConversionPerson[];
};

export type EventRow = { id: string; kind: string; message: string; created_at: string };

export type AnalyticsData = {
  from: string;
  to: string;
  kpi: {
    customers: number;
    emailLeads: number;
    phoneLeads: number;
    bookings: number;
    fitted: number;
    abandoned: number;
    cancelled?: number;
    nps: number;
    testimonials: number;
    npsHeadline: number | null;
  };
  series: DayBucket[];
  mix: {
    email: number;
    phone: number;
    leads: number;
    customers: number;
    bookings: number;
    fitted: number;
    inHours: number;
    outHours: number;
  };
  pct: {
    afterHours: number | null;
    phoneOfLeads: number | null;
    emailOfLeads: number | null;
    newCustomersOfAll: number | null;
    fittedOfBookings: number | null;
    vsPrevious: {
      leads: number | null;
      email: number | null;
      phone: number | null;
      customers: number | null;
      bookings: number | null;
    };
  };
  previous?: {
    leads: number;
    email: number;
    phone: number;
    customers: number;
    bookings: number;
  };
  smtHeadlineNps: number | null;
};

export function chartLabels(series: DayBucket[]): string[] {
  if (!series.length) return [];
  if (series.length <= 8) return series.map((d) => d.label);
  const step = (series.length - 1) / 6;
  return Array.from({ length: 7 }, (_, i) => series[Math.round(i * step)]?.label || "");
}

export function callbacks(enquiries: EnquiryRow[]): EnquiryRow[] {
  return [...enquiries]
    .filter((e) => !e.in_hours)
    .sort((a, b) => String(a.enquired_at || a.first_seen_at || "").localeCompare(String(b.enquired_at || b.first_seen_at || "")));
}

export function recentLeads(enquiries: EnquiryRow[], n = 5): EnquiryRow[] {
  return [...enquiries]
    .sort((a, b) => String(b.enquired_at || b.first_seen_at || "").localeCompare(String(a.enquired_at || a.first_seen_at || "")))
    .slice(0, n);
}

export function npsLabel(value: number | null | undefined): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? `${value}%` : `${value}%`;
}
