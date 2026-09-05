# Isolated sandbox — not part of the wasup product

This folder is a **temporary, isolated inbox** for Tyre Fighter Dundee.

- Do **not** merge it into `apps/dashboard` or `apps/control-plane`.
- Do **not** SCP it onto a wasup worker.
- Do **not** PM2 reload / restart any WhatsApp worker for this app.
- Secrets live in `.env.local` only. Never commit `.env.local`.

The dashboard reads `dundee_*` tables on the operator Supabase project. Live WhatsApp traffic is ingested later via n8n using `dundee_ingest_message`.
