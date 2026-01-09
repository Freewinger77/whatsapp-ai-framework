# Receiving Messages

Learn how to receive and process incoming WhatsApp messages using webhooks.

## How It Works

```
User sends message → WhatsApp → Your Instance → Webhook URL → Your Server
                                                     ↓
                                               Process & Reply
```

When a message arrives, the API:
1. Receives it via the WhatsApp connection
2. Forwards it to your configured webhook URL
3. Waits for your response
4. Sends the reply back to the user

## Setting Up Webhooks

### Option 1: When Creating Instance

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "name": "Support Bot",
    "webhookUrl": "https://your-server.com/webhook/whatsapp"
  }'
```

### Option 2: Update Existing Instance

```bash
curl -X PUT http://localhost:3000/api/instances/wa_abc123 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhookUrl": "https://your-server.com/webhook/whatsapp"
  }'
```

## Webhook Request Format

When a message arrives, your webhook receives a POST request:

```json
{
  "instanceId": "wa_abc123",
  "from": "60123456789",
  "fromJid": "60123456789@s.whatsapp.net",
  "message": "Hello, I need help with my order",
  "messageType": "conversation",
  "isReply": false,
  "quotedMessage": null,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "messageId": "3EB0B430A..."
}
```

### Message Types

| Type | Description | Example |
|------|-------------|---------|
| `conversation` | Plain text message | "Hello" |
| `extendedText` | Text with formatting/links | "Check https://..." |
| `image` | Image with optional caption | Caption or "[Image]" |
| `video` | Video with optional caption | Caption or "[Video]" |
| `audio` | Voice note | "[Voice Note]" |
| `document` | File attachment | Filename or "[Document]" |
| `sticker` | Sticker | "[Sticker]" |
| `buttonResponse` | Button click | Selected button text |
| `listResponse` | List selection | Selected item |

### Reply Context

When a user replies to a message, you get additional context:

```json
{
  "from": "60123456789",
  "message": "Yes, order #12345",
  "isReply": true,
  "quotedMessage": "What is your order number?"
}
```

## Webhook Response Format

Your webhook should return a JSON response:

### Auto-Reply

```json
{
  "reply": "Thanks for your message! We'll get back to you soon."
}
```

Or use alternative field names:

```json
{
  "message": "Thanks for your message!"
}
```

```json
{
  "text": "Thanks for your message!"
}
```

### Skip Reply (Human Handoff)

If a human agent is handling the conversation:

```json
{
  "skip": true
}
```

### No Reply

Return an empty response or omit the `reply` field:

```json
{}
```

## Example Webhook Server

### Node.js (Express)

```javascript
const express = require('express');
const app = express();
app.use(express.json());

app.post('/webhook/whatsapp', async (req, res) => {
  const { instanceId, from, message, messageType, isReply, quotedMessage } = req.body;
  
  console.log(`[${instanceId}] Message from ${from}: ${message}`);
  
  // Simple auto-reply logic
  let reply = null;
  
  if (message.toLowerCase().includes('hello')) {
    reply = 'Hi there! How can I help you today?';
  } else if (message.toLowerCase().includes('hours')) {
    reply = 'We are open Monday-Friday, 9am-6pm.';
  } else if (message.toLowerCase().includes('human')) {
    // Hand off to human - don't auto-reply
    return res.json({ skip: true });
  }
  
  if (reply) {
    return res.json({ reply });
  }
  
  // No auto-reply for unrecognized messages
  res.json({});
});

app.listen(3001, () => {
  console.log('Webhook server running on port 3001');
});
```

### Python (Flask)

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/webhook/whatsapp', methods=['POST'])
def webhook():
    data = request.json
    instance_id = data.get('instanceId')
    from_number = data.get('from')
    message = data.get('message', '').lower()
    
    print(f"[{instance_id}] Message from {from_number}: {message}")
    
    # Simple auto-reply logic
    if 'hello' in message:
        return jsonify({'reply': 'Hi there! How can I help you?'})
    elif 'hours' in message:
        return jsonify({'reply': 'We are open Monday-Friday, 9am-6pm.'})
    elif 'human' in message:
        return jsonify({'skip': True})
    
    return jsonify({})

if __name__ == '__main__':
    app.run(port=3001)
```

### PHP

```php
<?php
header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);

$instanceId = $input['instanceId'] ?? '';
$from = $input['from'] ?? '';
$message = strtolower($input['message'] ?? '');

error_log("[$instanceId] Message from $from: $message");

$reply = null;

if (strpos($message, 'hello') !== false) {
    $reply = 'Hi there! How can I help you?';
} elseif (strpos($message, 'hours') !== false) {
    $reply = 'We are open Monday-Friday, 9am-6pm.';
} elseif (strpos($message, 'human') !== false) {
    echo json_encode(['skip' => true]);
    exit;
}

if ($reply) {
    echo json_encode(['reply' => $reply]);
} else {
    echo json_encode([]);
}
```

## Real-Time Updates via WebSocket

For real-time message notifications without webhooks, connect via WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Authenticate if API_KEY is set
  ws.send(JSON.stringify({ type: 'auth', apiKey: 'your-api-key' }));
  
  // Subscribe to all instances
  ws.send(JSON.stringify({ type: 'subscribe_all' }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'message') {
    console.log('New message:', data.data);
    // Handle the message
  }
};
```

### WebSocket Events

| Event | Description |
|-------|-------------|
| `init` | Initial data on connection |
| `instance_created` | New instance created |
| `instance_status` | Instance connection status changed |
| `instance_updated` | Instance settings changed |
| `instance_deleted` | Instance removed |
| `message` | New incoming message |
| `log` | Activity log entry |

## Integrating with AI/Chatbots

### n8n Workflow

Set your webhook URL to your n8n webhook trigger:

```
https://your-n8n.com/webhook/whatsapp
```

Then build a workflow that:
1. Receives the message
2. Queries your RAG/knowledge base
3. Generates AI response
4. Returns `{ "reply": "AI response here" }`

### Custom AI Integration

```javascript
app.post('/webhook/whatsapp', async (req, res) => {
  const { message, from } = req.body;
  
  // Call your AI service
  const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a helpful customer support agent.' },
        { role: 'user', content: message }
      ]
    })
  });
  
  const data = await aiResponse.json();
  const reply = data.choices[0].message.content;
  
  res.json({ reply });
});
```

## Testing Webhooks Locally

Use ngrok to expose your local server:

```bash
# Terminal 1: Start your webhook server
node webhook-server.js

# Terminal 2: Expose with ngrok
ngrok http 3001
```

Then use the ngrok URL as your webhook:
```
https://abc123.ngrok.io/webhook/whatsapp
```
