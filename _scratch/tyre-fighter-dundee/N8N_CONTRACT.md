# n8n ingest contract (live)

Dundee webhook on wasup is already attached:

`https://n8n-rapid-czbff9cnafhkhmhf.eastus-01.azurewebsites.net/webhook/dundee-tyre-listener`

Do **not** write into `chat_history`. Upsert through `dundee_ingest_message`. The RPC already accepts the raw wasup `event: message` body (`webhook_id` stands in for `instance_id`).

## What n8n is sending today (group inbound)

Captured from `dundee_ingest_log` on 5 Sep 2026. `source` is omitted, so the log records `unknown` — add `"source": "n8n"` if you want it labelled.

```json
{
  "event": "message",
  "webhook_id": "wa_mtn328n7_t5crc",
  "whatsapp_message_id": "3A8D052D3C8E13E19E31",
  "message_id": "e9a6ff53-d34d-4660-a313-b7c5dc93aa10",
  "from_jid": "120363401141649532@g.us",
  "from_phone": "120363401141649532",
  "is_group": true,
  "group_id": "120363401141649532",
  "sender_phone": "447939011112",
  "sender_jid": "123046987866116@lid",
  "to_phone": "447883023296",
  "message": "Ha47yh\n\n1656514\n\nPrice and eta plz",
  "media_type": "text",
  "media_url": null,
  "media_id": null,
  "media": null,
  "quoted_message": null,
  "file_name": null,
  "mime_type": null,
  "status": "received",
  "human_mode": false,
  "created_at": "2026-09-05T14:58:16.479Z"
}
```

n8n should POST that object as `{ "payload": { ...same fields, "source": "n8n" } }` to the RPC, which is what is already happening.

## Option A — Supabase RPC (secret key only)

```
POST https://jxuymuvtaqvxlkwqrdbe.supabase.co/rest/v1/rpc/dundee_ingest_message
apikey: SUPABASE_SECRET_KEY
Authorization: Bearer SUPABASE_SECRET_KEY
Content-Type: application/json
```

```json
{
  "payload": {
    "source": "n8n",
    "event": "message",
    "webhook_id": "wa_mtn328n7_t5crc",
    "whatsapp_message_id": "3A8D052D3C8E13E19E31",
    "from_jid": "120363401141649532@g.us",
    "is_group": true,
    "group_id": "120363401141649532",
    "sender_phone": "447939011112",
    "sender_jid": "123046987866116@lid",
    "to_phone": "447883023296",
    "message": "Ha47yh\n\n1656514\n\nPrice and eta plz",
    "media_type": "text",
    "media_url": null,
    "quoted_message": null,
    "created_at": "2026-09-05T14:58:16.479Z"
  }
}
```

## Option B — inbox `/api/ingest`

```
POST https://<vercel-host>/api/ingest
x-dundee-ingest-secret: DUNDEE_INGEST_SECRET
Content-Type: application/json
```

Body is the payload object itself (no `{ payload: ... }` wrapper).

## Variants

| Kind | How the wasup webhook looks | What the RPC does |
|---|---|---|
| Group inbound | `is_group: true`, `from_jid` = `…@g.us`, `sender_phone` = member, `from_phone` = group id | Thread key is `from_jid`. Sender stored from `sender_phone`. |
| DM inbound | `is_group: false`, `from_jid` = `447…@s.whatsapp.net`, `sender_phone` = same as `from_phone` | Thread key is the DM JID. |
| Outbound echo | `from_me: true` and/or `direction: "outbound"` | Same thread; counts as outbound. |
| Media | `media_type` = `image\|video\|audio\|document`, `media_url` or `media.publicUrl` | URL stored on the message. |
| Legacy group id | `from_jid` = `447366376999-1596060465@g.us` | Still a group. Do not treat `from_phone` as a person. |

Idempotent on `(line_id, wa_message_id)` using `whatsapp_message_id`.

## curl for your dev

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/dundee_ingest_message" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"payload":{"source":"n8n","webhook_id":"wa_mtn328n7_t5crc","whatsapp_message_id":"TEST-DEV-1","from_jid":"447700900123@s.whatsapp.net","is_group":false,"sender_phone":"447700900123","to_phone":"447883023296","message":"dev ping","media_type":"text","created_at":"2026-09-05T15:00:00.000Z"}}'
```

Do not change the wasup webhook with a PM2 bounce. Settings-only / `reload-behavior-from-disk` if you must edit it.
