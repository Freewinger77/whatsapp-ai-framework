import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { listEventsFor, listTable } from "@/lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  const data = (await listTable("smt_enquiries")).find((r) => r.smt_id === id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ enquiry: data, events: await listEventsFor("enquiry", id) });
}
