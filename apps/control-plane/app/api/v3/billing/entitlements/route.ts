import { NextResponse } from 'next/server';
import { getOrgBillingSummary } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getOrgPlanAccess } from '../../../../../lib/plan-access';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const url = new URL(req.url);
  const orgId = url.searchParams.get('orgId') || principal.orgId;
  if (orgId !== principal.orgId && principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [summary, plan] = await Promise.all([getOrgBillingSummary(orgId), getOrgPlanAccess(orgId)]);

  return NextResponse.json({
    success: true,
    billing: summary,
    plan,
    entitlement: {
      allowed: plan.canCreateInstances,
      mode: plan.tier === 'pro' ? 'billing' : plan.tier === 'grace' ? 'grace' : 'free',
      reason: plan.canCreateInstances
        ? null
        : plan.tier === 'locked'
          ? 'billing_locked'
          : plan.tier === 'grace'
            ? 'billing_grace'
            : plan.tier === 'free'
              ? 'pro_subscription_required'
              : plan.availableInstanceSlots <= 0
                ? 'instance_limit_reached'
                : 'billing_inactive',
      availableSlots: plan.availableInstanceSlots,
      paidInstanceLimit: plan.paidInstanceLimit,
      activeInstanceCount: plan.activeInstanceCount,
      reservedInstanceCount: Number(summary.reserved_instance_count ?? 0),
      trialInstanceLimit: null,
      trialEndsAt: null
    }
  });
}
