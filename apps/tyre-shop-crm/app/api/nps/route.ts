import { NextResponse } from "next/server";
import { asCsv, requireSession } from "@/lib/api";
import { npsHeadline } from "@/lib/hours";
import { listTable } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  let rows = [] as Array<Record<string, unknown>>;
  try {
    rows = (await listTable("smt_nps")) as Array<Record<string, unknown>>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
  if (url.searchParams.get("format") === "csv") {
    return asCsv(
      "smt-nps.csv",
      ["smt_id", "score", "reason", "comment", "name", "phone", "scored_at"],
      rows.map((r) =>
        [r.smt_id, r.score, r.reason, r.comment, r.name, r.phone, r.scored_at].map((v) =>
          v == null ? "" : String(v),
        ),
      ),
    );
  }
  return NextResponse.json({
    nps: rows,
    count: rows.length,
    headline: npsHeadline(rows.map((r) => Number(r.score))),
  });
}
