# Repository layout

This monorepo combines the WhatsApp worker, SaaS control plane, dashboard, and Azure deployment assets.

```
.
├── .github/workflows/       # CI/CD (build checks, deploy hooks)
├── app/                     # WhatsApp worker (Baileys + Express) — cloned to org VMs as …/app
├── apps/
│   ├── control-plane/       # Next.js API (orgs, billing, VM provisioning)
│   └── dashboard/           # Vite/React customer dashboard (dev.wasup.co)
├── configs/                 # Pointers to per-service env templates
├── deploy/
│   ├── scripts/             # Deploy, provision, hotfix, smoke scripts
│   ├── config/              # nginx + PM2 configs (symlinked at deploy/ root for VMs)
│   ├── azure/               # Regional proxy tooling, battlespace dashboard
│   ├── k8s/                 # Helm charts (future worker/control-plane on K8s)
│   └── docker/              # Placeholder for future container images
├── docs/                    # Guides, runbooks, feature inventory
├── n8n-agent/               # CLI + client for the live n8n Public API (cloud agent)
├── scripts/                 # Convenience entrypoints → deploy/scripts/
├── supabase/                # Database migrations
└── n8n-workflows/           # Exported n8n automation flows
```

## What stayed where (on purpose)

- **`app/` at repo root** — Org VMs and cloud-init clone this repo and run `app/server.js`. Moving it would break live provisioning until all VMs and scripts are migrated.
- **`deploy/*.sh` wrappers** — Thin wrappers forward to `deploy/scripts/` so existing docs and muscle memory (`bash deploy/deploy-to-vm.sh`) keep working.
- **`deploy/nginx.conf` / `deploy/ecosystem.config.cjs`** — Symlinks to `deploy/config/` for VMs that already reference the old paths.

## Common commands

```bash
make help                  # list targets
make deploy-dashboard      # build + upload dashboard to Azure Storage
make deploy-control-plane  # build + zip deploy to App Service
make deploy-worker VM=…    # rsync worker to a VM and restart PM2
```

See also [`configs/README.md`](../configs/README.md) and [`deploy/scripts/`](../deploy/scripts/).
