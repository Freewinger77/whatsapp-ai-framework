# Configuration templates

Environment templates live next to each service so they stay in sync with that app's code.
Copy the relevant example to `.env` (or `.env.local`) in the same directory before running locally.

| Service | Template | Runtime config |
|---------|----------|----------------|
| WhatsApp worker (Baileys) | [`app/.env.example`](../app/.env.example) | `app/.env` |
| Control plane (Next.js API) | [`apps/control-plane/.env.example`](../apps/control-plane/.env.example) | `apps/control-plane/.env.local` |
| Dashboard (Vite) | [`apps/dashboard/.env.example`](../apps/dashboard/.env.example) | `apps/dashboard/.env.local` |

Production secrets are stored in Azure App Service settings and VM env files — not in this repo.
