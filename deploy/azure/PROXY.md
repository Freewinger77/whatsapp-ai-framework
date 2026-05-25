# Proxy Configuration

Three layers, all optional, evaluated in this order:

```
┌───────────────────────────────────────────────────────────┐
│ 1. Per-instance API override (source: "api")              │  ← PUT /api/instances/:id/proxy
│                              ↓ if not set                 │
│ 2. Proxy pool auto-assignment (source: "pool")            │  ← PROXY_POOL env var
│                              ↓ if pool empty / exhausted  │
│ 3. Deployment default (source: "deployment")              │  ← DEFAULT_PROXY_URL env var
│                              ↓ if not set                 │
│ 4. Direct connection (source: "none")                     │
└───────────────────────────────────────────────────────────┘
```

`source: "disabled"` is also possible — an instance override of `{enabled:false}`
short-circuits everything and forces a direct connection even when a pool /
deployment default exists.

Supported schemes: `http`, `https`, `socks4`, `socks5`.

## Rollout status

Pool deployments (first N instances auto-assigned one pool proxy; recycled on delete):

| Region   | App name          | Pool size | Source file                                       |
|----------|-------------------|-----------|---------------------------------------------------|
| UK West  | `wasup-uk-west`   | 5         | [proxies/uk-west.txt](proxies/uk-west.txt)        |
| UK South | `wasup-uk-south`  | 5         | [proxies/uk-south.txt](proxies/uk-south.txt)      |
| SE       | `wasup-se`        | 5         | [proxies/se.txt](proxies/se.txt)                  |
| FI       | `wasup-fi`        | 5         | [proxies/fi.txt](proxies/fi.txt)                  |
| DE       | `wasup-de`        | —         | (no pool)                                         |
| FR       | `wasup-fr`        | —         | (no pool)                                         |
| IT       | `wasup-it`        | —         | (no pool)                                         |
| NO       | `wasup-no`        | —         | (no pool)                                         |

The 4 pool-enabled regions each recycle 5 proxies independently. A 6th
instance on any of these regions will connect direct (no proxy). Deleting an
instance returns its slot to that region's pool.

## 1. Proxy pool (per region, auto-assigned)

Set a finite pool on an App Service and the first N instances created on that
app each automatically claim a slot. Deleting an instance returns its slot.
The 6th+ instance connects direct.

### Apply to UK West (pilot)

```bash
cd deploy/azure
./set-proxy-pool.sh --region uk-west             # uses proxies/uk-west.txt
```

### Apply to all four pool regions

```bash
./set-proxy-pool.sh --region uk-west
./set-proxy-pool.sh --region uk-south
./set-proxy-pool.sh --region se
./set-proxy-pool.sh --region fi
```

### Inspect / remove

```bash
./set-proxy-pool.sh --region uk-west --show
./set-proxy-pool.sh --region uk-west --unset
```

### Inspect from a live app

```bash
curl -s https://wasup-uk-west.azurewebsites.net/api/proxy/pool \
  -H "X-API-Key: $UK_WEST_API_KEY" | jq
```

Example output:

```json
{
  "success": true,
  "enabled": true,
  "pool": {
    "enabled": true,
    "total": 5,
    "used": 3,
    "free": 2,
    "entries": [
      { "id": "212.212.18.198:6849", "type": "http", "host": "212.212.18.198", "port": 6849, "username": "rktwwipc", "password": "********", "assignedTo": "wa_abc123" },
      { "id": "104.252.62.244:5615", "type": "http", "host": "104.252.62.244", "port": 5615, "username": "rktwwipc", "password": "********", "assignedTo": "wa_def456" },
      { "id": "104.252.62.99:5470",  "type": "http", "host": "104.252.62.99",  "port": 5470, "username": "rktwwipc", "password": "********", "assignedTo": "wa_ghi789" },
      { "id": "212.212.18.227:6878", "type": "http", "host": "212.212.18.227", "port": 6878, "username": "rktwwipc", "password": "********", "assignedTo": null },
      { "id": "212.212.19.147:6298", "type": "http", "host": "212.212.19.147", "port": 6298, "username": "rktwwipc", "password": "********", "assignedTo": null }
    ]
  }
}
```

### Reconcile (retroactive assignment)

If instances existed before the pool was set up, run:

```bash
curl -s -X POST https://wasup-uk-west.azurewebsites.net/api/proxy/pool/reconcile \
  -H "X-API-Key: $UK_WEST_API_KEY" | jq
```

This hands free slots to the oldest instances that aren't using an API
override, bounces their sockets, and reports what it did.

### Pool lifecycle semantics

- **Creation**: new instance auto-claims next free slot. Pool exhausted →
  `proxy: null` (direct).
- **Deletion**: slot freed immediately, available to the next `createInstance`.
- **API override** (`PUT /api/instances/:id/proxy`): instance's pool slot is
  released and given back to the pool. Instance reconnects through the
  user-supplied proxy. Source tag: `api`.
- **Override cleared** (`DELETE /api/instances/:id/proxy`): tries to claim a
  free pool slot. If none, falls through to the deployment default or direct.
- **Reconcile on boot**: on startup, orphaned pool references (proxy points to
  a slot no longer in `PROXY_POOL`) are cleared; oldest direct-connection
  instances claim any free slots.

## 2. Deployment-level default (per region)

Set on the Azure App Service as an environment variable. All instances on that
region will use it unless they have their own override.

### Apply to UK West

```bash
cd deploy/azure
./set-proxy.sh --url "http://user:pass@proxy.example.com:8080"
```

### Apply to another region

```bash
./set-proxy.sh --region de --url "socks5://user:pass@proxy.de.example.com:1080"
```

### Remove

```bash
./set-proxy.sh --region uk-west --unset
```

### Verify

```bash
# reads from the app and redacts the password
./set-proxy.sh --region uk-west --show

# from the app itself:
curl -s https://wasup-uk-west.azurewebsites.net/api/proxy \
  -H "X-API-Key: $UK_WEST_API_KEY" | jq
```

### Supported env vars on the App Service

| Variable                 | Example                                        |
|--------------------------|------------------------------------------------|
| `DEFAULT_PROXY_URL`      | `http://user:pass@proxy.example.com:8080`      |
| `DEFAULT_PROXY_TYPE`     | `http` \| `https` \| `socks4` \| `socks5`       |
| `DEFAULT_PROXY_HOST`     | `proxy.example.com`                            |
| `DEFAULT_PROXY_PORT`     | `8080`                                         |
| `DEFAULT_PROXY_USERNAME` | (optional)                                     |
| `DEFAULT_PROXY_PASSWORD` | (optional)                                     |
| `REGION_CODE`            | `uk-west` (set automatically by `set-proxy.sh`) |

`DEFAULT_PROXY_URL` is the preferred single-variable form. The structured
variables are only consulted if `DEFAULT_PROXY_URL` is empty.

## 3. Per-instance override (via API)

Every endpoint below requires the region's API key in the `X-API-Key` header.

### Get effective proxy

```http
GET /api/instances/:id/proxy
```

```json
{
  "success": true,
  "proxy": {
    "override":  null,
    "effective": { "type": "http", "host": "proxy.uk-west.local", "port": 8080, "username": "deploy", "password": "********" },
    "source":    "deployment"
  }
}
```

`source` is one of: `api` | `pool` | `deployment` | `disabled` | `none`.

### Set instance-level override

```http
PUT /api/instances/:id/proxy
Content-Type: application/json

{ "url": "http://user:pass@proxy-a.example.com:8080" }
```

Also accepted:

```json
{ "url": "socks5://user:pass@proxy.example.com:1080" }
{ "type": "http", "host": "proxy.example.com", "port": 8080, "username": "u", "password": "p" }
{ "enabled": false }   // explicitly disable, even if deployment has a default
```

The instance automatically reconnects if it was online so the new proxy takes
effect.

### Clear override (fall back to deployment default)

```http
DELETE /api/instances/:id/proxy
```

### Test connectivity through a proxy

```http
POST /api/proxy/test
Content-Type: application/json

{ "url": "http://user:pass@proxy-a.example.com:8080",
  "target": "https://web.whatsapp.com/" }
```

If no body is supplied, the deployment default is tested. Returns the HTTP
status seen through the proxy plus a latency measurement.

## Quick end-to-end example (UK West)

```bash
# 1. Set the deployment default on UK West
./set-proxy.sh --region uk-west --url "http://user:pass@proxy.example.com:8080"

# 2. Confirm the app picked it up
curl -s https://wasup-uk-west.azurewebsites.net/api/proxy \
  -H "X-API-Key: $UK_WEST_API_KEY" | jq

# 3. (Optional) Override for one specific instance
curl -s -X PUT \
  https://wasup-uk-west.azurewebsites.net/api/instances/wa_abc123/proxy \
  -H "X-API-Key: $UK_WEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"socks5://alt-user:alt-pass@proxy.other.com:1080"}'

# 4. (Optional) Disable proxy for that one instance only
curl -s -X PUT \
  https://wasup-uk-west.azurewebsites.net/api/instances/wa_abc123/proxy \
  -H "X-API-Key: $UK_WEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'

# 5. (Optional) Drop the override and go back to the deployment default
curl -s -X DELETE \
  https://wasup-uk-west.azurewebsites.net/api/instances/wa_abc123/proxy \
  -H "X-API-Key: $UK_WEST_API_KEY"
```

## How it works under the hood

- `app/src/utils/proxy.js` parses URLs, normalizes config, builds agents, and
  resolves which tier (`api` / `pool` / `deployment` / `disabled` / `none`)
  an instance ends up on.
- `app/src/utils/proxy-pool.js` owns the pool. Pool state is **derived** from
  the current set of instances — free slots = entries whose host:port isn't
  referenced by any instance's `proxy` with `source: "pool"`. No separate
  on-disk state to keep in sync.
- `app/src/utils/instance-manager.js` resolves the effective proxy at socket
  creation time and passes an `agent` + `fetchAgent` to `makeWASocket(...)`,
  so both the WhatsApp WebSocket and media up/downloads go through the proxy.
- The pool hooks into the lifecycle: `createInstance` claims a slot,
  `deleteInstance` releases it, `setInstanceProxy` (API override) releases,
  and on boot a reconcile retroactively hands free slots to the oldest
  direct-connection instances and bounces their sockets.
- Updating a proxy via the API tears down and restarts the Baileys socket;
  auth credentials (`auth/`) are untouched, so the session is preserved.
- Per-instance proxies are persisted to `instances.json` as part of the
  instance config (alongside `webhookUrl`, `antiBanSettings`, etc.) and
  survive restarts via Azure's `/home` persistent storage.
