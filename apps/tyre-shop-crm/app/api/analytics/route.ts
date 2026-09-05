import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { analytics } from "@/lib/store";
import { createSmtClient } from "@/lib/smt/client";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const days = Number(new URL(request.url).searchParams.get("days") || 30);
  const data = await analytics(Number.isFinite(days) ? days : 30);
  let smtHeadline: number | null = null;
  try {
    smtHeadline = await createSmtClient().headlineNps();
  } catch {
    smtHeadline = null;
  }
  return NextResponse.json({ ...data, smtHeadlineNps: smtHeadline });
}
