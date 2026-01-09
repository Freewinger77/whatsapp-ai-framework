# WebSocket Events

Real-time updates for instance status, messages, and logs via WebSocket.

## Connecting

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
// Or for HTTPS: wss://your-domain.com/ws
```

## Authentication

If `API_KEY` is configured, authenticate after connecting:

```javascript
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    apiKey: 'your-api-key'
  }));
};
```

## Subscribing to Updates

### Subscribe to All Instances

```javascript
ws.send(JSON.stringify({ type: 'subscribe_all' }));
```

### Subscribe to Specific Instance

```javascript
ws.send(JSON.stringify({ 
  type: 'subscribe',
  instanceId: 'wa_abc123'
}));
```

### Unsubscribe from Instance

```javascript
ws.send(JSON.stringify({ 
  type: 'unsubscribe',
  instanceId: 'wa_abc123'
}));
```

## Event Types

### `init`

Received immediately after connection with current state:

```json
{
  "type": "init",
  "data": {
    "instances": [
      {
        "id": "wa_abc123",
        "name": "Support",
        "status": "connected",
        "connectedPhone": "60123456789"
      }
    ],
    "requiresAuth": true
  }
}
```

### `auth_success`

Authentication successful:

```json
{
  "type": "auth_success"
}
```

### `auth_failed`

Authentication failed:

```json
{
  "type": "auth_failed"
}
```

### `instance_created`

New instance was created:

```json
{
  "type": "instance_created",
  "data": {
    "id": "wa_xyz789",
    "name": "New Bot",
    "status": "disconnected",
    "webhookUrl": "",
    "behaviorSettings": {
      "typingSimulation": true,
      "delayEnabled": true
    }
  }
}
```

### `instance_status`

Instance connection status changed:

```json
{
  "type": "instance_status",
  "data": {
    "id": "wa_abc123",
    "name": "Support",
    "status": "connecting",
    "qrCode": "data:image/png;base64,iVBORw0...",
    "connectedPhone": null,
    "connectedAt": null
  }
}
```

Status values: `disconnected`, `connecting`, `connected`

### `instance_updated`

Instance settings were updated:

```json
{
  "type": "instance_updated",
  "data": {
    "id": "wa_abc123",
    "name": "Support Bot",
    "webhookUrl": "https://new-url.com/webhook",
    "behaviorSettings": {
      "typingSimulation": true,
      "delayEnabled": false
    }
  }
}
```

### `instance_deleted`

Instance was deleted:

```json
{
  "type": "instance_deleted",
  "data": {
    "id": "wa_abc123"
  }
}
```

### `message`

New incoming message:

```json
{
  "type": "message",
  "data": {
    "instanceId": "wa_abc123",
    "from": "60123456789",
    "fromJid": "60123456789@s.whatsapp.net",
    "message": "Hello, I need help",
    "messageType": "conversation",
    "isReply": false,
    "quotedMessage": null,
    "timestamp": "2024-01-15T10:30:00.000Z",
    "messageId": "3EB0B430A..."
  }
}
```

### `log`

Activity log entry:

```json
{
  "type": "log",
  "instanceId": "wa_abc123",
  "data": {
    "id": "1705312200000",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "message": "Connected as 60123456789",
    "level": "success"
  }
}
```

Log levels: `info`, `success`, `warning`, `error`

## Complete Example

### JavaScript Client

```javascript
class WhatsAppWebSocket {
  constructor(url, apiKey) {
    this.url = url;
    this.apiKey = apiKey;
    this.ws = null;
    this.reconnectTimeout = null;
    this.handlers = {};
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      
      // Authenticate if API key provided
      if (this.apiKey) {
        this.send({ type: 'auth', apiKey: this.apiKey });
      }
      
      // Subscribe to all instances
      this.send({ type: 'subscribe_all' });
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleEvent(data);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  handleEvent(data) {
    const handler = this.handlers[data.type];
    if (handler) {
      handler(data.data || data);
    }
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  disconnect() {
    clearTimeout(this.reconnectTimeout);
    this.ws?.close();
  }
}

// Usage
const ws = new WhatsAppWebSocket('ws://localhost:3000/ws', 'your-api-key');

ws.on('init', (data) => {
  console.log('Initial instances:', data.instances);
});

ws.on('instance_status', (instance) => {
  console.log(`Instance ${instance.id} is now ${instance.status}`);
  
  if (instance.qrCode) {
    // Display QR code to user
    document.getElementById('qr').src = instance.qrCode;
  }
});

ws.on('message', (msg) => {
  console.log(`New message from ${msg.from}: ${msg.message}`);
});

ws.on('log', (log) => {
  console.log(`[${log.level}] ${log.message}`);
});

ws.connect();
```

### React Hook

```javascript
import { useEffect, useState, useCallback } from 'react';

function useWhatsAppSocket(apiKey) {
  const [instances, setInstances] = useState([]);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000/ws');

    ws.onopen = () => {
      setConnected(true);
      if (apiKey) {
        ws.send(JSON.stringify({ type: 'auth', apiKey }));
      }
      ws.send(JSON.stringify({ type: 'subscribe_all' }));
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds
      setTimeout(() => {
        // Trigger re-render to reconnect
      }, 3000);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'init':
          setInstances(data.data.instances);
          break;
        case 'instance_created':
          setInstances(prev => [...prev, data.data]);
          break;
        case 'instance_status':
        case 'instance_updated':
          setInstances(prev => 
            prev.map(i => i.id === data.data.id ? { ...i, ...data.data } : i)
          );
          break;
        case 'instance_deleted':
          setInstances(prev => prev.filter(i => i.id !== data.data.id));
          break;
        case 'message':
          setMessages(prev => [data.data, ...prev].slice(0, 100));
          break;
      }
    };

    return () => ws.close();
  }, [apiKey]);

  return { instances, connected, messages };
}

// Usage in component
function Dashboard() {
  const { instances, connected, messages } = useWhatsAppSocket('your-api-key');

  return (
    <div>
      <div>Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}</div>
      <h2>Instances ({instances.length})</h2>
      {instances.map(instance => (
        <div key={instance.id}>
          {instance.name} - {instance.status}
        </div>
      ))}
    </div>
  );
}
```

### Python (websocket-client)

```python
import websocket
import json
import threading

class WhatsAppWebSocket:
    def __init__(self, url, api_key=None):
        self.url = url
        self.api_key = api_key
        self.ws = None
        self.handlers = {}

    def on_message(self, ws, message):
        data = json.loads(message)
        event_type = data.get('type')
        if event_type in self.handlers:
            self.handlers[event_type](data.get('data', data))

    def on_open(self, ws):
        print('Connected')
        if self.api_key:
            ws.send(json.dumps({'type': 'auth', 'apiKey': self.api_key}))
        ws.send(json.dumps({'type': 'subscribe_all'}))

    def on_close(self, ws, close_status, close_msg):
        print('Disconnected')

    def on(self, event, handler):
        self.handlers[event] = handler

    def connect(self):
        self.ws = websocket.WebSocketApp(
            self.url,
            on_message=self.on_message,
            on_open=self.on_open,
            on_close=self.on_close
        )
        self.ws.run_forever()

# Usage
ws = WhatsAppWebSocket('ws://localhost:3000/ws', 'your-api-key')

ws.on('init', lambda data: print(f"Instances: {data['instances']}"))
ws.on('message', lambda msg: print(f"Message from {msg['from']}: {msg['message']}"))
ws.on('instance_status', lambda i: print(f"Instance {i['id']} is {i['status']}"))

# Run in background thread
thread = threading.Thread(target=ws.connect)
thread.daemon = True
thread.start()
```

## Best Practices

1. **Always handle reconnection** - Network issues happen
2. **Authenticate immediately** after connection
3. **Subscribe to specific instances** if you don't need all updates
4. **Buffer messages** on disconnect and process on reconnect
5. **Use heartbeat** for long-running connections (WebSocket has built-in ping/pong)
