import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { readKv } from "@/lib/settings";
import { analytics } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const raw = Number(new URL(request.url).searchParams.get("days") || 7);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(366, raw)) : 7;
  const data = await analytics(days);
  const cached = await readKv<number>("nps_headline");
  return NextResponse.json({ ...data, smtHeadlineNps: cached });
}
