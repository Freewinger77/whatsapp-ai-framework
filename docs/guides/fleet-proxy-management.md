# Fleet proxy management (Aug 2026)

## What this is

One place to see **how many proxies are attached across the whole Wasup fleet**:

| Scope | Covered |
|---|---|
| Shared workers | `wasup`, `wasup-dev`, `wasup2`–`wasup5`, `wasup01`–`wasup05` |
| Org / SaaS VMs | `org_deployments` rows with a `base_url` (dev.wasup tenants) |
| Control-plane pool | Supabase `proxy_allocations` / `proxy_pool_summary` (claimed for provisioning) |

Per worker it reports: instance counts, connected, **with proxy vs direct**, local pool used/free, and fingerprint risk (shared egress).

## APIs

### Platform admin (dev.wasup control plane)

```http
GET /api/v3/proxy/fleet
Authorization: Bearer <clerk session / API key>
```

Query params:

- `includeShared=1|0` (default `1`)
- `includeOrg=1|0` (default `1`)
- `workers=wasup2,wasup3` (optional shared-id filter)

Requires **platform admin**. Needs `WASUP_WORKER_SHARED_SECRET` on the control plane to probe workers.

### Worker-local (unchanged)

- `GET /api/proxy/pool` — slots on one VM
- `GET /api/fingerprint-risk` — shared egress on one VM
- `GET|PUT|DELETE /api/instances/:id/proxy` — attach / clear

## Dashboard

**Admin → Fleet** → **Fleet proxy map** panel (expand a worker for per-instance egress).

**Admin → Proxies** remains the SaaS import/claim pool (Supabase), not live worker attach state.

## CLI (ops, no Clerk)

```bash
WASUP_WORKER_SHARED_SECRET=... node scripts/fleet-proxy-audit.mjs
ONLY=wasup2,wasup3 node scripts/fleet-proxy-audit.mjs
```

Shared workers only (no Supabase org VMs).

## Code

| File | Role |
|---|---|
| `apps/control-plane/lib/fleet-workers.ts` | Shared worker registry |
| `apps/control-plane/lib/fleet-proxy-audit.ts` | Fan-out audit |
| `apps/control-plane/app/api/v3/proxy/fleet/route.ts` | HTTP route |
| `apps/dashboard/.../platform-fleet-proxy-panel.tsx` | Admin UI |
| `scripts/fleet-proxy-audit.mjs` | CLI |

## Operator checklist

1. Deploy control-plane + dashboard with this route/UI.
2. Confirm `WASUP_WORKER_SHARED_SECRET` matches workers.
3. Hit Fleet tab or CLI until every production sender is **proxy** (not `direct`) and FP **low**.
4. Keep CP pool stocked per region for new `dev.wasup` provisions.
