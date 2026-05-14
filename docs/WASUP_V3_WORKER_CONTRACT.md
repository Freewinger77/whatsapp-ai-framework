# Wasup v3 Worker Contract

This contract defines how the SaaS control plane talks to an isolated WhatsApp worker. It is the bridge between the existing `app/` runtime and the future AKS data plane.

## Worker Ownership

Each worker owns exactly one WhatsApp instance by default:

- one `org_id`
- one `instance_id`
- one auth/state volume
- one sticky proxy allocation
- one webhook configuration snapshot
- one Wasup Anti-Ban state

The control plane may restart/redeploy the dashboard/API without touching workers.

## Required Worker Environment

```env
NODE_ENV=production
PORT=3000
WASUP_WORKER_MODE=single-instance
WASUP_ORG_ID=<uuid>
WASUP_INSTANCE_ID=<uuid>
WASUP_DATA_DIR=/data
WASUP_CONTROL_PLANE_URL=https://api.wasup.ai
WASUP_WORKER_SHARED_SECRET=<from-key-vault>
INSTANCE_PROXY_URL=<from-worker-secret>
DEFAULT_WEBHOOK_URL=<optional snapshot>
```

## Required Endpoints

The worker should expose these internal endpoints. They are not public customer APIs.

### `GET /internal/health`

Returns process and socket health.

```json
{
  "status": "ok",
  "mode": "single-instance",
  "orgId": "org_uuid",
  "instanceId": "instance_uuid",
  "connection": "connected",
  "phone": "447...",
  "uptime": 123
}
```

### `GET /internal/status`

Returns full instance status for dashboard rendering.

### `POST /internal/connect`

Starts QR or pairing flow.

Body:

```json
{
  "mode": "qr",
  "pairingPhone": "447..."
}
```

### `POST /internal/disconnect`

Closes the socket without revoking credentials by default.

Body:

```json
{
  "revoke": false
}
```

### `POST /internal/clear-auth`

Revokes/deletes local auth for a manual re-pair flow. This endpoint should require an explicit reason and audit event from the control plane.

### `POST /internal/send`

Sends text/rich message from this instance only.

### `PUT /internal/behavior`

Applies behaviour profile and advanced options without process restart.

```json
{
  "behaviorProfile": "notification-balanced",
  "notificationGraceMs": 8000,
  "typingSimulation": true,
  "delayEnabled": true,
  "phoneNotificationsEnabled": true
}
```

### `PUT /internal/proxy`

Applies or clears the sticky proxy allocation. Proxy changes should be rare and audited.

## Worker Events

Worker sends events to the control plane:

`POST /internal/worker-events`

Headers:

- `X-Wasup-Worker-Token`
- `X-Wasup-Instance-Id`
- `X-Wasup-Org-Id`

Events:

- `worker.ready`
- `connection.qr`
- `connection.pairing_code`
- `connection.open`
- `connection.close`
- `connection.fatal`
- `message.inbound`
- `message.outbound`
- `webhook.delivery`
- `antiban.risk_change`
- `proxy.health`

## Provisioning State Machine

1. `desired`: row created in Supabase.
2. `proxy_allocating`: allocator picks/imports/provisions regional proxy.
3. `secret_syncing`: Key Vault/External Secret materializes worker secret.
4. `worker_creating`: AKS workload/PVC/service created.
5. `worker_ready`: worker heartbeat received.
6. `awaiting_pair`: QR/pairing active.
7. `connected`: WhatsApp connection open.
8. `error`: operator action required.

## Security Rules

- Customer API keys never go to workers.
- Workers authenticate to control plane with service tokens or mTLS.
- Proxy passwords live in Key Vault/Kubernetes Secret only.
- Auth volumes are single-writer and never mounted by two workers at once.
- Never run legacy and v3 workers with the same WhatsApp auth at the same time.
