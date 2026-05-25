import { getSupabaseAdmin } from './supabase-admin';

export type PlanTier = 'free' | 'pro' | 'grace' | 'locked';

export type OrgPlanAccess = {
  tier: PlanTier;
  isPro: boolean;
  canCreateInstances: boolean;
  canViewCredentials: boolean;
  proInstanceLimit: number;
  billingStatus: string | null;
  billingGraceEndsAt: string | null;
  billingLockedAt: string | null;
  trialEndsAt: string | null;
  instancesDeleteAfter: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activeInstanceCount: number;
  paidInstanceLimit: number;
  availableInstanceSlots: number;
};

const PRO_BILLING_STATUSES = new Set(['active', 'trialing']);
const GRACE_BILLING_STATUSES = new Set(['past_due', 'unpaid']);

export function getProInstanceLimit() {
  return Number(process.env.WASUP_PRO_INSTANCE_LIMIT || 5);
}

export function getBillingGraceDays() {
  return Number(process.env.WASUP_BILLING_GRACE_DAYS || 14);
}

export function getBillingInstanceDeletionDays() {
  return Number(process.env.WASUP_BILLING_INSTANCE_DELETION_DAYS || 30);
}

export async function getOrgPlanAccess(orgId: string): Promise<OrgPlanAccess> {
  const supabase = getSupabaseAdmin() as any;
  const proLimit = getProInstanceLimit();

  const [{ data: org }, { data: entitlement }, { data: summary }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, status')
      .eq('id', orgId)
      .single(),
    supabase
      .from('billing_entitlements')
      .select('status, paid_instance_limit, current_period_end, cancel_at_period_end, metadata')
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase.from('org_billing_summary').select('*').eq('org_id', orgId).maybeSingle()
  ]);

  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }

  const entitlementMetadata = (entitlement?.metadata ?? {}) as Record<string, unknown>;
  const billingStatus = (entitlement?.status as string | undefined) ?? null;
  const billingGraceEndsAt =
    (entitlementMetadata.billing_grace_ends_at as string | undefined) ??
    (entitlementMetadata.billingGraceEndsAt as string | undefined) ??
    null;
  const billingLockedAt =
    (entitlementMetadata.billing_locked_at as string | undefined) ??
    (entitlementMetadata.billingLockedAt as string | undefined) ??
    null;
  const trialEndsAt =
    billingStatus === 'trialing'
      ? ((entitlementMetadata.stripe_trial_end as string | undefined) ??
        (entitlement?.current_period_end as string | undefined) ??
        null)
      : null;
  const instancesDeleteAfter =
    (entitlementMetadata.instances_delete_after as string | undefined) ??
    (entitlementMetadata.instancesDeleteAfter as string | undefined) ??
    null;
  const activeInstanceCount = Number(summary?.active_instance_count ?? 0);
  const paidInstanceLimit = Math.min(Number(entitlement?.paid_instance_limit ?? 0), proLimit);
  const availableInstanceSlots = Math.max(paidInstanceLimit - activeInstanceCount, 0);
  const now = Date.now();
  const graceActive =
    Boolean(billingGraceEndsAt) &&
    !billingLockedAt &&
    new Date(billingGraceEndsAt as string).getTime() > now;

  let tier: PlanTier = 'free';
  if (billingLockedAt || org.status === 'billing_locked') {
    tier = 'locked';
  } else if (graceActive || (billingStatus && GRACE_BILLING_STATUSES.has(billingStatus))) {
    tier = 'grace';
  } else if (billingStatus && PRO_BILLING_STATUSES.has(billingStatus) && paidInstanceLimit > 0) {
    tier = 'pro';
  }

  const isPro = tier === 'pro' || tier === 'grace';
  const canCreateInstances = tier === 'pro' && availableInstanceSlots > 0;
  const canViewCredentials = tier === 'pro' || tier === 'grace';

  return {
    tier,
    isPro,
    canCreateInstances,
    canViewCredentials,
    proInstanceLimit: proLimit,
    billingStatus,
    billingGraceEndsAt,
    billingLockedAt,
    trialEndsAt,
    instancesDeleteAfter,
    currentPeriodEnd: (entitlement?.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(entitlement?.cancel_at_period_end),
    activeInstanceCount,
    paidInstanceLimit,
    availableInstanceSlots
  };
}
