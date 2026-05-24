# wasup2 Smoke Watchdog

The fallback worker `wasup2` runs a recurring smoke test against `https://wasup2.northeurope.cloudapp.azure.com` to catch demo-breaking regressions before live calls.

## What It Checks

The watchdog runs `app/scripts/wasup-smoke.js` without requiring a WhatsApp QR scan. It verifies:

- HTTPS dashboard availability and HTTP-to-HTTPS redirect behavior
- `/api/health`, `/openapi.yaml`, `/test`, and `/api/dashboard-config`
- OpenAPI and playground markers for link, CTA URL, and button sends
- same-origin public dashboard API mode, or API-key mode when `WASUP_SMOKE_API_KEY` is set
- create, read, log, QR/status, disconnected text/link/button negative paths, and delete for a unique `smoke-*` temp instance
- invalid interactive payload validation details
- stale `smoke-*` instance cleanup
- real non-smoke instance connectivity, including whether saved credentials are present
- optional reconnect attempts for real preserved-auth instances when `WASUP_SMOKE_RECONNECT_REAL=true`

The script exits non-zero on failure and never prints API keys or other secrets. It never clears auth. Logged-out, invalid-auth, or missing-auth instances are reported as manual QR/pairing required.

## Manual Run

On the VM:

```bash
cd /opt/whatsapp-ai/app
WASUP_SMOKE_BASE_URL=https://wasup2.northeurope.cloudapp.azure.com node scripts/wasup-smoke.js
```

If the dashboard is not public, provide the key through the process environment only:

```bash
WASUP_SMOKE_API_KEY="$API_KEY" node scripts/wasup-smoke.js
```

To test real instance reconnect behavior without waiting for cron:

```bash
WASUP_SMOKE_BASE_URL=https://wasup2.northeurope.cloudapp.azure.com \
WASUP_SMOKE_REAL_INSTANCE_CHECK=true \
WASUP_SMOKE_REAL_DISCONNECTED_GRACE_MINUTES=10 \
WASUP_SMOKE_RECONNECT_REAL=true \
node scripts/wasup-smoke.js
```

## Cron

`wasup2` is configured to run the script every 5 minutes as `azureuser`. Cron appends JSONL output to:

```text
/var/log/wasup2-smoke.log
```

The latest condensed status is written to:

```text
/var/log/wasup2-smoke-status.json
```

The status JSON includes `.realInstances`, with counts and per-instance summaries:

- `connected`: real instance is connected.
- `credentialed_disconnected`: saved credentials exist, but the instance is not connected.
- `manual_qr_required`: credentials are missing or logs/status indicate logged-out/invalid auth.
- `auth_unknown_not_connected`: the server did not expose credential presence, so the watchdog cannot safely decide if reconnect is valid.

Check the latest pass/fail line:

```bash
sudo rg '"message":"Smoke run complete"|"message":"Smoke run crashed"' /var/log/wasup2-smoke.log
```

## Failure Meaning

A failed run means one or more worker invariants broke: public reachability, API auth/dashboard mode, OpenAPI/playground markers, instance CRUD, QR/status behavior, logs, clean disconnected send errors, or real credentialed instance connectivity after the configured grace period.

If repeated failures occur, inspect:

```bash
sudo -u azureuser pm2 list
sudo -u azureuser pm2 logs --lines 100
sudo rg '"level":"fail"' /var/log/wasup2-smoke.log
```

Notifications are not enabled unless a destination is configured. Add a conservative alert hook around the cron command or extend `app/scripts/wasup-smoke.js` once an SMTP or webhook destination is available.

See [Reconnect Hardening Runbook](./reconnect-hardening-runbook.md) for root causes, prevention controls, and the old north rollout plan.
