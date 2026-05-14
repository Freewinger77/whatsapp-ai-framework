# Wasup v3 Control Plane

Next.js SaaS control plane for Wasup v3.

Recommended stack:

- Clerk for user login, organizations, invitations, and roles.
- Supabase Postgres: Wasup application data and provisioning state.
- Stripe Checkout + webhooks: per-instance entitlements and message credit metering.
- AKS: isolated worker pods that own WhatsApp sockets.
- Azure Key Vault + External Secrets: proxy credentials, worker service tokens, provider API keys.

This app is intentionally additive and not wired into the production VM yet.

## Local Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

The dashboard uses Clerk for identity. A small placeholder org fallback remains for local/bootstrap work before Clerk organizations are fully configured. API writes accept `X-Wasup-Admin-Token` only as a bootstrap fallback when configured.

The server-side Supabase service-role client performs control-plane writes. Do not expose the service-role key to browser code.

## First Milestone

1. Run the Supabase migration in `supabase/migrations`.
2. Configure Clerk and Supabase env vars.
3. Sign up as the first test user through the app.
4. Create org records through `POST /api/v3/orgs`.
5. Add Clerk org webhooks to mirror org/member changes into Supabase.
6. Run `npm run stripe:products` and configure `STRIPE_*` env vars.
7. Apply the billing migration in `supabase/migrations`.
8. Import current VM/regional instances as `legacy` workers.
9. Add the provisioner that creates AKS worker pods for new instances.

## Paid Provisioning

Provisioning is now entitlement-gated:

- `POST /api/v3/billing/checkout` creates a Stripe Checkout session.
- `/api/webhooks/stripe` syncs subscription quantity into `billing_entitlements`.
- `POST /api/v3/provision/instances` reserves one paid instance slot before writing desired state.
- `POST /api/internal/usage-events` records worker message/webhook usage and consumes credits.

See `../../docs/PAID_PROVISIONING.md` for Stripe product setup, webhook events, proxy allocation policy, and the Azure provisioner contract.
