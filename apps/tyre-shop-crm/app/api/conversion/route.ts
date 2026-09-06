import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { leadConversion } from "@/lib/store";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const raw = Number(new URL(request.url).searchParams.get("days") || 0);
    const days = Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.min(366, Math.floor(raw))) : undefined;
    return NextResponse.json(await leadConversion(days));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
