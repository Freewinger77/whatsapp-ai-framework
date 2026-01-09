# Anti-Ban Settings

Protect your WhatsApp accounts from being banned with built-in rate limiting and human-like behavior simulation.

## Why Anti-Ban Protection?

WhatsApp monitors for automated behavior and will ban accounts that:
- Send too many messages too quickly
- Send to too many unique contacts
- Respond instantly without human-like delays
- Show no "typing" indicators

This API includes multiple layers of protection to make your bot appear human.

## Protection Layers

### 1. Rate Limiting

Limits on messages and unique contacts per hour/day.

### 2. Typing Simulation

Shows "typing..." indicator before sending, with realistic duration based on message length.

### 3. Response Delays

Waits 2-45 seconds before responding, calculated based on:
- Incoming message length (reading time)
- Outgoing message length (typing time)
- Time of day (slower at night)
- Random variance (±30%)

## Presets

| Preset | Messages/Hour | Messages/Day | Chats/Hour | Chats/Day | Best For |
|--------|---------------|--------------|------------|-----------|----------|
| `conservative` | 100 | 2,000 | 25 | 250 | Lower volume, safer |
| `balanced` | 200 | 5,000 | 50 | 500 | Most use cases (default) |
| `aggressive` | 400 | 10,000 | 100 | 1,000 | High volume needs |
| `custom` | Your values | Your values | Your values | Your values | Advanced users |

## Getting Current Status

```bash
curl http://localhost:3000/api/instances/wa_abc123/anti-ban \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "settings": {
    "preset": "balanced",
    "messagesPerHour": 50,
    "messagesPerDay": 300,
    "uniqueChatsPerHour": 25,
    "uniqueChatsPerDay": 100
  },
  "health": {
    "status": "healthy",
    "hourlyUsage": 20,
    "dailyUsage": 8,
    "hourlyChatsUsage": 16,
    "dailyChatsUsage": 5,
    "warnings": [],
    "stats": {
      "messagesThisHour": 10,
      "messagesThisDay": 24,
      "uniqueChatsThisHour": 4,
      "uniqueChatsThisDay": 5
    }
  }
}
```

### Health Status

| Status | Meaning |
|--------|---------|
| `healthy` | All metrics below 80% |
| `warning` | One or more metrics above 80% |
| `limited` | One or more limits reached (100%) |

## Changing Presets

### Use a Preset

```bash
curl -X PUT http://localhost:3000/api/instances/wa_abc123/anti-ban \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "preset": "conservative"
  }'
```

### Custom Values

```bash
curl -X PUT http://localhost:3000/api/instances/wa_abc123/anti-ban \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "preset": "custom",
    "messagesPerHour": 40,
    "messagesPerDay": 200,
    "uniqueChatsPerHour": 20,
    "uniqueChatsPerDay": 80
  }'
```

## Behavior Settings

Control typing simulation and delays separately:

### Get Current Settings

```bash
curl http://localhost:3000/api/instances/wa_abc123/behavior \
  -H "X-API-Key: your-api-key"
```

**Response:**
```json
{
  "success": true,
  "behaviorSettings": {
    "typingSimulation": true,
    "delayEnabled": true
  }
}
```

### Update Settings

```bash
curl -X PUT http://localhost:3000/api/instances/wa_abc123/behavior \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "typingSimulation": true,
    "delayEnabled": false
  }'
```

### Setting Descriptions

| Setting | Default | Description |
|---------|---------|-------------|
| `typingSimulation` | `true` | Show "typing..." indicator before sending |
| `delayEnabled` | `true` | Add human-like delays before responding |

## Per-Message Overrides

Override behavior for individual messages:

```bash
curl -X POST http://localhost:3000/api/instances/wa_abc123/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Urgent: Your order has shipped!",
    "typingSimulation": false,
    "delayEnabled": false
  }'
```

> ⚠️ Use sparingly - frequent instant messages increase ban risk.

## Delay Calculation

The delay formula:

```
Base Delay = 2000ms (minimum)
           + (incoming_words × 200ms)    // reading time
           + (outgoing_chars × 50ms)     // typing time
           × time_multiplier             // slower at night
           ± 30% random variance

Final Delay = clamp(base, 2000ms, 45000ms)
```

### Time Multipliers

| Time | Multiplier | Effect |
|------|------------|--------|
| 12am - 6am | 2.0× | Much slower (night) |
| 6am - 9am | 1.3× | Slower (early morning) |
| 9am - 12pm | 1.0× | Normal (morning) |
| 12pm - 2pm | 1.2× | Slightly slower (lunch) |
| 2pm - 6pm | 1.0× | Normal (afternoon) |
| 6pm - 10pm | 1.1× | Slightly slower (evening) |
| 10pm - 12am | 1.5× | Slower (night) |

## Rate Limit Responses

When rate limited, the send API returns:

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

The `waitTime` (in milliseconds) tells you when the limit resets.

## Monitoring in Dashboard

The web dashboard shows real-time usage bars:

- 🟢 Green (0-49%): Healthy
- 🟡 Yellow (50-79%): Moderate
- 🔴 Red (80-100%): Near/at limit

## Best Practices

### For Lower Volume Use Cases

1. Use `conservative` preset
2. Keep both `typingSimulation` and `delayEnabled` on
3. Monitor health status regularly

### For Standard Use Cases

1. Use `balanced` preset (default)
2. 200 messages/hour, 5000/day is suitable for most bots
3. Watch for warnings before hitting limits

### For High Volume

1. Use `aggressive` preset carefully
2. Only for established, verified business accounts
3. Monitor closely for any warnings

### General Tips

1. **Never disable both protections** in production
2. **Spread messages** throughout the day
3. **Vary response times** - don't always respond at the same speed
4. **Don't spam** - send useful, expected messages only
5. **Respect user requests** - stop messaging when asked

## Troubleshooting

### "Rate limited" but I just started

Counters reset hourly/daily. If you hit limits, wait for reset:
- Hourly: Wait up to 60 minutes
- Daily: Wait until midnight (server time)

### Messages taking too long

If delays are excessive, you can:
1. Reduce limits (paradoxically, lower limits = faster sends)
2. Disable delays for specific messages (use sparingly)

### Bot still got banned

Even with protections, bans can happen if:
- Users report you as spam
- You're sending unwanted messages
- Your content violates WhatsApp policies

The anti-ban system reduces risk but doesn't eliminate it.
