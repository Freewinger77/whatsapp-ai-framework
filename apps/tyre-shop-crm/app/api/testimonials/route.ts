import { NextResponse } from "next/server";
import { asCsv, requireSession } from "@/lib/api";
import { listTable } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  let testimonials = [] as Array<Record<string, unknown>>;
  try {
    testimonials = (await listTable("smt_testimonials")) as Array<Record<string, unknown>>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  if (url.searchParams.get("format") === "csv") {
    return asCsv(
      "smt-testimonials.csv",
      ["smt_id", "name", "quote", "published_at"],
      testimonials.map((r) => [r.smt_id, r.name, r.quote, r.published_at]),
    );
  }
  return NextResponse.json({ testimonials, count: testimonials.length });
}
