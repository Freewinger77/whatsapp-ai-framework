import { NextResponse } from 'next/server';
import { getOrgBillingSummary } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const url = new URL(req.url);
  const orgId = url.searchParams.get('orgId') || principal.orgId;
  if (orgId !== principal.orgId && principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const summary = await getOrgBillingSummary(orgId);
  const entitlement = await getCreateInstanceEntitlement(orgId, summary);

  return NextResponse.json({ success: true, billing: summary, entitlement });
}

async function getCreateInstanceEntitlement(orgId: string, summary: any) {
  const billingActive = ['active', 'trialing'].includes(summary.billing_status);
  if (billingActive) {
    const availableSlots = Number(summary.available_instance_slots ?? 0);
    return {
      allowed: availableSlots > 0,
      mode: 'billing',
      reason: availableSlots > 0 ? null : 'instance_limit_reached',
      availableSlots,
      paidInstanceLimit: Number(summary.paid_instance_limit ?? 0),
      activeInstanceCount: Number(summary.active_instance_count ?? 0),
      reservedInstanceCount: Number(summary.reserved_instance_count ?? 0),
      trialInstanceLimit: null,
      trialEndsAt: null
    };
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: org, error } = await supabase
    .from('organizations')
    .select('trial_started_at, trial_ends_at, trial_instance_limit')
    .eq('id', orgId)
    .single();

  if (error || !org) {
    throw new Error(error?.message || `Organization ${orgId} not found`);
  }

  const activeInstanceCount = Number(summary.active_instance_count ?? 0);
  const trialInstanceLimit = Number(org.trial_instance_limit ?? 1);
  const trialEndsAt = org.trial_ends_at as string | null;
  const trialExpired = !!trialEndsAt && new Date(trialEndsAt).getTime() < Date.now();
  const availableSlots = Math.max(trialInstanceLimit - activeInstanceCount, 0);

  return {
    allowed: !trialExpired && availableSlots > 0,
    mode: 'trial',
    reason: trialExpired ? 'trial_expired' : availableSlots > 0 ? null : 'trial_instance_limit_reached',
    availableSlots,
    paidInstanceLimit: Number(summary.paid_instance_limit ?? 0),
    activeInstanceCount,
    reservedInstanceCount: Number(summary.reserved_instance_count ?? 0),
    trialInstanceLimit,
    trialEndsAt: trialEndsAt || previewTrialEnd()
  };
}

function previewTrialEnd() {
  const days = Number(process.env.WASUP_TRIAL_DAYS || 14);
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
