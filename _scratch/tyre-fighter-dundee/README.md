# Tyre Fighter Dundee inbox (isolated sandbox)

Read-only conversational inbox for the Dundee WhatsApp line on wasup.

- Instance: `wa_mtn328n7_t5crc`
- Number: `447883023296`
- Worker: `https://wasup.northeurope.cloudapp.azure.com`
- Tables: `dundee_*` on the operator Supabase project (not `chat_history`)

See [NOT_IN_REPO.md](./NOT_IN_REPO.md). Do not merge this into `apps/dashboard`. Do not bounce PM2.

## Local

```bash
cp .env.example .env.local
# fill keys
npm install
set -a && source .env.local && set +a
npm run db:schema
npm run db:operator
npm run db:backfill
npm run dev
```

## n8n live feed (phase 2)

When the webhook URL is ready, POST the wasup `event: message` payload to either:

1. Supabase RPC `dundee_ingest_message` with the **secret** key
2. `POST /api/ingest` on this app with header `x-dundee-ingest-secret`

Expected fields: `instance_id`, `whatsapp_message_id`, `from_jid`, `is_group`, `group_id`, `sender_phone`, `to_phone`, `message`, `media_type`, `media_url`, `created_at`, `from_me`.

Idempotent on `(line_id, wa_message_id)`.
