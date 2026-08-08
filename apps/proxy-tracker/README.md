# Webshare Proxy Tracker

Simple dashboard to track the 12 Webshare Direct proxies (HTTP + SOCKS5), with status, assignee, and notes.

## Local

```bash
cd apps/proxy-tracker
npx --yes serve -l 4173 .
```

Open http://localhost:4173

## Deploy (Vercel)

```bash
cd apps/proxy-tracker
npx vercel --yes --prod
```

Tracking state is stored in browser `localStorage`. Use Export/Import to backup or share assignments.
