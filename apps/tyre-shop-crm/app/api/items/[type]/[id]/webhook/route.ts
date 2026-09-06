import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { listTable, markWebhookSent } from "@/lib/store";
import { sendCreatedWebhook, type CreatedEvent } from "@/lib/webhook";

const MAP = {
  customers: { table: "smt_customers", event: "customer.created" as CreatedEvent, type: "customer" },
  customer: { table: "smt_customers", event: "customer.created" as CreatedEvent, type: "customer" },
  enquiries: { table: "smt_enquiries", event: "enquiry.created" as CreatedEvent, type: "enquiry" },
  enquiry: { table: "smt_enquiries", event: "enquiry.created" as CreatedEvent, type: "enquiry" },
  nps: { table: "smt_nps", event: "nps.created" as CreatedEvent, type: "nps" },
  testimonials: { table: "smt_testimonials", event: "testimonial.created" as CreatedEvent, type: "testimonial" },
  testimonial: { table: "smt_testimonials", event: "testimonial.created" as CreatedEvent, type: "testimonial" },
} as const;

export async function POST(_request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { type, id } = await params;
  const spec = MAP[type as keyof typeof MAP];
  if (!spec) return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  const data = (await listTable(spec.table)).find((r) => r.smt_id === id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = data as Record<string, string | null>;
  const result = await sendCreatedWebhook(
    spec.event,
    {
      id,
      name: row.name || id,
      phone: row.phone_e164 || row.phone,
      at: row.enquired_at || row.scored_at || row.published_at || row.first_seen_at,
      extra:
        spec.type === "enquiry"
          ? {
              email: row.email,
              channel: row.channel,
              source: row.source,
              status: row.status,
              message: row.message,
              notes: row.notes,
              tags: row.tags,
            }
          : undefined,
    },
    { force: true },
  );
  if (result.ok || result.skipped) await markWebhookSent(spec.table, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
