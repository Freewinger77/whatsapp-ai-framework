import { NextResponse } from "next/server";
import { POLL_INTERVAL_MS, SHOP_NAME, SMT_MODE, TRACKED_KINDS } from "@/lib/config";
import { readSettings } from "@/lib/settings";

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json({
    ok: true,
    mode: SMT_MODE,
    shop: SHOP_NAME,
    platform: "sellmoretyres",
    trackedKinds: TRACKED_KINDS,
    pollIntervalMs: settings.pollIntervalMs || POLL_INTERVAL_MS,
    webhookConfigured: Boolean(settings.webhookUrl),
    inHours: "Mon–Sat 09:00–17:00 Europe/London",
  });
}
