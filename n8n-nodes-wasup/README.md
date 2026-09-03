# n8n-nodes-wasup

By **Arslan Badr**. This is an [n8n](https://n8n.io) community node for **Wasup** — a multi-instance WhatsApp API with built-in **proprietary anti-ban protection** that keeps numbers healthy at scale. It lets you drive any Wasup deployment from n8n: send messages, CTA URL buttons, quick replies, lists, media, locations and reactions, manage instances and connections, profiles, webhooks, human handoff, and fine-grained account-safety controls.

Because the **Base URL** lives in the credentials, the same node works against the open `wasup2` demo worker, your own production workers, or a customer's self-hosted deployment — just create one credential per deployment.

Don't have a deployment yet? Spin up your own cloud-hosted instances at **[dev.wasup.co](https://dev.wasup.co)**.

[Installation](#installation) · [Credentials](#credentials) · [Resources & operations](#resources--operations) · [Examples](#examples) · [Publishing](#publishing)

## Installation

### In n8n (Community Nodes)

1. Go to **Settings → Community Nodes → Install**.
2. Enter `n8n-nodes-wasup` and confirm.
3. The **Wasup** node and **Wasup API** credential become available.

### Manual / self-hosted

```bash
# inside your n8n custom extensions folder (~/.n8n/custom or N8N_CUSTOM_EXTENSIONS)
npm install n8n-nodes-wasup
```

### Local development

```bash
npm install
npm run build          # compiles TS + copies icons into dist/
# link into a local n8n instance
npm link
cd ~/.n8n/custom && npm link n8n-nodes-wasup
```

## Credentials

Create a **Wasup API** credential:

| Field | Description |
|-------|-------------|
| **Base URL** | Your deployment URL, no trailing slash. e.g. `https://wasup2.northeurope.cloudapp.azure.com` or your production worker URL. |
| **API Key** | Deployment admin key (`X-API-Key`) or a per-instance `wsp_v3_*` key. Leave blank only for open deployments with no key configured. |

The key is sent as the `X-API-Key` header on every request. The credential **Test** button hits `GET /api/instances` to verify the URL + key.

> Create a separate credential for each deployment you operate (one per Base URL). In a workflow you pick which deployment to talk to by choosing the credential.

## Resources & operations

| Resource | Operations |
|----------|------------|
| **Instance** | List, Get, Create, Update, Delete, Onboard |
| **Connection** | Connect, Disconnect, Clear Auth, Pair, Get QR / Pairing Code, Get Status |
| **Message** | Send Text, Send Media, Send Buttons, Send CTA URL Button, Send List, Send Location, Send Contact, React, Get History, Send Raw |
| **Profile** | Get, Set Name, Set Status (About), Set Picture, Remove Picture |
| **Behavior** | Get, Update |
| **Anti-Ban (Legacy)** | Get Status, Update |
| **Anti-Ban V2** | Get Status, Get Config, Update Config, Get Health, Get Warmup, Pause, Resume, Reset |
| **Handoff** | List Active, Set, Clear All, Get Settings, Update Settings |
| **Webhook** | Get Global Default, Get Instance Webhook, Set Instance Webhook, Test Delivery |
| **Media** | List, Get |
| **System** | Health, Status, Storage Status, Generate API Key, Reload Behavior From Disk |

For most operations you pick the target **Instance** from a searchable dropdown (loaded live from the deployment) or pass an id/expression. Message sends offer an **Auto-Select Instance** toggle that routes through `/api/send` and lets Wasup pick a connected number.

## Examples

**Send a CTA URL button**

- Resource: `Message` → Operation: `Send CTA URL Button`
- To: `60123456789`, Text: `Ready to book?`, CTA URL: `https://acme.com/book`, CTA Label: `Book now`

**Send quick-reply buttons**

- Operation: `Send Buttons`, Text: `Choose an option`
- Buttons: `{ id: yes, text: Yes }`, `{ id: no, text: No }` (up to 3)

**Send a list**

- Operation: `Send List`, Text: `Pick a service`
- Sections (JSON):

```json
[
  { "title": "Services", "rows": [
    { "id": "consulting", "title": "Consulting", "description": "Expert advice" },
    { "id": "support", "title": "Support" }
  ]}
]
```

**Change anti-ban (v2)**

- Resource: `Anti-Ban V2` → `Update Config`, Preset: `moderate`, override `maxPerHour: 250`.

## Webhook (inbound)

This node sends outbound requests. For **inbound** messages, point your instance's `webhookUrl` (Webhook → Set Instance Webhook) at an n8n **Webhook** trigger node. Wasup POSTs JSON with `from_phone`, `message`, `media_url`, etc., and your webhook may reply `{ "reply": "text" }` to auto-respond or `{ "skip": true }` to stay silent.

## Publishing

```bash
npm run build
npm version patch
npm publish --access public
```

The package keeps the `n8n-community-node-package` keyword so it can be installed directly from npm via **Settings → Community Nodes** in any n8n instance.

## License

[MIT](./LICENSE)
