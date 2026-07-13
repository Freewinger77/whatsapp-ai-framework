# Wasup Worker API — Pairing & Reconnect Guide (tested)

Bulletproof, tested recipes for connecting / reconnecting a WhatsApp instance via pairing code.
Verified live against Bashir's worker on **2026-06-16**.

> **Goal of this guide:** from *any* state (disconnected, half-connected, corrupt auth, was-connected-then-dropped),
> reliably reach **"pairing code generated"** so a human can link the device.

---

## 0. Connection details

| Item | Value |
|------|-------|
| Worker base URL | `https://bashir-s-workspace-hlzpr2.wasup.co` |
| Apex instance ID | `51981fe4-d0f6-4801-8060-750deb57fc72` |
| Auth header | `X-API-Key: <key>` **or** `Authorization: Bearer <key>` |
| Content type | `application/json` |

All examples use shell var `BASE`, `ID`, `KEY`, `PHONE` (E.164 digits, **no `+`**, e.g. `447835156367`).

---

## 1. The ONE flow you should use (bulletproof "always reach a pairing code")

This is the behavior the other project asked for: **regardless of current state or whether auth was cleared, end with a fresh pairing code.**

```
POST /api/instances/:id/disconnect      # 1. kill any live/half socket
POST /api/instances/:id/clear-auth       # 2. wipe creds  → forces fresh registration
(wait ~2s)
POST /api/instances/:id/connect          # 3. generate a NEW pairing code
GET  /api/instances/:id/connection       # 4. poll until status === "connected"
```

### Why all three steps (do not skip clear-auth)

`POST /connect` only **requests a pairing code when the instance is NOT registered**.
If the instance was connected before (creds still on disk, `registered: true`), `/connect`
will silently try to *resume the old session* and return `pairingCode: null` — **no code for the user**.

`clear-auth` deletes the auth folder so `registered` becomes false, which guarantees the next
`/connect` issues a code. This is also what fixes the **`428 Connection Closed`** failure (see §5).

### Copy-paste (bash)

```bash
BASE=https://bashir-s-workspace-hlzpr2.wasup.co
ID=51981fe4-d0f6-4801-8060-750deb57fc72
KEY=<your-api-key>
PHONE=447835156367
H=(-H "X-API-Key: $KEY" -H "Content-Type: application/json")

curl -sS "${H[@]}" -X POST -d '{}' "$BASE/api/instances/$ID/disconnect"
curl -sS "${H[@]}" -X POST       "$BASE/api/instances/$ID/clear-auth"
sleep 2
curl -sS "${H[@]}" -X POST -d "{\"phoneNumber\":\"$PHONE\"}" "$BASE/api/instances/$ID/connect"
```

**Tested response (TEST 4):**

```json
{ "success": true, "reused": null, "pairingCode": "KA9VZW8L",
  "message": "Pairing code generated: KA9VZW8L" }
```

Total time for steps 1–3: **~4.4s** (disconnect 75ms, clear-auth 27ms, connect ~2.4s incl. the deliberate 2s socket warm-up).

---

## 2. Endpoint reference (verified behavior)

### `POST /api/instances/:id/connect`
Body: `{ "phoneNumber": "447835156367" }` (also accepts `phone` or `pairingPhone`).

| Condition | Result |
|-----------|--------|
| Not registered (after clear-auth) | **Generates** new code → `{ pairingCode, reused: null }` |
| Code <120s old, same phone, still `connecting` | **Reuses** it → `{ pairingCode, reused: true }` |
| Already `registered` (was connected) | Resumes session, **`pairingCode: null`** ← not what you want for re-pair |
| No phone in body | QR mode (`pairingCode: null`, sets `qrCode`) |
| Socket dropped mid-handshake | `400 { error: "Connection Closed" }` (see §5) |
| Unknown id | `400 { error: "Instance <id> not found" }` |

### `POST /api/instances/:id/disconnect`
Body optional: `{ "revoke": true }` to revoke server-side session. Default **keeps** creds on disk.
- `200 { success, message, instance }`. Idempotent — safe to call when already disconnected.

### `POST /api/instances/:id/clear-auth`
No body. Logs out the socket, **deletes the auth folder**, recreates it empty, status → `disconnected`.
- `200 { success, message: "Auth cleared", instance }`. Idempotent.

### `GET /api/instances/:id/connection`  ← poll this
```json
{ "success": true, "status": "connecting", "phone": null,
  "connectedAt": null, "uptime": null, "pairingCode": "KA9VZW8L", "qrCode": null }
```
`status` ∈ `disconnected` | `connecting` | `connected`. Poll every **3–5s**.

### `GET /api/instances/:id/qr`
Returns `{ status, qrCode, pairingCode }`. `?format=image` → PNG (204 when connected).

### `POST /api/instances` (create new instance)
Body: `{ "name": "...", "webhookUrl": "..." }` → `201 { instance: { id, ... } }`.
> On Bashir's worker this is wired to register the new instance with the control plane
> (so it appears in dev.wasup). Prefer the control-plane provision flow for multi-tenant — see §6.

### `POST /api/onboard` (create + connect in one call)
Body: `{ "phone": "447...", "name": "...", "webhookUrl": "..." }`
**Field is `phone`, NOT `phoneNumber`** (common 400 cause). Returns `{ instanceId, pairingCode }`.

---

## 3. Scenario recipes

### A. Brand-new number (never connected)
```
POST /api/instances            { name, webhookUrl }        → save instance.id
POST /api/instances/:id/connect { phoneNumber }            → pairingCode
GET  /api/instances/:id/connection  (poll until connected)
```
Or one call: `POST /api/onboard { phone, name, webhookUrl }`.

### B. Was connected, then disconnected — re-pair (the other project's requirement)
> They want: **disconnected for any reason → clear auth → reach pairing code.**
Use the **§1 flow exactly** (disconnect → clear-auth → connect). Do **not** call bare `/connect`
on a was-connected instance expecting a code — it will resume silently and return `pairingCode: null`.

### C. Reconnect WITHOUT re-pairing (keep existing linked session)
Only if you want to resume an existing device link (no new code):
```
POST /api/instances/:id/connect   (no phone, or phone but expect pairingCode:null if registered)
GET  /api/instances/:id/connection
```
If it won't come back `connected` within ~30s → fall back to the §1 re-pair flow.

### D. User says "code didn't work" / expired
Codes live ~2 min. Run the **§1 flow** once to mint a fresh one. Show the new code. Do **not** loop.

---

## 4. Polling pattern (pseudo-code, safe)

```python
def reach_pairing_code(base, id, key, phone):
    H = {"X-API-Key": key, "Content-Type": "application/json"}
    requests.post(f"{base}/api/instances/{id}/disconnect", headers=H, json={})
    requests.post(f"{base}/api/instances/{id}/clear-auth", headers=H)
    time.sleep(2)
    r = requests.post(f"{base}/api/instances/{id}/connect", headers=H,
                      json={"phoneNumber": phone})
    if r.status_code == 400 and "Connection Closed" in r.text:
        time.sleep(4)                                  # one self-heal retry (§5)
        r = requests.post(f"{base}/api/instances/{id}/connect", headers=H,
                          json={"phoneNumber": phone})
    code = r.json().get("pairingCode")
    return code   # show to user; then poll /connection until "connected"

def wait_connected(base, id, key, timeout=180):
    H = {"X-API-Key": key}
    deadline = time.time() + timeout
    while time.time() < deadline:
        s = requests.get(f"{base}/api/instances/{id}/connection", headers=H).json()
        if s["status"] == "connected":
            return True
        time.sleep(4)                                  # 3–5s; NEVER call /connect here
    return False
```

**Rules baked in:**
- Exactly **one** `/connect` per pairing attempt (plus at most one self-heal retry on `Connection Closed`).
- While waiting, **only** `GET /connection`. Never re-`POST /connect` in the poll loop.
- Respect `reused: true` — show the same code, do not refresh.

---

## 5. Errors & how to avoid them (all observed live)

| Symptom | Root cause | Fix / avoidance |
|---------|-----------|-----------------|
| **`400 "Connection Closed"`** with `statusCode 428` on `requestPairingCode` | Stale/corrupt auth on disk (prior 401 logout or aborted pairing) → WhatsApp rejects the handshake; **or** a previous socket still tearing down | Run **clear-auth before connect** (§1). If it still 400s, wait 4s and retry connect **once**. Never rapid-fire connect. |
| `pairingCode: null` on connect | Instance still `registered` (auth not cleared) — it resumed instead of re-pairing | Call **clear-auth first** to force a new code |
| `reused: true`, code unchanged | Reuse guard (code <120s old) — this is correct | Show the same code; stop calling connect |
| WhatsApp app: **"something went wrong"** | Code rotated because connect was called repeatedly while user was typing | One connect per attempt; let the user enter the current code; poll GET only |
| `400 "Instance <id> not found"` | Wrong id, or instance was deleted | Verify id via `GET /api/instances`; re-create/provision if gone |
| `401 "Invalid API key format."` | Bad/missing key | Use a valid `sk-prod-…` or worker key. (Good: this is **401, not 500** — auth is validated cleanly) |
| `400 "Missing required field: phone"` on `/api/onboard` | Used `phoneNumber` instead of `phone` | `/onboard` wants `phone`; `/connect` accepts `phoneNumber`/`phone`/`pairingPhone` |
| Instance briefly `not found in map` | Connect raced with a reload/migration | Don't fire connects during create/migrate; retry after 2s |

### The golden rule
**disconnect → clear-auth → (2s) → connect → poll GET.** One connect. No loops. This is immune to the `428`.

---

## 6. Multi-tenant note (important for the other project)

Bashir's worker is **one org VM**. For a *different project / customer*, do **not** keep calling
`POST /api/onboard` on this shared URL — it creates local `wa_*` instances that don't map cleanly
to the control plane and lead to the ghost/mismatch problems we've been fixing.

For new tenants, provision through the control plane so each gets its own instance UUID:

```
POST https://control-plane.wasup.co/api/v3/provision/instances
Authorization: Bearer sk-prod-<key>
{ "name": "...", "phone": "447...", "regionCode": "uk-south",
  "webhookUrl": "https://your-app/api/webhooks/wasup" }
```

Then run the §1 pairing flow against the returned `worker_endpoint` + UUID.
Full integration doc: `docs/guides/rapidmot-integration.md`.

---

## 7. Current live state (for the customer right now)

| Field | Value |
|-------|-------|
| Instance | `51981fe4-d0f6-4801-8060-750deb57fc72` |
| Phone | `447835156367` |
| **Active pairing code** | **`KA9VZW8L`** (regenerate with §1 if >2 min old) |
| Status | `connecting` |

WhatsApp → **Linked Devices → Link with phone number** → enter the code once, don't refresh.

A runnable test harness lives at `deploy/scripts/test-pairing-flow.sh`.
