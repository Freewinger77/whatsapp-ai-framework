import { buildDashboardSeries } from "./analytics-series";
import { buildLeadConversion } from "./conversion";
import { npsHeadline } from "./hours";
import { memory, memoryEnabled } from "./memory";
import { adminClient, supabaseConfigured } from "./supabase/admin";
import type { SmtCustomer, SmtEnquiry, SmtNps, SmtTestimonial } from "./smt/types";

function usingMemory(): boolean {
  return memoryEnabled() && !supabaseConfigured();
}

export async function logEvent(
  kind: string,
  message: string,
  recordType?: string | null,
  recordId?: string | null,
  payload?: unknown,
): Promise<void> {
  if (usingMemory()) {
    memory.insert("smt_events", { kind, message, record_type: recordType ?? null, record_id: recordId ?? null, payload: payload ?? null });
    return;
  }
  if (!supabaseConfigured()) {
    console.log(`[smt_event] ${kind} ${message}`);
    return;
  }
  await adminClient().from("smt_events").insert({
    kind,
    message,
    record_type: recordType ?? null,
    record_id: recordId ?? null,
    payload: payload ?? null,
  });
}

export async function startPollRun(announce: boolean): Promise<string | null> {
  if (usingMemory()) {
    return String(memory.insert("smt_poll_runs", { announce, ok: false, scraped: 0 }).id);
  }
  if (!supabaseConfigured()) return null;
  const { data, error } = await adminClient()
    .from("smt_poll_runs")
    .insert({ announce, ok: false })
    .select("id")
    .single();
  if (error) {
    console.warn("startPollRun", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

export async function finishPollRun(
  id: string | null,
  stats: {
    ok: boolean;
    scraped: number;
    newCount: number;
    webhooked: number;
    refreshed: number;
    error?: string | null;
  },
): Promise<void> {
  if (!id) return;
  if (usingMemory()) {
    memory.update("smt_poll_runs", "id", id, {
      finished_at: new Date().toISOString(),
      ok: stats.ok,
      scraped: stats.scraped,
      new_count: stats.newCount,
      webhooked: stats.webhooked,
      refreshed: stats.refreshed,
      error: stats.error ?? null,
    });
    return;
  }
  if (!supabaseConfigured()) return;
  await adminClient()
    .from("smt_poll_runs")
    .update({
      finished_at: new Date().toISOString(),
      ok: stats.ok,
      scraped: stats.scraped,
      new_count: stats.newCount,
      webhooked: stats.webhooked,
      refreshed: stats.refreshed,
      error: stats.error ?? null,
    })
    .eq("id", id);
}

type UpsertResult = { isNew: boolean };

export async function upsertCustomer(row: SmtCustomer): Promise<UpsertResult> {
  if (usingMemory()) {
    const isNew = memory.upsert("smt_customers", "smt_id", {
      smt_id: row.smtId,
      phone_e164: row.phoneE164,
      name: row.name,
      first_name: row.firstName,
      last_name: row.lastName,
      email: row.email,
      phone: row.phone,
      postcode: row.postcode,
      source: row.source,
      stage: row.stage,
      last_booking_at: row.lastBookingAt,
      first_seen_at: memory.find("smt_customers", "smt_id", row.smtId)?.first_seen_at || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      raw: row.raw,
    });
    if (isNew) await logEvent("customer.created", `New customer ${row.name}`, "customer", row.smtId);
    return { isNew };
  }
  const db = adminClient();
  const { data: existing } = await db
    .from("smt_customers")
    .select("smt_id")
    .eq("smt_id", row.smtId)
    .maybeSingle();
  const now = new Date().toISOString();
  const payload = {
    smt_id: row.smtId,
    phone_e164: row.phoneE164,
    name: row.name,
    first_name: row.firstName,
    last_name: row.lastName,
    email: row.email,
    phone: row.phone,
    postcode: row.postcode,
    source: row.source,
    stage: row.stage,
    last_booking_at: row.lastBookingAt,
    last_seen_at: now,
    raw: row.raw,
    updated_at: now,
  };
  if (existing) {
    await db.from("smt_customers").update(payload).eq("smt_id", row.smtId);
    return { isNew: false };
  }
  await db.from("smt_customers").insert({
    ...payload,
    first_seen_at: now,
  });
  await logEvent("customer.created", `New customer ${row.name}`, "customer", row.smtId);
  return { isNew: true };
}

export async function upsertEnquiry(row: SmtEnquiry): Promise<UpsertResult> {
  if (usingMemory()) {
    const isNew = memory.upsert("smt_enquiries", "smt_id", {
      smt_id: row.smtId,
      customer_smt_id: row.customerSmtId,
      name: row.name,
      phone: row.phone,
      phone_e164: row.phoneE164,
      email: row.email,
      status: row.status,
      source: row.source,
      notes: row.notes,
      channel: row.channel,
      message: row.message,
      tags: row.tags,
      enquired_at: row.enquiredAt,
      in_hours: row.inHours,
      first_seen_at: memory.find("smt_enquiries", "smt_id", row.smtId)?.first_seen_at || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      raw: row.raw,
    });
    if (isNew) await logEvent("enquiry.created", `New enquiry ${row.name}`, "enquiry", row.smtId);
    return { isNew };
  }
  const db = adminClient();
  const { data: existing } = await db
    .from("smt_enquiries")
    .select("smt_id")
    .eq("smt_id", row.smtId)
    .maybeSingle();
  const now = new Date().toISOString();
  const payload = {
    smt_id: row.smtId,
    customer_smt_id: row.customerSmtId,
    name: row.name,
    phone: row.phone,
    phone_e164: row.phoneE164,
    email: row.email,
    status: row.status,
    source: row.source,
    notes: row.notes,
    channel: row.channel,
    message: row.message,
    tags: row.tags,
    enquired_at: row.enquiredAt,
    in_hours: row.inHours,
    last_seen_at: now,
    raw: row.raw,
    updated_at: now,
  };
  if (existing) {
    await db.from("smt_enquiries").update(payload).eq("smt_id", row.smtId);
    return { isNew: false };
  }
  await db.from("smt_enquiries").insert({ ...payload, first_seen_at: now });
  await logEvent("enquiry.created", `New enquiry ${row.name}`, "enquiry", row.smtId);
  return { isNew: true };
}

export async function upsertNps(row: SmtNps): Promise<UpsertResult> {
  if (usingMemory()) {
    const isNew = memory.upsert("smt_nps", "smt_id", {
      smt_id: row.smtId,
      score: row.score,
      reason: row.reason,
      comment: row.comment,
      name: row.name,
      phone: row.phone,
      phone_e164: row.phoneE164,
      scored_at: row.scoredAt,
      first_seen_at: memory.find("smt_nps", "smt_id", row.smtId)?.first_seen_at || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      raw: row.raw,
    });
    if (isNew) await logEvent("nps.created", `NPS ${row.score} from ${row.name || row.smtId}`, "nps", row.smtId);
    return { isNew };
  }
  const db = adminClient();
  const { data: existing } = await db.from("smt_nps").select("smt_id").eq("smt_id", row.smtId).maybeSingle();
  const now = new Date().toISOString();
  const payload = {
    smt_id: row.smtId,
    score: row.score,
    reason: row.reason,
    comment: row.comment,
    name: row.name,
    phone: row.phone,
    phone_e164: row.phoneE164,
    scored_at: row.scoredAt,
    last_seen_at: now,
    raw: row.raw,
    updated_at: now,
  };
  if (existing) {
    await db.from("smt_nps").update(payload).eq("smt_id", row.smtId);
    return { isNew: false };
  }
  await db.from("smt_nps").insert({ ...payload, first_seen_at: now });
  await logEvent("nps.created", `NPS ${row.score} from ${row.name || row.smtId}`, "nps", row.smtId);
  return { isNew: true };
}

export async function upsertTestimonial(row: SmtTestimonial): Promise<UpsertResult> {
  if (usingMemory()) {
    const isNew = memory.upsert("smt_testimonials", "smt_id", {
      smt_id: row.smtId,
      name: row.name,
      quote: row.quote,
      published_at: row.publishedAt,
      first_seen_at: memory.find("smt_testimonials", "smt_id", row.smtId)?.first_seen_at || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      raw: row.raw,
    });
    if (isNew) await logEvent("testimonial.created", `Testimonial from ${row.name}`, "testimonial", row.smtId);
    return { isNew };
  }
  const db = adminClient();
  const { data: existing } = await db
    .from("smt_testimonials")
    .select("smt_id")
    .eq("smt_id", row.smtId)
    .maybeSingle();
  const now = new Date().toISOString();
  const payload = {
    smt_id: row.smtId,
    name: row.name,
    quote: row.quote,
    published_at: row.publishedAt,
    last_seen_at: now,
    raw: row.raw,
    updated_at: now,
  };
  if (existing) {
    await db.from("smt_testimonials").update(payload).eq("smt_id", row.smtId);
    return { isNew: false };
  }
  await db.from("smt_testimonials").insert({ ...payload, first_seen_at: now });
  await logEvent("testimonial.created", `Testimonial from ${row.name}`, "testimonial", row.smtId);
  return { isNew: true };
}

export async function markWebhookSent(table: string, smtId: string): Promise<void> {
  if (usingMemory()) {
    memory.update(table, "smt_id", smtId, { webhook_sent_at: new Date().toISOString() });
    return;
  }
  await adminClient()
    .from(table)
    .update({ webhook_sent_at: new Date().toISOString() })
    .eq("smt_id", smtId);
}

export async function listEvents(limit = 150) {
  if (usingMemory()) return memory.all("smt_events").slice(0, limit);
  const { data, error } = await adminClient()
    .from("smt_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listEventsFor(recordType: string, recordId: string, limit = 80) {
  if (usingMemory()) {
    return memory
      .all("smt_events")
      .filter((e) => e.record_type === recordType && e.record_id === recordId)
      .slice(0, limit);
  }
  const { data, error } = await adminClient()
    .from("smt_events")
    .select("*")
    .eq("record_type", recordType)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function latestPoll() {
  if (usingMemory()) return memory.all("smt_poll_runs")[0] ?? null;
  const { data } = await adminClient()
    .from("smt_poll_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function counts() {
  if (usingMemory()) {
    const customers = memory.all("smt_customers");
    const enquiries = memory.all("smt_enquiries");
    const nps = memory.all("smt_nps");
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const scores = nps.map((r) => Number(r.score));
    return {
      customers: customers.length,
      enquiries: enquiries.length,
      nps: nps.length,
      testimonials: memory.all("smt_testimonials").length,
      newCustomers30d: customers.filter((c) => new Date(String(c.first_seen_at)).getTime() >= since).length,
      inHours: enquiries.filter((e) => e.in_hours).length,
      outHours: enquiries.filter((e) => !e.in_hours).length,
      emailLeads: enquiries.filter((e) => e.channel !== "phone").length,
      phoneLeads: enquiries.filter((e) => e.channel === "phone").length,
      npsHeadline: npsHeadline(scores),
    };
  }
  const db = adminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [customers, enquiries, nps, testimonials, newCustomers, inHours, outHours, emailLeads, phoneLeads] =
    await Promise.all([
      db.from("smt_customers").select("smt_id", { count: "exact", head: true }),
      db.from("smt_enquiries").select("smt_id", { count: "exact", head: true }),
      db.from("smt_nps").select("score"),
      db.from("smt_testimonials").select("smt_id", { count: "exact", head: true }),
      db.from("smt_customers").select("smt_id", { count: "exact", head: true }).gte("first_seen_at", since),
      db.from("smt_enquiries").select("smt_id", { count: "exact", head: true }).eq("in_hours", true),
      db.from("smt_enquiries").select("smt_id", { count: "exact", head: true }).eq("in_hours", false),
      db.from("smt_enquiries").select("smt_id", { count: "exact", head: true }).neq("channel", "phone"),
      db.from("smt_enquiries").select("smt_id", { count: "exact", head: true }).eq("channel", "phone"),
    ]);
  const scores = ((nps.data as Array<{ score: number }> | null) ?? []).map((r) => Number(r.score));
  return {
    customers: customers.count ?? 0,
    enquiries: enquiries.count ?? 0,
    nps: scores.length,
    testimonials: testimonials.count ?? 0,
    newCustomers30d: newCustomers.count ?? 0,
    inHours: inHours.count ?? 0,
    outHours: outHours.count ?? 0,
    emailLeads: emailLeads.count ?? 0,
    phoneLeads: phoneLeads.count ?? 0,
    npsHeadline: npsHeadline(scores),
  };
}

export async function analytics(days = 30) {
  const windowDays = Math.max(1, Math.min(366, Math.floor(days)));
  const since = new Date(Date.now() - windowDays * 2 * 24 * 60 * 60 * 1000).toISOString();
  if (usingMemory()) {
    const rows = memory.all("smt_enquiries") as Array<{
      enquired_at: string | null;
      in_hours: boolean;
      status: string | null;
      channel: string | null;
      first_seen_at: string;
    }>;
    const customers = memory.all("smt_customers") as Array<{ last_booking_at: string | null }>;
    return buildAnalytics(windowDays, rows, customers, memory.all("smt_nps").map((r) => Number(r.score)));
  }
  const db = adminClient();
  const [{ data: enquiries }, { data: customerRows }, { data: nps }, kpi] = await Promise.all([
    db
      .from("smt_enquiries")
      .select("enquired_at,in_hours,status,source,channel,first_seen_at")
      .gte("first_seen_at", since),
    db.from("smt_customers").select("last_booking_at").not("last_booking_at", "is", null).gte("last_booking_at", since),
    db.from("smt_nps").select("score,scored_at"),
    counts(),
  ]);
  const rows = (enquiries ?? []) as Array<{
    enquired_at: string | null;
    in_hours: boolean;
    status: string | null;
    channel: string | null;
    first_seen_at: string;
  }>;
  const customers = (customerRows ?? []) as Array<{ last_booking_at: string | null }>;
  const scores = ((nps ?? []) as Array<{ score: number }>).map((r) => Number(r.score));
  return buildAnalytics(windowDays, rows, customers, scores, kpi);
}

async function buildAnalytics(
  days: number,
  rows: Array<{
    enquired_at: string | null;
    in_hours: boolean;
    status: string | null;
    channel: string | null;
    first_seen_at: string;
  }>,
  customers: Array<{ last_booking_at: string | null }>,
  scores: number[],
  kpiCounts?: Awaited<ReturnType<typeof counts>>,
) {
  const kpi = kpiCounts ?? (await counts());
  const dash = buildDashboardSeries(
    days,
    rows.map((row) => ({
      at: row.enquired_at,
      firstSeenAt: row.first_seen_at,
      inHours: Boolean(row.in_hours),
      channel: row.channel,
    })),
    customers.map((row) => ({ bookedAt: row.last_booking_at })),
    kpi.customers,
  );
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, inHours: 0, outHours: 0 }));
  for (const row of rows) {
    const at = row.enquired_at || row.first_seen_at;
    const d = new Date(at);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(d),
    );
    if (Number.isFinite(hour)) {
      byHour[hour].total += 1;
      if (row.in_hours) byHour[hour].inHours += 1;
      else byHour[hour].outHours += 1;
    }
  }
  return {
    days: dash.days,
    from: dash.from,
    to: dash.to,
    kpi,
    series: dash.series,
    mix: dash.mix,
    pct: dash.pct,
    byDay: dash.series.map((d) => ({
      date: d.date,
      total: d.leads,
      inHours: d.inHours,
      outHours: d.outHours,
      email: d.email,
      phone: d.phone,
      customers: d.customers,
    })),
    byHour,
    typeMix: [
      { name: "Email enquiry", value: dash.mix.email },
      { name: "Phone enquiry", value: dash.mix.phone },
    ].filter((x) => x.value > 0),
    npsHeadline: npsHeadline(scores),
    npsCount: scores.length,
  };
}

export async function leadConversion() {
  const [leads, customers] = await Promise.all([listTable("smt_enquiries"), listTable("smt_customers")]);
  return buildLeadConversion(
    leads as Array<{
      smt_id: string;
      name: string | null;
      phone: string | null;
      phone_e164: string | null;
      email: string | null;
      channel: string | null;
      enquired_at: string | null;
      message: string | null;
    }>,
    customers as Array<{
      smt_id: string;
      name: string | null;
      phone_e164: string | null;
      email: string | null;
    }>,
  );
}

export async function listTable(table: string) {
  if (usingMemory()) return memory.all(table);
  const { data, error } = await adminClient().from(table).select("*");
  if (error) throw error;
  return data ?? [];
}
