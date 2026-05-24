# Reconnect Hardening Runbook

This runbook covers the recurring old north and `wasup2` disconnect pattern and the prevention controls now expected in production.

## What Broke

- Old north instances repeatedly hit recoverable WhatsApp socket closures, mainly `428` / connection replaced. This usually means a multi-device/socket conflict: auth was still valid, but another worker or device replaced the active socket. The old north worker did not have the latest bounded scheduled reconnect/startup reconciliation because PM2 reload was intentionally avoided, so after its limited attempts it could stay disconnected until a per-instance reconnect was called.
- `wasup2` hit Baileys `503 unavailableService`, a transient stream/service error. The previous classifier treated that as non-recoverable, so it preserved auth but did not schedule reconnect. The canonical reconnect classifier now treats transient `5xx` disconnects as recoverable, never clears auth for them, and logs them as service/stream errors rather than misleading logged-out events.
- The `wasup2` watchdog passed because it only exercised HTTPS/API/docs/temp-instance flows. A synthetic temp instance can prove API shape, but it cannot prove that real scanned credentials are still connected.

## Prevention Controls

- Recoverable disconnects include socket replaced/closed/lost/timeouts/restart-required plus transient `5xx`. Only explicit logged-out/invalid-auth style failures require manual QR or pairing.
- Auto reconnect is bounded by `WA_RECONNECT_MAX_ATTEMPTS`, `WA_RECONNECT_BASE_DELAY_MS`, and `WA_RECONNECT_MAX_DELAY_MS`, with jitter and duplicate-attempt guards.
- Startup reconciliation schedules reconnect for instances with saved credentials after a PM2 reload or process restart.
- The static dashboard has a global `Reconnect disconnected` button for manual recovery without clearing auth.
- The smoke watchdog now checks real non-smoke instances. It records disconnected-since state in its status JSON, fails when a credentialed real instance stays non-connected beyond the grace period, and can call `/connect` only when `WASUP_SMOKE_RECONNECT_REAL=true`.
- The watchdog never calls `/clear-auth` or a revoking disconnect. Missing auth or logged-out signals are reported as `manual_qr_required`.

## wasup2 Watchdog Settings

Recommended cron environment on `wasup2`:

```bash
WASUP_SMOKE_BASE_URL=https://wasup2.northeurope.cloudapp.azure.com
WASUP_SMOKE_REAL_INSTANCE_CHECK=true
WASUP_SMOKE_REAL_DISCONNECTED_GRACE_MINUTES=10
WASUP_SMOKE_RECONNECT_REAL=true
```

The latest status file is `/var/log/wasup2-smoke-status.json`. Check `.realInstances` for `connected`, `credentialed_disconnected`, `manual_qr_required`, and reconnect attempt details.

## Old North Rollout Plan

Do not execute this without an approved maintenance window.

1. Preflight:
   - Capture `pm2 list`, current commit/build marker, `/api/instances`, and recent PM2 logs.
   - Back up the app file(s) being replaced, especially `app/src/utils/instance-manager.js`, `app/server.js`, `app/public/index.html`, and `app/scripts/wasup-smoke.js` if present.
   - Confirm no credentials or `.env` files are copied from another host.
2. Copy only code files:
   - Deploy the latest reconnect worker code and static dashboard assets from this repo.
   - Do not modify `app/instances/**`, auth folders, `.env`, proxy files, or keys.
3. Reload once:
   - Run one PM2 reload during the maintenance window.
   - Expect a brief WhatsApp socket drop. Startup reconciliation should schedule reconnect for saved-credential instances.
4. Verify:
   - Confirm `/api/instances` shows `hasSavedCredentials` and `autoReconnect`.
   - Watch logs for `Scheduling startup auto-reconnect` and successful `Connected as ...` entries.
   - Use the dashboard global reconnect button only for any saved-auth instances still disconnected after startup reconciliation.
5. Roll back:
   - Restore the backed-up code files.
   - Reload PM2 once.
   - Do not clear auth unless an instance explicitly reports logged-out/invalid auth and the operator accepts a new QR/pairing flow.
