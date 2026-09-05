import { createHmac } from "node:crypto";
import { PLATFORM, SHOP_NAME } from "./config";
import { isInHours } from "./hours";
import { readSettings } from "./settings";
import { logEvent } from "./store";

export type CreatedEvent =
  | "customer.created"
  | "enquiry.created"
  | "nps.created"
  | "testimonial.created";

export interface OutboundRecord {
  id: string;
  name: string;
  phone: string | null;
  at: string | null;
  extra?: Record<string, unknown>;
}

export async function sendCreatedWebhook(
  event: CreatedEvent,
  record: OutboundRecord,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; skipped?: boolean; status?: number; body?: string }> {
  const settings = await readSettings();
  if (!settings.webhookUrl) {
    await logEvent("webhook.skipped", `No WEBHOOK_URL; ${event} ${record.id}`, event.split(".")[0], record.id);
    return { ok: true, skipped: true };
  }
  const at = record.at || new Date().toISOString();
  const payload = {
    event,
    platform: PLATFORM,
    shop: SHOP_NAME,
    in_hours: isInHours(at),
    record: {
      id: record.id,
      name: record.name,
      phone: record.phone,
      at,
      ...record.extra,
    },
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "tyre-shop-crm/0.1",
  };
  if (settings.signWebhooks && settings.webhookSecret) {
    headers["X-Signature"] = createHmac("sha256", settings.webhookSecret).update(body).digest("hex");
    headers["X-Webhook-Secret"] = settings.webhookSecret;
  }
  const res = await fetch(settings.webhookUrl, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) {
    await logEvent(
      "webhook.failed",
      `HTTP ${res.status} for ${event} ${record.id}`,
      event.split(".")[0],
      record.id,
      { status: res.status, body: text.slice(0, 400), force: Boolean(opts?.force) },
    );
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
  await logEvent("webhook.sent", `Sent ${event} ${record.name || record.id}`, event.split(".")[0], record.id);
  return { ok: true, status: res.status, body: text.slice(0, 500) };
}
