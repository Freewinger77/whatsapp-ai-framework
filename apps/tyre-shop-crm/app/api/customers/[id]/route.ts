import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { listEventsFor, listTable } from "@/lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const rows = await listTable("smt_customers");
  const data = rows.find((r) => r.smt_id === id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    customer: data,
    events: await listEventsFor("customer", id),
  });
}
