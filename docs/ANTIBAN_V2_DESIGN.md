# Anti-Ban v2 — `baileys-antiban` Integration

This is the comprehensive design / "ultrathink" doc for integrating
[`baileys-antiban`](https://github.com/kobie3717/baileys-antiban) into all 8
regional WhatsApp deployments + Battlespace dashboard.

It exists alongside the older [ANTI_BAN_PROTOCOL.md](./ANTI_BAN_PROTOCOL.md)
which describes the original light-touch rate-limiter (still kept for
backward compat). v2 supersedes it for new behaviour.

---

## 1. What baileys-antiban actually does

It is a **drop-in middleware** wrapping a Baileys socket. After
`makeWASocket(...)`, you do `wrapSocket(rawSock, config, savedState)` and the
returned socket has the same shape but `sendMessage` and the event handlers
are intercepted to enforce a multi-layer protection pipeline.

**Modules it ships (v3.8.1):**

| Module                       | What it does                                                                                                             |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| `RateLimiter`                | Per-min/hr/day caps + Gaussian-jitter delays + identical-message dedupe + new-chat penalty + burst allowance             |
| `WarmUp`                     | New numbers ramp 7 days: day1=20, day7=680, day8+=∞. Re-warmup after 72h inactivity                                       |
| `HealthMonitor`              | Risk score 0-100 (low/medium/high/critical) computed from disconnects, 403/401/463 errors, failed sends. Auto-pause       |
| `TimelockGuard`              | Detects 463 reachout-timelock errors → blocks new contact sends until timelock lifts. Existing chats keep working         |
| `ReplyRatioGuard`            | Tracks outbound:inbound per JID. After N msgs with <10% reply rate → block that contact for 24h                          |
| `ContactGraphWarmer`         | Requires 1:1 handshake before bulk/group sends. Group lurk period (12h after join). Caps strangers/day                   |
| `PresenceChoreographer`      | WPM-based typing model (45 WPM ± 15 stdDev), think pauses, circadian rhythm (slow at night, dead at 02-06 local)         |
| `RetryReasonTracker`         | Classifies retry reasons (no_session, bad_mac, server_error_429, …). Detects retry spirals (same msg keeps failing)       |
| `PostReconnectThrottle`      | Ramps send rate 10% → 100% over 60s after reconnect (prevents burst-flood on reconnect that triggers rate limits)         |
| `LidResolver` + `JidCanonicalizer` | LID↔PN race fix — auto-learn from events, canonicalize all outbound to PN form. Drops Bad MAC/No Session errors           |
| `SessionHealthMonitor`       | Tracks decrypt success/failure ratio. >3 Bad MACs in 60s → DEGRADED state, alert                                          |
| `classifyDisconnect()`       | Typed disconnect codes (401/408/428/429/440/500/503/515/1000) with `category` (fatal/recoverable/rate-limited) + backoffMs |
| `getStealthSocketConfig()`   | Random browser fingerprint from a pool + `markOnlineOnConnect: false`                                                     |
| `rampPresenceAfterConnect()` | After open, wait 45-120s before broadcasting first `available` (no instant-online tell)                                  |
| `ContentVariator`            | Invisible zero-width chars + punctuation/synonym variation to defeat identical-message detection                          |
| `MessageQueue`               | Priority queue with retry + exponential backoff                                                                           |
| `Scheduler`                  | Business-hours / weekend factor / lunch break / peak-hours timing                                                         |
| `WebhookAlerts`              | Telegram/Discord/HTTP webhook firing on risk-level changes                                                                |
| `proxyRotator`               | Multi-strategy rotation (round-robin, random, LRU, weighted-by-health). We already have our own pool; v2 keeps ours       |
| `MessageRecovery`            | Recover lost messages on reconnect                                                                                        |
| `CredsSnapshot`              | Periodic creds snapshots for recovery                                                                                     |
| `SessionFingerprint`         | Obscura-inspired stealth: per-session jitter, voice note metadata, battery state, connection quality                      |

**Stress test claim:** 1000 messages on a real WA number, no ban, ~12 msgs/min sustained.

---

## 2. What we already have (and keep)

Our existing code in `app/src/utils/anti-ban.js` + `instance-manager.js` has:

- `AntiBanManager` — basic per-min/hr/day rate limiter (PRESERVED for back-compat)
- Saved-contacts cache (PRESERVED — orthogonal to antiban policy, it's a WhatsApp UX thing)
- Per-instance proxy pool (PRESERVED — pool integration with v2's `agent` injection)
- Human handoff (PRESERVED — sits at a different layer; our handoff hook fires
  on `messages.upsert` with `key.fromMe = true`, before the v2 wrap sees it)
- Read receipt simulation (KEPT but redundant with PresenceChoreographer; v2
  fires its own typing presence updates so we move ours to a no-op)
- Manual LID-to-PN cache + persistence (REPLACED by `LidResolver`)
- Manual presence cycling every 3-7 min (REPLACED by `PresenceChoreographer`
  with circadian rhythm)
- Hard 5s reconnect backoff (REPLACED by `classifyDisconnect()`-driven backoff)

---

## 3. Layered architecture (post-integration)

```
┌──────────────────────────────────────────────────────────────────┐
│  HTTP API: POST /api/instances/:id/send                          │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  WhatsAppInstance.sendMessage()                                   │
│   - normalize JID                                                 │
│   - human handoff check                                           │
│   - legacy AntiBanManager.canSendMessage (backstop)               │
│   - save contact before message                                   │
│   - call this.socket.sendMessage(...)  ←── WRAPPED                │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  baileys-antiban wrappedSocket.sendMessage()                      │
│   1. JidCanonicalizer.canonicalizeTarget(jid)  → PN form          │
│   2. antiban.beforeSend(jid, text)                                │
│       ├─ Health.isPaused? → block                                 │
│       ├─ Timelock.canSend(jid)? → block new contacts if 463 active│
│       ├─ ReplyRatio.canSend(jid)? → block <10% responders         │
│       ├─ ContactGraph.canSend(jid)? → block group/bulk pre-handshake│
│       ├─ Warmup.canSend()? → block if today's quota exceeded      │
│       ├─ RateLimiter.getDelay() → Gaussian jittered delay         │
│       ├─ PresenceChoreographer adjust → circadian multiplier      │
│       └─ ReconnectThrottle multiplier → if recently reconnected   │
│   3. PresenceChoreographer.executeTypingPlan(sock, jid, plan)     │
│       (composing/paused with WPM realism + think pauses)          │
│   4. originalSendMessage(jid, content)  ← raw Baileys             │
│   5. antiban.afterSend(jid, text)                                 │
│       ├─ Warmup.record()                                          │
│       ├─ ReplyRatio increment outbound                            │
│       ├─ Health risk recompute                                    │
│       └─ retryTracker.clear(msgKey.id)                            │
└────────────────┬─────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Baileys socket → proxy agent → WhatsApp WSS                     │
└──────────────────────────────────────────────────────────────────┘
```

Inbound side (incoming messages):

```
WhatsApp WSS → Baileys socket → ev.on('messages.upsert')
       │
       ├─ Our handler: human handoff, contact save, dedup, webhook forward
       │
       └─ baileys-antiban handler (auto-attached by wrapSocket):
          ├─ JidCanonicalizer.onIncomingEvent → learn LID↔PN
          ├─ Timelock.registerKnownChat(jid) → mark as "not new"
          ├─ ReplyRatio.recordIncoming → improves their ratio
          ├─ ContactGraph.markHandshakeReceived
          └─ SessionHealthMonitor on Bad MAC → degraded state
```

Connection events:

```
ev.on('connection.update')
  ├─ open  → antiban.onReconnect()  (post-reconnect throttle starts)
  │       → rampPresenceAfterConnect(45-120s delay) → first 'available'
  ├─ close → antiban.onDisconnect(statusCode)
  │       → classifyDisconnect(statusCode) → backoffMs + shouldReconnect
  │       → if shouldReconnect: setTimeout(reconnect, backoffMs)
  └─ qr/pairing-code → unchanged
```

---

## 4. Per-instance configuration model

Existing shape on disk in `instances/instances.json`:

```json
{
  "id": "wa_xxx",
  "antiBanSettings": {
    "preset": "balanced",
    "messagesPerHour": 200,
    "messagesPerDay": 5000,
    "uniqueChatsPerHour": 50,
    "uniqueChatsPerDay": 500
  }
}
```

New v2 shape (added alongside, not replacing):

```json
{
  "id": "wa_xxx",
  "antiBanSettings": { /* legacy, unchanged */ },
  "antibanV2": {
    "enabled": true,
    "preset": "moderate",
    "overrides": {
      "maxPerMinute": 12,
      "maxPerHour": 250,
      "maxPerDay": 4000,
      "minDelayMs": 1500,
      "maxDelayMs": 5000
    },
    "modules": {
      "warmup":            { "enabled": true,  "warmupDays": 7, "day1Limit": 20 },
      "replyRatio":        { "enabled": true,  "minRatio": 0.10, "minMessagesBeforeEnforce": 5 },
      "contactGraph":      { "enabled": true,  "requireHandshakeBeforeGroupSend": true },
      "presence":          { "enabled": true,  "circadianProfile": "default", "timezone": "Europe/London" },
      "retryTracker":      { "enabled": true },
      "reconnectThrottle": { "enabled": true,  "rampDurationMs": 60000 },
      "lidResolver":       { "enabled": true,  "canonical": "pn" },
      "sessionStability":  { "enabled": true,  "badMacThreshold": 3 },
      "stealthConnect":    { "enabled": true,  "presenceRampMinMs": 45000, "presenceRampMaxMs": 120000 }
    },
    "alertsWebhook": null,
    "createdAt": "2026-04-30T..."
  }
}
```

The legacy `antiBanSettings` keeps working as a backstop. The flat
v2 limits override it once `antibanV2.enabled === true`.

---

## 5. Persistence model

Per-instance state lives under `instances/<id>/antiban/`:

```
instances/<id>/antiban/
  warmup.json              ← day, totalSent, day1Started
  reply-ratio.json         ← per-JID outbound:inbound counters
  contact-graph.json       ← handshake states + group join times
  lid-mappings.json        ← LID↔PN cache (replaces existing lid-mapping.json)
  health-snapshot.json     ← last known risk + failure log
  fingerprint.json         ← chosen browser tuple (sticky per instance)
```

Saving cadence:
- Periodic timer every 60s while connected
- Forced flush on `connection: 'close'`
- Forced flush on `process.SIGTERM`

Loading cadence:
- On `WhatsAppInstance.connect()` before `makeWASocket`
- Pass `savedState.warmup` to `new AntiBan(config, savedState.warmup)`
- Pass `savedState.lidMappings` to `LidResolver({...persistence})`

---

## 6. Migration safety — the critical bit

Existing instances on the fleet are already connected with sessions
established. We must NOT throw them into warmup day 1 (which would cap them
at 20 messages/day).

**Rule:** any instance that was created before v2 launch is recorded as
"warmup complete" — its `warmup.json` is initialized with `phase: 'complete',
day: 8, totalDays: 7`. New instances created post-launch start at day 1.

Detection: when loading an instance from `instances.json`:
- if `antibanV2.enabled` is missing → first run with v2; check `connectedPhone`
- if connectedPhone exists → seed warmup as complete
- else → seed warmup as fresh (day 0)

Existing rate limits are preserved by mapping `balanced` → flat-config
overrides:

```js
function mapLegacyToV2(legacy) {
  const presetMap = {
    conservative: 'conservative',
    balanced: 'moderate',
    aggressive: 'aggressive',
  };
  return {
    enabled: true,
    preset: presetMap[legacy.preset] || 'moderate',
    overrides: {
      maxPerHour: legacy.messagesPerHour,
      maxPerDay: legacy.messagesPerDay,
    },
    modules: { /* sensible defaults, see §4 */ },
  };
}
```

---

## 7. API surface

All under `/api/instances/:id/antiban-v2`:

| Method | Path                | Purpose                                                                          |
|--------|---------------------|----------------------------------------------------------------------------------|
| GET    | `/`                 | Full status: config, health, warmup, retry-tracker, reply-ratio, contact-graph   |
| GET    | `/config`           | Just the config block                                                            |
| PUT    | `/config`           | Update preset + overrides + module flags. Hot-reload (no restart needed if poss) |
| GET    | `/health`           | Compact: `{ risk, score, recommendation, isPaused }`                              |
| GET    | `/warmup`           | Compact: `{ phase, day, totalDays, todayLimit, todaySent, progress, complete }`   |
| GET    | `/lid-mappings`     | Current LID↔PN cache (size + sample)                                              |
| POST   | `/pause`            | Manual emergency pause                                                            |
| POST   | `/resume`           | Resume after pause                                                                |
| POST   | `/reset`            | Nuclear reset (after a real ban; clears all state)                                 |

Battlespace pass-through paths:
- `GET  /api/regions/:code/instances/:id/antiban-v2`
- `POST /api/regions/:code/instances/:id/antiban-v2/pause`
- `POST /api/regions/:code/instances/:id/antiban-v2/resume`

---

## 8. Battlespace UI surface

Each instance row in the detail panel grows a new line:

```
[ ● connected ]  bs-live     [POOL] 212.212.18.198:6849   [VERIFY]
                              [ANTI-BAN]  RISK low  •  WARM day 4/7  •  retries 0  •  badMac 0
                              [ PAUSE ] [ RESUME ] [ RESET ]
```

Risk badge colors:
- `low`     — accent green
- `medium`  — amber
- `high`    — orange
- `critical`— red, pulsing

Top stat bar gets two new cells:
- `WARMING` — count of instances still in warmup (`progress < 100%`)
- `AT RISK` — count with risk ≥ medium

Region card chip: small risk dot per instance count if any is `high|critical`.

---

## 9. Webhook alerts

Two places fire alerts (all opt-in via env or per-instance config):

1. **Per-instance** `instance.webhookUrl` (existing) — fires `event: 'antiban_risk_change'` with `{ old, new, recommendation }` when the instance's risk changes.
2. **Global** `ALERT_WEBHOOK_URL` env var on the regional app — fires high-priority alerts (risk ≥ high, timelock, ban detection).

Payload (Telegram-compatible Markdown):

```json
{
  "event": "antiban_risk_change",
  "instanceId": "wa_xxx",
  "name": "...",
  "region": "uk-west",
  "phone": "44...",
  "old_risk": "low",
  "new_risk": "high",
  "score": 72,
  "recommendation": "Reduce by 80%, consider pausing",
  "timestamp": "2026-04-30T17:30:00Z"
}
```

---

## 10. Rollout plan

1. Phase 1: Land code on `app/`, smoke test locally with `instances/` directory.
2. Phase 2: Build app zip, deploy in waves of 4 to all 8 regions.
3. Phase 3: Verify each region's `/api/health` + a single instance's
   `/api/instances/:id/antiban-v2/health` returns sensible data.
4. Phase 4: Update Battlespace, deploy, restart.
5. Phase 5: Spot-check live: create test instance on UK West → confirm v2
   wrap active in logs, warmup state fresh.
6. Phase 6: Watch for 24h, then mark as steady-state.

Rollback: keep legacy `safeSendMessage` import path in place but unused. If
v2 misbehaves, flip `antibanV2.enabled = false` per-instance and restart.

---

## 11. Risks and mitigations

| Risk                                                                            | Mitigation                                                                          |
|---------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| Wrapping breaks an existing instance's sendMessage path                         | Smoke test locally with our existing test instances before any deploy                |
| Warmup starts at day 1 for a connected production number → throttled to 20/day  | Migration shim seeds existing instances as "warmup complete"                         |
| New stealth fingerprint differs from the one Baileys used at pairing time       | Persist the chosen fingerprint per instance in `fingerprint.json`; reuse on reconnect|
| `wrapSocket` tries to listen on `ev.process` but our code uses `ev.on`          | wrapper.ts gracefully falls back to `ev.on` if `ev.process` missing — confirmed      |
| Circadian rhythm makes a UK instance super-slow at 03:00 even for 24/7 use cases | Default `circadianProfile: 'default'`; expose `'always_on'` opt-out per-instance     |
| `LidResolver` invalidates our existing `lid-mapping.json` cache                  | Migration: read existing on first boot, hand to LidResolver via `persistence.load`   |
| Webhook spam if risk flaps                                                      | onRiskChange already debounces upward transitions; skip downward transitions          |
| Stale state files after instance delete                                         | `deleteInstance` already `rm -rf`s the `instances/<id>/` folder — covered             |

---

## 12. What this doc replaces

Previous version of [ANTI_BAN_PROTOCOL.md](./ANTI_BAN_PROTOCOL.md) described
our hand-rolled rate limiter only. v2 supersedes the policy layer with
something far more sophisticated. The hand-rolled limiter stays as a
backstop until we've validated v2 in production for ≥7 days.
