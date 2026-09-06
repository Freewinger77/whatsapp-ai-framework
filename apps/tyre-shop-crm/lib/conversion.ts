import { lastLondonDays, londonDateKey } from "./analytics-series";

export interface ConversionLead {
  smt_id: string;
  name: string | null;
  phone: string | null;
  phone_e164: string | null;
  email: string | null;
  channel: string | null;
  enquired_at: string | null;
  message?: string | null;
}

export interface ConversionCustomer {
  smt_id: string;
  name: string | null;
  phone_e164: string | null;
  email: string | null;
}

export interface ConversionMatch {
  leadSmtId: string;
  leadName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  enquiredAt: string | null;
  message: string | null;
  customerSmtId: string;
  customerName: string;
  how: "phone" | "email" | "phone+email";
}

export interface ConversionPerson {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  enquiryCount: number;
  customerSmtId: string;
  customerName: string;
  lastEnquiredAt: string | null;
}

export interface LeadConversion {
  emailLeadRows: number;
  uniqueLeadPeople: number;
  matchedRows: number;
  uniqueBooked: number;
  openRows: number;
  rowPct: number;
  peoplePct: number;
  matches: ConversionMatch[];
  people: ConversionPerson[];
}

function normEmail(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function personKey(phoneE164: string | null | undefined, email: string | null | undefined): string | null {
  if (phoneE164) return `p:${phoneE164}`;
  const em = normEmail(email);
  if (em) return `e:${em}`;
  return null;
}

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function buildLeadConversion(
  leads: ConversionLead[],
  customers: ConversionCustomer[],
): LeadConversion {
  const emailLeads = leads.filter((l) => l.channel !== "phone");
  const byPhone = new Map<string, ConversionCustomer>();
  const byEmail = new Map<string, ConversionCustomer>();
  for (const customer of customers) {
    if (customer.phone_e164) byPhone.set(customer.phone_e164, customer);
    const email = normEmail(customer.email);
    if (email) byEmail.set(email, customer);
  }

  const matches: ConversionMatch[] = [];
  const uniqueLeadKeys = new Set<string>();
  for (const lead of emailLeads) {
    const key = personKey(lead.phone_e164, lead.email);
    if (key) uniqueLeadKeys.add(key);
    const email = normEmail(lead.email);
    const viaPhone = lead.phone_e164 ? byPhone.get(lead.phone_e164) : undefined;
    const viaEmail = email ? byEmail.get(email) : undefined;
    const customer = viaPhone || viaEmail;
    if (!customer) continue;
    matches.push({
      leadSmtId: lead.smt_id,
      leadName: lead.name || "Lead",
      leadPhone: lead.phone,
      leadEmail: lead.email,
      enquiredAt: lead.enquired_at,
      message: lead.message || null,
      customerSmtId: customer.smt_id,
      customerName: customer.name || "Customer",
      how: viaPhone && viaEmail ? "phone+email" : viaPhone ? "phone" : "email",
    });
  }

  const peopleMap = new Map<string, ConversionPerson>();
  for (const match of matches) {
    const key = personKey(
      match.leadPhone ? leads.find((l) => l.smt_id === match.leadSmtId)?.phone_e164 : null,
      match.leadEmail,
    ) || `id:${match.customerSmtId}`;
    const existing = peopleMap.get(key);
    const last =
      !existing?.lastEnquiredAt || (match.enquiredAt && match.enquiredAt > existing.lastEnquiredAt)
        ? match.enquiredAt
        : existing.lastEnquiredAt;
    peopleMap.set(key, {
      key,
      name: match.leadName,
      phone: match.leadPhone || existing?.phone || null,
      email: match.leadEmail || existing?.email || null,
      enquiryCount: (existing?.enquiryCount || 0) + 1,
      customerSmtId: match.customerSmtId,
      customerName: match.customerName,
      lastEnquiredAt: last,
    });
  }

  const people = [...peopleMap.values()].sort((a, b) =>
    String(b.lastEnquiredAt || "").localeCompare(String(a.lastEnquiredAt || "")),
  );

  return {
    emailLeadRows: emailLeads.length,
    uniqueLeadPeople: uniqueLeadKeys.size,
    matchedRows: matches.length,
    uniqueBooked: people.length,
    openRows: emailLeads.length - matches.length,
    rowPct: pct(matches.length, emailLeads.length),
    peoplePct: pct(people.length, uniqueLeadKeys.size || emailLeads.length),
    matches: matches.sort((a, b) => String(b.enquiredAt || "").localeCompare(String(a.enquiredAt || ""))),
    people,
  };
}

export function bookedLeadIds(conversion: LeadConversion): Set<string> {
  return new Set(conversion.matches.map((m) => m.leadSmtId));
}

export function leadsInLondonWindow<T extends { enquired_at: string | null }>(
  leads: T[],
  days: number,
  now = new Date(),
): T[] {
  const keys = new Set(lastLondonDays(days, now));
  return leads.filter((lead) => {
    const key = londonDateKey(lead.enquired_at || "");
    return Boolean(key && keys.has(key));
  });
}
