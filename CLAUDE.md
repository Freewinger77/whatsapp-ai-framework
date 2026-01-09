# Claude Code Instructions for WhatsApp AI Chatbot

> **Last Updated:** January 9, 2026

This file provides project-specific instructions for Claude Code sessions.

---

## Project Overview

Production-ready WhatsApp AI chatbot platform with:
- **Multi-Instance Support** - Manage multiple WhatsApp numbers from one server
- **RESTful API** - Full API for external platform integration
- **Baileys** for WhatsApp connection (NOT Evolution API)
- **n8n** for AI orchestration (RAG queries, LLM calls, memory, handoff)
- **Cloudflare AutoRAG** for knowledge base
- **Web Admin Panel** (multi-instance dashboard, QR display, anti-ban monitoring)
- **Anti-Ban Protection** (rate limiting, human-like delays per instance)
- **API Key Authentication** for secure external access
- Multi-language support (EN, BM, Mandarin)

---

## Before Starting Work

### 1. Read Documentation Index
```
Read /Volumes/External/gx/AI-chat-bot-whatsapp/docs/README.md
```
This links to all project documentation.

### 2. Key Documentation

| Document | Purpose |
|----------|---------|
| [docs/README.md](./docs/README.md) | Documentation index |
| [docs/FEATURE_INVENTORY.md](./docs/FEATURE_INVENTORY.md) | Complete feature list |
| [docs/ANTI_BAN_PROTOCOL.md](./docs/ANTI_BAN_PROTOCOL.md) | Ban prevention |
| [docs/CLAUDE_SESSION_NOTES.md](./docs/CLAUDE_SESSION_NOTES.md) | Development history |

### 3. Reference Project
```
/Volumes/External/whatsapp-sender/
├── chatbot.js     # Baileys + webhook pattern
├── send.js        # Baileys QR + connection
└── auth_info/     # Credential storage
```

### 4. Use Context7 for Library Documentation

```typescript
// Baileys (WhatsApp)
mcp__context7__resolve-library-id({ libraryName: "baileys whatsapp" })

// Express.js (Web Server)
mcp__context7__resolve-library-id({ libraryName: "express" })

// QRCode generation
mcp__context7__resolve-library-id({ libraryName: "qrcode npm" })
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js v18+ |
| WhatsApp | @whiskeysockets/baileys v7.0.0 |
| Web Server | Express.js v4.18.2 |
| Real-time | WebSocket (ws v8.14.2) |
| HTTP Client | axios v1.6.0 |
| QR Display | qrcode v1.5.3 |
| Config | dotenv v16.3.1 |
| Cloud Backup | googleapis v169.0.0 |
| Process Manager | PM2 |
| AI Orchestration | n8n (external) |
| RAG | Cloudflare AutoRAG (external) |
| LLM | OpenAI / Gemini (via n8n) |

---

## Project Structure

```
whatsapp-ai-framework/
├── README.md                    # Project overview
├── CLAUDE.md                    # This file (dev instructions)
│
├── app/                         # Main Node.js application
│   ├── package.json             # Dependencies
│   ├── server.js                # Multi-instance API server
│   ├── settings.json            # Global settings
│   ├── .env                     # Configuration (gitignored)
│   ├── .env.example             # Config template
│   │
│   ├── src/
│   │   └── utils/
│   │       ├── instance-manager.js  # Multi-instance WhatsApp manager
│   │       ├── anti-ban.js          # Anti-ban module
│   │       └── settings.js          # Settings persistence
│   │
│   ├── public/
│   │   └── index.html           # Multi-instance admin dashboard
│   │
│   ├── instances/               # Per-instance data (gitignored)
│   │   ├── instances.json       # Instance registry
│   │   └── <instance-id>/
│   │       ├── auth/            # WhatsApp credentials
│   │       └── logs/            # Instance logs
│   │
│   └── logs/                    # Legacy logs folder
│
├── docs/                        # Documentation
│   ├── FEATURE_INVENTORY.md     # Complete feature list
│   ├── ANTI_BAN_PROTOCOL.md     # Ban prevention guide
│   └── META_API_SETUP_GUIDE.md  # Meta Business API setup
│
├── n8n-workflows/               # Exported n8n workflows
│
├── cloudflare/                  # Cloudflare Worker (optional)
└── evolution/                   # Docker compose for Evolution API
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/server.js` | Multi-instance API server (Express + WebSocket) |
| `app/src/utils/instance-manager.js` | WhatsApp instance management class |
| `app/public/index.html` | Multi-instance admin dashboard |
| `app/src/utils/anti-ban.js` | Anti-ban protection module |
| `app/src/utils/settings.js` | Settings persistence |

---

## API Endpoints (Multi-Instance)

### Instance Management
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/instances` | GET | List all instances |
| `/api/instances` | POST | Create new instance |
| `/api/instances/:id` | GET | Get instance details |
| `/api/instances/:id` | PUT | Update instance settings |
| `/api/instances/:id` | DELETE | Delete instance |

### Instance Connection
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/instances/:id/connect` | POST | Start WhatsApp connection |
| `/api/instances/:id/disconnect` | POST | Disconnect instance |
| `/api/instances/:id/clear-auth` | POST | Clear credentials |
| `/api/instances/:id/qr` | GET | Get QR code |

### Messaging
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/instances/:id/send` | POST | Send message via instance |
| `/api/send` | POST | Send (auto-select instance) |

### Instance Logs & Anti-Ban
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/instances/:id/logs` | GET | Get activity logs |
| `/api/instances/:id/anti-ban` | GET | Get anti-ban status |
| `/api/instances/:id/anti-ban` | PUT | Update anti-ban settings |

### System
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/status` | GET | System status |
| `/api/health` | GET | Health check |
| `/api/generate-api-key` | POST | Generate new API key |

### Authentication
All API endpoints require authentication when `API_KEY` is set in `.env`:
- Header: `X-API-Key: your-api-key`
- Or: `Authorization: Bearer your-api-key`

---

## Code Standards

### JavaScript/Node.js
- ES6+ features (const, let, arrow functions, async/await)
- Error handling with try/catch
- Environment variables via dotenv
- JSDoc comments for functions

### Error Handling
```javascript
try {
    const result = await someOperation();
    return result;
} catch (error) {
    console.error('Operation failed:', error);
    // Handle gracefully, don't crash
}
```

---

## Testing Locally

```bash
# Navigate to app directory
cd app

# Install dependencies
npm install

# Start development server
npm start
# OR
node server.js

# Access admin panel
open http://localhost:3000
```

---

## Production (PM2)

```bash
# Start with PM2
pm2 start app/server.js --name whatsapp-bot

# Auto-start on boot
pm2 startup && pm2 save

# Monitor
pm2 monit

# View logs
pm2 logs whatsapp-bot
```

---

## Environment Variables

```env
# Server
PORT=3000

# API Authentication (for external platform integration)
# Generate: openssl rand -hex 32
API_KEY=your-secure-api-key

# Admin Panel Password (optional)
ADMIN_PASSWORD=

# Google Drive Backup (OPTIONAL)
GOOGLE_CREDENTIALS_FILE=./google-credentials.json
GOOGLE_DRIVE_FOLDER_ID=folder-id

# Note: Webhook URLs are now configured per-instance via API
```

---

## Skills & Agents

| When To Use | Tool |
|-------------|------|
| Building UI | `Skill: frontend-design` |
| Testing endpoints | `Skill: webapp-testing` |
| Before commits | `Task: code-reviewer agent` |
| Exploring code | `Task: code-explorer agent` |
| Architecture decisions | `Task: Plan agent` |

---

## Important Notes

1. **Multi-Instance Architecture**: Each WhatsApp number runs as its own instance with separate auth, settings, and logs
2. **API-First Design**: All operations available via REST API for external platform integration
3. **Per-Instance Webhooks**: Each instance can have its own webhook URL for AI processing
4. **Anti-Ban Per Instance**: Each instance has independent rate limiting
5. **API Authentication**: Set `API_KEY` in `.env` to secure API access
6. **WebSocket Events**: Real-time updates for QR codes, connection status, and messages

---

## After Making Changes

Update `docs/CLAUDE_SESSION_NOTES.md` with:
- What was accomplished
- Any issues encountered
- Next steps
