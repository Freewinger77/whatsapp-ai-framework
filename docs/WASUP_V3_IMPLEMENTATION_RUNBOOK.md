# Wasup v3 Implementation Runbook

This runbook turns the Wasup v3 architecture into build phases. The stack is Clerk, Supabase, AKS, Azure Key Vault, and one worker pod per WhatsApp instance. A small placeholder org fallback remains for local/bootstrap work before Clerk organizations are fully configured.

## Phase 1: Control Plane Skeleton

Status in this branch:

- `apps/control-plane/`: Next.js + Clerk + Supabase starter.
- `supabase/migrations/20260513120500_wasup_v3_control_plane.sql`: first control-plane schema.
- `docs/WASUP_V3_WORKER_CONTRACT.md`: worker/control-plane contract.
- `deploy/k8s/wasup-worker/`: placeholder worker Helm chart.

Still needed:

1. Create Supabase project and run migration.
2. Configure `.env.local` from `apps/control-plane/.env.example`.
3. Configure Clerk test keys.
4. Sign up as the first test user through the app.
5. Create organizations through `POST /api/v3/orgs`.
6. Add Clerk app/webhooks to create/update `organizations` and `organization_members`.
7. Import legacy VM/regional instances into Supabase as `legacy` records.

## Phase 2: Legacy Inventory Import

Build an importer that reads:

- VM: `https://wasup.northeurope.cloudapp.azure.com/api/instances`
- Regional apps: `wasup-de`, `wasup-fr`, `wasup-it`, `wasup-fi`, `wasup-se`, `wasup-no`, `wasup-uk-south`, `wasup-uk-west`
- Proxy pools: `/api/proxy/pool` where enabled

Import into:

- `organizations`
- `instances`
- `proxy_allocations`
- `worker_events`

All imported records should have metadata:

```json
{
  "source": "legacy",
  "legacyBaseUrl": "https://wasup-uk-west.azurewebsites.net"
}
```

## Phase 3: Single-Instance Worker Mode

Add to the existing `app/` runtime:

- `WASUP_DATA_DIR` path override.
- `WASUP_WORKER_MODE=single-instance`.
- `WASUP_ORG_ID` and `WASUP_INSTANCE_ID` labels in logs/events.
- internal worker endpoints from `WASUP_V3_WORKER_CONTRACT.md`.
- no dashboard/static serving in worker mode.

This phase is what actually separates API/dashboard deploys from WhatsApp socket ownership.

## Phase 4: AKS Dev Cluster

Create:

- AKS cluster.
- Azure Container Registry.
- Azure Key Vault.
- External Secrets Operator.
- ingress-nginx or Azure Application Gateway Ingress Controller.
- cert-manager.
- namespace templates per org.

Deploy one throwaway test worker only. Do not migrate production sessions yet.

## Phase 5: Proxy Allocator

Implement:

- imported pool allocation from current proxy files/API.
- provider-account table and credentials in Key Vault.
- sticky per-instance assignment.
- health verification job.
- rotation guardrail: default max one proxy change per instance per 24h.

## Phase 6: New Customers on v3

For new orgs:

1. Create org in Clerk.
2. Create org row in Supabase.
3. Generate v3 API key.
4. Create instance row.
5. Allocate proxy.
6. Create worker secret/PVC/deployment/service.
7. Present QR/pairing through control-plane dashboard.

Existing VM/regional customers remain untouched.

## Phase 7: Existing Customer Migration

Per customer:

1. Schedule window.
2. Stop sends.
3. Disconnect without revoking credentials.
4. Copy auth + anti-ban state to v3 PVC.
5. Start worker with same instance ID and proxy.
6. Verify connection, phone, proxy egress, webhooks.
7. Switch route target in Supabase.
8. Keep legacy disabled for rollback.

## Non-Negotiables

- No PM2/API reloads for active sockets once workers exist.
- No duplicate active auth between legacy and v3.
- No aggressive proxy rotation.
- No customer-facing external library names.
- No service-role keys in browser code.
