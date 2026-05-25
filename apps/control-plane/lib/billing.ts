import type Stripe from 'stripe';
import { getStripe } from './stripe';
import { getSupabaseAdmin } from './supabase-admin';
import { markBillingGraceStarted, restoreOrgAfterBillingPayment, lockOrgForBillingFailure } from './billing-lifecycle';
import { readEntitlementMetadata } from './billing-metadata';
import { getProInstanceLimit } from './plan-access';

export type EntitlementReservation =
  | { allowed: true; paidInstanceLimit: number; activeInstanceCount: number; reservedInstanceCount: number }
  | { allowed: false; reason: string; paidInstanceLimit?: number; activeInstanceCount?: number; reservedInstanceCount?: number };

const ACTIVE_BILLING_STATUSES = new Set(['active', 'trialing']);
const GRACE_BILLING_STATUSES = new Set(['past_due', 'unpaid']);
const LOCK_TRIGGER_STATUSES = new Set(['canceled', 'incomplete_expired']);

export async function getOrgBillingSummary(orgId: string) {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from('org_billing_summary')
    .select('*')
    .eq('org_id', orgId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function reservePaidInstanceSlot(orgId: string): Promise<EntitlementReservation> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.rpc('reserve_instance_entitlement', { p_org_id: orgId });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeReservation(data);
}

export async function releasePaidInstanceSlot(orgId: string) {
  const supabase = getSupabaseAdmin() as any;
  await supabase.rpc('release_instance_entitlement', { p_org_id: orgId });
}

export async function ensureStripeCustomerForOrg(orgId: string, contactEmail?: string | null) {
  const supabase = getSupabaseAdmin() as any;
  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, slug, name, billing_customer_id')
    .eq('id', orgId)
    .single();

  if (error || !org) {
    throw new Error(error?.message || `Organization ${orgId} not found`);
  }

  const stripe = getStripe();
  const normalizedEmail = contactEmail?.trim() || null;

  if (org.billing_customer_id) {
    if (normalizedEmail) {
      await stripe.customers.update(org.billing_customer_id, { email: normalizedEmail });
    }
    return org.billing_customer_id as string;
  }

  const customer = await stripe.customers.create({
    name: org.name,
    email: normalizedEmail || undefined,
    metadata: {
      wasupOrgId: org.id,
      wasupOrgSlug: org.slug
    }
  });

  await supabase
    .from('organizations')
    .update({ billing_customer_id: customer.id })
    .eq('id', org.id);

  return customer.id;
}

export async function syncStripeSubscription(subscriptionId: string) {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['customer', 'items.data.price.product']
  });
  const subscriptionRecord = subscription as any;

  const orgId = await resolveOrgIdForStripeSubscription(subscription);
  if (!orgId) {
    throw new Error(`Stripe subscription ${subscription.id} is missing wasupOrgId metadata`);
  }

  const entitlement = buildEntitlementFromSubscription(subscription as any);
  const customerId = getStripeCustomerId(subscription.customer);
  const supabase = getSupabaseAdmin() as any;

  if (ACTIVE_BILLING_STATUSES.has(entitlement.status)) {
    await restoreOrgAfterBillingPayment(orgId);
  } else if (GRACE_BILLING_STATUSES.has(entitlement.status)) {
    await markBillingGraceStarted(orgId);
  } else if (LOCK_TRIGGER_STATUSES.has(entitlement.status)) {
    const metadata = await readEntitlementMetadata(orgId);
    if (!metadata.billing_locked_at) {
      const { data: org } = await supabase
        .from('organizations')
        .select('id, slug, name, subdomain, status')
        .eq('id', orgId)
        .single();
      if (org) await lockOrgForBillingFailure(org);
    }
  }

  const entitlementMetadata = {
    ...entitlement.metadata,
    stripe_trial_end: subscription.trial_end ? toIso(subscription.trial_end) : null
  };

  await supabase
    .from('organizations')
    .update({
      billing_customer_id: customerId,
      plan: entitlement.planKey,
      status: ACTIVE_BILLING_STATUSES.has(entitlement.status)
        ? 'active'
        : GRACE_BILLING_STATUSES.has(entitlement.status)
          ? 'billing_grace'
          : 'billing_hold'
    })
    .eq('id', orgId);

  const { error } = await supabase
    .from('billing_entitlements')
    .upsert({
      org_id: orgId,
      provider: 'stripe',
      provider_customer_id: customerId,
      provider_subscription_id: subscription.id,
      status: entitlement.status,
      plan_key: entitlement.planKey,
      paid_instance_limit: entitlement.paidInstanceLimit,
      included_message_credits: entitlement.includedMessageCredits,
      current_period_start: toIso(subscriptionRecord.current_period_start),
      current_period_end: toIso(subscriptionRecord.current_period_end),
      cancel_at_period_end: !!subscription.cancel_at_period_end,
      metadata: entitlementMetadata,
      updated_at: new Date().toISOString()
    }, { onConflict: 'org_id' });

  if (error) {
    throw new Error(error.message);
  }

  return { orgId, entitlement };
}

export async function recordStripeEvent(event: Stripe.Event) {
  const supabase = getSupabaseAdmin() as any;
  const orgId = extractOrgIdFromStripeObject(event.data.object);
  const { error } = await supabase
    .from('billing_events')
    .insert({
      org_id: orgId,
      provider: 'stripe',
      provider_event_id: event.id,
      event_type: event.type,
      payload: event as any
    });

  if (error?.code === '23505') {
    return { duplicate: true };
  }

  if (error) {
    throw new Error(error.message);
  }

  return { duplicate: false };
}

export async function grantMessageCreditsFromCheckout(session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.wasupOrgId;
  const credits = Number(session.metadata?.wasupMessageCredits || 0);
  if (!orgId || !Number.isFinite(credits) || credits <= 0) {
    return;
  }

  const supabase = getSupabaseAdmin() as any;
  await supabase.from('credit_ledger_entries').insert({
    org_id: orgId,
    source: 'stripe',
    event_type: 'credits.granted',
    quantity: Math.floor(credits),
    idempotency_key: `stripe_checkout:${session.id}`,
    metadata: {
      checkoutSessionId: session.id,
      paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : null
    }
  });
}

async function resolveOrgIdForStripeSubscription(subscription: Stripe.Subscription) {
  const direct = subscription.metadata?.wasupOrgId;
  if (direct) return direct;

  const customer = subscription.customer;
  if (typeof customer !== 'string' && customer && !customer.deleted) {
    const orgId = customer.metadata?.wasupOrgId;
    if (orgId) return orgId;
  }

  const customerId = getStripeCustomerId(customer);
  if (!customerId) return null;

  const supabase = getSupabaseAdmin() as any;
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('billing_customer_id', customerId)
    .single();

  return data?.id ?? null;
}

function buildEntitlementFromSubscription(subscription: Stripe.Subscription) {
  let paidInstanceLimit = 0;
  let includedMessageCredits = 0;
  let planKey = subscription.metadata?.wasupPlanKey || 'starter';
  const items = subscription.items?.data ?? [];

  for (const item of items) {
    const quantity = item.quantity || 1;
    const price = item.price;
    const product = typeof price.product === 'string' ? null : price.product;
    const metadata = {
      ...(product && !product.deleted ? product.metadata : {}),
      ...price.metadata
    };
    const entitlement = metadata.wasupEntitlement || metadata.wasup_entitlement;

    if (metadata.wasupPlanKey || metadata.wasup_plan_key) {
      planKey = metadata.wasupPlanKey || metadata.wasup_plan_key;
    }

    if (entitlement === 'instance') {
      paidInstanceLimit += quantity * numberMetadata(metadata.wasupInstanceSlots || metadata.wasup_instance_slots, 1);
    }

    if (entitlement === 'message_credits') {
      includedMessageCredits += quantity * numberMetadata(metadata.wasupMessageCredits || metadata.wasup_message_credits, 0);
    }
  }

  if (ACTIVE_BILLING_STATUSES.has(subscription.status)) {
    paidInstanceLimit = getProInstanceLimit();
    planKey = 'pro';
  }

  return {
    status: subscription.status,
    planKey,
    paidInstanceLimit,
    includedMessageCredits,
    metadata: {
      stripePriceIds: items.map((item) => item.price.id),
      stripeProductIds: items.map((item) => typeof item.price.product === 'string' ? item.price.product : item.price.product.id)
    }
  };
}

function normalizeReservation(value: any): EntitlementReservation {
  if (value?.allowed) {
    return {
      allowed: true,
      paidInstanceLimit: Number(value.paidInstanceLimit ?? 0),
      activeInstanceCount: Number(value.activeInstanceCount ?? 0),
      reservedInstanceCount: Number(value.reservedInstanceCount ?? 0)
    };
  }

  return {
    allowed: false,
    reason: String(value?.reason || 'entitlement_check_failed'),
    paidInstanceLimit: value?.paidInstanceLimit === undefined ? undefined : Number(value.paidInstanceLimit),
    activeInstanceCount: value?.activeInstanceCount === undefined ? undefined : Number(value.activeInstanceCount),
    reservedInstanceCount: value?.reservedInstanceCount === undefined ? undefined : Number(value.reservedInstanceCount)
  };
}

function extractOrgIdFromStripeObject(value: any) {
  return value?.metadata?.wasupOrgId || null;
}

function getStripeCustomerId(customer: unknown) {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : (customer as { id?: string }).id ?? null;
}

function numberMetadata(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIso(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}
