---
name: smt-crm-dashboard
description: Clone the Tyres 4 U SMT CRM dashboard for another Sell More Tyres shop. Use when mapping admin.sellmoretyres.com, adding smt_* tables, or wiring a minute poller + webhook.
---

# SMT CRM dashboard (clone for another shop)

This app turns a session-only Sell More Tyres admin into a pollable API. Copy `apps/tyre-shop-crm`, do not merge it into the wasup worker or the Dundee inbox.

## Env for a new shop

| Variable | Purpose |
|---|---|
| `SMT_EMAIL` / `SMT_PASSWORD` | Fitting-centre admin login. Gitignore only. |
| `SHOP_NAME` | e.g. Tyres 4 U |
| `SMT_ORIGIN` | `https://admin.sellmoretyres.com` |
| `DUNDEE_DASHBOARD_PASSWORD` | Same password gate as the inbox (`Wasup@123`) |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Same project is fine; **new `smt_*` tables only** |
| `WEBHOOK_URL` / `WEBHOOK_SECRET` | n8n / WhatsApp agent. Empty until you have a URL. |
| `CRON_SECRET` | Vercel cron bearer |
| `TZ` | `Europe/London` |

In-hours is fixed in v1: **Mon–Sat 09:00–17:00 Europe/London**.

## Map a new admin

1. Screenshot `/Account/Login`. Confirm `Email`, `Password`, `RememberMe`, `__RequestVerificationToken`, form `POST /`.
2. After login, screenshot `/FittingCentre/CRM` and each list (Customers, Enquiries, NPS, Testimonials).
3. In DevTools Network, note the list XHR (often DataTables `ajax` on `/FittingCentre/CRM/<Thing>/List`). Prefer that over HTML.
4. Confirm View hrefs expose integer ids. Those are dedupe keys.
5. Customers also have **Export CSV** — use it for backfill.
6. Do not guess a selector that the screenshot contradicts.

Dedupe: customer id (else phone E.164); enquiry id; NPS score+date+phone/name; testimonial id.

Unknown id → insert + optional webhook. Known id → refresh, **no second webhook**.

## What not to do

- Do not merge this into the wasup Node process or enable PM2 cluster.
- Do not `pm2 restart` / `pm2 reload` wasup for this work.
- Do not write CRM rows into `dundee_*` or `chat_history`.
- Do not commit SMT passwords or the dashboard cookie secret.

## Verification

1. Login to this dashboard → KPIs populate.
2. Customers / Enquiries lists match SMT list pages (screenshot both).
3. Enquiries in-hours filter: weekday 09:00–17:00 UK vs evenings/Sunday.
4. Scraper → Scrape now → Activity shows `poll.ok`.
5. API docs sample matches `GET /api/health`.
6. SMT **Reports** vs `GET /api/analytics`: customer/enquiry counts, new vs existing bookings, NPS % vs `smt_nps` math (`Your NPS Score Is`).

Backfill first (`npm run backfill`, `announce: false`), then turn cron on.
