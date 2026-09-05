import { NextResponse } from "next/server";
import { asCsv, requireSession } from "@/lib/api";
import { listTable } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const filter = url.searchParams.get("filter") || "all";
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 5000);
  let bookings = [] as Array<Record<string, unknown>>;
  try {
    bookings = (await listTable("smt_bookings")) as Array<Record<string, unknown>>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  bookings.sort((a, b) => String(b.created_at_smt || "").localeCompare(String(a.created_at_smt || "")));
  if (q) {
    bookings = bookings.filter((r) =>
      [r.customer_name, r.vrn, r.smt_id, r.status, r.vehicle_make].some((v) =>
        String(v || "").toLowerCase().includes(q),
      ),
    );
  }
  if (filter !== "all") {
    bookings = bookings.filter((r) => r.status_norm === filter);
  }
  bookings = bookings.slice(0, limit);
  if (url.searchParams.get("format") === "csv") {
    return asCsv(
      "smt-bookings.csv",
      ["smt_id", "customer_name", "vrn", "status", "created_at_smt", "fitting_at", "order_total", "services"],
      bookings.map((r) =>
        [r.smt_id, r.customer_name, r.vrn, r.status, r.created_at_smt, r.fitting_at, r.order_total, r.services].map((v) =>
          v == null ? "" : String(v),
        ),
      ),
    );
  }
  return NextResponse.json({ bookings, count: bookings.length });
}
