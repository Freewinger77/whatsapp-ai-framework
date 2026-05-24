# Managing Multiple Instances

Learn how to create, configure, and manage multiple WhatsApp numbers from a single API.

## Understanding Instances

Each **instance** represents one WhatsApp number. Instances are:
- **Independent** - Separate credentials, settings, and rate limits
- **Concurrent** - All can be connected simultaneously
- **Configurable** - Each can have its own webhook URL and behavior settings

## Creating Instances

### Basic Instance

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "name": "Sales Team"
  }'
```

### Instance with Custom ID

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "id": "sales_main",
    "name": "Sales Team"
  }'
```

### Instance with Full Configuration

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "name": "Customer Support",
    "webhookUrl": "https://your-api.com/webhook/support",
    "behaviorSettings": {
      "typingSimulation": true,
      "delayEnabled": true
    },
    "antiBanSettings": {
      "preset": "balanced"
    }
  }'
```

## Listing Instances

Get all instances with their current status:

```bash
curl http://localhost:3000/api/instances \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "instances": [
    {
      "id": "wa_abc123",
      "name": "Sales Team",
      "status": "connected",
      "connectedPhone": "60123456789",
      "connectedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "wa_def456",
      "name": "Support Team",
      "status": "disconnected",
      "connectedPhone": null
    }
  ]
}
```

## Getting Instance Details

```bash
curl http://localhost:3000/api/instances/wa_abc123 \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "instance": {
    "id": "wa_abc123",
    "name": "Sales Team",
    "status": "connected",
    "qrCode": null,
    "connectedPhone": "60123456789",
    "connectedAt": "2024-01-15T10:30:00.000Z",
    "webhookUrl": "https://your-api.com/webhook",
    "behaviorSettings": {
      "typingSimulation": true,
      "delayEnabled": true
    },
    "antiBanSettings": {
      "preset": "balanced",
      "messagesPerHour": 50,
      "messagesPerDay": 300
    },
    "antiBanHealth": {
      "status": "healthy",
      "hourlyUsage": 10,
      "dailyUsage": 5
    }
  }
}
```

## Updating Instances

Update name, webhook URL, or settings:

```bash
curl -X PUT http://localhost:3000/api/instances/wa_abc123 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "name": "Sales Team - Primary",
    "webhookUrl": "https://new-webhook.com/endpoint"
  }'
```

## Deleting Instances

> ⚠️ **Warning:** This permanently deletes the instance and all its data.

```bash
curl -X DELETE http://localhost:3000/api/instances/wa_abc123 \
  -H "X-API-Key: your-api-key"
```

## Connection Management

### Connect an Instance

Starts the WhatsApp connection and generates a QR code:

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/connect \
  -H "X-API-Key: your-api-key"
```

### Get QR Code

Poll this endpoint to get the QR code for scanning:

```bash
curl http://localhost:3000/api/instances/wa_abc123/qr \
  -H "X-API-Key: your-api-key"
```

**Response when QR is ready:**
```json
{
  "success": true,
  "status": "connecting",
  "qrCode": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Response when connected:**
```json
{
  "success": true,
  "status": "connected",
  "phone": "60123456789",
  "message": "Already connected"
}
```

### Disconnect an Instance

Disconnects but keeps credentials (can reconnect without QR):

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/disconnect \
  -H "X-API-Key: your-api-key"
```

### Automatic Reconnect

Credentialed instances automatically retry recoverable disconnects without clearing auth. This includes common Baileys close/restart cases such as connection closed/replaced, timed out/lost, and restart required after QR scan. Logout or explicit auth invalidation still requires a new manual connection or auth reset.

Reconnects are single-flight per instance and use bounded backoff by default:

```env
WA_AUTO_RECONNECT_ENABLED=true
WA_RECONNECT_MAX_ATTEMPTS=8
WA_RECONNECT_BASE_DELAY_MS=5000
WA_RECONNECT_MAX_DELAY_MS=120000
```

On app startup, instances with saved credentials are also scheduled through the same reconnect guard with a small stagger to avoid reconnect storms.

### Manual Global Reconnect Button

The worker dashboard includes a **Reconnect disconnected** tool for incident recovery when automatic reconnect has stopped or missed one or more lines. It does not clear auth.

Use it only after confirming the worker is otherwise healthy. The button:
- Fetches `/api/instances`
- Selects instances that are disconnected or in an error/fatal state, while skipping already connected or actively connecting instances
- Skips entries that already expose QR/manual-repair signals such as logged-out auth, QR code, or pairing-code state
- Calls `POST /api/instances/{id}/connect` sequentially with a short delay between instances
- Shows a per-instance result summary and refreshes the instance list when complete

Results marked **started reconnect** mean the worker accepted the connect attempt and the line may still take a few seconds to become connected. Results marked **needs QR/manual repair** require an operator to scan QR, pair again, or repair credentials manually. Do not use Clear Auth as part of this recovery flow unless a separate runbook explicitly calls for it.

To confirm a deployed dashboard contains this recovery tool without pressing it, check for the static marker:

```bash
python3 - <<'PY'
import ssl, urllib.request
url = "https://wasup2.northeurope.cloudapp.azure.com/"
ctx = ssl._create_unverified_context()
with urllib.request.urlopen(url, timeout=12, context=ctx) as resp:
    html = resp.read().decode("utf-8", "replace")
print("global reconnect marker:", "global-reconnect-disconnected-v1" in html)
PY
```

### Clear Auth (Full Logout)

Disconnects AND deletes credentials (requires new QR scan):

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/clear-auth \
  -H "X-API-Key: your-api-key"
```

## Instance Status Flow

```
disconnected → [connect] → connecting → [scan QR] → connected
     ↑                                                   |
     |                    [disconnect]                   |
     ←───────────────────────────────────────────────────
```

## Best Practices

1. **Naming Convention**: Use descriptive names like `support_main`, `sales_asia`
2. **One Phone Per Instance**: Never try to connect the same phone to multiple instances
3. **Monitor Health**: Check `antiBanHealth` regularly to avoid rate limits
4. **Graceful Shutdown**: Always disconnect instances before stopping the server
