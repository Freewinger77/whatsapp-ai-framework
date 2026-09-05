import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { POLL_INTERVAL_MS, SHOP_NAME, SMT_MODE } from "@/lib/config";
import { createSmtClient } from "@/lib/smt/client";
import { readSettings } from "@/lib/settings";
import { counts, latestPoll } from "@/lib/store";
import { supabaseConfigured } from "@/lib/supabase/admin";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const ping = await createSmtClient().ping();
  const settings = await readSettings();
  return NextResponse.json({
    smt: ping,
    mode: SMT_MODE,
    shop: SHOP_NAME,
    supabase: supabaseConfigured(),
    stats: supabaseConfigured() || process.env.SMT_MODE === "mock" ? await counts() : null,
    latestPoll: supabaseConfigured() || process.env.SMT_MODE === "mock" ? await latestPoll() : null,
    config: {
      pollIntervalMs: settings.pollIntervalMs || POLL_INTERVAL_MS,
      webhookConfigured: Boolean(settings.webhookUrl),
      webhookUrl: settings.webhookUrl ? "[set]" : "",
      signWebhooks: settings.signWebhooks,
      sendEachOnce: settings.sendEachOnce,
      announceKinds: settings.announceKinds,
    },
  });
}
