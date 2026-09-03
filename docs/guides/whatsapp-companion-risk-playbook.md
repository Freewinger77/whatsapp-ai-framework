# WhatsApp companion risk playbook

**Last updated:** 2026-09-02
**Audience:** operators, Codebae, any agent that might bounce a worker or send cold.

This is the durable model. Other guides cover one slice (tctoken, 428 reconnect, fingerprints). This file is how those pieces fit, what WhatsApp actually does, and what we must never do again.

**TyreJobs trial / ATK / ATK2 never-again:** [tyrejobs-sacred-scroll.md](./tyrejobs-sacred-scroll.md).

Related:

- [TyreJobs sacred scroll](./tyrejobs-sacred-scroll.md)
- [tctoken / 463 / reachout hardening](./tctoken-reachout-hardening.md)
- [Reconnect hardening runbook](./reconnect-hardening-runbook.md)
- [Fingerprint risk + staggered reconnect](./fingerprint-risk-and-staggered-reconnect.md)
- [Pairing / reconnect API](./wasup-pairing-reconnect-api.md)
- Worker rule: `.cursor/rules/deployment.mdc`

---

## 1. Mental model (phone ≠ Wasup)

A WhatsApp **number** is the phone. A Wasup **instance** is one **linked companion** (Baileys). Users often rename that device (`airb`, a laptop, a warmer).

| Layer | What “connected” means | Source of truth |
|---|---|---|
| Phone app | The account works. Existing chats work. | The handset |
| Linked devices | How many companions WhatsApp still accepts (max 4) | Phone → **Linked devices** |
| Worker dashboard | Our Baileys socket is up **and** is that companion | `GET /api/instances` `status` |

If the phone works but Linked devices no longer lists our browser (`WhatsApp Multi` / whatever they named `airb`), the worker **will** show disconnected. That is correct. Do not “fix” it with Connect spam.

**Tokens, locks, and 463 are per (account × companion × contact).** A tctoken on trial does not copy to ATK. A lock on ATK2 does not appear on the phone the same way as “logged out of airb.” Trust the **phone banner** for lock remaining when the worker socket is dead — the worker cannot MEX-probe a logged-out companion.

---

## 2. Risk score (Codebae)

Score **intent WhatsApp sees**, not our HTTP story.

| Event | What WA sees | Score | Typical outcome |
|---|---|---|---|
| n8n send / CTA / presence / keep-alive, **same socket** | Normal companion traffic | Low | Fine if not cold-blasting |
| SCP `public/*.html`, `PUT /behavior`, `reload-behavior-from-disk` / `kill -HUP` | No companion event | None | Safe |
| Cold 1:1 with **no tctoken** (incl. “send anyway” exclusions) | New-chat / reach-out | High | 463, then DEFAULT lock ~6h; **stacks to 24h** if you keep going |
| Contact-save / onWhatsApp usync during a lock | Extra IQs on a restricted companion | High | Extends the lock |
| Retry after 463 / n8n retry on `failed` | More reach-outs | High | Extends lock; burns the contact |
| `pm2 reload` / `restart` / crash / OOM / `deploy-to-vm.sh` | **Every** companion on that VM logs out and logs in | **Critical** | 428, then 401, Linked device gone, ~6h lock |
| Two flaps in ~1 min (428 recover + deploy reload) | Companion thrash | **Critical** | Logout + lock (ATK 2026-08-25) |
| Auto-reconnect ~15s after **401 conflict** | Login fight on a dying session | **Critical** | Turns a kick into **fatal logged out / QR** |
| Connect / QR **during** an active lock | New companion while restricted | **Critical** | Longer lock or dead auth |
| Shared egress (`direct` / same proxy, `fingerprintRisk.high`) | Many numbers, one IP | High | Faster locks across the pack |
| Unique proxy, FP `low`, warm tokens, no bounce | One number, one IP, existing chats | Low | Sustainable |

`pm2 reload` is **not** HTTP zero-downtime. Express may keep the port. **Every Baileys socket still dies.**

Stagger (`WA_STARTUP_RECONNECT_STAGGER_MS`) only stops **all lines logging in at once**. It does **not** make a reload safe for one hot number.

---

## 3. Disconnect codes (what they actually mean)

Baileys / WhatsApp status codes we keep mixing up. Classify before touching Connect.

| Code | Log / UI | Meaning | Auth on disk | What to do |
|---|---|---|---|---|
| **428** | Connection replaced / another device took over | A **different socket won** (phone Web, another worker, warmer, our own reconnect). Session usually still valid. | Keep | Stand down. Bounded reclaim OK. Do **not** bounce the whole worker. Do **not** QR. |
| **401 conflict** (`Stream Errored (conflict)`) | Logged out (misleading first line) | Takeover **in progress**. Not necessarily wiped yet. | Keep | **Do not auto-reconnect.** Wait. Phone Linked devices will tell you if `airb` survived. |
| **401 Connection Failure** | Fatal logged out, QR required | Companion session **invalidated**. Connect with old creds will 401 again. | Often still `registered: true` (useless) | If the device is **gone** from Linked devices: wait out any lock, **then one QR**. Never hammer. |
| **403** | Forbidden | WA rejecting this companion after conflict/restriction storm | Keep | Stop. No Connect loop. Hours later, one attempt. |
| **463** | Outbound NACK on a send | Companion send with **no usable tctoken** (or account already reach-out locked) | N/A | `doNotRetry`. Per-contact circuit. Do not resend. |
| **503** | Stream / service unavailable | Transient WA | Keep | Recoverable reconnect. Not a logout. |
| **515** | Restart required | Stream asked for a clean reconnect | Keep | One reconnect. Not QR. |
| **405** | Method / stream oddity | Usually recoverable | Keep | Bounded reconnect. |

**Library vs Wasup:** antiban-v2 can treat 428 as **fatal**. Wasup module `conflict428Recover` (default ON) reclaim-reconnects so clinic bots do not sit offline. That recover is **correct for a lone 428**. It is **wrong** to stack a **PM2 reload** on top of a 428 we just recovered.

**401 conflict auto-reconnect is the known footgun.** Worker still schedules `auto-reconnect 1/8 in 15s` on conflict. That second login is what logs `airb` out and paints the 6h banner. If you are on a restricted/hot line, **do not let that fire** (and do not PM2-reload into it).

---

## 4. Reach-out / new-chat locks

WhatsApp paints a **companion new-chat cap** (MEX `reachoutTimeLock`, types we see: `DEFAULT`, `RESTRICT_ALL_COMPANIONS`, others).

What it is:

- **Not** a full account ban. Phone + **existing** threads usually still work.
- **Is** “this linked device may not start new chats.”
- Timer is typically **~6h** (`DEFAULT`). **Retrying cold / flapping the companion stacks it** (6h → 24h seen on ATK2 2026-08-25). Multi-day locks exist on young lines after spam.

What extends it:

- Any companion **new-chat** attempt: no-tctoken send, contact-save, onWhatsApp usync, CTA to a cold number, n8n retry.
- Companion **re-login** (reload, 401 fight, QR).

What to do:

1. **Stop outbound** on that instance. Gate already hard-stops **before** onWhatsApp / save-contact / `sendMessage` when lock is active.
2. **Do not QR. Do not Reconnect. Do not Link a device.**
3. Wait until `timeEnforcementEnds` **on the phone** if the worker is disconnected.
4. After the clock: **one** Reconnect if creds still listed in Linked devices; **one QR** if the device is gone.

Worker probes can come back **Argo inconclusive**. That is **not** a lock and **not** a reason to block — and **not** a reason to send. If the phone shows a banner, the phone wins.

---

## 5. tctoken, LID, 463

Companion 1:1 send without a live `<tctoken>` → **463** and/or reach-out credit.

Facts we keep relearning:

- Token is harvested from **history sync** and **inbound** `privacy_token` (proactive capture). It does **not** copy across numbers (ATK ↛ ATK2 ↛ trial).
- Baileys stores tokens under **LID**; we send to **PN**. Must **mirror** LID token onto the send JID or WA sees no token (classic 463 on “we have a file but NACK anyway”).
- **Do not first-touch `@lid`.** Map LID→PN; send PN. LID mapping is safe; LID first-send is not.
- Window is ~**28 days**. Expired = cold again.
- `GET /api/instances/:id/privacy-lookup?phone=` is the live check.
- Fake tokens are worse than no token.

**Warm** = usable non-expired token for that contact on **this** instance. **Cold** = not.

TyreJobs (trial / ATK / ATK2) when `coldOptInGate` is on — **current law**, not the old CTA drip:

1. **Not `registered: true` yet → send nothing.** Then wait **6 hours after `registeredAt`.**
2. **Warm (usable token on this companion) → send the job.** Leftover LID files restored at clear-auth are **not** warm on a brand-new pair. `Mirrored tctoken @lid → @s.whatsapp.net` at send time means we copied old bytes onto PN because no PN file existed.
3. **Cold → hold** (`doNotRetry`). **No CTA / buttons. Ever.** After a limit the 5-day clock still exists; these lines still must not send a CTA after it expires.
4. **Never save-contact** on these three. **Never auto-reconnect 401.** **428** uses the Demo quiet-resume curve (20–50s → 1–5m → 30m → stop), not 10s×8.
5. **Timelock active → send nothing.**

Full incident memory: [tyrejobs-sacred-scroll.md](./tyrejobs-sacred-scroll.md).

n8n: holds/CTAs return **HTTP 200** with `sent: true`, `skippedJob: true`, `doNotRetry: true` so HTTP nodes do not throw-retry. Workflows that retry on `status=failed` can still retry — fix the workflow.

---

## 6. Process recycle vs regular ops

### Safe while the same Node process and socket stay up

- n8n `/api/send` (warm)
- Opt-in CTA drip (cold, spaced)
- Presence cycling, keep-alives
- SCP of static HTML / OpenAPI
- `PUT /api/instances/:id/behavior`
- `POST /api/system/reload-behavior-from-disk` or `WASUP_SIGHUP_BEHAVIOR_RELOAD=1` + `kill -HUP`

### Same risk class as a deploy bounce

- `pm2 reload` / `restart` / `delete`+`start`
- `deploy/deploy-to-vm.sh` (`npm install` + restart)
- Worker crash / OOM / VM reboot
- Disconnect-watchdog **force connect** on a hot line
- 428 reclaim **plus** a reload in the same minute
- Connect/QR loops after fatal 401
- PM2 `cluster` mode (duplicates sessions — never)

**Do not reload wasup2/wasup3 to ship hold/token JS.** SCP the files. Wait for a calm window the operator **explicitly** accepts. A hold bug is cheaper than a 6h/24h lock and a QR.

If you must bounce a **quiet** worker: one `reload` (not `restart`), watch staggered `Scheduling startup auto-reconnect`, verify `/api/instances`, **no** mass Reconnect-all.

---

## 7. Operator decision trees

### A. Phone works, dashboard disconnected

1. Open **Linked devices**.
2. If our device is **listed** and recently active → one **Reconnect** (keep auth). Not QR.
3. If our device is **missing** / “logged out” → session is dead. If a **lock banner** is showing, wait it out. Then **one** Link a device (QR). Stop.

### B. 428 in logs, status bouncing

Someone else has a socket (or we just replaced ourselves). Stop deploys. Let `conflict428Recover` try. If it loops 8/8, press Reconnect **once**. Do not reload the VM.

### C. 401 conflict then 401 Connection Failure

We already lost. Auto-reconnect made it fatal. **Stop.** Read Linked devices + lock banner. No QR until the clock ends.

### D. Timelock banner (~6h / 24h)

Stop feeders. Confirm worker hard-stop (holds, not contact-save). Sit the timer. Existing chats on the phone are OK.

### E. 463 on a send

Do not retry that contact. Check privacy-lookup. If no token, they are cold — CTA path, not jobs.

### F. “Just bounce it, it will come back”

It often comes back **and** takes a lock with it. Young companions (days old) + cold traffic + bounce = tonight.

---

## 8. Incidents (pattern, not bad luck)

### 2026-08-28 wasup3 (ATK2 pair)

- **ATK** `447503741818` paired in the morning (registration-safe), first job used the same LID→PN copy ~80s later, **survived**, still sending tokened jobs.
- **ATK2** `447503742842`: pairing codes typed on **trial** first; then a real pair. **515** restart wrapped antiban + full history (`me.id` leftover, `registered:false`). At **23s** after `Connected as`: **saved new contact** + mirrored **6-day-old LID token** onto PN (PN file created at send) + job C3FA → DEFAULT lock until 19:00 + **401 conflict** → auto-reconnect 15s → **401 logged out**.
- Lesson: the LID copy was the same as ATK. The kill was **send + save-contact before `registered: true`**, then **fighting the 401**. Rule now: **registered + 6 hours**, no save-contact, no CTA, no conflict auto-reconnect on these three.

### 2026-08-27 ATK 403

A ~7-minute-old ATK companion plus one save-number CTA (`447598246847`) produced **403** and a dead phone. Never test-CTA a newborn companion.

### 2026-08-25 wasup3 (TyreJobs)

- **ATK2** `447503742842`: ~40 **cold** jobs to Marshall (no tctoken) because of a “send even without token” exclusion. Reload 18:40 UTC, one more cold send 18:56 → lock **6h then 24h**, 401 logout.
- **ATK** `447503741818` (Linked name **`airb`**): 428 at 18:39 (recovered), **our pm2 reload at 18:40**, warm job + contact-save 18:52, 401 conflict, auto-reconnect 15s → **airb gone**, phone **~5h51m** lock.
- **trial** stayed up; already locked until 2026-08-29.
- Lesson: token-first gate was correct; **shipping it with a reload on hot lines was not.** Exclusions that bypass tctoken are how you buy a 24h lock.

### 2026-08-03 wasup2 / wasup3

Worker restarts → mass companion re-login: Nordkone 401, Regent 6h lock, ATK + Dispatch 401 twice, wasup.co 403 after cold blasts. Led to staggered startup reconnect + fingerprint risk.

### Recurring 428 (old north / shared devices)

Staff WhatsApp Web or a second worker steals the socket. Auth valid. Bounded reclaim is right. Reload-avoidance left some workers **unable** to reclaim — that is a different bug (stale classifier). Fix code on a **quiet** window; do not “just reload prod” to pick up the fix.

### Historical TyreJobs (warmer / Chinese LID DMs)

Manual/warmer cold DMs to `@lid` + companion conflict → `RESTRICT_ALL_COMPANIONS` + 401. Wasup logging “manual message detected” means **another device sent**, not our API. Still counts against the number.

### 2026-08-21 Samantha ACK timeout (Dental / WF-1)

**Samantha Lane** `447305613523` got the same opener **three times in four minutes**. Baileys had already minted a real WA id and WhatsApp delivered. `_awaitOutboundServerAck` timed out and returned `sent: false` / `status: failed`. n8n cron unlocked her and claimed again.

**Law:** timeout with a real message id → **`sent` + `doNotRetry`**, never `failed`. n8n: any real `3EB0…` id is already on WhatsApp. Fake UUID / no id is the only genuine fail.

Companion sockets (dental, Content Crew, many clinics) often **never emit SERVER_ACK** even when the message delivered. Default `/send` still waits up to **60s** then marks sent. That is why n8n Send Bubble sits ~70s and the queue piles up.

### 2026-09-02 `skipOutboundAckWait` (wasup.northeurope first)

Per-instance switch, **default OFF**. On = fire-and-forget: once Baileys mints an id, return `sent` + `doNotRetry` immediately. Still one shot — no Samantha double-text. Tradeoff: a real 463 NACK will not fail that HTTP request.

Dashboard: **Don't wait for WhatsApp ACK**. `PUT /behavior` `{ "skipOutboundAckWait": true }`. Flip needs no bounce after the JS is loaded.

Shipped to **wasup.northeurope only** first. Do **not** bounce wasup3 to pick this up. Do **not** turn it on for trial / ATK / ATK2.

---

## 9. Code map (where the lessons live)

| Lesson | Where |
|---|---|
| Timelock hard-stop before WA IQs | `instance-manager.js` `sendMessage` (before onWhatsApp / contact-save) |
| Token-first TyreJobs gate | `_tyrejobsHasUsablePrivacyToken`, `_planAtk2OptInCta` (no-op unless opt-in switch), `_maybeHoldJobUntilHumanReply` |
| registered + 6h / hard no-CTA | `tyrejobs-post-limit-quiet.js`, `_noteTyrejobsRegistered`, `_isTyrejobsPostLinkSendHold` |
| TyreJobs 401 stand-down | `_isTyrejobsProtectedLine` + fatal branch (no auto-reconnect) |
| TyreJobs / Demo 428 quiet resume | `_usesDemoResumeCurve` + `_scheduleSharedDeviceResume` (20–50s → 1–5m → 30m → stop) |
| LID→PN token mirror | `privacy-token-hardening.js`, `_ensurePrivacyTokenBeforeSend` |
| 463 circuit / `doNotRetry` | `_tripContact463Circuit`, `_awaitOutboundServerAck` |
| Fire-and-forget send (no ACK wait) | `behaviorSettings.skipOutboundAckWait` (default off) — skip `_awaitOutboundServerAck` |
| 428 reclaim vs fatal | `conflict428Recover`, `_scheduleConflictReconnect` |
| Startup stagger | `WA_STARTUP_RECONNECT_STAGGER_MS` |
| Fingerprint sharing | `GET /api/fingerprint-risk` |
| Behavior without bounce | `POST /api/system/reload-behavior-from-disk` |

Env worth knowing (defaults in code):

```bash
WA_STARTUP_RECONNECT_STAGGER_MS=8000
WA_STARTUP_RECONNECT_JITTER_MS=3000
WA_RUNTIME_RECONNECT_STAGGER_MS=5000
WA_RECONNECT_MAX_ATTEMPTS=8
WA_CONFLICT_RECONNECT_MAX_ATTEMPTS=8
WA_SHARED_DEVICE_RESUME_BASE_MS=120000
WASUP_BLOCK_COLD_WITHOUT_TOKEN=false   # fleet default; TyreJobs uses coldOptInGate instead
```

---

## 10. Non-negotiables

1. **Never PM2-recycle a worker with live restricted or customer lines** unless the operator says the lock/QR risk is accepted.
2. **Never QR** a number that is showing a reach-out lock.
3. **Never retry** 463 / timelock holds (n8n `doNotRetry`).
4. **Never** “send even without tctoken” for companion jobs.
5. **Never** two Wasup workers, cluster mode, or a warmer + Wasup fighting the same number.
6. **Never** treat dashboard `connected` as Linked devices, or phone-works as Wasup-linked.
7. **Never** clear-auth unless you intend a new QR/pair. Preserve tctoken/lid files. Do not copy whole `auth/` to a second VM.
8. After a **401 conflict**: **stop**. Auto-reconnect 1/8 is how `airb` dies. TyreJobs trial/ATK/ATK2: **no auto-reconnect at all.**
9. After a fresh pair on those three: **nothing outbound until `registered: true` plus 6 hours.** No save-contact. No CTA. No test job. A leftover LID file is not a live token.

If it is not on this list, it is still probably a companion flap. Ask before bouncing.
