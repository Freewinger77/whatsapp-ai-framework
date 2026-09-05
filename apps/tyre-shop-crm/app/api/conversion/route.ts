import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { leadConversion } from "@/lib/store";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    return NextResponse.json(await leadConversion());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
