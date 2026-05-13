# Wasup v3 SaaS Kubernetes Plan

This plan turns the current single-process, multi-instance WhatsApp app into a SaaS control plane with isolated per-customer data plane workers. It is intentionally additive: the current VM and regional Azure App Services keep running while v3 is built beside them.

## Current Baseline

- `app/server.js` exposes a regional REST API, WebSocket UI events, instance lifecycle endpoints, QR/pairing endpoints, per-instance send APIs, anti-ban endpoints, proxy endpoints, health checks, and docs unlock.
- `app/src/utils/instance-manager.js` stores instance registry in `app/instances/instances.json`, stores Baileys auth under `app/instances/<instanceId>/auth`, and keeps each WhatsApp socket in the same Node process.
- `app/src/utils/proxy.js` resolves proxy priority as instance override, pool assignment, deployment default, then direct connection.
- `app/src/utils/proxy-pool.js` owns finite pool assignment derived from instance configs and supports runtime add/remove/reconcile through API.
- `infra/azure/PROXY.md` documents the current eight-region App Service model and pool-enabled regions.
- `infra/azure/battlespace/` is already a central command dashboard that polls regional deployments, pass-throughs some operations, and displays proxy/anti-ban state.
- Production VM deployment is PM2 fork mode with one Node process owning sockets. Do not use cluster mode for a single process because it duplicates WhatsApp sessions.

## Target Architecture

### Control Plane

The v3 control plane is the source of truth and operator interface. It should not hold WhatsApp sockets.

- Central dashboard and API: customer/org lifecycle, instances, regional capacity, proxy inventory, billing/usage, QR/pairing views, logs, and anti-ban controls.
- Supabase Postgres: stores organizations, users, instance metadata, worker placement, regional base URLs, API key hashes, proxy allocation metadata, usage events, audit events, and billing state.
- Supabase Auth or external SSO: authenticates dashboard users and maps them to organization memberships and roles.
- Control API: issues tenant-scoped Wasup v3 API keys, validates org access, creates desired worker records, triggers Kubernetes provisioning, and routes calls to the right worker.
- Provisioner/controller: watches desired state in Supabase and Kubernetes state, then creates/upgrades/deletes per-tenant worker workloads and proxy credentials.
- Secrets broker: writes tenant/instance secrets into Kubernetes Secrets or External Secrets, never into Git or plain Supabase columns.
- Event bus: receives worker heartbeats, QR/pairing updates, status changes, webhooks, logs, and usage counters. Start with HTTP callbacks/WebSocket fan-out; move to NATS/Redis Streams/Event Hubs when scale requires.

### Data Plane

The data plane runs the WhatsApp transport and must be isolated by tenant.

- Per-organization namespace for strong isolation: `wasup-org-<orgId>` contains only that org's workers, PVCs, services, network policies, and secrets.
- Per-instance worker pod for the safest isolation: one Baileys socket per pod, one PVC per instance, one proxy allocation per instance. This matches WhatsApp socket ownership and prevents noisy neighbors inside a process.
- Optional small-org consolidation later: multiple instances per org worker only after the scheduler and operational tooling prove stable. The default should remain one instance per pod.
- Worker container: reuse the existing `app/` server code initially, constrained by env/config so it runs one instance or one org. Long term, split `instance-manager` into a worker library and expose a narrower worker API.
- Persistent auth: Baileys auth and anti-ban state live on an encrypted PVC mounted at `/data/instances/<instanceId>`, backed by Azure Disk or Azure Files. Do not store credentials in the container image.
- Media storage: keep Azure Blob for received media, with org/instance prefixes and private access by default. Prefer signed URLs over public blob access for SaaS.
- Service model: each worker has an internal ClusterIP service. Public traffic enters through the control API/gateway, not directly to worker pods except during migration.

### Routing and Base URLs

Recommended v3 public API model:

- Global base URL: `https://api.wasup.ai/v3`.
- Customer-scoped routes: `/orgs/{orgId}/instances/{instanceId}/...` for dashboard/control usage.
- API-key routes: `/v3/instances/{instanceId}/send`, `/v3/messages`, etc. The API key maps to `orgId` and allowed instance IDs.
- Optional per-org vanity base URL: `https://{orgSlug}.api.wasup.ai/v3`, stored in Supabase as `organizations.api_base_url`.
- Worker internal URL: stored as `instances.worker_service_url` or derived from namespace/service naming, not exposed to customers.

The sketch requirement "Wasup v3 per-organization base URL/API key stored in Supabase against organisation ID" maps to:

- `organizations.api_base_url`: customer-facing API base.
- `api_keys`: hashed v3 keys scoped to `org_id` with role, allowed instance IDs, last used timestamp, and revocation state.
- `instances.worker_endpoint`: internal route/gateway target.

### API Key Model

- Generate keys as `wsp_v3_<publicId>_<secret>`.
- Store only `sha256(secret + per-key salt)` or an HMAC hash in Supabase.
- Keep `publicId` visible for lookup, rotation, and audit.
- Scope keys by organization and capability: `instances:read`, `instances:write`, `messages:send`, `webhooks:manage`, `billing:read`.
- Support multiple active keys per org for rotation.
- Worker-to-control auth should use short-lived service tokens or mTLS, not customer API keys.

### Supabase Metadata Model

Suggested first tables:

- `organizations`: `id`, `slug`, `name`, `plan`, `region_preference`, `api_base_url`, `status`, `created_at`.
- `organization_members`: `org_id`, `user_id`, `role`.
- `api_keys`: `id`, `org_id`, `public_id`, `secret_hash`, `scopes`, `allowed_instance_ids`, `created_by`, `last_used_at`, `revoked_at`.
- `instances`: `id`, `org_id`, `name`, `status`, `phone`, `region_code`, `worker_namespace`, `worker_name`, `worker_endpoint`, `webhook_url`, `behavior_profile`, `antiban_preset`, `created_at`, `deleted_at`.
- `proxy_providers`: provider account metadata, health, regions supported, quota, credential secret references.
- `proxy_allocations`: `id`, `org_id`, `instance_id`, `provider_id`, `region_code`, `host`, `port`, `username_ref`, `password_secret_ref`, `source`, `status`, `assigned_at`, `released_at`, `last_verified_at`.
- `worker_events`: append-only connection, QR, pair, anti-ban, proxy, and lifecycle events.
- `usage_events`: message sends, received messages, media bytes, worker runtime minutes, proxy minutes.
- `webhook_deliveries`: outgoing webhook attempts, response code, latency, retry state.
- `audit_events`: operator/customer actions and security events.

Use Supabase Row Level Security for dashboard-facing reads. Workers should use service role credentials only through a backend service, not directly from browser clients.

### QR and Pairing Flow

1. Dashboard creates organization and instance.
2. Control plane picks a region and asks the provisioner to create the worker pod/PVC/secret set.
3. Worker starts in `disconnected` state, calls back with `worker.ready`.
4. Dashboard calls `connect` or `pair` through the control API.
5. Control API forwards to the worker.
6. Worker emits QR or pairing code to the control plane.
7. Dashboard subscribes by WebSocket/SSE to org-scoped events and renders QR/code.
8. On connection, worker persists Baileys auth to PVC, updates status/phone, and begins heartbeats.

QR payloads are short-lived operational data. Store only the current value in memory/cache with expiry unless audit requirements demand otherwise.

### Webhooks

- Inbound WhatsApp messages are processed by the worker and delivered to the org's configured webhook, as today.
- Control plane should own webhook configuration, signing secrets, delivery logs, retry policy, and dead-letter state.
- Worker can either call customer webhooks directly using signed config provided at startup, or send message events to the control plane for delivery. Prefer control-plane delivery for SaaS because it centralizes retries, rate limits, observability, and customer-facing logs.
- Sign each delivery with `X-Wasup-Signature`, `X-Wasup-Timestamp`, and `X-Wasup-Delivery-Id`.

### Observability

- Metrics: worker heartbeats, connected/disconnected count, QR age, send latency, webhook latency, anti-ban blocks, risk score, proxy verification latency, proxy exhaustion, reconnect counts, pod restarts, PVC attach latency.
- Logs: JSON logs with `org_id`, `instance_id`, `region_code`, `worker_name`, `proxy_allocation_id`, and redacted phone/proxy credentials.
- Traces: control API to worker API to webhook delivery.
- Dashboards: fleet health, per-org health, proxy capacity by region/provider, webhook failures, anti-ban risk, Kubernetes pod/PVC health.
- Alerts: disconnected critical instances, stuck connecting, QR expired, proxy pool exhausted, high ban-risk score, webhook failure spike, worker crash loop, storage attach failure.

### Tenant Isolation

- Kubernetes namespace per org.
- NetworkPolicy: org workers can reach WhatsApp, approved proxy endpoints, media storage, control API, and DNS; no cross-namespace access.
- ResourceQuota and LimitRange per org/plan.
- Secrets per namespace and instance.
- PVC per instance with encryption at rest.
- API keys scoped to org and optional instance list.
- Dashboard authorization enforced through Supabase RLS plus backend checks.
- Logs and metrics always include org/instance labels but redact secrets and message bodies by default.

## Proxy Strategy

### Current Pools

The current regional pools should be imported as provider-owned inventory:

- Preserve existing pool entries from `PROXY_POOL` or `instances/proxy-pool.json`.
- Store pool metadata in Supabase `proxy_allocations` and credentials in a secret manager.
- Existing Azure regional apps continue using their local pool during migration.
- The v3 control plane polls current `/api/proxy/pool` and `/api/instances` endpoints to build a live inventory map until each region is drained.

### On-Demand Provisioning

The v3 proxy allocator should support two sources:

- Static/imported pools: old Webshare/residential pools assigned one slot per instance.
- Provider API provisioning: allocate a regional residential/static proxy on demand when a new instance is created or when a customer changes region.

Allocation algorithm:

1. Choose region from customer preference, phone country, available capacity, and compliance policy.
2. Try to reuse an existing healthy unassigned proxy in that region/provider.
3. If none is available and plan allows, call provider API to provision a new regional proxy.
4. Store credentials in secret manager and a redacted allocation record in Supabase.
5. Create/update the worker Kubernetes Secret with `INSTANCE_PROXY_URL`.
6. Worker starts/reconnects using that proxy as a per-instance override.
7. Verify egress IP and mark allocation healthy/unhealthy.

### Assignment and Rotation

- One proxy allocation belongs to one WhatsApp instance at a time.
- Do not rotate healthy proxies frequently. Proxy changes cause reconnects and can increase WhatsApp risk.
- Rotate only on explicit customer request, provider failure, sustained egress mismatch, region migration, or risk response approved by policy.
- Enforce cool-downs: default no more than one proxy change per instance per 24 hours, with emergency override for dead proxies.
- Keep old proxy reserved for a grace period after rotation so rollback is possible.
- Do not share one proxy across unrelated orgs.
- For high-risk accounts, prefer sticky residential proxies in the same country/region as the phone number.

### Credential Storage

- Supabase stores redacted host/port/region/provider/status and secret references.
- Kubernetes Secret or External Secret stores full proxy URL/username/password.
- Provider API credentials live in a control-plane namespace secret only.
- Dashboard never renders proxy passwords; it can show host, port, region, provider, status, and last verification.

### Dashboard Proxy Controls

- Per-region capacity: total, used, free, unhealthy, pending provisioning.
- Per-instance assignment: source, provider, region, host, last verified, egress IP, mismatch status.
- Actions: allocate, release, verify, rotate with policy warning, quarantine unhealthy proxy, import old pool entries.
- Audit every proxy action.

## Central Dashboard Design

The current Battlespace app should evolve into the v3 dashboard, backed by Supabase instead of hardcoded regional env vars.

Primary pages:

- Customers/orgs: name, plan, status, region preference, total instances, connected instances, usage, billing health, last activity.
- Org detail: members, API base URL, API keys, webhook settings, audit log, billing summary.
- Instances: per-org list with status, phone, region, worker, proxy, anti-ban risk, behavior profile, QR/pairing action, webhook status.
- Instance detail: QR/pairing, connection timeline, send/receive logs, anti-ban v2 health, behavior profile, handoff settings, proxy verification, worker pod events.
- Regions/proxies: regional map, capacity, imported pools, provider provisioning state, unhealthy proxy queue.
- Wasup Anti-Ban: fleet risk overview, paused instances, warmup day/progress, rate limits, blocked sends, recommended actions.
- Logs: filter by org, instance, event type, severity, message ID, webhook delivery ID.
- Billing/usage: messages sent/received, connected runtime, proxy runtime, media storage, plan limits, overage warnings.
- Operations: worker deployments, Kubernetes health, PVCs, failed migrations, orphaned secrets/proxies.

## Migration Plan

### Phase 0: Inventory and No-Change Control Plane

- Keep VM and eight Azure App Services alive.
- Extend Battlespace/control plane to read Supabase org/instance records while still polling current regional APIs.
- Import all existing regions, instances, API keys, base URLs, and proxy pools into Supabase as `legacy` records.
- Map each existing instance to an org/customer before any move.
- Add read-only dashboards for customer/org views and proxy capacity.

### Phase 1: Containerize Without Moving Customers

- Add a Dockerfile and health/readiness endpoints suitable for Kubernetes.
- Make instance data root configurable with `WASUP_DATA_DIR` instead of assuming `app/instances`.
- Make "single instance worker mode" configurable with `WASUP_INSTANCE_ID`, `WASUP_ORG_ID`, and `WASUP_WORKER_MODE=single-instance`.
- Keep the current multi-instance mode untouched for VM/App Service.
- Build and test locally/minikube with throwaway test numbers only.

### Phase 2: Kubernetes Shadow Environment

- Create AKS cluster, ingress, cert-manager, External Secrets, observability stack, and network policies.
- Deploy control plane and one test worker namespace.
- Provision test proxies through the new allocator.
- Validate QR, pairing, send, receive, webhook delivery, reconnect, anti-ban persistence, and PVC recovery.

### Phase 3: New Customers on v3

- Route only new customers to Kubernetes.
- Keep existing customers on legacy VM/App Services.
- Dashboard manages both legacy and v3 instances through a unified model.
- New customer API keys use v3 key format and global base URL.

### Phase 4: Opt-In Migration for Existing Customers

For each customer:

1. Schedule migration window.
2. Freeze sends or put instance into maintenance mode.
3. Disconnect without revoking credentials.
4. Copy `instances/<id>/auth`, anti-ban state, behavior settings, webhook config, and proxy assignment into a v3 PVC/secret.
5. Start the Kubernetes worker with the same instance ID and proxy.
6. Verify connected status, phone, proxy egress, anti-ban state, and webhook delivery.
7. Update Supabase route target and customer base URL/API key mapping.
8. Keep legacy instance disabled but recoverable for a short rollback window.

Never run the same WhatsApp auth credentials active in legacy and Kubernetes at the same time.

### Phase 5: Drain Legacy Regions

- Migrate customers region by region.
- Remove old pool entries only after all assigned instances leave the region.
- Keep read-only historical logs and usage.
- Decommission App Services and eventually the VM only after no live sockets remain.

## First Scaffold

Safe repo changes for the first scaffold:

- Add this design document: `docs/WASUP_V3_SAAS_K8S_PLAN.md`.
- Add a placeholder Helm chart under `infra/k8s/wasup-worker/` for a future per-instance worker.
- Keep manifests non-deployable by default with placeholder image, secret names, and values.
- Do not change `app/server.js`, `instance-manager.js`, production deploy scripts, or live VM settings until Phase 1.

Next implementation files likely needed:

- `app/Dockerfile`: container image for the existing app.
- `app/src/config/paths.js`: centralize `WASUP_DATA_DIR`.
- `app/src/control-plane/`: Supabase models/client and v3 gateway later.
- `infra/k8s/control-plane/`: dashboard/API deployment after architecture decisions.
- `infra/k8s/external-secrets/`: provider-specific secret wiring.
- `docs/WASUP_V3_MIGRATION_RUNBOOK.md`: per-customer move checklist after test migration.

## Risks

- WhatsApp auth duplication: two active workers using the same auth can invalidate sessions or force QR rescans.
- PVC/storage semantics: Baileys multi-file auth needs durable, low-latency, single-writer storage.
- Proxy churn: aggressive rotation may increase ban risk.
- Kubernetes restarts: pod eviction/restarts look like disconnects and must be rate-limited.
- Secrets sprawl: proxy, Baileys auth, API keys, and provider credentials need strict handling from day one.
- Current app assumptions: `INSTANCES_FOLDER` is hardcoded under `app/instances`, so worker mode needs careful path refactor.
- API compatibility: existing customers may depend on regional base URLs and current response shapes.
- Webhook ownership: direct worker delivery is simpler, but control-plane delivery is better for SaaS reliability and logs.
- Cost: one pod/PVC per instance is operationally clean but may cost more than multi-instance workers.

## Decisions Needed

- AKS vs another Kubernetes provider, and target regions for first production cluster.
- One pod per instance as the enforced v3 default, or one pod per org for small plans.
- Supabase project structure: single production project with RLS, or separate projects/environments.
- Secret manager choice: Kubernetes Secrets sealed by cluster, Azure Key Vault with External Secrets, or Supabase Vault for selected metadata.
- Proxy provider API and regional availability guarantees.
- Whether customer webhooks are delivered by workers or by the control plane.
- Public routing shape: global `api.wasup.ai/v3`, per-org subdomains, or both.
- Billing source of truth and metering granularity.
- Migration rollback window and customer notification policy.
