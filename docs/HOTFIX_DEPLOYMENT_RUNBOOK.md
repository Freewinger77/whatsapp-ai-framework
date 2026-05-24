# Hotfix and Deploy Runbook

Use these paths for small fixes so production changes do not require repeated manual full rebuilds.

## Dashboard Frontend

Deploy `apps/polymet-wasup` to the Azure Storage static site and optionally purge Front Door:

```bash
DASHBOARD_STORAGE_ACCOUNT=<storage-account> \
CONTROL_PLANE_APP_NAME=<app-service-name> \
AZURE_RESOURCE_GROUP=<resource-group> \
FRONTDOOR_PROFILE=<front-door-profile> \
FRONTDOOR_ENDPOINT=<front-door-endpoint> \
deploy/deploy-dashboard-frontend.sh
```

The script reads `VITE_CLERK_PUBLISHABLE_KEY` from Azure App Service settings, sets `VITE_CONTROL_PLANE_API_BASE_URL=https://control-plane.wasup.co`, runs the Vite production build guard, uploads `dist` to `$web`, and purges Front Door when profile/endpoint are provided.

## Control Plane API

Build and deploy the Next.js standalone server to Azure App Service:

```bash
CONTROL_PLANE_APP_NAME=<app-service-name> \
AZURE_RESOURCE_GROUP=<resource-group> \
deploy/deploy-control-plane-appservice.sh
```

Runtime secrets stay in Azure App Service app settings. The package includes `.next/standalone`, `.next/static`, and `public`.

## Worker VM Hotfixes

For the legacy worker VM or future per-org workers, prefer targeted copy/reload:

```bash
deploy/hotfix-worker-vm.sh <vm-host> static app/public/index.html
deploy/hotfix-worker-vm.sh <vm-host> server app/server.js app/src/utils/settings.js
BASE_URL=https://<org>.wasup.co API_KEY=<key> deploy/hotfix-worker-vm.sh ignored behavior-reload
```

Static mode does not reload PM2. Server mode uses `pm2 reload`, not `restart`. The script excludes secrets by only copying explicit allowlisted paths.

## WhatsApp/Baileys Pairing Lifecycle

The current working QR pairing fix depends on preserving per-instance auth through Baileys restart-required closes:

- Do not auto-clear auth for `515` / `restartRequired`. After a user scans a QR, Baileys can close with `515` as part of the normal handoff. Restart that instance socket quickly and preserve the auth files.
- Treat pre-scan `408` QR timeouts as QR refresh events. Restart the pairing socket for that instance and generate a fresh QR without wiping credentials.
- Only the explicit Clear auth action should wipe auth files. Disconnect, PM2 reload, QR refresh, and post-scan restarts must keep saved credentials intact.
- Avoid broad PM2 reloads while users are actively pairing. If a worker patch is required, prefer per-instance handling and targeted hotfixes; do not interrupt all sessions unless there is no safer option.
- Keep pairing logic scoped per instance. One instance reaching `restartRequired`, `408`, conflict, or logged-out state should not clear or restart unrelated instances.

Operational check after a pairing patch: scan the QR, watch for `creds.update`, allow the expected post-scan `515`, confirm the socket restarts with preserved auth, and only investigate auth clearing if the next terminal state is a true logged-out condition.

## Billing Safety

Do not run live checkout tests that create real charges. Verify production with:

```bash
curl -i https://control-plane.wasup.co/api/v3/billing/entitlements
curl -i -X POST https://control-plane.wasup.co/api/v3/billing/checkout -H 'Content-Type: application/json' -d '{}'
curl -i -X POST https://control-plane.wasup.co/api/v3/billing/portal -H 'Content-Type: application/json' -d '{}'
curl -s https://control-plane.wasup.co/api/health
```

The billing API calls should reject unauthenticated requests. Health should report Stripe as `ok` when `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_INSTANCE_PRICE_ID` are configured.
