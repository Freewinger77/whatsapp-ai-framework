import { deprovisionOrgDeployment } from './org-deployments';
import { getProMonthlyPriceLabel } from './billing-pricing';
import { getServerEnv } from './env';
import { notifyOrgAdmins } from './notifications';
import { getSupabaseAdmin } from './supabase-admin';

type TrialOrg = {
  id: string;
  slug: string;
  name: string;
  trial_ends_at: string | null;
  trial_locked_at: string | null;
  vm_delete_after: string | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function sweepTrialLifecycle() {
  const env = getServerEnv();
  const supabase = getSupabaseAdmin() as any;
  const now = new Date();
  const warningDays = parseWarningDays(env.WASUP_TRIAL_WARNING_DAYS);

  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, slug, name, trial_ends_at, trial_locked_at, vm_delete_after')
    .not('trial_ends_at', 'is', null);

  if (error) throw new Error(error.message);

  const results = {
    checked: 0,
    warned: 0,
    locked: 0,
    vmDeletionWarned: 0,
    deprovisionRequested: 0,
    skippedPaid: 0,
    errors: [] as Array<{ orgId: string; error: string }>
  };

  for (const org of (orgs ?? []) as TrialOrg[]) {
    results.checked += 1;
    try {
      if (await hasActiveBilling(org.id)) {
        results.skippedPaid += 1;
        continue;
      }

      const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
      if (!trialEndsAt) continue;

      if (trialEndsAt > now) {
        results.warned += await sendDueTrialWarnings(org, trialEndsAt, now, warningDays);
        continue;
      }

      if (!org.trial_locked_at) {
        await lockExpiredTrialOrg(org, now, env.WASUP_TRIAL_DELETION_GRACE_DAYS);
        results.locked += 1;
        continue;
      }

      const vmDeleteAfter = org.vm_delete_after ? new Date(org.vm_delete_after) : null;
      if (!vmDeleteAfter) continue;

      if (vmDeleteAfter > now) {
        results.vmDeletionWarned += await sendDueVmDeletionWarnings(org, vmDeleteAfter, now, warningDays);
        continue;
      }

      await deprovisionOrgDeployment(org.id, 'trial-lifecycle-sweeper');
      await notifyOrgAdmins({
        orgId: org.id,
        eventType: 'trial.vm_deleted',
        subject: 'Your Wasup trial VM deletion has started',
        text: `The grace period for ${org.name} has ended, so Wasup has started deleting the trial VM. Upgrade from the billing page to provision a new worker.`,
        html: `<p>The grace period for <strong>${org.name}</strong> has ended, so Wasup has started deleting the trial VM.</p><p>Upgrade from the billing page to provision a new worker.</p>`,
        idempotencyKey: `trial-vm-deleted:${org.id}`,
        metadata: { orgSlug: org.slug, vmDeleteAfter: org.vm_delete_after }
      });
      results.deprovisionRequested += 1;
    } catch (error) {
      results.errors.push({
        orgId: org.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

async function hasActiveBilling(orgId: string) {
  const { data, error } = await (getSupabaseAdmin() as any)
    .from('billing_entitlements')
    .select('status, paid_instance_limit')
    .eq('org_id', orgId)
    .in('status', ['trialing', 'active'])
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length && Number(data[0].paid_instance_limit || 0) > 0);
}

async function sendDueTrialWarnings(org: TrialOrg, trialEndsAt: Date, now: Date, warningDays: number[]) {
  let sent = 0;
  for (const days of warningDays) {
    const diffDays = Math.ceil((trialEndsAt.getTime() - now.getTime()) / MS_PER_DAY);
    if (diffDays !== days) continue;

    await notifyOrgAdmins({
      orgId: org.id,
      eventType: 'trial.warning',
      subject: days === 0 ? 'Your Wasup free trial ends today' : `Your Wasup free trial ends in ${days} day${days === 1 ? '' : 's'}`,
      text: `Your Wasup trial for ${org.name} ends ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}. Upgrade to keep your instances connected for ${getProMonthlyPriceLabel()}/month.`,
      html: `<p>Your Wasup trial for <strong>${org.name}</strong> ends ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}.</p><p>Upgrade to keep your instances connected for ${getProMonthlyPriceLabel()}/month.</p>`,
      idempotencyKey: `trial-warning:${org.id}:${days}`,
      metadata: { orgSlug: org.slug, trialEndsAt: org.trial_ends_at, daysRemaining: days }
    });
    sent += 1;
  }
  return sent;
}

async function sendDueVmDeletionWarnings(org: TrialOrg, vmDeleteAfter: Date, now: Date, warningDays: number[]) {
  let sent = 0;
  for (const days of warningDays) {
    const diffDays = Math.ceil((vmDeleteAfter.getTime() - now.getTime()) / MS_PER_DAY);
    if (diffDays !== days) continue;

    await notifyOrgAdmins({
      orgId: org.id,
      eventType: 'trial.vm_deletion_warning',
      subject: days === 0 ? 'Your Wasup trial VM is scheduled for deletion today' : `Your Wasup trial VM will be deleted in ${days} day${days === 1 ? '' : 's'}`,
      text: `Your Wasup trial for ${org.name} expired and instances are locked. The trial VM will be deleted ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}. Upgrade now to keep the workspace.`,
      html: `<p>Your Wasup trial for <strong>${org.name}</strong> expired and instances are locked.</p><p>The trial VM will be deleted ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`} unless you upgrade.</p>`,
      idempotencyKey: `trial-vm-delete-warning:${org.id}:${days}`,
      metadata: { orgSlug: org.slug, vmDeleteAfter: org.vm_delete_after, daysRemaining: days }
    });
    sent += 1;
  }
  return sent;
}

async function lockExpiredTrialOrg(org: TrialOrg, now: Date, graceDays: number) {
  const supabase = getSupabaseAdmin() as any;
  const vmDeleteAfter = new Date(now.getTime() + graceDays * MS_PER_DAY).toISOString();

  await supabase
    .from('organizations')
    .update({
      status: 'trial_expired',
      deployment_status: 'suspended',
      trial_locked_at: now.toISOString(),
      vm_delete_after: vmDeleteAfter,
      updated_at: now.toISOString()
    })
    .eq('id', org.id);

  const { data: instances, error: instanceError } = await supabase
    .from('instances')
    .update({
      status: 'suspended',
      provisioning_state: 'trial_suspended',
      updated_at: now.toISOString()
    })
    .eq('org_id', org.id)
    .is('deleted_at', null)
    .select('id');

  if (instanceError) throw new Error(instanceError.message);

  await supabase
    .from('proxy_allocations')
    .update({
      org_id: null,
      instance_id: null,
      status: 'free',
      released_at: now.toISOString(),
      assigned_by: null,
      updated_at: now.toISOString()
    })
    .eq('org_id', org.id)
    .eq('status', 'assigned');

  await supabase.from('worker_events').insert({
    org_id: org.id,
    event_type: 'trial.locked',
    severity: 'warning',
    summary: 'Free trial expired; instances were locked and proxies were released.',
    payload: {
      instanceIds: (instances ?? []).map((instance: { id: string }) => instance.id),
      vmDeleteAfter
    }
  });

  await notifyOrgAdmins({
    orgId: org.id,
    eventType: 'trial.locked',
    subject: 'Your Wasup free trial has ended',
    text: `Your 14-day Wasup trial for ${org.name} has ended. Instances are now locked and the VM is scheduled for deletion in ${graceDays} days unless you upgrade.`,
    html: `<p>Your 14-day Wasup trial for <strong>${org.name}</strong> has ended.</p><p>Instances are now locked and the VM is scheduled for deletion in ${graceDays} days unless you upgrade.</p>`,
    idempotencyKey: `trial-locked:${org.id}`,
    metadata: { orgSlug: org.slug, vmDeleteAfter, graceDays }
  });
}

function parseWarningDays(value: string) {
  const parsed = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((days) => Number.isInteger(days) && days >= 0);
  return parsed.length ? parsed : [7, 1, 0];
}
