import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { listEvents } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const limit = Number(new URL(request.url).searchParams.get("limit") || 150);
  return NextResponse.json({ events: await listEvents(Number.isFinite(limit) ? limit : 150) });
}
