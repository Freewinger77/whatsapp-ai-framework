# tctoken / 463 / reachout hardening (Wasup)

Companion flaps, 428/401, and PM2 reload risk: **[WhatsApp companion risk playbook](./whatsapp-companion-risk-playbook.md)**.  
TyreJobs trial/ATK/ATK2: leftover LID files and `Mirrored tctoken @lid → PN` are **not** a live token on a new companion — **[sacred scroll](./tyrejobs-sacred-scroll.md)**.

WhatsApp now enforces privacy tokens (`tctoken`) on companion/linked-device sends. Token-less cold DMs accumulate a **reachout timelock** (`RESTRICT_ALL_COMPANIONS`) and return **463**. Official clients already attach tokens; Baileys-linked sessions historically did not.

This guide is the production hardening policy for shared workers (`wasup`, `wasup-dev`, `wasup2`–`wasup5`) and every org VM provisioned by wasup-dev / control-plane.

## What Baileys 7.0.0-rc13 already does

Pin **`baileys@7.0.0-rc13`** and keep upgrades routine. On that line Baileys already:

1. Persists `tctoken`, `lid-mapping`, and `device-list` via `useMultiFileAuthState` (generic key store — **no hardcoded type list** in Wasup).
2. Harvests `chat.tcToken` from history sync before emitting `messaging-history.set`.
3. Stores inbound `privacy_token` notifications.
4. Indexes tokens by **LID** when possible.
5. Prunes tokens outside the ~28-day rolling window.
6. Attaches `<tctoken>` on eligible 1:1 sends.
7. Exposes `fetchAccountReachoutTimelock` / connection `reachoutTimeLock`.

Wasup uses **file auth only** (`instances/<id>/auth/`). There is no Postgres/Redis Signal adapter. If you ever add one, it **must** pass through every `SignalDataTypeMap` key (including `tctoken` / `lid-mapping` / `device-list`) or tokens die on restart and every send after redeploy feeds the reachout counter.

## What Wasup adds on top

| Layer | Behaviour |
|-------|-----------|
| History sync | `syncFullHistory` enabled for paired sessions (`me.id` present). Never disable to “save resources”. |
| Observability | `messaging-history.set` logs how many chats carried `tcToken`. |
| Warm / cold | Before send, lookup usable (non-expired) token by LID then PN. |
| Circuit breaker | Active `reachoutTimeLock` → hard-block companion cold sends. |
| 463 never-retry | Per-contact 6h circuit after 463; API returns `doNotRetry: true`. |
| Honest delivery | Require SERVER_ACK (≥2); no fake local tokens. |
| Metrics | `GET /api/instances/:id/reachout-timelock` and instance status include `privacyTokenHardening` (hits/misses/expired/463/tokenHitRate/auth file counts). |
| UI | Dashboard + worker admin show live countdown when locked. |

### Optional cold-send hard block

Default is **off** so existing reminder / outbound flows on live fleets keep working:

```env
WASUP_BLOCK_COLD_WITHOUT_TOKEN=false
```

Per request:

```json
{ "to": "...", "message": "...", "blockColdWithoutToken": true }
```

or allow an explicit cold send when the env is `true`:

```json
{ "allowColdWithoutToken": true }
```

Recommended for reply-first booking stacks: set `WASUP_BLOCK_COLD_WITHOUT_TOKEN=true` once warm traffic is proven.

## Fleet deploy (do not disturb live sessions)

**Never** `pm2 restart` / full wipe / clear-auth for this hardening.

```bash
# Shared workers — graceful reload only; skips npm if baileys already rc13
bash deploy/scripts/deploy-tctoken-hardening.sh

# Optional: one host
ONLY=wasup2 bash deploy/scripts/deploy-tctoken-hardening.sh

# Org VMs created by wasup-dev
bash infra/azure/docker/sync-org-worker.sh wasupadmin@<ip>
# or
bash infra/azure/docker/sync-org-worker.sh <subdomain>
```

After reload, verify instances still `connected` and that `privacyTokenHardening.authFiles.tctokenFiles` is non-zero on warm lines.

## Future instances (automatic inheritance)

1. Worker code must land on the git ref used by provisioning (`WASUP_WORKER_GIT_REF`, default `main`).
2. Cloud-init + `standardizeWorkerRuntime` pin `baileys@7.0.0-rc13` and run `scripts/patch-baileys.js`.
3. `sync-org-worker.sh` re-pins Baileys on every org sync.
4. New instances on an already-hardened VM inherit the worker process — no extra step.

## Operator runbook

1. **463 count should stay ~0.** Rising count → inspect token hit rate first.
2. **Token hit rate for warm traffic should stay high.** Drop = auth/history plumbing, not “WhatsApp is random”.
3. **Timelock active** → wait until `timeEnforcementEnds`; do not retry cold; UI countdown is authoritative.
4. Prefer **inbound-first** threads. Treat no-token contacts as cold.
5. Isolate numbers per client; never reuse previously banned numbers for cold-heavy traffic.
6. Keep Baileys current — protocol chase is ongoing (LID, caps, quotas).

## Realistic framing

Items 1–5 of the upstream checklist eliminate **self-inflicted** token-less accumulation. Items 6–8 contain residual risk: WhatsApp can still restrict heavy cold outreach even with tokens. The circuit breaker keeps one locked number from becoming a fleet outage.
