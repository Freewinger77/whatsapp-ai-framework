const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const wasupBase = process.env.WASUP_BASE_URL || "https://wasup.northeurope.cloudapp.azure.com";
const instanceId = process.env.DUNDEE_INSTANCE_ID || "wa_mtn328n7_t5crc";
const linePhone = process.env.DUNDEE_LINE_PHONE || "447883023296";
const lineName = process.env.DUNDEE_LINE_NAME || "Tyre Fighter Dundee";

if (!supabaseUrl || !secret) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exit(1);
}

function looksGroup(id) {
  const value = String(id || "");
  return value.includes("-") || value.startsWith("120") || value.length > 14;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function ingest(payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/dundee_ingest_message`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
  });
  if (!response.ok) {
    throw new Error(`ingest failed ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const inbound = await fetchJson(`${wasupBase}/api/instances/${instanceId}/messages?limit=200`);
const outbound = await fetchJson(
  `${wasupBase}/api/instances/${instanceId}/messages?limit=200&direction=outbound`
);
const mediaPayload = await fetchJson(`${wasupBase}/api/instances/${instanceId}/media?limit=200`);

const mediaByMessage = new Map();
for (const item of mediaPayload.media || []) {
  if (item.sourceMessageId) mediaByMessage.set(item.sourceMessageId, item);
}

const messages = [...(inbound.messages || []), ...(outbound.messages || [])];
messages.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

console.log(`backfill ${messages.length} messages, ${mediaByMessage.size} media refs`);

let ok = 0;
for (const message of messages) {
  const fromMe = message.direction === "outbound";
  const peer = fromMe ? message.to : message.from;
  const isGroup = looksGroup(peer);
  const media = mediaByMessage.get(message.id);
  await ingest({
    source: "wasup_backfill",
    instance_id: instanceId,
    line_name: lineName,
    line_phone: linePhone,
    whatsapp_message_id: message.id,
    from_jid: isGroup ? `${peer}@g.us` : `${peer}@s.whatsapp.net`,
    is_group: isGroup,
    group_id: isGroup ? String(peer) : null,
    sender_phone: isGroup ? null : fromMe ? linePhone : String(peer),
    to_phone: linePhone,
    message: message.text || "",
    media_type: media?.mediaType || (message.mediaType ?? null),
    media_url: media?.publicUrl || message.mediaUrl || null,
    media_id: media?.id || message.mediaId || null,
    created_at: message.timestamp,
    direction: message.direction,
    from_me: fromMe,
    raw_history: message,
  });
  ok += 1;
}

console.log(`ingested ${ok} messages`);
