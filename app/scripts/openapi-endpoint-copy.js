/**
 * Human-readable endpoint copy for Wasup worker OpenAPI docs.
 * Applied by scripts/enrich-openapi.js — no transport/protocol jargon.
 */

export const INFO_DESCRIPTION = `Wasup lets you run one or more WhatsApp numbers from a single deployment. Each **instance** is an isolated number with its own pairing state, webhook, send limits, and activity logs.

## Who this API is for
Integrators building bots, CRMs, booking flows, or support desks that need to **create numbers**, **pair them**, **send messages**, and **receive inbound events** over HTTPS.

## Authentication
When an API key is configured, send it on every \`/api/...\` request:
- Header \`X-API-Key: your-key\`
- or \`Authorization: Bearer your-key\`

Org-scoped keys from the Wasup dashboard Connection page are recommended. Open deployments without \`API_KEY\` accept unauthenticated calls (development only).

## Typical flow
1. **Create** an instance (\`POST /api/instances\`)
2. **Connect** and scan QR or enter a pairing code (\`POST .../connect\`, poll \`GET .../qr\`)
3. **Set webhook** for inbound messages (\`PUT .../webhook\` or at create time)
4. **Send** outbound messages (\`POST .../send\`)
5. **Poll status** for delivery/read acks (\`GET .../messages/{messageId}/status\`)
5. **Monitor** health and logs (\`GET /api/health\`, \`GET .../logs\`)

## Reconnecting & re-pairing (read this to avoid pairing failures)
To take a number from **any** state (disconnected, dropped, corrupt auth, or previously linked) to a **fresh pairing code**, always run this exact sequence:

1. \`POST /api/instances/{id}/disconnect\` — close any live/half socket
2. \`POST /api/instances/{id}/clear-auth\` — wipe credentials (forces a NEW code)
3. wait ~2s, then \`POST /api/instances/{id}/connect\` with \`{ "phoneNumber": "447..." }\`
4. \`GET /api/instances/{id}/connection\` — poll every 3–5s until \`status: connected\`

**Rules that prevent the common failures:**
- Call \`connect\` **once** per attempt. While waiting, poll \`GET .../connection\` only — never re-POST connect.
- If \`connect\` returns \`reused: true\`, the previous code (<2 min) is still valid — show the same code, do not refresh.
- **Skipping \`clear-auth\`** on a previously linked number makes \`connect\` resume the old session and return \`pairingCode: null\` — no code for the user.
- \`400 "Connection Closed"\` (status 428) means stale/corrupt auth — \`clear-auth\` then \`connect\` fixes it; retry connect at most once after ~4s.
- WhatsApp app showing **"something went wrong"** = the code was rotated by repeated \`connect\` calls. One connect, then let the user enter the code.

## Interactive messages
Use the same send endpoints for plain text, link previews, CTA URL buttons, quick-reply buttons, media, locations, and reactions. See **Messaging** and **Webhook** sections for payload shapes.

## Inbound webhooks
When someone messages your linked number, Wasup POSTs JSON to your \`webhookUrl\`. Media messages include \`media_id\` and \`media.downloadUrl\` so you can fetch the file with \`GET /api/instances/{id}/media/{mediaId}\`.

**Group messages:** \`from_phone\` remains the **group id** (legacy). Use \`is_group\`, \`group_id\`, and \`sender_phone\` for the member who sent the message. \`from_jid\` / \`sender_jid\` carry raw WhatsApp JIDs when you need them.`;

export const TAG_DESCRIPTIONS = {
  Whitelabel: 'Single-call helpers that create, configure, and connect a number in one request — ideal for onboarding flows.',
  Instances: 'Create, read, update, and delete WhatsApp instances. An instance is one linked phone number plus its settings.',
  Connection: `Start or stop the live WhatsApp session, fetch QR/pairing codes, and check whether a number is linked.

**Bulletproof re-pair flow (use this to ALWAYS reach a fresh pairing code):**
1. \`POST .../disconnect\` — close any live or half-open socket
2. \`POST .../clear-auth\` — wipe saved credentials (this is what forces a NEW code)
3. wait ~2s, then \`POST .../connect\` with \`pairingPhone\` — generates the code
4. \`GET .../connection\` — poll every 3–5s until \`status: connected\`

Call \`connect\` **once** per attempt. While polling, only call \`GET .../connection\` — never re-POST connect in a loop. If \`connect\` returns \`reused: true\` the previous code (<2 min old) is still valid — show the same code, do not refresh. Skipping \`clear-auth\` on a previously linked number makes \`connect\` resume the old session and return \`pairingCode: null\` (no code for the user).`,
  Messaging: 'Send text, media, buttons, lists, and reactions to customers. Auto-select routes pick the first connected instance when you omit an instance id.',
  Reactions: 'Attach or remove emoji reactions on existing messages using the message id from webhooks or send responses.',
  Handoff: 'Pause automated replies for specific chats while a human agent takes over the conversation.',
  Profile: 'Read or update the WhatsApp display name, profile photo, and About text for a linked instance.',
  Webhook: 'Configure where inbound messages are delivered and inspect the JSON shape your receiver should expect.',
  Behavior: 'Control typing indicators, human-like delays, and whether the linked phone should receive push notifications before the API marks messages read.',
  'Anti-Ban': 'Legacy rate-limit presets and usage counters that protect a number from sending too fast.',
  'Wasup Anti-Ban': 'Advanced per-instance protection modules (warm-up, rate limits, health monitoring, presence timing). State is stored on disk per instance.',
  Proxy: 'Assign regional egress proxies to instances for stable outbound IP addresses.',
  Logs: 'Read recent connection and messaging activity for troubleshooting.',
  System: 'Deployment health, instance roll-ups, and API key utilities.',
  Storage: 'Upload files to the worker and inspect storage backend status.',
};

export const ENDPOINT_DESCRIPTIONS = {
  'POST /api/onboard': `**Onboard a new WhatsApp number in one call.** Creates an instance (or reuses an existing one for the same phone), sets optional webhook and profile fields, starts pairing, and returns a pairing code when applicable. Use this when your product wizard should not make separate create/connect/webhook calls.`,

  'GET /api/instances': `**List every instance on this deployment.** Returns id, display name, connection status (\`disconnected\`, \`connecting\`, \`connected\`), linked phone when available, webhook URL, behavior settings, and anti-ban health. Use this to populate admin dashboards or to pick an instance id before sending.`,

  'POST /api/instances': `**Create a new empty instance.** Optionally set a custom id, friendly name, inbound webhook URL, behavior profile, and anti-ban preset. The number is not linked until you call \`POST .../connect\` and complete QR or pairing. Does not send any messages.`,

  'GET /api/instances/{instanceId}': `**Fetch full details for one instance.** Same fields as the list endpoint plus QR state hints, connected-at timestamp, saved-credentials flag, and effective anti-ban usage. Use before sending or when showing a single number in your UI.`,

  'PUT /api/instances/{instanceId}': `**Update instance settings without deleting it.** Change name, webhook URL, behavior profile (typing, delays, notification grace), and anti-ban limits. Does not disconnect an active session unless a setting requires reconnect (for example proxy changes).`,

  'DELETE /api/instances/{instanceId}': `**Permanently remove an instance.** Stops the session, deletes local credentials, logs, and stored media for that id. This cannot be undone — create a new instance to link the same phone again.`,

  'POST /api/instances/{instanceId}/connect': `**Start linking this instance to WhatsApp.** Opens a pairing session. By default returns QR mode — poll \`GET .../qr\` and show the code to the user. Pass \`pairingPhone\` (or \`phoneNumber\`) to receive a numeric pairing code instead of QR.

**Call this only ONCE per pairing attempt.** Do not call it again while waiting — poll \`GET .../connection\` instead. Re-calling rotates the code and triggers WhatsApp's "something went wrong".

**Responses:**
- New code → \`{ pairingCode, reused: null }\`
- Code <2 min old, same phone → \`{ pairingCode, reused: true }\` (show the SAME code; do not refresh)
- Number already linked / credentials still present → resumes the old session and returns \`pairingCode: null\`. To force a fresh code you must \`clear-auth\` first (see the **Bulletproof re-pair flow** in the Connection section).
- \`400 "Connection Closed"\` (status 428) → corrupt/stale auth or a socket still tearing down. Fix: run \`clear-auth\` then \`connect\`; if it recurs, wait ~4s and retry connect once. Never rapid-fire connect.`,

  'POST /api/instances/{instanceId}/disconnect': `**Close the live session locally.** Stops receiving and sending until you connect again. Saved credentials remain on disk so reconnect usually does not require a new QR. Pass \`revoke: true\` only when you intentionally want WhatsApp to invalidate the linked device everywhere. Idempotent — safe to call when already disconnected. Step 1 of the re-pair flow.`,

  'POST /api/instances/{instanceId}/clear-auth': `**Wipe saved pairing data.** Disconnects if needed and deletes credential files, then the next \`connect\` ALWAYS issues a fresh QR/pairing code. This is the step that prevents the \`pairingCode: null\` and \`428 Connection Closed\` failures on a previously linked or corrupted number. Idempotent. Step 2 of the re-pair flow — run it before \`connect\` whenever you want the user to (re)link, regardless of current status.`,

  'POST /api/instances/{instanceId}/pair': `**Connect using a pairing code instead of QR.** Requires the phone number in the body. Returns a short code the user enters under WhatsApp → Linked devices. Automatically starts the connection if not already connecting.`,

  'GET /api/instances/{instanceId}/qr': `**Get the current QR image or pairing code.** Poll while status is \`connecting\`. Append \`?format=image\` for a raw PNG suitable for mobile apps. Returns connected phone when status is \`connected\`. Returns 204 when no code is ready yet — call \`/connect\` first.`,

  'GET /api/instances/{instanceId}/connection': `**Lightweight connection poll — use THIS while waiting to link.** Returns only status (\`disconnected\` | \`connecting\` | \`connected\`), phone, uptime, and the current \`pairingCode\` — faster than fetching the full instance object. Poll every 3–5s after \`connect\`; stop when \`status: connected\`. Never call \`POST .../connect\` inside the poll loop. Note: a \`connecting\` instance whose code is not entered will drop back to \`disconnected\` after ~2 min (the code expired) — re-run the re-pair flow to mint a new one.`,

  'POST /api/instances/{instanceId}/send': `**Send an outbound WhatsApp message from this instance.** Accepts plain text, link previews, CTA URL buttons, quick replies, images, documents, audio, video, and location pins in one payload. Requires \`to\` (customer phone, country code, no +) and content fields. Respects anti-ban delays; blocked sends return a reason and suggested wait time.`,

  'POST /api/instances/{instanceId}/send/interactive': `**Same as \`/send\` with documentation focused on interactive payloads.** Use for button-heavy examples. Supports combining one CTA URL button with up to two quick-reply buttons (three interactive actions total).`,

  'GET /api/instances/{instanceId}/media': `**List files stored for this instance.** Includes inbound and outbound media saved on the worker disk. Filter by \`type\` and paginate with \`limit\`. Each row includes \`downloadUrl\` for authenticated file fetch.`,

  'GET /api/instances/{instanceId}/media/{mediaId}': `**Download one stored media file.** Use the \`media_id\` from an inbound webhook or from the media list. Requires the same API key as other routes. Returns raw bytes with the original content type.`,

  'POST /api/send': `**Send without specifying an instance id.** Wasup picks a connected instance automatically — usually matching \`from_phone\` when provided, otherwise the first connected instance. Same body as instance send. Fails with a clear error if no instance is connected.`,

  'GET /api/instances/{instanceId}/messages': `**Search recent message history stored on the worker.** Filter by phone, direction, or text search. Useful for support consoles; primary automation should still rely on webhooks for real-time inbound events.`,

  'GET /api/instances/{instanceId}/messages/{messageId}/status': `**Poll outbound delivery/read status for a message you sent.** Use the \`message_id\` from \`POST .../send\` or \`/api/send\`. Returns \`pending\`, \`sent\`, \`delivered\`, \`read\`, or \`played\` while the instance stays connected. 404 if the id is unknown or the worker restarted since send.`,

  'POST /api/instances/{instanceId}/react': `**Add or remove a reaction emoji on a message.** Provide \`to\`, \`messageId\` from a webhook or send response, and \`emoji\` (empty string removes the reaction). Set \`fromMe: true\` when reacting to a message this instance sent.`,

  'POST /api/react': `**React using auto-selected instance.** Same body as instance react plus optional \`from_phone\` to choose which linked number performs the reaction.`,

  'GET /api/instances/{instanceId}/handoff': `**List chats currently in human handoff mode.** While handoff is active for a contact, automated replies are suppressed so agents can respond manually from the phone or another tool.`,

  'POST /api/instances/{instanceId}/handoff': `**Mark a chat as human-controlled.** Provide customer phone or chat id. Optional resume keywords and message control when the bot should start again.`,

  'DELETE /api/instances/{instanceId}/handoff': `**Clear handoff for one contact or all contacts.** Automation resumes for the cleared chats on the next inbound message.`,

  'GET /api/instances/{instanceId}/handoff/settings': `**Read handoff keywords, resume message, and managed numbers** configured for this instance.`,

  'PUT /api/instances/{instanceId}/handoff/settings': `**Update handoff rules** such as keywords that return control to the bot and default resume text.`,

  'GET /api/storage/status': `**Report media storage backend** (local disk vs cloud) and capacity hints for this deployment.`,

  'POST /api/upload': `**Upload a file to the worker** for later use in outbound messages. Returns a URL or handle referenced by send payloads.`,

  'GET /api/instances/{instanceId}/profile': `**Read WhatsApp profile metadata** — display name, About text, and profile picture URL when linked.`,

  'PUT /api/instances/{instanceId}/profile/name': `**Change the WhatsApp display name** shown to customers who have not saved your contact.`,

  'PUT /api/instances/{instanceId}/profile/picture': `**Upload or replace the profile photo** for the linked number. Accepts image URL or base64 depending on deployment.`,

  'DELETE /api/instances/{instanceId}/profile/picture': `**Remove the profile photo** and revert to WhatsApp default avatar.`,

  'PUT /api/instances/{instanceId}/profile/status': `**Update the About / status line** under the profile name.`,

  'GET /api/instances/{instanceId}/behavior': `**Read behavior settings** — profile preset (\`bot-native\`, \`notification-balanced\`, \`notification-max\`), typing simulation, response delays, and phone notification grace period.`,

  'PUT /api/instances/{instanceId}/behavior': `**Update how human-like the instance acts when replying.** For clinics or desks where staff read messages on their phone first, use \`notification-balanced\` with a grace period so push notifications arrive before read receipts.`,

  'GET /api/instances/{instanceId}/anti-ban': `**Read legacy anti-ban limits and current usage percentages.** Shows hourly/daily message counts, unique chat limits, and warning state.`,

  'PUT /api/instances/{instanceId}/anti-ban': `**Change legacy rate limits** using presets (\`conservative\`, \`balanced\`, \`aggressive\`) or custom hourly/daily caps.`,

  'GET /api/webhook': `**Read the deployment-wide default webhook URL** from environment configuration. Instances without their own webhook inherit this URL.`,

  'GET /api/instances/{instanceId}/webhook': `**See which webhook URL will receive inbound messages** for this instance — instance-specific override or global default.`,

  'PUT /api/instances/{instanceId}/webhook': `**Set or clear the instance webhook.** Pass a URL to receive JSON POSTs for every inbound message, or null/empty to fall back to the global default.`,

  'POST /api/instances/{instanceId}/webhook/test': `**Send a sample inbound payload** to the configured webhook URL so you can verify your receiver without waiting for a real message.`,

  'GET /docs/inbound-webhook': `**Documentation-only reference** for the JSON body Wasup POSTs to your webhook when a customer messages you. Includes text, media, location, \`media_id\`, and \`whatsapp_message_id\` fields. Group chats also include \`is_group\`, \`group_id\`, \`sender_phone\`, \`from_jid\`, and \`sender_jid\`. Not a callable HTTP route on the worker.`,

  'GET /api/instances/{instanceId}/logs': `**Fetch recent activity log lines** — connects, disconnects, sends, receives, and errors. Use the \`limit\` query param (max 200) for pagination.`,

  'GET /api/health': `**Quick deployment health check.** Returns ok/error, process uptime, and count of total vs connected instances. No authentication required — suitable for load balancers.`,

  'GET /api/status': `**Authenticated roll-up of all instances** with id, name, status, and phone. Similar to \`GET /api/instances\` but optimized for monitoring dashboards.`,

  'POST /api/system/reload-behavior-from-disk': `**Reload saved behavior settings from disk** for already-running instances without restarting the whole process. Does not disconnect active numbers.`,

  'POST /api/generate-api-key': `**Generate a random API key string** for reference. You must manually add it to server environment — this endpoint does not persist keys by itself.`,

  'GET /api/proxy': `**Deployment-level proxy summary** — whether a pool is configured and how many slots are in use.`,

  'GET /api/proxy/pool': `**List all proxy pool slots** with assignment status and which instance (if any) holds each slot.`,

  'GET /api/instances/{instanceId}/proxy': `**Read proxy configuration for one instance** — override URL, effective proxy, and live egress state.`,

  'PUT /api/instances/{instanceId}/proxy': `**Attach or change the outbound proxy** for an instance. Accepts full proxy URL or \`host:port:user:pass\` shorthand. Reconnects the instance when already online.`,

  'DELETE /api/instances/{instanceId}/proxy': `**Remove proxy override** and return the instance to pool assignment or direct connection.`,

  'POST /api/instances/{instanceId}/proxy/verify': `**Test egress IP** by sending a probe request through the instance proxy and returning the detected public IP.`,

  'GET /api/instances/{instanceId}/antiban-v2': `**Read Wasup Anti-Ban v2 module status** — which protection modules are active and their health summary.`,

  'GET /api/instances/{instanceId}/antiban-v2/config': `**Read detailed Anti-Ban v2 configuration** per module (warm-up, rate limiter, presence timing, etc.).`,

  'PUT /api/instances/{instanceId}/antiban-v2/config': `**Update Anti-Ban v2 module settings** such as warm-up stage, rate multipliers, or pause thresholds.`,

  'GET /api/instances/{instanceId}/antiban-v2/health': `**Health scores and recent warnings** from Anti-Ban v2 monitors for this instance.`,

  'POST /api/instances/{instanceId}/antiban-v2/warmup': `**Advance or reset warm-up stage** for a newly linked number so send limits ramp gradually.`,

  'GET /api/instances/{instanceId}/antiban-v2/lid-mappings': `**Inspect contact id mappings** maintained for reliable delivery (internal troubleshooting; most integrations can ignore).`,

  'POST /api/instances/{instanceId}/antiban-v2/pause': `**Temporarily pause Anti-Ban v2 enforcement** for maintenance or testing — use with caution.`,

  'POST /api/instances/{instanceId}/antiban-v2/resume': `**Resume Anti-Ban v2 enforcement** after a manual pause.`,

  'POST /api/instances/{instanceId}/antiban-v2/reset': `**Reset Anti-Ban v2 counters and state files** for this instance to defaults.`,
};

export const CONTROL_PLANE_INFO = `Wasup **Control Plane API** (v3) powers the dashboard at dev.wasup.co. It manages organizations, billing, provisioning, and proxies — while actual WhatsApp send/receive happens on your org worker URL.

## Authentication
Sign in with **Clerk** in the browser, or send a **Wasup API key** (\`sk-prod_...\` / \`sk-dev_...\`) from the Connection page:
- \`Authorization: Bearer sk-prod_...\`
- or \`X-API-Key: sk-prod_...\`

## Base URL
\`https://control-plane.wasup.co\` (production). Paths below are prefixed with \`/api/v3\`.

## Relationship to worker API
- Control plane: create orgs, pay, provision instances, read activity feeds.
- Org worker (\`https://{org}.wasup.co\`): connect QR, send messages, webhooks. See worker \`/docs\` on your org URL.`;

export const CONTROL_PLANE_ENDPOINTS = {
  'GET /api/v3/me': `**Who am I?** Returns the authenticated principal — Clerk user id, organization id, auth source (\`clerk\` or \`api_key\`), and assigned scopes. Call this first to verify your API key or session works before provisioning or listing instances.`,

  'GET /api/v3/connection': `**Workspace connection summary for the signed-in org.** Returns organization slug, worker base URL, deployment status (provisioning vs ready), DNS progress, and API keys available on the Connection page.`,

  'GET /api/v3/connection/keys': `**List API keys** for the org (masked). Use to rotate keys or confirm which \`sk-prod\` key is active.`,

  'GET /api/v3/orgs': `**List organizations** the current user belongs to. Each org maps to one Wasup workspace and one worker VM.`,

  'POST /api/v3/orgs': `**Create a new workspace.** Requires Clerk auth. Returns 409 if the user already owns a workspace (one workspace per user). Triggers Azure VM provisioning in the background.`,

  'GET /api/v3/orgs/{id}': `**Fetch one organization** including slug, name, and billing linkage.`,

  'PUT /api/v3/orgs/{id}': `**Update organization settings** such as display name.`,

  'DELETE /api/v3/orgs/{id}': `**Delete a workspace** and schedule worker teardown (destructive).`,

  'GET /api/v3/instances': `**List WhatsApp instances in your org.** Includes Supabase status, region, phone, proxy assignment, and \`messages_today\` count. Live-syncs connected numbers from the worker when needed.`,

  'POST /api/v3/instances': `**Request a new instance slot.** Checks billing entitlements, reserves a paid seat, assigns regional proxy, and registers desired state on the worker. Returns provisioning status — poll until \`connected\` or open the dashboard.`,

  'GET /api/v3/instances/{id}': `**Get one instance** with live worker status sync on read. Use on instance detail pages to show accurate connected/disconnected state.`,

  'PUT /api/v3/instances/{id}': `**Update instance name, webhook URL, or signing secret** in both Supabase and the org worker.`,

  'DELETE /api/v3/instances/{id}': `**Delete instance** — removes worker state, releases proxy slot, and frees billing seat.`,

  'POST /api/v3/instances/{id}/connect': `**Tell the worker to start pairing** for this instance. Optional \`pairingPhone\` for code-based linking. Call once per attempt, then poll \`GET .../qr\`. To force a fresh code on an already-linked or stuck number, call \`POST .../clear-auth\` first (proxies to the worker re-pair flow).`,

  'GET /api/v3/instances/{id}/qr': `**Poll QR / pairing / connected state** from the worker through the control plane (no direct worker URL needed in the dashboard). Poll every 3–5s; do not re-call \`connect\` while polling. A pairing code expires after ~2 min if unused.`,

  'POST /api/v3/instances/{id}/clear-auth': `**Clear worker credentials** so the next \`connect\` always issues a fresh QR/pairing code. Use this before \`connect\` to reliably re-pair a number that was previously linked, dropped, or shows \`pairingCode: null\` / \`Connection Closed\`.`,

  'POST /api/v3/instances/{id}/send': `**Send a WhatsApp message** via control plane proxy to the org worker. Same payload as worker \`/send\`. Returns worker response including \`message_id\` when available.`,

  'GET /api/v3/instances/{id}/messages/{messageId}/status': `**Poll outbound message delivery/read status** via control plane proxy to the org worker. Same as worker \`GET .../messages/{messageId}/status\`. Requires \`instances:read\`.`,

  'GET /api/v3/instances/{id}/profile': `**Read linked WhatsApp profile** (name, about, picture) from the worker.`,

  'PUT /api/v3/instances/{id}/profile': `**Update WhatsApp profile fields** on the worker.`,

  'GET /api/v3/instances/{id}/handoff': `**Read handoff state** for human takeover flows.`,

  'PUT /api/v3/instances/{id}/handoff': `**Update handoff settings** on the worker.`,

  'GET /api/v3/deep-dive': `**Search messages and logs** across the org (or one instance). Powers Home, Deep Dive, and instance Live Activity in the dashboard. Query params: \`type\`, \`instanceId\`, \`search\`, \`from\`, \`to\`, \`limit\`.`,

  'GET /api/v3/docs': `**Resolve worker doc links** for your org — docs, playground, openapi, admin URLs on \`{org}.wasup.co\`.`,

  'GET /api/v3/billing/entitlements': `**Read billing state** — paid instance slots, active count, credit balance, subscription status.`,

  'POST /api/v3/billing/checkout': `**Start Stripe Checkout** to buy instance seats or message credits.`,

  'POST /api/v3/billing/portal': `**Open Stripe Customer Portal** for invoices and payment methods.`,

  'POST /api/v3/provision/instances': `**Provision flow alias** — reserves entitlement and creates instance (same gate as POST /instances).`,

  'GET /api/v3/proxy/availability': `**Regions with available proxies** for new instance creation.`,

  'GET /api/v3/proxy/admin': `**Admin proxy pool view** (operator scope).`,

  'POST /api/v3/proxy/admin': `**Import proxies** into the pool (operator scope).`,

  'GET /api/v3/notifications': `**In-app notifications** for the signed-in user (provisioning, errors, billing).`,

  'POST /api/v3/notifications/mark-read': `**Mark notifications read.**`,

  'GET /api/v3/playground/worker-health': `**Check reachability** of the org worker from the control plane.`,

  'POST /api/v3/customer/reset': `**Danger zone — delete entire workspace** and all data (requires confirmation token).`,

  'GET /api/v3/organization-invitations': `**Pending org invites** for the current user.`,
};
