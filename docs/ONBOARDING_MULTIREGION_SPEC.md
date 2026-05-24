# Multi-Region WhatsApp Onboarding — Migration Spec

**Purpose:** migrate the existing single-region onboarding flow on the external
platform to the new multi-region fleet. The user picks a **country on a
map** (Western EU theatre), the platform picks the matching regional WhatsApp
deployment, creates the instance (with proxy auto-assigned when available),
then falls through to the existing QR / pairing-code device-linking step.

This doc is written as a single self-contained brief that another agent can
follow end-to-end without asking for more context.

---

## 1. TL;DR

1. Show an interactive map of Western/Northern Europe; user clicks a country.
2. Map that country → one of our 8 regional WhatsApp apps (there are 2 UK
   regions — pick whichever has more free proxy pool slots).
3. Call `POST /api/instances` on the chosen regional app → instance created.
   If the region has free proxy pool slots, a residential proxy is
   **automatically assigned** and logged with the instance (you get the proxy
   details in the response).
4. Call the existing device-link logic (QR / pairing code) — we have a single
   endpoint that returns either.
5. Poll `GET /api/instances/:id/connection` until `status === 'connected'`.
6. Done. The instance persists on the regional app; further messaging calls
   all hit that same regional URL with that region's API key.

No restarts are ever required. Onboarding a new user takes a couple of HTTP
round-trips + however long the user takes to scan.

---

## 2. Architecture overview

```
┌──────────────────────────────────────────┐
│   Onboarding platform (your product)     │
│                                          │
│   [Map: user picks country]              │
│             │                            │
│             ▼                            │
│   [Backend chooses region, creates       │
│    instance via regional API]            │
│             │                            │
│             ▼                            │
│   [Show QR / pairing code, poll status]  │
└──────────────────────────────────────────┘
                  │  (8 different base URLs
                  │   + 8 different API keys,
                  │   keys ALWAYS server-side)
                  ▼
    ┌──────────────────────────────────────┐
    │  Regional WhatsApp apps (Azure)      │
    │  wasup-{de,fr,it,fi,se,no,uk-{s,w}}  │
    │                                      │
    │  Each has its own:                   │
    │    - WhatsApp sessions (Baileys)     │
    │    - Anti-ban rate limiting          │
    │    - Proxy pool (Webshare) ← new     │
    │    - Webhook config per instance     │
    └──────────────────────────────────────┘
```

The platform backend talks directly to each regional app over HTTPS with
`X-API-Key` auth. **API keys are server-side only** — never exposed to the
browser.

---

## 3. Fleet inventory

There are 8 regional deployments. Store these as env vars on your
onboarding backend.

| Region code | Country / Area  | App URL                                     | Latitude | Longitude | Proxy pool today |
|-------------|-----------------|---------------------------------------------|----------|-----------|------------------|
| `de`        | Germany         | `https://wasup-de.azurewebsites.net`        | 50.1109  | 8.6821    | none (0)         |
| `fr`        | France          | `https://wasup-fr.azurewebsites.net`        | 48.8566  | 2.3522    | none (0)         |
| `it`        | Italy           | `https://wasup-it.azurewebsites.net`        | 45.4642  | 9.1900    | none (0)         |
| `fi`        | Finland         | `https://wasup-fi.azurewebsites.net`        | 60.1699  | 24.9384   | 5 slots          |
| `se`        | Sweden          | `https://wasup-se.azurewebsites.net`        | 59.3293  | 18.0686   | 5 slots          |
| `no`        | Norway          | `https://wasup-no.azurewebsites.net`        | 59.9139  | 10.7522   | none (0)         |
| `uk-south`  | UK (London)     | `https://wasup-uk-south.azurewebsites.net`  | 51.5074  | -0.1278   | 5 slots          |
| `uk-west`   | UK (Cardiff)    | `https://wasup-uk-west.azurewebsites.net`   | 51.4816  | -3.1791   | 5 slots          |

### API keys (all 8)

Store each as a separate env var on the onboarding backend. **Do not ship
these to the browser.**

```env
DE_URL=https://wasup-de.azurewebsites.net
DE_API_KEY=3e8acf3e6a2d75872b4c26663c0c85c9f1b971c1a92abf0ca6c100a65669dd40

FR_URL=https://wasup-fr.azurewebsites.net
FR_API_KEY=2ee460bcad1efa055dd53180ae5241104c0da8a6acd5c65790c27e17ce5fbf29

IT_URL=https://wasup-it.azurewebsites.net
IT_API_KEY=19bbb4351d3c2b10d587ae24eb557678c9dada5442422c6f3ceec960d447ec0c

FI_URL=https://wasup-fi.azurewebsites.net
FI_API_KEY=ab524cb6a4e75827ecc7d88f98965d6ca4c16d5224b3f0bbfd88f48ee6ec07b0

SE_URL=https://wasup-se.azurewebsites.net
SE_API_KEY=ecdbdfe4c9552cd00c9b5e9eee999cf553c885e00bf9df710fc00cc6f14e3fa1

NO_URL=https://wasup-no.azurewebsites.net
NO_API_KEY=a2b73d9e42549c26a3142c56cc0764577be9b080c08e9c84a63f5f8b36d22c67

UK_SOUTH_URL=https://wasup-uk-south.azurewebsites.net
UK_SOUTH_API_KEY=0eaf1a445e74039bd06cfbcc226a3db242c33d4dd0d4b729ffc0af77e29630ca

UK_WEST_URL=https://wasup-uk-west.azurewebsites.net
UK_WEST_API_KEY=2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846
```

---

## 4. Country → region routing

Each country maps to exactly one region code, except the UK which splits
South/West. The backend does the selection; the UI shows a single "United
Kingdom" tile and the backend picks.

### Active countries (user can click)

| Country ISO | Label           | Region chosen                                 |
|-------------|-----------------|-----------------------------------------------|
| `DE`        | Germany         | `de`                                          |
| `FR`        | France          | `fr`                                          |
| `IT`        | Italy           | `it`                                          |
| `FI`        | Finland         | `fi`                                          |
| `SE`        | Sweden          | `se`                                          |
| `NO`        | Norway          | `no`                                          |
| `GB`        | United Kingdom  | `uk-south` or `uk-west` (see algorithm below) |

### UK tie-breaker algorithm

Both `uk-south` and `uk-west` are legitimate. Choose the one with **more free
proxy pool slots**. Ties go to `uk-south`. Fetch pool state from both regions:

```
GET /api/proxy/pool on wasup-uk-south
GET /api/proxy/pool on wasup-uk-west
```

The response includes `pool.free`. Pick max; tie → `uk-south`. If both are
down, bubble up an error; do not silently fall through.

### Expansion countries (show but disable)

Render these on the map dimmed/greyed with a "COMING SOON" tooltip — they are
**not** yet deployed. User cannot click them.

| ISO  | Label         |
|------|---------------|
| `NL` | Netherlands   |
| `IE` | Ireland       |
| `ES` | Spain         |
| `BE` | Belgium       |
| `CH` | Switzerland   |
| `AT` | Austria       |
| `DK` | Denmark       |
| `PL` | Poland        |

---

## 5. Map UI — reference implementation

We already have a tactical dark-theme map in our internal Battlespace
dashboard. The onboarding map can be softer/cleaner but the mechanics and
the GeoJSON dataset are directly reusable.

### Assets to copy / reuse

- **GeoJSON source:** `infra/azure/battlespace/public/eu.geojson` — already
  trimmed to the relevant Western/Northern EU countries with `properties.iso`
  on each feature. Serve it statically.
- **Leaflet 1.9.4** (CDN) and **CARTO dark basemap** if you want the same
  look. Or swap the basemap tile URL for a lighter one — everything else
  stays the same.
- **Click → country selection:** each feature has `properties.iso` (two-letter
  ISO). On click, look up the region in the routing table above. Keep a small
  in-page state `selectedCountry`.

### UX flow on the map

1. Active covered countries render with a cyan/green fill (hover highlight),
   clickable.
2. Expansion countries render dimmed with a dashed outline, not clickable.
3. Everything else greyed out (`country-other` class).
4. When a country is clicked → set `selectedCountry`, show a side panel with
   region info (latency to DC, proxy pool availability) and a big "CONTINUE"
   button.
5. On "CONTINUE" → backend picks the region (including UK tie-break) and
   proceeds to step 6 below.

Reference Leaflet bootstrap (adapt styling):

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<div id="map" style="height:600px"></div>

<script>
  const map = L.map('map', { minZoom: 3, maxZoom: 6 }).setView([52, 10], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd'
  }).addTo(map);

  const ACTIVE_COUNTRIES = { DE:'de', FR:'fr', IT:'it', FI:'fi', SE:'se', NO:'no', GB:'uk' };
  const EXPANSION = new Set(['NL','IE','ES','BE','CH','AT','DK','PL']);

  fetch('/eu.geojson').then(r => r.json()).then(geo => {
    L.geoJSON(geo, {
      style: f => {
        const iso = f.properties.iso;
        if (ACTIVE_COUNTRIES[iso]) return { color:'#5df0c8', weight:1, fillOpacity:0.15 };
        if (EXPANSION.has(iso))   return { color:'#7a8db0', weight:1, dashArray:'3,3', fillOpacity:0.05 };
        return { color:'#1c3055', weight:0.5, fillOpacity:0.02 };
      },
      onEachFeature: (feature, layer) => {
        const iso = feature.properties.iso;
        if (!ACTIVE_COUNTRIES[iso]) return;
        layer.on('click', () => selectCountry(iso));
        layer.bindTooltip(feature.properties.name);
      },
    }).addTo(map);
  });

  function selectCountry(iso) {
    // POST to your backend; backend resolves to a region code and creates instance
    fetch('/onboarding/select-country', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryIso: iso })
    }).then(r => r.json()).then(handleInstanceReady);
  }
</script>
```

---

## 6. Onboarding flow — complete API choreography

All HTTP calls below are made from the **onboarding platform's backend** to
the chosen regional app, with the matching `X-API-Key` header. The browser
never sees the region's API key.

### Step 1 — Resolve region

Input: `countryIso` (e.g. `"GB"`).

```js
function resolveRegion(iso) {
  const simple = { DE:'de', FR:'fr', IT:'it', FI:'fi', SE:'se', NO:'no' };
  if (simple[iso]) return simple[iso];
  if (iso === 'GB') return pickUkRegion(); // see below
  throw new Error('Unsupported country: ' + iso);
}

async function pickUkRegion() {
  const [south, west] = await Promise.all([
    getPool('uk-south'),
    getPool('uk-west'),
  ]);
  const sFree = south?.pool?.free ?? -1;
  const wFree = west?.pool?.free ?? -1;
  if (sFree < 0 && wFree < 0) throw new Error('Both UK regions unavailable');
  return wFree > sFree ? 'uk-west' : 'uk-south';
}

async function getPool(regionCode) {
  const { url, apiKey } = regionConfig(regionCode);
  const r = await fetch(`${url}/api/proxy/pool`, {
    headers: { 'X-API-Key': apiKey },
  });
  return r.ok ? r.json() : null;
}
```

### Step 2 — Create the instance (proxy auto-assigns)

```http
POST {REGION_URL}/api/instances
X-API-Key: {REGION_API_KEY}
Content-Type: application/json

{
  "name": "Jane Doe's inbox",
  "webhookUrl": "https://your-n8n.example/webhook/whatsapp"   // optional
}
```

The response `instance.proxy` tells you everything about the proxy the
server attached (if any):

```json
{
  "success": true,
  "instance": {
    "id": "wa_mn8abc_xyz42",
    "name": "Jane Doe's inbox",
    "status": "disconnected",
    "connectedPhone": null,
    "proxy": {
      "override": {
        "enabled": true,
        "origin": "pool",                       // <-- proxy came from the pool
        "type": "http",
        "host": "212.212.18.198",
        "port": 6849,
        "username": "rktwwipc",
        "password": "********"
      },
      "effective": { "type":"http","host":"212.212.18.198","port":6849, ... },
      "source": "pool"                          // "pool" | "api" | "deployment" | "none"
    }
  }
}
```

Interpreting `proxy.source`:

| value          | meaning                                                             |
|----------------|---------------------------------------------------------------------|
| `pool`         | A residential proxy was auto-assigned from the region's pool.       |
| `api`          | Someone set a custom proxy explicitly (shouldn't happen at create). |
| `deployment`   | The region has a `DEFAULT_PROXY_URL` env var and is using it.       |
| `none`         | No proxy. Direct connection. This is fine — still proceeds.         |

Store `instance.id` in your DB linked to the user.

### Step 3 — Kick off device linking

You already have this logic. For reference, here are the two endpoints
available on the regional app. Either works; the request body chooses.

**QR mode (scan with the user's phone):**

```http
POST {REGION_URL}/api/instances/{id}/connect
X-API-Key: {REGION_API_KEY}
Content-Type: application/json

{}
```

Then poll `GET .../connection` (below) and display `qrCode` (base64 data URL)
until `status === 'connected'` or a timeout. There's also a raw-image
variant: `GET {REGION_URL}/api/instances/{id}/qr?format=image` returns a
300×300 PNG.

**Pairing-code mode (user types an 8-char code into WhatsApp):**

```http
POST {REGION_URL}/api/instances/{id}/pair
X-API-Key: {REGION_API_KEY}
Content-Type: application/json

{ "phoneNumber": "447393002183" }
```

Response:

```json
{
  "success": true,
  "pairingCode": "ABCD-EFGH",
  "message": "Enter code ABCD-EFGH in WhatsApp > Linked Devices > Link a Device",
  "instance": { ... }
}
```

### Step 4 — Poll connection status

```http
GET {REGION_URL}/api/instances/{id}/connection
X-API-Key: {REGION_API_KEY}
```

Response (polled every 1–2s):

```json
{
  "success": true,
  "status": "connecting",           // disconnected | connecting | connected
  "phone": null,
  "connectedAt": null,
  "uptime": null,
  "pairingCode": "ABCD-EFGH",       // null once connected
  "qrCode": "data:image/png;base64,..."   // null once connected
}
```

When `status === 'connected'`, move on. Typical timings:

- QR: user has ~20s per QR window; Baileys rotates automatically. Expect
  30s–2 min for the happy path.
- Pairing: user has ~3 min to type the code.

### Step 5 — (Optional) verify the proxy is actually tunneling

If the instance got a pool proxy (`source:'pool'`) and you want definitive
proof that traffic is leaving through it, call:

```http
POST {REGION_URL}/api/instances/{id}/proxy/verify
X-API-Key: {REGION_API_KEY}
Content-Type: application/json

{}
```

Response:

```json
{
  "success": true,
  "verdict": "MATCH",                    // MATCH | MISMATCH | DIRECT | UNKNOWN
  "egressIp": "212.212.18.198",
  "proxy": { "host":"212.212.18.198","port":6849, ... },
  "match": true,
  "elapsedMs": 143
}
```

`MATCH` = the outbound IP observed when hitting ipify exactly equals the
proxy host → traffic is definitely going through the proxy. `DIRECT` = no
proxy configured, egress is the Azure app's outbound IP (fine, just not
proxied).

### Step 6 — Done. Use the instance for messaging.

Subsequent operations (send message, set webhook, fetch messages, etc.) all
go to the same `REGION_URL` with the same `REGION_API_KEY` for the lifetime
of that instance. The instance id is the primary key.

Common ones you'll want downstream:

- `POST {REGION_URL}/api/instances/{id}/send` — send a message.
- `GET {REGION_URL}/api/instances/{id}/messages` — recent message history.
- `PUT {REGION_URL}/api/instances/{id}/webhook` — update the webhook URL.

---

## 7. State machine for the onboarding UI

```
       ┌──────────────┐
       │ COUNTRY_PICK │  ← user lands here; map shown
       └──────┬───────┘
              │ user clicks country
              ▼
       ┌──────────────┐
       │ RESOLVE_REGION│ ← backend; <100ms, fetches pool free counts for UK
       └──────┬───────┘
              │
              ▼
       ┌──────────────┐
       │ CREATE_INSTANCE│ ← POST /api/instances; ~1s; returns id + proxy info
       └──────┬───────┘
              │ display proxy info to user: "You're routing through an
              │  IP in <region>" (or "Direct connection" if source='none')
              ▼
       ┌──────────────┐
       │ DEVICE_LINK  │ ← user chooses QR or pairing code; poll status
       └──────┬───────┘
              │ status === 'connected'
              ▼
       ┌──────────────┐
       │ VERIFY_EGRESS│ (optional; skip if proxy.source === 'none')
       └──────┬───────┘
              │
              ▼
          [DONE]
```

Nothing else is required. The anti-ban protection, webhook dispatch, message
history, LID mapping, and proxy persistence are all already handled by the
regional app.

---

## 8. Proxy auto-assignment — what the user sees

Behavior is fully automatic at instance creation time. Effectively:

- If the region has free pool slots: the new instance silently claims one.
  The UI can optionally display "Routed via <region> residential IP" by
  looking at `proxy.source === 'pool'`.
- If the pool is full: `proxy.source === 'none'`, `proxy.effective` is null.
  The instance still works — it just connects directly from the Azure region.
  Don't block the user on this.
- You can top up any region's pool at runtime via Battlespace (see
  `infra/azure/PROXY.md`). No onboarding platform changes needed when new
  proxies arrive.

Current proxy pool state:

| Region    | Pool size | Covers                                                          |
|-----------|-----------|-----------------------------------------------------------------|
| uk-west   | 5 slots   | `212.212.18.198`, `104.252.62.244`, `104.252.62.99`, `212.212.18.227`, `212.212.19.147` |
| uk-south  | 5 slots   | `104.252.62.154`, `104.252.62.132`, `87.86.25.138`, `87.86.24.159`, `104.252.81.217` |
| se        | 5 slots   | `82.26.114.130`, `82.26.114.9`, `82.26.114.85`, `96.62.194.83`, `82.26.114.232` |
| fi        | 5 slots   | `82.26.114.69`, `82.26.114.14`, `82.26.114.21`, `82.26.114.140`, `96.62.194.155` |
| de, fr, it, no | 0 slots | Direct connection until proxies added (can add via dashboard). |

---

## 9. Error handling checklist

| Failure                                 | Detect                                          | User-facing                                        |
|-----------------------------------------|-------------------------------------------------|----------------------------------------------------|
| Region app offline / 5xx on create      | `POST /api/instances` → non-2xx                 | "Try a different region" — don't silently retry    |
| API key rejected (401/403)              | 401/403                                         | Internal alert; not a user-fixable problem         |
| Instance name already exists            | `POST` returns `400` with message "already exists" | Generate a unique id on your side and retry      |
| Pairing phone invalid                   | `POST /pair` returns 400                        | Show inline validation, let user retype            |
| Connection never reaches `connected`    | Poll exceeds 3 min                              | Offer "Reset and try again" → calls `POST /clear-auth` + `POST /connect` again |
| Proxy pool exhausted                    | `proxy.source === 'none'` in create response    | Silent; the flow continues fine. Optionally log.   |
| Proxy verify returns `MISMATCH`         | `verdict !== 'MATCH'`                           | Internal alert; instance still works but proxy is leaking — check Webshare credentials |

---

## 10. Security notes

- Every regional API key is scoped to that one regional app only. Leaking
  `DE_API_KEY` doesn't expose UK data.
- Keys live on the **platform backend**. The browser never sees them. The
  browser calls your `/onboarding/*` endpoints; your backend calls regional
  apps.
- Battlespace (`wasup-battlespace.azurewebsites.net`) already has all 8
  keys stored server-side — if you ever want to consolidate, you can route
  your onboarding calls through Battlespace's pass-through routes instead of
  holding 8 keys directly. Either works. Direct is simpler; via-Battlespace
  means only one token to rotate.

---

## 11. Quick copy-paste tests

Run these from a shell to confirm everything works before wiring the UI.

```bash
# 1. Pool state on UK West (needed for UK tie-break)
curl -s https://wasup-uk-west.azurewebsites.net/api/proxy/pool \
  -H "X-API-Key: 2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846" | jq '.pool.free'

# 2. Create an instance on UK West (auto-claims a pool slot)
curl -s -X POST https://wasup-uk-west.azurewebsites.net/api/instances \
  -H "X-API-Key: 2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846" \
  -H 'Content-Type: application/json' \
  -d '{"name":"onboarding-test"}' | jq '{id: .instance.id, proxySource: .instance.proxy.source, proxyHost: .instance.proxy.effective.host}'

# Save the id; use in step 3+.

# 3. Request a pairing code
curl -s -X POST https://wasup-uk-west.azurewebsites.net/api/instances/$ID/pair \
  -H "X-API-Key: 2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846" \
  -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"447393002183"}' | jq '.pairingCode'

# 4. Poll status every second until connected
curl -s https://wasup-uk-west.azurewebsites.net/api/instances/$ID/connection \
  -H "X-API-Key: 2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846" | jq '.status'

# 5. Once connected, verify egress IP
curl -s -X POST https://wasup-uk-west.azurewebsites.net/api/instances/$ID/proxy/verify \
  -H "X-API-Key: 2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846" \
  -H 'Content-Type: application/json' -d '{}' | jq '.verdict'

# Cleanup
curl -s -X DELETE https://wasup-uk-west.azurewebsites.net/api/instances/$ID \
  -H "X-API-Key: 2bd2071b4993fc45e53db871b0eae5a9a705cf8f31dd5307c0c8ae006e501846"
```

Expected outputs:
- Step 1: a number 0–5.
- Step 2: `{id: "wa_...", proxySource: "pool", proxyHost: "212.212.18.198"}` (or `source: "none"` if pool full).
- Step 3: a string like `"ABCD-EFGH"`.
- Step 4: `"connecting"` → eventually `"connected"`.
- Step 5: `"MATCH"` (proxy working) or `"DIRECT"` (no proxy).

---

## 12. What you do NOT need to build

The regional app already handles:

- Baileys WhatsApp session persistence (auth survives restarts).
- Anti-ban rate limiting with preset modes.
- Human handoff (manual sends from the phone pause the bot until `#bot` is sent).
- Webhook dispatch with retry.
- Media up/download to Azure Blob Storage.
- LID ↔ phone number mapping.
- Contact saving before first message (anti-ban).
- Proxy pool claim/release lifecycle.
- Proxy egress verification.

You are only building: **country map + region resolver + thin wrapper around
create-instance and the existing QR/pair flow.**

---

## 13. File-level references in this repo

Useful reading while implementing:

- `infra/azure/battlespace/public/eu.geojson` — ready-made GeoJSON for EU map.
- `infra/azure/battlespace/public/app.js` — example Leaflet setup with
  country click handlers and per-region markers (trim to your taste).
- `infra/azure/battlespace/public/style.css` — the tactical dark theme (skip if
  you want a cleaner look; everything else is framework-agnostic).
- `infra/azure/PROXY.md` — full proxy pool semantics.
- `app/src/utils/instance-manager.js` — server-side instance lifecycle (read-only
  reference; you don't need to touch this).
- `app/server.js` — all the regional API endpoints (canonical reference).

---

## 14. Open questions to clarify with stakeholders (if any)

- Should "Direct connection" (no proxy) be a soft warning in the UI, or
  completely hidden from the user? (Current recommendation: hidden — it's
  functionally fine.)
- Should we let the user re-pick region after creating the instance?
  (Current recommendation: no. Delete the instance and start over. Region is
  baked into the session.)
- Do we want analytics on which countries get picked? (Battlespace can show
  this; onboarding-side tracking is up to you.)

---

*Generated from the wasup-ai-framework repo. Regional API keys in §3 are
live production secrets — treat them accordingly.*
