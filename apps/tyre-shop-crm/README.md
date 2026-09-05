# Tyres 4 U SMT CRM

Sibling dashboard to the Dundee WhatsApp inbox. Scrapes Sell More Tyres admin for **Tyres 4 U**, stores `smt_*` rows in the same Supabase project, and exposes a dental-shaped API + UI.

This is **not** the wasup worker. Do not PM2-restart anything to deploy it.

## Run locally

```bash
cp .env.example .env.local
# set DUNDEE_DASHBOARD_PASSWORD=Wasup@123
# SMT_MODE=mock to try the UI without SMT / Supabase
npm install
npm test
npm run dev
```

Password gate: `Wasup@123` (same as the inbox).

Live scrape needs `SMT_EMAIL`, `SMT_PASSWORD`, and `SUPABASE_SECRET_KEY`. Apply tables with `npm run db:schema`, then full history with `npm run backfill` (no webhook flood).

## Cron

`vercel.json` schedules `* * * * *` → `GET /api/poll`. Minute ticks only pick **new** SMT ids. Existing rows refresh quietly.

## Deploy

New Vercel project **`tyres-4u-smt-crm`** from `apps/tyre-shop-crm`. Do not change the inbox project (`tyre-fighter-dundee-inbox`) or the repo-root `whatsapp-ai-framework` Vercel project.

```bash
# from apps/tyre-shop-crm, with VERCEL_TOKEN set
npm run deploy:vercel
```

The script reads `.env.local` (never prints values) and sets Production + Preview + Development. Minute cron needs a Vercel Pro plan; Hobby still serves the UI and **Scrape now**.

Inbox at https://tyre-fighter-dundee-inbox.vercel.app stays untouched.
