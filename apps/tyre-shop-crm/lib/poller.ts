import { createSmtClient, type SmtClient } from "./smt/client";
import { enquiryExportMatchKey, phoneLeadsFromActivity } from "./smt/parse";
import type { SmtCustomer, SmtEnquiry, SmtNps, SmtTestimonial } from "./smt/types";
import { memoryEnabled } from "./memory";
import { readSettings, writeKv } from "./settings";
import { supabaseConfigured } from "./supabase/admin";
import {
  finishPollRun,
  logEvent,
  markWebhookSent,
  startPollRun,
  listTable,
  upsertCustomer,
  upsertEnquiry,
  upsertNps,
  upsertTestimonial,
} from "./store";
import { sendCreatedWebhook } from "./webhook";

export interface TickOptions {
  announce?: boolean;
  maxPages?: number;
  pageSize?: number;
  kinds?: Array<"customers" | "enquiries" | "nps" | "testimonials">;
  fullExport?: boolean;
}

export interface TickResult {
  scraped: number;
  newCount: number;
  webhooked: number;
  refreshed: number;
  ok: boolean;
  error?: string;
  pages: Record<string, number>;
}

const DEFAULT_INCREMENTAL_PAGES = 2;
const DEFAULT_BACKFILL_PAGES = 200;

async function walk<T>(
  kind: string,
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; hasMore: boolean }>,
  pageSize: number,
  maxPages: number,
  each: (item: T) => Promise<"new" | "refresh">,
): Promise<{ scraped: number; newCount: number; refreshed: number; pages: number }> {
  let scraped = 0;
  let newCount = 0;
  let refreshed = 0;
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page, pageSize);
    pages += 1;
    if (!result.items.length) break;
    for (const item of result.items) {
      scraped += 1;
      const status = await each(item);
      if (status === "new") newCount += 1;
      else refreshed += 1;
    }
    if (!result.hasMore) break;
  }
  return { scraped, newCount, refreshed, pages };
}

export async function tick(opts: TickOptions = {}, client?: SmtClient): Promise<TickResult> {
  const announce = opts.announce !== false && !opts.fullExport;
  const pageSize = opts.pageSize ?? (opts.fullExport ? 100 : 50);
  const maxPages = opts.maxPages ?? (opts.fullExport ? DEFAULT_BACKFILL_PAGES : DEFAULT_INCREMENTAL_PAGES);
  const kinds = opts.kinds ?? ["customers", "enquiries", "nps", "testimonials"];
  const empty: TickResult = { scraped: 0, newCount: 0, webhooked: 0, refreshed: 0, ok: true, pages: {} };

  if (!supabaseConfigured() && !memoryEnabled()) {
    return { ...empty, ok: false, error: "Supabase is not configured" };
  }

  const smt = client ?? createSmtClient();
  const settings = await readSettings();
  const runId = await startPollRun(announce);
  let scraped = 0;
  let newCount = 0;
  let webhooked = 0;
  let refreshed = 0;
  const pages: Record<string, number> = {};

  const maybeAnnounce = async (
    kind: "customers" | "enquiries" | "nps" | "testimonials",
    event: "customer.created" | "enquiry.created" | "nps.created" | "testimonial.created",
    table: string,
    record: { id: string; name: string; phone: string | null; at: string | null; extra?: Record<string, unknown> },
    isNew: boolean,
  ) => {
    if (!isNew) return;
    if (!announce) return;
    if (!settings.announceKinds.includes(kind)) return;
    const sent = await sendCreatedWebhook(event, record);
    if (sent.ok || sent.skipped) {
      await markWebhookSent(table, record.id);
      if (!sent.skipped) webhooked += 1;
    }
  };

  try {
    if (kinds.includes("customers")) {
      if (opts.fullExport) {
        try {
          const csv = await smt.exportCustomersCsv();
          pages.customersCsv = csv.length;
          if (csv.length) {
            await logEvent(
              "customer.export_skipped",
              `CSV export had ${csv.length} rows but no SMT View ids — HTML walk is the census`,
            );
          }
        } catch (err) {
          await logEvent("customer.export_failed", err instanceof Error ? err.message : String(err));
        }
      }
      const walked = await walk<SmtCustomer>(
        "customers",
        (page, size) => smt.listCustomers(page, size),
        pageSize,
        maxPages,
        async (row) => {
          const { isNew } = await upsertCustomer(row);
          await maybeAnnounce(
            "customers",
            "customer.created",
            "smt_customers",
            { id: row.smtId, name: row.name, phone: row.phoneE164 || row.phone, at: row.lastBookingAt },
            isNew,
          );
          return isNew ? "new" : "refresh";
        },
      );
      scraped += walked.scraped;
      newCount += walked.newCount;
      refreshed += walked.refreshed;
      pages.customers = walked.pages;
    }

    if (kinds.includes("enquiries")) {
      const walked = await walk<SmtEnquiry>(
        "enquiries",
        (page, size) => smt.listEnquiries(page, size),
        pageSize,
        maxPages,
        async (row) => {
          const { isNew } = await upsertEnquiry(row);
          await maybeAnnounce(
            "enquiries",
            "enquiry.created",
            "smt_enquiries",
            {
              id: row.smtId,
              name: row.name,
              phone: row.phoneE164 || row.phone,
              at: row.enquiredAt,
              extra: {
                email: row.email,
                channel: row.channel,
                source: row.source,
                status: row.status,
                message: row.message,
                notes: row.notes,
                tags: row.tags,
              },
            },
            isNew,
          );
          return isNew ? "new" : "refresh";
        },
      );
      scraped += walked.scraped;
      newCount += walked.newCount;
      refreshed += walked.refreshed;
      pages.enquiries = walked.pages;

      try {
        const exported = await smt.exportEnquiriesCsv();
        const existing = (await listTable("smt_enquiries")) as Array<Record<string, unknown>>;
        const byKey = new Map<string, Record<string, unknown>>();
        for (const row of existing) {
          const key = enquiryExportMatchKey({
            phoneE164: row.phone_e164 as string | null,
            email: row.email as string | null,
            name: row.name as string | null,
            enquiredAt: row.enquired_at as string | null,
          });
          if (key) byKey.set(key, row);
        }
        let enriched = 0;
        for (const csv of exported) {
          const key = enquiryExportMatchKey(csv);
          const match = key ? byKey.get(key) : null;
          if (!match || match.channel === "phone") continue;
          const { isNew } = await upsertEnquiry({
            smtId: String(match.smt_id),
            customerSmtId: (match.customer_smt_id as string | null) || null,
            name: String(match.name || csv.name),
            email: (match.email as string | null) || csv.email,
            phone: (match.phone as string | null) || csv.phone,
            phoneE164: (match.phone_e164 as string | null) || csv.phoneE164,
            status: (match.status as string | null) || csv.status,
            source: "Enquiry Received",
            notes: csv.notes || (match.notes as string | null),
            channel: "email",
            message: csv.message,
            tags: csv.tags,
            enquiredAt: (match.enquired_at as string | null) || csv.enquiredAt,
            inHours: Boolean(match.in_hours),
            raw: { ...(typeof match.raw === "object" && match.raw ? match.raw : {}), export: csv.raw },
          });
          enriched += 1;
          if (isNew) newCount += 1;
          else refreshed += 1;
        }
        pages.enquiriesCsv = exported.length;
        pages.enquiriesEnriched = enriched;
      } catch (err) {
        await logEvent("enquiry.export_failed", err instanceof Error ? err.message : String(err));
      }

      try {
        const activity = await smt.listHomeActivity();
        const phoneLeads = phoneLeadsFromActivity(activity);
        for (const row of phoneLeads) {
          const { isNew } = await upsertEnquiry(row);
          scraped += 1;
          if (isNew) {
            newCount += 1;
            await maybeAnnounce(
              "enquiries",
              "enquiry.created",
              "smt_enquiries",
              {
                id: row.smtId,
                name: row.name,
                phone: row.phoneE164 || row.phone,
                at: row.enquiredAt,
                extra: {
                  email: row.email,
                  channel: row.channel,
                  source: row.source,
                  status: row.status,
                  message: row.message,
                  notes: row.notes,
                  tags: row.tags,
                },
              },
              true,
            );
          } else refreshed += 1;
        }
        pages.phoneLeads = phoneLeads.length;
      } catch (err) {
        await logEvent("enquiry.activity_failed", err instanceof Error ? err.message : String(err));
      }
    }

    if (kinds.includes("nps")) {
      const walked = await walk<SmtNps>(
        "nps",
        (page, size) => smt.listNps(page, size),
        pageSize,
        maxPages,
        async (row) => {
          const { isNew } = await upsertNps(row);
          await maybeAnnounce(
            "nps",
            "nps.created",
            "smt_nps",
            { id: row.smtId, name: row.name || `NPS ${row.score}`, phone: row.phoneE164 || row.phone, at: row.scoredAt },
            isNew,
          );
          return isNew ? "new" : "refresh";
        },
      );
      scraped += walked.scraped;
      newCount += walked.newCount;
      refreshed += walked.refreshed;
      pages.nps = walked.pages;
      try {
        const headline = await smt.headlineNps();
        await writeKv("nps_headline", headline);
        pages.npsHeadline = headline ?? 0;
      } catch (err) {
        await logEvent("nps.headline_failed", err instanceof Error ? err.message : String(err));
      }
    }

    if (kinds.includes("testimonials")) {
      const walked = await walk<SmtTestimonial>(
        "testimonials",
        (page, size) => smt.listTestimonials(page, size),
        pageSize,
        maxPages,
        async (row) => {
          const { isNew } = await upsertTestimonial(row);
          await maybeAnnounce(
            "testimonials",
            "testimonial.created",
            "smt_testimonials",
            { id: row.smtId, name: row.name, phone: null, at: row.publishedAt },
            isNew,
          );
          return isNew ? "new" : "refresh";
        },
      );
      scraped += walked.scraped;
      newCount += walked.newCount;
      refreshed += walked.refreshed;
      pages.testimonials = walked.pages;
    }

    await finishPollRun(runId, { ok: true, scraped, newCount, webhooked, refreshed });
    await logEvent(
      "poll.ok",
      `Scraped ${scraped}, ${newCount} new, ${webhooked} webhooked, ${refreshed} refreshed${announce ? "" : " (no announce)"}`,
    );
    return { scraped, newCount, webhooked, refreshed, ok: true, pages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishPollRun(runId, {
      ok: false,
      scraped,
      newCount,
      webhooked,
      refreshed,
      error: message,
    });
    await logEvent("poll.error", message);
    return { scraped, newCount, webhooked, refreshed, ok: false, error: message, pages };
  }
}
