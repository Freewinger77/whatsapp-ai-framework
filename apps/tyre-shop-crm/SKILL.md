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
3. In DevTools Network, check whether lists are DataTables XHR **or** server-rendered `?page=N` HTML. Tyres 4 U is **HTML only** — `/CRM/*/List` is not the live feed.
4. Confirm View hrefs expose integer ids (`CustomerView/:id`, `EnquiriesView/:id`, `NPSView?nps=`, `TestimonialID=`). Those are dedupe keys.
5. Customers CSV export may omit SMT ids and under-count the HTML walk (275 vs 289 here). **Do not upsert CSV** unless each row has a View id.
6. Do not guess a selector that the screenshot contradicts.
7. Reports → New/Existing Customer Bookings are **booking charts**, not CRM list totals. Reconcile KPIs against list pagination (`Page X of Y`) and unique View ids. A BookingsExport CSV is **orders** (OrderID). Import with `npm run import:bookings -- file.csv` into `smt_bookings`. Do not upsert those rows as customers or leads — no View ids, no phone.

Dedupe: customer View id; enquiry View id; NPS View id; testimonial id.

Unknown id → insert + optional webhook. Known id → refresh, **no second webhook**.

## What not to do

- Do not merge this into the wasup Node process or enable PM2 cluster.
- Do not `pm2 restart` / `pm2 reload` wasup for this work.
- Do not write CRM rows into `dundee_*` or `chat_history`.
- Do not commit SMT passwords or the dashboard cookie secret.

## Frontend

The paid RapidScreen handoff is the dashboard. Do not restyle it.

- Source: `handoff/desktop.html`, `handoff/mobile.html`, `handoff/css/tokens.css`
- Production copies those screens: desktop chrome + dashboard at `/`, mobile Overview + Needs calling back
- Backend / APIs / Supabase fit the handoff. Numbers and lists are live; spacing, type, and colours stay as supplied
- Switch desktop/mobile at 860px. No other media-query restyle of the handoff surfaces

## Live

- Custom domain: https://tyres4u.wasup.co
- Vercel alias: https://tyres-4u-smt-crm.vercel.app
- DNS: GoDaddy `CNAME tyres4u → cname.vercel-dns.com` TTL 600, plus `_vercel` TXT verify. Do not point this hostname at the Azure wasup VM.

## Verification

1. Login to this dashboard → KPIs populate.
2. Customers / Enquiries lists match SMT list pages (screenshot both).
3. Enquiries in-hours filter: weekday 09:00–17:00 UK vs evenings/Sunday.
4. Scraper → Scrape now → Activity shows `poll.ok`.
5. API docs sample matches `GET /api/health`.
6. SMT **CRM lists** vs `GET /api/analytics`: 275 customers / 80 email leads / phone leads from home Recent Activity / 28 NPS / 5 testimonials. NPS chrome `71.43%` matches table math on the 28 real scores. Skip pager footer rows (`Page X of Y`). Reports new-customer bookings (~243/year) are a different metric.
7. Enquiries are **leads**, not customers. Email export has name + phone + message. Phone Enquiry Received on the home feed often has no caller number.

Backfill first (`npm run backfill`, `announce: false`), then turn cron on.
