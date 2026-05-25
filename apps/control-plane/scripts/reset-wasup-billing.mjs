#!/usr/bin/env node
/**
 * Reset Wasup Pro billing state for dev/testing.
 * Cancels Wasup-tagged Stripe subscriptions, clears entitlements, and resets org plan.
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: entitlements, error } = await supabase.from('billing_entitlements').select('*');
  if (error) throw new Error(error.message);

  const orgIds = new Set((entitlements ?? []).map((row) => row.org_id));
  const { data: proOrgs } = await supabase
    .from('organizations')
    .select('id, slug, billing_customer_id, plan')
    .eq('plan', 'pro');

  for (const org of proOrgs ?? []) orgIds.add(org.id);

  console.log(`Resetting billing for ${orgIds.size} workspace(s)...`);

  for (const orgId of orgIds) {
    const entitlement = (entitlements ?? []).find((row) => row.org_id === orgId);
    const { data: org } = await supabase
      .from('organizations')
      .select('id, slug, billing_customer_id')
      .eq('id', orgId)
      .single();

    if (!org) continue;
    console.log(`\n→ ${org.slug} (${org.id})`);

    const subscriptionId = entitlement?.provider_subscription_id;
    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        if (sub.status !== 'canceled') {
          await stripe.subscriptions.cancel(subscriptionId);
          console.log('  cancelled subscription', subscriptionId);
        }
      } catch (err) {
        console.log('  subscription cancel skipped:', err instanceof Error ? err.message : err);
      }
    }

    const customerId = entitlement?.provider_customer_id || org.billing_customer_id;
    if (customerId) {
      try {
        const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
        for (const sub of subs.data) {
          if (sub.status === 'canceled') continue;
          const isWasup =
            sub.metadata?.wasupOrgId === orgId ||
            sub.metadata?.organizationId === orgId ||
            entitlement?.provider_subscription_id === sub.id;
          if (!isWasup) continue;
          await stripe.subscriptions.cancel(sub.id);
          console.log('  cancelled linked subscription', sub.id);
        }
      } catch (err) {
        console.log('  subscription sweep skipped:', err instanceof Error ? err.message : err);
      }

      try {
        await stripe.customers.del(customerId);
        console.log('  deleted stripe customer', customerId);
      } catch (err) {
        console.log('  customer delete skipped:', err instanceof Error ? err.message : err);
      }
    }

    await supabase.from('billing_events').delete().eq('org_id', orgId);
    await supabase.from('billing_entitlements').delete().eq('org_id', orgId);
    await supabase
      .from('organizations')
      .update({ plan: 'starter', status: 'active', billing_customer_id: null })
      .eq('id', orgId);

    console.log('  cleared entitlements + reset org to starter');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
