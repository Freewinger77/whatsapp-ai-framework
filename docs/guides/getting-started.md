# Getting Started

Get your WhatsApp Multi-Instance API running in under 5 minutes.

## Prerequisites

- Node.js v18 or higher
- A phone with WhatsApp installed

## Installation

### 1. Clone & Install

```bash
git clone https://github.com/your-repo/whatsapp-api.git
cd whatsapp-api/app
npm install
```

### 2. Configure Environment

Create a `.env` file in the `app` directory:

```env
# Server port
PORT=3000

# API Authentication (generate with: openssl rand -hex 32)
API_KEY=your-secure-api-key-here
```

### 3. Start the Server

```bash
npm start
```

You'll see:

```
╔════════════════════════════════════════════════════════════╗
║       WhatsApp AI Bot - Multi-Instance API Server          ║
╚════════════════════════════════════════════════════════════╝

🌐 Web UI:      http://localhost:3000
🔌 API Base:    http://localhost:3000/api
```

## Quick Start: Connect Your First Number

### Option A: Using the Web Dashboard

1. Open http://localhost:3000 in your browser
2. Click **"Create Instance"**
3. Give it a name (e.g., "Customer Support")
4. Click **"Connect"** to generate a QR code
5. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
6. Scan the QR code

### Option B: Using the API

```bash
# 1. Create an instance
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"name": "Customer Support"}'

# Response: {"success": true, "instance": {"id": "wa_lxyz123_abc45", ...}}

# 2. Start connection
curl -X POST http://localhost:3000/api/instances/wa_lxyz123_abc45/connect \
  -H "X-API-Key: your-api-key"

# 3. Get QR code
curl http://localhost:3000/api/instances/wa_lxyz123_abc45/qr \
  -H "X-API-Key: your-api-key"

# Response includes qrCode as base64 data URL - display this to the user
```

## Send Your First Message

Once connected, send a test message:

```bash
curl -X POST http://localhost:3000/api/instances/wa_lxyz123_abc45/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "to": "60123456789",
    "message": "Hello from the API! 🚀"
  }'
```

> **Note:** Replace `60123456789` with a real phone number (country code + number, no + or spaces).

## Next Steps

- [Managing Multiple Instances](./managing-instances.md) - Add more WhatsApp numbers
- [Sending Messages](./sending-messages.md) - Message formats and options
- [Receiving Messages](./receiving-messages.md) - Set up webhooks
- [Anti-Ban Settings](./anti-ban-settings.md) - Protect your accounts
