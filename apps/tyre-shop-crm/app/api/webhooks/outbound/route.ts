import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { sendCreatedWebhook, type CreatedEvent, type OutboundRecord } from "@/lib/webhook";

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = (await request.json()) as { event?: CreatedEvent; record?: OutboundRecord };
  if (!body.event || !body.record?.id) {
    return NextResponse.json({ error: "event and record.id required" }, { status: 400 });
  }
  const result = await sendCreatedWebhook(body.event, body.record, { force: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
