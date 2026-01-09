# Sending Messages

Learn how to send WhatsApp messages through the API with full control over delivery behavior.

## Basic Message Sending

### Send via Specific Instance

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Hello! How can I help you today?"
  }'
```

### Send via Auto-Selected Instance

Let the API choose the first connected instance:

```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Hello!"
  }'
```

Or specify which instance to use:

```bash
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "instanceId": "wa_abc123",
    "to": "60123456789",
    "message": "Hello!"
  }'
```

## Phone Number Format

| Format | Example | Valid? |
|--------|---------|--------|
| With country code | `60123456789` | ✅ |
| With plus sign | `+60123456789` | ❌ |
| With spaces | `60 123 456 789` | ❌ |
| With dashes | `60-123-456-789` | ❌ |
| Local format | `0123456789` | ❌ |

Always use: **Country code + number, no symbols or spaces**

## Response Format

**Success:**
```json
{
  "success": true,
  "result": {
    "sent": true,
    "delay": 3500,
    "typingSimulation": true,
    "delayEnabled": true
  }
}
```

**Rate Limited:**
```json
{
  "success": true,
  "result": {
    "sent": false,
    "reason": "Hourly message limit reached",
    "waitTime": 1800000
  }
}
```

## Behavior Options

Control typing simulation and delays on a per-message basis:

### With Full Anti-Ban Protection (Default)

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Hello!"
  }'
```

This will:
1. Show "typing..." indicator
2. Wait 2-45 seconds (based on message length)
3. Send the message

### Without Typing Indicator

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Hello!",
    "typingSimulation": false
  }'
```

### Instant Send (No Delays)

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Hello!",
    "typingSimulation": false,
    "delayEnabled": false
  }'
```

> ⚠️ **Warning:** Disabling delays increases ban risk. Use only for testing.

## Behavior Settings Hierarchy

1. **Per-message options** (highest priority) - Override for this message only
2. **Instance settings** - Default for all messages from this instance
3. **System defaults** - `typingSimulation: true`, `delayEnabled: true`

### Update Instance Defaults

```bash
curl -X PUT http://localhost:3000/api/instances/wa_abc123/behavior \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "typingSimulation": true,
    "delayEnabled": false
  }'
```

## Code Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';
const API_KEY = 'your-api-key';

async function sendMessage(instanceId, to, message, options = {}) {
  const response = await axios.post(
    `${API_BASE}/instances/${instanceId}/send`,
    { to, message, ...options },
    { headers: { 'X-API-Key': API_KEY } }
  );
  return response.data;
}

// Usage
await sendMessage('wa_abc123', '60123456789', 'Hello!');

// Instant send (for testing)
await sendMessage('wa_abc123', '60123456789', 'Hello!', {
  typingSimulation: false,
  delayEnabled: false
});
```

### Python

```python
import requests

API_BASE = 'http://localhost:3000/api'
API_KEY = 'your-api-key'

def send_message(instance_id, to, message, **options):
    response = requests.post(
        f'{API_BASE}/instances/{instance_id}/send',
        json={'to': to, 'message': message, **options},
        headers={'X-API-Key': API_KEY}
    )
    return response.json()

# Usage
send_message('wa_abc123', '60123456789', 'Hello!')

# Instant send
send_message('wa_abc123', '60123456789', 'Hello!', 
             typingSimulation=False, delayEnabled=False)
```

### PHP

```php
<?php
$apiBase = 'http://localhost:3000/api';
$apiKey = 'your-api-key';

function sendMessage($instanceId, $to, $message, $options = []) {
    global $apiBase, $apiKey;
    
    $ch = curl_init("$apiBase/instances/$instanceId/send");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            "X-API-Key: $apiKey"
        ],
        CURLOPT_POSTFIELDS => json_encode(array_merge([
            'to' => $to,
            'message' => $message
        ], $options))
    ]);
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    return json_decode($response, true);
}

// Usage
sendMessage('wa_abc123', '60123456789', 'Hello!');
```

## Rate Limits

Messages are subject to anti-ban rate limits:

| Preset | Messages/Hour | Messages/Day | Unique Chats/Hour |
|--------|---------------|--------------|-------------------|
| `conservative` | 100 | 2,000 | 25 |
| `balanced` | 200 | 5,000 | 50 |
| `aggressive` | 400 | 10,000 | 100 |

Check current usage:
```bash
curl http://localhost:3000/api/instances/wa_abc123/anti-ban \
  -H "X-API-Key: your-api-key"
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `Instance not connected` | WhatsApp not linked | Call `/connect` and scan QR |
| `Rate limited: Hourly message limit reached` | Too many messages | Wait or increase limits |
| `Instance not found` | Invalid instance ID | Check `/api/instances` |
