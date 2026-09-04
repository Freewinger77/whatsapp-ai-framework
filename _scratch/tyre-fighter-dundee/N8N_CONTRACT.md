# n8n ingest contract (ready for your webhook URL)

Do **not** write into `chat_history`. Upsert through `dundee_ingest_message`.

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
    "instance_id": "wa_mtn328n7_t5crc",
    "line_name": "Tyre Fighter Dundee",
    "whatsapp_message_id": "2AE3FAB8EADCC4C9FA66",
    "from_jid": "120363302926299309@g.us",
    "is_group": true,
    "group_id": "120363302926299309",
    "group_name": "optional human title",
    "sender_phone": "447700900123",
    "sender_jid": "447700900123@s.whatsapp.net",
    "to_phone": "447883023296",
    "message": "225/55/18 Mansfield quote",
    "media_type": "text",
    "media_url": null,
    "quoted_message": null,
    "created_at": "2026-09-04T19:16:51.739Z",
    "from_me": false,
    "direction": "inbound",
    "push_name": "Dave"
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

| Kind | How to set keys |
|---|---|
| Group inbound | `is_group: true`, `from_jid` = `…@g.us`, `sender_phone` = actual member |
| DM inbound | `is_group: false`, `from_jid` = `447…@s.whatsapp.net`, `sender_phone` = same |
| Outbound echo | `from_me: true` or `direction: "outbound"` |
| Media | `media_type` + `media_url` (Azure public URL if present) |

Idempotent on `(instance_id, whatsapp_message_id)`.

wasup already emits this shape on `event: message` (see worker webhook). Dundee currently has **no webhook URL** — attach n8n later via instance settings + `reload-behavior-from-disk`, not a PM2 bounce.
