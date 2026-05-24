# Wasup Paid Provisioning

This is the first production shape for charging per WhatsApp instance and only provisioning workers for organizations with paid capacity.

## Control Flow

1. Customer signs in through Clerk and has a Supabase `organizations` row.
2. The dashboard or platform backend calls `POST /api/v3/billing/checkout`.
3. Stripe Checkout sells a recurring instance seat price. Quantity equals paid WhatsApp instances.
4. Stripe sends subscription webhooks to `/api/webhooks/stripe`.
5. The control plane caches the Stripe subscription in `billing_entitlements`.
6. `POST /api/v3/provision/instances` calls `reserve_instance_entitlement`.
7. If the org has an active/trialing subscription and an unused paid slot, the instance row is created as `provisioning` / `desired`.
8. The Azure provisioner sees desired state, allocates a proxy, deploys the worker, and writes lifecycle events.
9. Workers report sent, received, seen, and webhook events to `POST /api/internal/usage-events`.

Stripe remains the billing source of truth. Supabase is the fast entitlement cache used by provisioning and usage APIs.

## Stripe Products

Create the default Stripe catalog from `apps/control-plane`:

```bash
STRIPE_SECRET_KEY=sk_live_... npm run stripe:products
```

The script creates:

- `Wasup WhatsApp Instance Seat`: recurring monthly price, one paid instance slot per quantity.
- `Wasup 1,000 Monthly Message Credits`: recurring monthly add-on, grants monthly included message credits per quantity.

Store the returned values in the control-plane environment:

```env
STRIPE_INSTANCE_PRICE_ID=price_...
STRIPE_MESSAGE_CREDIT_PRICE_ID=price_...
```

Required Stripe metadata:

- `wasupEntitlement=instance`
- `wasupInstanceSlots=1`
- `wasupEntitlement=message_credits`
- `wasupMessageCredits=1000`

## Environment

```env
WASUP_CONTROL_PLANE_URL=https://control.wasup.ai
WASUP_WORKER_SHARED_SECRET=<strong random value>
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

### Check Entitlement

`GET /api/v3/billing/entitlements?orgId=<uuid>`

Returns paid instance limit, active instance count, available slots, billing status, and message credit balance.

### Provision Instance

`POST /api/v3/provision/instances`

Provisioning now fails with HTTP `402` unless the org has an active/trialing entitlement with a free paid instance slot.

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

This change creates desired state only. The Azure provisioner still needs to:

- Watch `instances` where `provisioning_state='desired'`.
- Reserve or create a proxy for the instance.
- Create Key Vault secrets for proxy and webhook credentials.
- Deploy the WhatsApp worker to AKS or Container Apps.
- Write `worker_events` and update `instances.provisioning_state`, `status`, `worker_namespace`, `worker_name`, and `worker_endpoint`.

Keep the control plane separate from the legacy VM. Do not restart the production PM2 process for control-plane or docs changes.
