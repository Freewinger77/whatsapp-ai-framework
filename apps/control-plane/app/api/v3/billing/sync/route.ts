import { NextResponse } from 'next/server';
import { z } from 'zod';
import { syncStripeSubscription } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getStripe } from '../../../../../lib/stripe';
import { getOrgPlanAccess } from '../../../../../lib/plan-access';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const SyncSchema = z.object({
  orgId: z.string().uuid().optional(),
  checkoutSessionId: z.string().optional()
});

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = SyncSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = parsed.data.orgId || principal.orgId;
  if (orgId !== principal.orgId && principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const stripe = getStripe();
  let subscriptionId: string | null = null;

  if (parsed.data.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(parsed.data.checkoutSessionId);
    if (session.client_reference_id && session.client_reference_id !== orgId) {
      return NextResponse.json({ error: 'Checkout session does not belong to this workspace' }, { status: 403 });
    }
    if (session.metadata?.wasupOrgId && session.metadata.wasupOrgId !== orgId) {
      return NextResponse.json({ error: 'Checkout session does not belong to this workspace' }, { status: 403 });
    }
    subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
  }

  if (!subscriptionId) {
    const supabase = getSupabaseAdmin() as any;
    const { data: org } = await supabase
      .from('organizations')
      .select('billing_customer_id')
      .eq('id', orgId)
      .single();

    const customerId = org?.billing_customer_id as string | undefined;
    if (customerId) {
      const customerSubs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 5 });
      const active = customerSubs.data.find((sub) => sub.status === 'active' || sub.status === 'trialing');
      subscriptionId = active?.id ?? customerSubs.data[0]?.id ?? null;
    }
  }

  if (!subscriptionId) {
    return NextResponse.json({ error: 'No Stripe subscription found for this workspace yet' }, { status: 404 });
  }

  await syncStripeSubscription(subscriptionId);
  const plan = await getOrgPlanAccess(orgId);

  return NextResponse.json({ success: true, subscriptionId, plan });
}
