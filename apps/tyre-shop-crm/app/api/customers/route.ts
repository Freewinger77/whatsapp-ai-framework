import { NextResponse } from "next/server";
import { asCsv, requireSession } from "@/lib/api";
import { listTable } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const filter = url.searchParams.get("filter") || "all";
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 5000);
  let customers = [] as Array<Record<string, unknown>>;
  try {
    customers = (await listTable("smt_customers")) as Array<Record<string, unknown>>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  if (q) {
    customers = customers.filter((r) =>
      [r.name, r.phone, r.email, r.smt_id].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }
  if (filter === "new") {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    customers = customers.filter((r) => new Date(String(r.first_seen_at)).getTime() >= since);
  } else if (filter === "needs") {
    customers = customers.filter((r) => !r.webhook_sent_at);
  }
  customers = customers.slice(0, limit);
  if (url.searchParams.get("format") === "csv") {
    return asCsv(
      "smt-customers.csv",
      ["smt_id", "name", "phone", "email", "postcode", "source", "stage", "first_seen_at"],
      customers.map((r) => [r.smt_id, r.name, r.phone, r.email, r.postcode, r.source, r.stage, r.first_seen_at]),
    );
  }
  return NextResponse.json({ customers, count: customers.length });
}
