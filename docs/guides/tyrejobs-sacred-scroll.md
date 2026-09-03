# TyreJobs sacred scroll (never again)

**Last updated:** 2026-09-02  
**Lines:** trial-Tyrejobs `447503207364`, TyreJobs-ATK `447503741818`, TyreJobs-ATK2 `447503742842` only.  
**Not these:** paid-Tryejobs, variset, Booklapland, K1, or any other business on wasup3.

Canonical companion / 401 / 428 / PM2 model: [whatsapp-companion-risk-playbook.md](./whatsapp-companion-risk-playbook.md).  
Agent rules: `.cursor/rules/tyrejobs-no-cta-after-limit.mdc`, `.cursor/rules/deployment.mdc`.

If you are about to pair, send, save-contact, auto-reconnect, or bounce wasup3 for these three numbers — **stop and read this whole file.**

---

## Commandments

1. **Never bounce wasup3** (`pm2 reload` / `restart` / crash) while ATK, paid, variset, Booklapland, or K1 are live. SCP JS and wait. Operator must explicitly accept a bounce.
2. **Dashboard `connected` is not `registered: true`.** Sending before `creds.registered === true` is how ATK2 died on 2026-08-28.
3. **After `registered` flips true (status sync done), wait 6 hours.** Then jobs with a usable tctoken only. Clock: `instances/<id>/post-limit-quiet.json` → `registeredAt`.
4. **A leftover LID tctoken file is not a live token on a new companion.** `Mirrored tctoken 123@lid → 447…@s.whatsapp.net` means we **copied old bytes onto PN** because no PN file existed. That is not “warm.”
5. **Never save-contact** (`Unknown User {last4}`) on these three. Address-book write on a newborn companion is a reach-out event.
6. **Never auto-reconnect 401 conflict** on these three. Stand down. Auth stays on disk. Operator decides the next connect. **428** is different: quiet resume **20–50s → 1–5 min → 30 min → stop** (same curve as Demo). Do **not** fight 428 with 10s×8. After the third miss, press Connect.
7. **Never CTA / buttons / lists.** Hard-off — no operator switch. After any limit the 5-day `noCtaUntil` clock still exists, but these lines must not send a CTA even after it expires.
8. **No token → hold** (`doNotRetry`, nothing hits WhatsApp). No Marshall/Lee exceptions. No test job. No test CTA.
9. **One pairing code. Correct phone. Wait.** Wrong/expired ≠ mint five more. Trial `07503 207364` ≠ ATK `07503 741818` ≠ ATK2 `07503 742842`.
10. **515 after a successful pair is normal** (restart with new keys). Coming back with antiban wrap + `syncFullHistory` because leftover `me.id` is not normal. Stay registration-safe until the link finishes.

---

## The phones (memorise this)

| Line | MSISDN | Instance id | Notes |
|---|---|---|---|
| TyreJobs-ATK | `447503741818` / 07503 741818 | `wa_mrkslqeb_0b6og` | Linked name has been `airb`. 403 on 27 Aug from CTA. |
| TyreJobs-ATK2 | `447503742842` / 07503 742842 | `wa_mt7k88um_46lo7` | 401 logged out 28 Aug after 23s send. |
| trial-Tyrejobs | `447503207364` / 07503 207364 | `wa_mrscw48u_xfqds` | 401. Do not enter ATK2 codes here. |
| paid-Tryejobs | `447503208086` | `wa_mrkslwud_ajyvr` | **Not** in this gate. Do not freeze. |

Pairing **code** needs the MSISDN. **QR does not.** Entering ATK2’s code on trial is how you get “incorrect” / “couldn’t link” while the socket is still up.

---

## Token truth (LID vs tctoken vs mint)

WhatsApp privacy tokens (`<tctoken>`) are stored by Baileys under **`@lid`**. Outbound send uses **PN** (`@s.whatsapp.net`).

| What you see | What it actually is |
|---|---|
| `tctoken-447…@s.whatsapp.net.json` exists **before** send, mtime from history/inbound **after this pair** | Real-enough for this companion |
| Only `tctoken-<lid>@lid.json`, restored at **clear-auth**, inner timestamp from **days ago** | Previous companion’s token on disk |
| Log: `Mirrored tctoken <lid>@lid → <pn>@s.whatsapp.net` | We **copied** LID bytes onto PN **at send time**. PN file mtime = send time. We did **not** mint new WhatsApp bytes. We also did **not** prove this companion is warm. |
| `_tyrejobsHasUsablePrivacyToken` true | “Unexpired file exists for LID or PN.” On a 23-second-old pair that is a **lie** if the file was restored from the last companion. |

**Do not invent tokens.** Fake bytes skip 463 and still never deliver.

**Do not copy `auth/` between VMs.** Same companion on two sockets = 428 fight.

**Tokens do not copy ATK → ATK2 → trial.** Per account × companion × contact.

After re-pair, `clear-auth` with `preservePrivacyTokens: true` restores tctoken/lid/device-list files. Those files are for **history**, not a licence to send in the first minute.

---

## What killed ATK2 (2026-08-28, ~13:00 UTC)

ATK (morning) and ATK2 (afternoon) both did the **same LID→PN copy** on first job. ATK lived. ATK2 died. The copy was not the unique kill. The **window** was.

1. Pair `5JXS-Q6HR` on **07503 742842**. Earlier codes were typed on **trial**. One code, wait.
2. WhatsApp **515 restart required** (~6s after scan). Normal after a real pair.
3. Reconnect saw leftover `me.id` + `registered:false` → **antiban wrap + `syncFullHistory: true`** instead of registration-safe.
4. **13:00:27** `Connected as 447503742842`. History still flooding. Creds still `registered:false`.
5. **13:00:50** **Saved new contact** `447719518933` as `Unknown User 8933`.
6. Same second: mirrored **22 Aug** LID token onto PN (PN file did not exist until that millisecond).
7. **13:00:51** sent job **C3FA**.
8. **13:00:52** DEFAULT reach-out lock until **19:00 UTC** + **401 conflict**.
9. Auto-reconnect **1/8 in 15s** → **13:01:12 401 logged out**.

22 seconds before the send, new-chat cap probe still said `NONE`. The lock flipped in the same second as save-contact + send.

ATK the same morning: same mirror pattern ~80s after connect, no 401 conflict loop, still sending tokened jobs and holding cold ones.

---

## Pairing (Baileys 7.0.0-rc13)

- `requestPairingCode` after a **blind 2s delay** (we do not wait for `pair-device`). Too early → 401/428. See Baileys PR #2409 (sets `creds.me` too early).
- Code appears, UI paints it, close clears `pairingCode` → “expired” / blank.
- **401 ~2s after mint** = failed companion **registration**, not post-pair 515.
- **515 after a successful pair** = expected restart. Do not QR. Do not mint another code.
- Pairing **storm** (five codes in minutes) is how WhatsApp starts refusing.
- After 401/403: wait, then **one** attempt. Prefer QR if pairing code keeps dying — operator call.
- `clear-auth` (keep tokens) then **one** `POST /pair` with the **correct** MSISDN is the flow that worked for ATK.

Do not mint pairing codes on a line that is **403** / lock-banner without the operator explicitly accepting that risk.

---

## After a limit (403 / 401 / reach-out / “can’t use WhatsApp”)

When that number is connected again:

- **Zero CTAs for 5 full days from that `Connected as`.** Not 5 days from now. Clock: `noCtaUntil`.
- **Zero jobs until `registered: true` + 6 hours** (`registeredAt`).
- Do not Connect/QR during the lock. Do not test-send.

---

## Code map (TyreJobs-only — do not apply to paid)

| Lesson | Where |
|---|---|
| Allowlist phones/ids | `app/src/utils/tyrejobs-cold-opt-in.js` |
| `registered` + 6h hold, hard no-CTA | `app/src/utils/tyrejobs-post-limit-quiet.js` |
| Hold / skip contact-save / no CTA planner | `instance-manager.js` `_isColdOptInGateActive`, `_isTyrejobsPostLinkSendHold`, `_noteTyrejobsRegistered`, `_planAtk2OptInCta` |
| 401 stand-down (no auto-reconnect) | `instance-manager.js` fatal branch + `_isTyrejobsProtectedLine` |
| 428 quiet resume (20–50s → 1–5m → 30m → stop) | `_usesDemoResumeCurve` / `_scheduleSharedDeviceResume` (trial/ATK/ATK2 + Demo) |
| 515 stays registration-safe | `connect()` `isInitialRegistration` override when pairing recovery |
| LID→PN copy (not a mint) | `privacy-token-hardening.js` `mirrorPrivacyTokenToJid` |

Live wasup3: SCP these files. They do **not** load until a process bounce the operator accepts. Disk ≠ RAM.

---

## What you must never do to “fix” it

- `pm2 reload` wasup3 to ship a hold.
- Pairing-code spam. Wrong number. Trial vs ATK vs ATK2.
- Test CTA / test job on a companion minutes old.
- Treat `Mirrored tctoken …@lid` as proof of a live PN token.
- Fight **401 conflict** with auto-reconnect (the 15s×8 path that logged ATK2 out on 28 Aug).
- Fight **428** with the fast 10s×8 reclaim. Use the 20–50s / 1–5m / 30m curve, then stop.
- Bounce wasup3 because ATK2 is dead while ATK is sending.

---

## 428 sit-down (2026-08-31, ATK2)

ATK2 `wa_mt7k88um_46lo7` got **428 Connection Terminated** at **09:57 UK**. Old law: *TyreJobs stand-down — not auto-reconnecting.* Auth was preserved. The line sat disconnected ~20+ minutes until a human pressed Connect.

That stand-down was written to stop the **401 fight** that killed ATK2 on 28 Aug. It also left a healthy 428 companion offline. Demos had the same problem until the quiet-resume curve.

**Current 428 law (trial / ATK / ATK2 + Demo), operator-accepted risk:**

1. First 428 → come back in **20–50 seconds** (random).
2. If it 428s again → **1–5 minutes** (random).
3. If it 428s again → **30 minutes**.
4. Then **stop**. Auth kept. Operator Connect.

**401 / 403 still stand down.** Do not auto-reconnect those.

A 7-minute-old ATK companion + one save-number CTA (`447598246847`, 2026-08-27) produced **403** and a dead phone. A 23-second-old ATK2 companion + save-contact + job produced **401 logged out**. Same class of fuckery.

If you need a code change: **SCP and wait.**

---

## Samantha episode + “Don't wait for ACK” (2026-08-21 / 2026-09-02)

Not TyreJobs, but this is the same holy-scroll class of fuckery: **Wasup said failed, WhatsApp already delivered, n8n unlocked and resent.**

**Samantha Lane** `447305613523` (Dental Aesthetica, 21 Aug): WF-1 cron fired the same opener **three times in four minutes**. `_awaitOutboundServerAck` timed out, flipped `sent: false` / `status: failed` even though Baileys had already minted a real WA id and the phone delivered. Cron saw failed → unlocked → claimed her again. All three landed.

**Law after that:** ACK timeout with a real message id → **`sent` + `doNotRetry`**, never `failed`. n8n must treat any real `3EB0…` id as already on WhatsApp. Fake UUID / no id is the only genuine fail.

**Content Crew (2 Sep):** companion sockets often **never emit SERVER_ACK** even when the message delivered. Default path still waits **60s** then marks sent. n8n Send Bubble sits ~70s and the queue piles up.

**Switch:** `skipOutboundAckWait` — **default OFF** on every instance. On = fire-and-forget: once Baileys mints an id, `/send` returns `sent` + `doNotRetry` immediately. Still one shot. Tradeoff: a real 463 NACK will not fail that HTTP request.

Dashboard: **Don't wait for WhatsApp ACK**. Worker: `PUT /api/instances/:id/behavior` `{ "skipOutboundAckWait": true }`. No bounce to flip the switch after the JS is loaded.

Rolled to **wasup.northeurope only** first (`20.107.202.157`). Do **not** bounce wasup3 to ship this. Do **not** turn it on for trial / ATK / ATK2 — those lines still want the 463 NACK on the HTTP response.

Playbook: [whatsapp-companion-risk-playbook.md](./whatsapp-companion-risk-playbook.md) §8 Samantha.
