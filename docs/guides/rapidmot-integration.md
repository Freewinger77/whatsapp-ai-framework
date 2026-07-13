# RapidMOT × Wasup integration guide

Instructions for the **RapidMOT team** (Bashir) and the **Wasup ops/deploy** checklist for Bashir's org worker.

---

## Part 1 — Instructions for RapidMOT

### Architecture rule (read this first)

Each RapidMOT customer needs **their own Wasup instance UUID**, created through the **control plane**, not by calling `POST /api/onboard` directly on the shared worker URL.

| Do | Don't |
|----|-------|
| Create instance via control plane | Call `POST /api/onboard` on the worker for every signup |
| Store the **UUID** from provision response | Store `wa_*` IDs from raw onboard |
| Poll `GET /connection` during pairing | Spam `POST /connect` every few seconds |
| Delete via control plane (one call) | Triple DELETE on worker + Supabase cleanup |
| One connect per pairing attempt | Refresh/reconnect loop while user enters code |

**Why:** Bashir's worker (`bashir-s-workspace-hlzpr2.wasup.co`) is **one org VM**. Raw `/api/onboard` creates local `wa_*` ghosts that never land in Supabase → reconnect breaks, webhooks point at wrong IDs, DELETE fails.

---

### Correct flow for a new RapidMOT customer

#### Step 1 — Provision instance (control plane)

Use your org API key (`sk-prod-…`) against the control plane:

```http
POST https://control-plane.wasup.co/api/v3/provision/instances
Authorization: Bearer sk-prod-<your-key>
Content-Type: application/json

{
  "name": "Apex Auto and MOT Centre",
  "phone": "447835156367",
  "regionCode": "uk-south",
  "webhookUrl": "https://rapidmot-seven.vercel.app/api/webhooks/wasup",
  "behaviorProfile": "notification-balanced"
}
```

**Save from response:**
- `instance.id` — UUID (e.g. `51981fe4-d0f6-4801-8060-750deb57fc72`) — **this is the only ID you store in Supabase**
- `instance.worker_endpoint` — worker base URL for this org
- `deployment.base_url` — same worker URL

If you get **402**, the org is out of trial/paid slots — fix billing before onboarding more customers on this worker.

#### Step 2 — Start pairing (worker, once)

```http
POST {worker_endpoint}/api/instances/{instance.id}/connect
Authorization: Bearer sk-prod-<your-key>
Content-Type: application/json

{
  "phoneNumber": "447835156367"
}
```

**Response fields:**
- `pairingCode` — 8-char code for WhatsApp Linked Devices
- `reused: true` — code still valid (<2 min); **do not call connect again**

Show the code to the customer. They enter it in **WhatsApp → Linked Devices → Link with phone number**.

#### Step 3 — Poll until connected

```http
GET {worker_endpoint}/api/instances/{instance.id}/connection
Authorization: Bearer sk-prod-<your-key>
```

Poll every **3–5 seconds**. Stop when `status === "connected"`.

**Do not** call `POST /connect` again while polling unless:
- Status is `disconnected` **and** pairing code expired (>2 min), **or**
- User explicitly taps "Get new code"

#### Step 4 — Reconnect (existing customer)

```http
GET {worker_endpoint}/api/instances/{instance.id}/connection
```

If `disconnected`:
1. Optional: `POST …/clear-auth` (only if logged out / 401 in logs)
2. **One** `POST …/connect` with phone number
3. Poll `GET …/connection` only

**Never** in reconnect:
- DELETE the UUID instance from the worker (blocked for customer keys; use control plane)
- Create a new `wa_*` via `/api/onboard`
- Loop delete + create + connect

#### Step 5 — Change phone number

1. **One** delete via control plane (or internal ops), not three worker DELETEs
2. Provision **new** instance UUID via control plane
3. Update Supabase with the **new UUID**
4. Pair once with new phone

---

### Field names (common mistakes)

| Endpoint | Field | Notes |
|----------|-------|-------|
| `POST /api/onboard` | `phone` | Required. **Not** `phoneNumber` |
| `POST …/connect` | `phoneNumber`, `phone`, or `pairingPhone` | All accepted |
| Provision | `phone`, `regionCode`, `webhookUrl` | See OpenAPI on control plane |

**Prefer provision + connect** over `/api/onboard` for production multi-tenant.

---

### Error handling in your UI

| Worker response | Show user | Your action |
|-----------------|-----------|-------------|
| `404 Instance not found` | "Setup incomplete — contact support" | UUID in DB doesn't exist on worker; re-provision or sync |
| `403 Forbidden` on DELETE | Don't expose | Use control plane delete, not worker |
| `reused: true` on connect | Show same code | Stop calling connect |
| WhatsApp "something went wrong" | "Code expired — tap Get new code once" | User retried too many connects; wait 2 min, one fresh connect |
| `402` on provision | "Upgrade / billing" | Org out of slots |

---

### Webhook contract

Set per instance at provision time or:

```http
PUT {worker_endpoint}/api/instances/{uuid}
Content-Type: application/json

{ "webhookUrl": "https://rapidmot-seven.vercel.app/api/webhooks/wasup" }
```

Inbound webhooks include `instance_id` — must match the UUID you stored.

---

### Bashir org reference (current production)

| Item | Value |
|------|-------|
| Org ID | `adb64f75-77ed-47ec-a2d1-7c961ad77029` |
| Worker | `https://bashir-s-workspace-hlzpr2.wasup.co` |
| Apex instance UUID | `51981fe4-d0f6-4801-8060-750deb57fc72` |
| Webhook | `https://rapidmot-seven.vercel.app/api/webhooks/wasup` |

---

## Part 2 — Wasup side (ops / deploy)

### Bashir worker — apply now

Run from repo root (requires SSH to `wasupadmin@20.58.56.114`):

```bash
# 1. Registry sync (worker → control plane)
scp app/src/utils/control-plane-registry.js \
  wasupadmin@20.58.56.114:/tmp/control-plane-registry.js

ssh wasupadmin@20.58.56.114 'sudo cp /tmp/control-plane-registry.js \
  /opt/wasup-81ccb28431f3/app/src/utils/control-plane-registry.js'

scp deploy/scripts/patch-worker-registry.py \
  wasupadmin@20.58.56.114:/tmp/patch-worker-registry.py

ssh wasupadmin@20.58.56.114 'sudo python3 /tmp/patch-worker-registry.py /opt/wasup-81ccb28431f3/app'

# 2. Required env on worker (append if missing)
ssh wasupadmin@20.58.56.114 'sudo bash -c "
grep -q WASUP_ORG_ID /opt/wasup-81ccb28431f3/app/.env || echo WASUP_ORG_ID=adb64f75-77ed-47ec-a2d1-7c961ad77029 >> /opt/wasup-81ccb28431f3/app/.env
grep -q WASUP_CONTROL_PLANE_URL /opt/wasup-81ccb28431f3/app/.env || echo WASUP_CONTROL_PLANE_URL=https://control-plane.wasup.co >> /opt/wasup-81ccb28431f3/app/.env
"'

# 3. DELETE guard hotfix (if not already applied)
scp deploy/scripts/patch-protect-delete.py wasupadmin@20.58.56.114:/tmp/
ssh wasupadmin@20.58.56.114 'sudo python3 /tmp/patch-protect-delete.py /opt/wasup-81ccb28431f3/app'
# Then fix env refs on VM if patch used bare WASUP_ORG_ID:
ssh wasupadmin@20.58.56.114 "sudo sed -i 's/WASUP_WORKER_SHARED_SECRET/WORKER_SHARED_SECRET/g; s/if (WASUP_ORG_ID/if (process.env.WASUP_ORG_ID/g' /opt/wasup-81ccb28431f3/app/server.js"

# 4. Reload
ssh wasupadmin@20.58.56.114 'sudo pm2 reload wasup-worker --update-env'
```

**Verify:**

```bash
SECRET=$(grep WASUP_WORKER_SHARED_SECRET apps/control-plane/.env | cut -d= -f2)
BASE=https://bashir-s-workspace-hlzpr2.wasup.co

curl -sS "$BASE/api/health"
curl -sS -H "X-API-Key: $SECRET" "$BASE/api/instances"   # expect 1 UUID, no wa_* orphans
# PM2 logs should show: Control plane instance registry enabled
```

### Code already in repo (next full deploy)

| Change | File |
|--------|------|
| Worker→CP register on create/onboard | `app/src/utils/control-plane-registry.js`, `server.js` |
| DELETE guard (UUID protected for customer keys) | `server.js`, `deploy/scripts/patch-protect-delete.py` |
| Pairing code reuse (2 min) | `server.js`, `patch-pairing-stability.py` |
| `phoneNumber` alias on connect | `server.js`, `patch-connect-phone-aliases.py` |
| Startup catalog sync | `patch-startup-sync.py`, `patch-worker-registry.py` |

### Long-term (stop hotfixing VMs)

1. Ship **one tagged release** to org workers (not piecemeal Python patches).
2. RapidMOT uses **provision API only** for new tenants.
3. Optional: dedicated worker per large RapidMOT customer (separate org in Wasup).
4. Add smoke test after deploy: health → list instances → connect (reuse) → bad key → 401.

---

## Quick message to paste to Bashir (RapidMOT)

> **Wasup pairing fix — action needed on RapidMOT side**
>
> 1. Stop using `POST /api/onboard` on our worker for new signups. Use `POST https://control-plane.wasup.co/api/v3/provision/instances` and store the **UUID** from the response.
> 2. Reconnect = poll `GET /instances/{id}/connection` only. Call `POST /connect` **once** per pairing attempt. If the API returns `reused: true`, show the same code — don't refresh.
> 3. Don't DELETE the instance UUID from the worker API — use control plane. We fixed a bug where DELETE was throwing 500 and leaving ghost `wa_*` instances.
> 4. For Apex right now: instance `51981fe4-d0f6-4801-8060-750deb57fc72`, phone `447835156367`. Ask Wasup for a fresh pairing code if expired.
>
> Full API guide: `docs/guides/rapidmot-integration.md` in the Wasup repo.
