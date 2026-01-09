# Authentication

Secure your WhatsApp API with API key authentication.

## Overview

When `API_KEY` is set in your `.env` file, all API requests require authentication. This prevents unauthorized access to your WhatsApp instances.

## Setting Up Authentication

### 1. Generate an API Key

```bash
# Using OpenSSL
openssl rand -hex 32

# Or via the API (if already running without auth)
curl -X POST http://localhost:3000/api/generate-api-key
```

### 2. Add to Environment

Create or update `.env` in your `app` directory:

```env
API_KEY=your-64-character-hex-key-here
```

### 3. Restart the Server

```bash
npm start
```

## Making Authenticated Requests

### Option 1: X-API-Key Header (Recommended)

```bash
curl http://localhost:3000/api/instances \
  -H "X-API-Key: your-api-key"
```

### Option 2: Authorization Bearer

```bash
curl http://localhost:3000/api/instances \
  -H "Authorization: Bearer your-api-key"
```

## Code Examples

### JavaScript (Axios)

```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:3000/api',
  headers: {
    'X-API-Key': 'your-api-key'
  }
});

// Now all requests are authenticated
const instances = await api.get('/instances');
```

### JavaScript (Fetch)

```javascript
const API_KEY = 'your-api-key';

async function apiCall(endpoint, options = {}) {
  const response = await fetch(`http://localhost:3000/api${endpoint}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return response.json();
}

// Usage
const instances = await apiCall('/instances');
```

### Python

```python
import requests

API_KEY = 'your-api-key'
BASE_URL = 'http://localhost:3000/api'

session = requests.Session()
session.headers.update({'X-API-Key': API_KEY})

# All requests through session are authenticated
response = session.get(f'{BASE_URL}/instances')
```

### PHP

```php
<?php
$apiKey = 'your-api-key';
$baseUrl = 'http://localhost:3000/api';

function apiCall($endpoint, $method = 'GET', $data = null) {
    global $apiKey, $baseUrl;
    
    $ch = curl_init("$baseUrl$endpoint");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            "X-API-Key: $apiKey",
            'Content-Type: application/json'
        ]
    ]);
    
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($data) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
    }
    
    $response = curl_exec($ch);
    curl_close($ch);
    
    return json_decode($response, true);
}
```

### cURL (Shell Script)

```bash
#!/bin/bash
API_KEY="your-api-key"
API_BASE="http://localhost:3000/api"

# GET request
curl -s "$API_BASE/instances" -H "X-API-Key: $API_KEY"

# POST request
curl -s -X POST "$API_BASE/instances" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "New Instance"}'
```

## Error Responses

### 401 Unauthorized

```json
{
  "error": "Unauthorized",
  "message": "Valid API key required. Use X-API-Key header or Authorization: Bearer <key>"
}
```

This means:
- `API_KEY` is set in `.env` but request has no/wrong key
- Check your API key is correct
- Check header name and format

## WebSocket Authentication

For WebSocket connections, authenticate after connecting:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Send auth message
  ws.send(JSON.stringify({
    type: 'auth',
    apiKey: 'your-api-key'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'auth_success') {
    console.log('Authenticated!');
    // Now subscribe to updates
    ws.send(JSON.stringify({ type: 'subscribe_all' }));
  }
  
  if (data.type === 'auth_failed') {
    console.error('Authentication failed');
  }
};
```

## Security Best Practices

### Do's ✅

- Use a strong, randomly generated key (32+ bytes)
- Store API key in environment variables, not code
- Use HTTPS in production
- Rotate keys periodically
- Use different keys for different environments

### Don'ts ❌

- Don't commit API keys to version control
- Don't share keys in plain text
- Don't use simple/guessable keys
- Don't expose the API to public internet without auth

## Development Mode

For local development, you can disable authentication by not setting `API_KEY`:

```env
# API_KEY not set = no auth required
PORT=3000
```

> ⚠️ Never run without authentication in production!

## Multiple API Keys

Currently, the API supports a single key. For multi-tenant scenarios, consider:

1. **Proxy layer**: Put an API gateway in front that handles multiple keys
2. **Instance-level auth**: Check instance ownership in your application logic
3. **Custom middleware**: Modify `server.js` to support multiple keys

## Admin Password (Legacy)

The `ADMIN_PASSWORD` environment variable provides a secondary authentication method:

```env
ADMIN_PASSWORD=your-admin-password
```

This can be used with `Authorization: Bearer <password>` for backward compatibility with the web dashboard.

## Testing Authentication

```bash
# Should return 401
curl http://localhost:3000/api/instances

# Should return 200 with data
curl http://localhost:3000/api/instances \
  -H "X-API-Key: your-api-key"

# Health endpoint doesn't require auth
curl http://localhost:3000/api/health
```
