import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { readSettings, writeSettings } from "@/lib/settings";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  const settings = await readSettings();
  return NextResponse.json({
    settings: {
      ...settings,
      webhookSecret: settings.webhookSecret ? "[set]" : "",
    },
  });
}

export async function PUT(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = (await request.json()) as Record<string, unknown>;
  const patch: Parameters<typeof writeSettings>[0] = {};
  if (typeof body.webhookUrl === "string") patch.webhookUrl = body.webhookUrl;
  if (typeof body.webhookSecret === "string" && body.webhookSecret !== "[set]") {
    patch.webhookSecret = body.webhookSecret;
  }
  if (typeof body.signWebhooks === "boolean") patch.signWebhooks = body.signWebhooks;
  if (typeof body.sendEachOnce === "boolean") patch.sendEachOnce = body.sendEachOnce;
  if (Array.isArray(body.announceKinds)) patch.announceKinds = body.announceKinds.map(String);
  if (typeof body.pollIntervalMs === "number") patch.pollIntervalMs = body.pollIntervalMs;
  const settings = await writeSettings(patch);
  return NextResponse.json({
    ok: true,
    settings: { ...settings, webhookSecret: settings.webhookSecret ? "[set]" : "" },
  });
}
