import { POLL_INTERVAL_MS } from "./config";
import { memory, memoryEnabled } from "./memory";
import { adminClient, supabaseConfigured } from "./supabase/admin";

export interface RuntimeSettings {
  webhookUrl: string;
  webhookSecret: string;
  signWebhooks: boolean;
  sendEachOnce: boolean;
  announceKinds: string[];
  pollIntervalMs: number;
}

const DEFAULTS: RuntimeSettings = {
  webhookUrl: process.env.WEBHOOK_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  signWebhooks: Boolean(process.env.WEBHOOK_SECRET),
  sendEachOnce: true,
  announceKinds: ["customers", "enquiries", "nps", "testimonials"],
  pollIntervalMs: POLL_INTERVAL_MS,
};

function parseValue(raw: string | null, fallback: unknown): unknown {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function readSettings(): Promise<RuntimeSettings> {
  const next = { ...DEFAULTS };
  if (memoryEnabled() && !supabaseConfigured()) {
    for (const row of memory.all("smt_settings") as Array<{ key: string; value: string }>) {
      const value = parseValue(row.value, undefined);
      if (row.key === "WEBHOOK_URL" && typeof value === "string") next.webhookUrl = value;
      if (row.key === "sign_webhooks") next.signWebhooks = Boolean(value);
      if (row.key === "send_each_once") next.sendEachOnce = Boolean(value);
      if (row.key === "announce_kinds" && Array.isArray(value)) next.announceKinds = value.map(String);
      if (row.key === "poll_interval_ms") next.pollIntervalMs = Number(value) || next.pollIntervalMs;
    }
    return next;
  }
  if (!supabaseConfigured()) return next;
  const { data, error } = await adminClient().from("smt_settings").select("key,value");
  if (error || !data) return next;
  for (const row of data as Array<{ key: string; value: string }>) {
    const value = parseValue(row.value, undefined);
    if (row.key === "WEBHOOK_URL" && typeof value === "string") next.webhookUrl = value;
    if (row.key === "WEBHOOK_SECRET" && typeof value === "string") next.webhookSecret = value;
    if (row.key === "sign_webhooks") next.signWebhooks = Boolean(value);
    if (row.key === "send_each_once") next.sendEachOnce = Boolean(value);
    if (row.key === "announce_kinds" && Array.isArray(value)) next.announceKinds = value.map(String);
    if (row.key === "poll_interval_ms") next.pollIntervalMs = Number(value) || next.pollIntervalMs;
  }
  return next;
}

export async function writeSettings(patch: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
  const current = await readSettings();
  const next = { ...current, ...patch };
  if (memoryEnabled() && !supabaseConfigured()) {
    for (const [key, value] of Object.entries({
      WEBHOOK_URL: next.webhookUrl,
      sign_webhooks: next.signWebhooks,
      send_each_once: next.sendEachOnce,
      announce_kinds: next.announceKinds,
      poll_interval_ms: next.pollIntervalMs,
    })) {
      memory.upsert("smt_settings", "key", { key, value: JSON.stringify(value) });
    }
    return next;
  }
  if (!supabaseConfigured()) return next;
  const rows = [
    { key: "WEBHOOK_URL", value: JSON.stringify(next.webhookUrl) },
    { key: "WEBHOOK_SECRET", value: JSON.stringify(next.webhookSecret) },
    { key: "sign_webhooks", value: JSON.stringify(next.signWebhooks) },
    { key: "send_each_once", value: JSON.stringify(next.sendEachOnce) },
    { key: "announce_kinds", value: JSON.stringify(next.announceKinds) },
    { key: "poll_interval_ms", value: JSON.stringify(next.pollIntervalMs) },
  ];
  await adminClient().from("smt_settings").upsert(rows, { onConflict: "key" });
  return next;
}
