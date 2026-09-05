import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { readKv } from "@/lib/settings";
import { analytics } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const days = Number(new URL(request.url).searchParams.get("days") || 30);
  const data = await analytics(Number.isFinite(days) ? days : 30);
  const cached = await readKv<number>("nps_headline");
  return NextResponse.json({ ...data, smtHeadlineNps: cached });
}
