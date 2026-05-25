# Wasup Paid Provisioning

This is the first production shape for charging per WhatsApp instance and only provisioning workers for organizations with paid capacity.

## Control Flow

1. Customer signs in through Clerk and has a Supabase `organizations` row.
2. The dashboard calls `POST /api/v3/billing/checkout` when the customer buys a $39/month instance seat.
3. Stripe Checkout sells a recurring instance seat price. Quantity equals paid WhatsApp instances.
4. Stripe sends subscription webhooks to `/api/webhooks/stripe`.
5. The control plane caches the Stripe subscription in `billing_entitlements`.
6. Customers manage payment methods, invoices, seat quantity, and cancellation through `POST /api/v3/billing/portal`.
7. `POST /api/v3/provision/instances` calls `ensure_org_entitlement_or_trial`.
7. If the org is inside its trial window or has an active/trialing subscription with an unused paid slot, the control plane ensures the org VM deployment exists.
8. The selected region claims a free Supabase-backed proxy lease for that instance when one is available.
9. The instance row is created as `provisioning` / `desired`, then the org worker is called immediately when its VM is ready or left queued while the VM/DNS finishes.
10. Workers report sent, received, seen, logs, and webhook events to `POST /api/internal/usage-events` and `POST /api/internal/events`.

Stripe remains the billing source of truth. Supabase is the fast entitlement cache used by provisioning and usage APIs.

## Stripe Products

Create the default Stripe catalog from `apps/control-plane`:

```bash
STRIPE_SECRET_KEY=sk_live_... npm run stripe:products
```

The script creates:

- `Wasup WhatsApp Instance Seat`: recurring monthly price, one paid instance slot per quantity. Default price is `USD 39.00` per instance seat.
- `Wasup 1,000 Monthly Message Credits`: recurring monthly add-on, grants monthly included message credits per quantity.
- `VIPER100`: a 100% off promotion code for comped checkout/testing.

Store the returned values in the control-plane environment:

```env
STRIPE_INSTANCE_PRICE_ID=price_...
STRIPE_MESSAGE_CREDIT_PRICE_ID=price_...
STRIPE_VIPER100_PROMOTION_CODE_ID=promo_...
```

Required Stripe metadata:

- `wasupEntitlement=instance`
- `wasupInstanceSlots=1`
- `wasupEntitlement=message_credits`
- `wasupMessageCredits=1000`

## Environment

```env
WASUP_CONTROL_PLANE_URL=https://control-plane.wasup.co
WASUP_WORKER_SHARED_SECRET=<strong random value>
WASUP_BASE_DOMAIN=wasup.co
WASUP_TRIAL_DAYS=7
WASUP_PROVISIONING_MODE=record-only
AZURE_PROVISIONING_WEBHOOK_URL=https://...
GODADDY_DOMAIN=wasup.co
GODADDY_API_KEY=...
GODADDY_API_SECRET=...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_INSTANCE_PRICE_ID=price_...
STRIPE_MESSAGE_CREDIT_PRICE_ID=price_...
```

Configure Stripe webhooks for:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

## APIs

### Create Checkout

`POST /api/v3/billing/checkout`

```json
{
  "orgId": "optional-org-uuid",
  "instanceQuantity": 3,
  "messageCreditQuantity": 10
}
```

Returns `checkoutUrl`. Open it for the customer.

### Manage Billing Portal

`POST /api/v3/billing/portal`

```json
{
  "returnUrl": "https://dev.wasup.co/#/settings"
}
```

Returns `portalUrl`. Open it for the customer to update payment method, invoices, subscription quantity, cancellation, and renewal settings.

### Check Entitlement

`GET /api/v3/billing/entitlements?orgId=<uuid>`

Returns paid instance limit, active instance count, available slots, billing status, and message credit balance.

### Provision Instance

`POST /api/v3/provision/instances`

Provisioning now fails with HTTP `402` unless the org has trial allowance or an active/trialing entitlement with a free paid instance slot. It ensures the org deployment, claims a regional proxy, and rolls proxy/billing state back if instance creation fails.

### Connection Metadata and Keys

`GET /api/v3/connection`

Returns the organisation base URL, org deployment status, and live/test API key metadata.

`POST /api/v3/connection/keys`

```json
{ "keyKind": "live" }
```

Revokes the current key of that kind and returns the new raw secret once.

### Proxy Availability

`GET /api/v3/proxy/availability`

Returns free/assigned/unavailable proxy counts grouped by region from `proxy_pool_summary`.

`GET /api/v3/proxy/admin?regionCode=fi`

Lists redacted proxy pool entries for owners/admins.

`POST /api/v3/proxy/admin`

```json
{
  "regionCode": "fi",
  "providerName": "Webshare",
  "proxies": "host:port:user:pass"
}
```

Accepts one proxy per line as `host:port:user:pass`, `host:port`, or full `http://user:pass@host:port` / `socks5://...` URLs. The route verifies that the region exists and is available before importing. Instance creation later claims only proxies from the selected region.

### Deep Dive

`GET /api/v3/deep-dive?type=messages|logs|all&instanceId=...&search=...&from=...&to=...`

Returns durable `instance_messages` and `worker_events` for the logged-in Clerk organisation.

### Profile and Handoff

- `GET/PUT /api/v3/instances/:id/profile`
- `GET/POST/DELETE /api/v3/instances/:id/handoff`

### Record Usage

`POST /api/internal/usage-events`

Headers:

```http
Authorization: Bearer <WASUP_WORKER_SHARED_SECRET>
```

Body:

```json
{
  "instanceId": "instance-uuid",
  "eventType": "message.sent",
  "quantity": 1,
  "idempotencyKey": "worker-name:message-id:sent",
  "metadata": {
    "jid": "447700900000@s.whatsapp.net"
  }
}
```

`message.sent`, `message.received`, `message.outbound`, and `message.inbound` cost one credit per message by default. `message.seen` and webhook events are tracked but cost zero unless `creditCost` is supplied.

## Proxy Allocation

The provisioner should allocate a proxy before worker deployment:

1. Prefer provider API if the proxy vendor exposes region-specific sticky residential endpoints.
2. Fall back to imported pools in `proxy_allocations` if there is no provider API.
3. Store secrets in Azure Key Vault and write only `username_ref` / `password_secret_ref` to Supabase.
4. Assign one active proxy per instance and mark unhealthy proxies as `quarantined`.

The current `proxy_policy` field supports:

- `auto`: provider first, imported pool fallback.
- `imported-pool`: only consume pre-uploaded proxies.
- `dedicated-provider`: request/lease from provider API only.

## Azure Provisioner Contract

Wasup now tracks one `org_deployments` row per organisation/environment. On first instance creation the control plane creates or reuses that row and, when `WASUP_PROVISIONING_MODE=webhook`, posts the desired VM payload to `AZURE_PROVISIONING_WEBHOOK_URL`.

The Azure provisioner should:

- Create one VM per organisation and install the Wasup worker API under `/opt/whatsapp-ai`.
- Configure the VM with `WASUP_WORKER_SHARED_SECRET`, the org id, and the org base URL.
- Call `POST /api/internal/deployments/ready` with the VM public IP when PM2 and health checks pass.
- Let the control plane create the GoDaddy `A` record for `{orgSlug}.wasup.co`.
- Keep later instance creation on the same org VM; do not provision a second VM for the same org unless recovery is explicitly requested.
- Write `worker_events` and update `instances.provisioning_state`, `status`, `worker_namespace`, `worker_name`, and `worker_endpoint`.

## Organization Deletion

`DELETE /api/v3/orgs/:id` is owner/admin only. It releases all instance proxy leases, marks the org deployment as suspended, calls `AZURE_DEPROVISIONING_WEBHOOK_URL` when configured, and then deletes the Supabase organisation row. Because child records cascade from `organizations`, deployment, instance, API key, usage, and message rows are removed after the VM cleanup request succeeds.

The deprovisioning webhook receives the org id, actor id, Azure resource group, VM name, public IP, base URL, and FQDN. It should delete the org VM and associated Azure resources idempotently.

Keep the control plane separate from the legacy VM. Do not restart the production PM2 process for control-plane or docs changes.
