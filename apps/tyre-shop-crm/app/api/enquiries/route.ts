import { NextResponse } from "next/server";
import { asCsv, requireSession } from "@/lib/api";
import { bookedLeadIds } from "@/lib/conversion";
import { leadConversion, listTable } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const filter = url.searchParams.get("filter") || "all";
  const hours = url.searchParams.get("hours");
  const channel = url.searchParams.get("channel");
  const booked = url.searchParams.get("booked");
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 5000);
  let enquiries = [] as Array<Record<string, unknown>>;
  try {
    enquiries = (await listTable("smt_enquiries")) as Array<Record<string, unknown>>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  if (q) {
    enquiries = enquiries.filter((r) =>
      [r.name, r.phone, r.email, r.smt_id].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }
  if (filter === "new") enquiries = enquiries.filter((r) => String(r.status || "").toLowerCase().includes("new"));
  if (filter === "needs") enquiries = enquiries.filter((r) => !r.webhook_sent_at);
  if (hours === "in") enquiries = enquiries.filter((r) => r.in_hours);
  if (hours === "out") enquiries = enquiries.filter((r) => !r.in_hours);
  if (channel === "phone") enquiries = enquiries.filter((r) => r.channel === "phone");
  if (channel === "email") enquiries = enquiries.filter((r) => r.channel !== "phone");
  if (booked === "yes" || booked === "no") {
    const bookedIds = bookedLeadIds(await leadConversion());
    enquiries = enquiries.filter((r) => {
      const hit = bookedIds.has(String(r.smt_id));
      return booked === "yes" ? hit : !hit && r.channel !== "phone";
    });
  }
  enquiries.sort((a, b) => String(b.enquired_at || "").localeCompare(String(a.enquired_at || "")));
  enquiries = enquiries.slice(0, limit);
  if (url.searchParams.get("format") === "csv") {
    return asCsv(
      "smt-leads.csv",
      ["smt_id", "name", "phone", "email", "channel", "status", "message", "in_hours", "enquired_at"],
      enquiries.map((r) =>
        [r.smt_id, r.name, r.phone, r.email, r.channel, r.status, r.message, r.in_hours, r.enquired_at].map((v) =>
          v == null ? "" : String(v),
        ),
      ),
    );
  }
  return NextResponse.json({ enquiries, count: enquiries.length });
}
