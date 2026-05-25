import { deleteGoDaddyARecord, upsertGoDaddyARecord } from './godaddy';
import { patchEntitlementMetadata, readEntitlementMetadata } from './billing-metadata';
import { getBillingGraceDays, getBillingInstanceDeletionDays } from './plan-access';
import { notifyOrgAdmins } from './notifications';
import { releaseProxyForInstance } from './proxy-pool';
import { getSupabaseAdmin } from './supabase-admin';

type BillingOrg = {
  id: string;
  slug: string;
  name: string;
  subdomain: string | null;
  status: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GRACE_STATUSES = new Set(['past_due', 'unpaid']);

export async function markBillingGraceStarted(orgId: string, graceDays = getBillingGraceDays()) {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date();
  const graceEnds = new Date(now.getTime() + graceDays * MS_PER_DAY).toISOString();

  await supabase
    .from('organizations')
    .update({
      status: 'billing_grace',
      updated_at: now.toISOString()
    })
    .eq('id', orgId);

  await patchEntitlementMetadata(orgId, {
    billing_grace_ends_at: graceEnds,
    billing_locked_at: null
  });

  const { data: org } = await supabase
    .from('organizations')
    .select('id, slug, name')
    .eq('id', orgId)
    .single();

  if (org) {
    await notifyOrgAdmins({
      orgId,
      eventType: 'billing.grace_started',
      subject: 'Payment failed — update billing within 14 days',
      text: `We couldn't renew Wasup Pro for ${org.name}. You have ${graceDays} days to update payment before instances are disconnected and your worker URL is disabled.`,
      html: `<p>We couldn't renew <strong>Wasup Pro</strong> for <strong>${org.name}</strong>.</p><p>You have <strong>${graceDays} days</strong> to update payment before instances are disconnected and your worker URL is disabled.</p>`,
      idempotencyKey: `billing-grace:${orgId}:${graceEnds.slice(0, 10)}`,
      metadata: { graceEndsAt: graceEnds }
    });
  }

  return { graceEndsAt: graceEnds };
}

export async function restoreOrgAfterBillingPayment(orgId: string) {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date().toISOString();

  const { data: org } = await supabase
    .from('organizations')
    .select('id, slug, subdomain, api_base_url')
    .eq('id', orgId)
    .single();

  if (!org) return { restored: false, reason: 'org_not_found' };

  const metadata = await readEntitlementMetadata(orgId);
  const wasLocked = Boolean(metadata.billing_locked_at);

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, status, public_ip, base_url')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (deployment?.public_ip) {
    const subdomain = org.subdomain || org.slug;
    try {
      await upsertGoDaddyARecord({ subdomain, value: deployment.public_ip });
    } catch (error) {
      console.error(`DNS restore failed for org ${orgId}:`, error);
    }
  }

  await supabase
    .from('organizations')
    .update({
      status: 'active',
      deployment_status: deployment?.status === 'ready' ? 'ready' : 'dns_pending',
      updated_at: now
    })
    .eq('id', orgId);

  await patchEntitlementMetadata(orgId, {
    billing_grace_ends_at: null,
    billing_locked_at: null,
    instances_delete_after: null,
    instances_deleted_at: null
  });

  if (wasLocked) {
    await supabase
      .from('instances')
      .update({
        status: 'disconnected',
        provisioning_state: 'provisioned',
        updated_at: now
      })
      .eq('org_id', orgId)
      .eq('provisioning_state', 'billing_suspended')
      .is('deleted_at', null);

    await supabase
      .from('org_deployments')
      .update({
        status: deployment?.public_ip ? 'ready' : 'suspended',
        updated_at: now
      })
      .eq('org_id', orgId)
      .eq('environment', 'production');
  }

  await notifyOrgAdmins({
    orgId,
    eventType: 'billing.restored',
    subject: 'Wasup Pro is active again',
    text: 'Your subscription is active. Reconnect your instances from the dashboard when you are ready.',
    html: '<p>Your <strong>Wasup Pro</strong> subscription is active again.</p><p>Reconnect your instances from the dashboard when you are ready.</p>',
    idempotencyKey: `billing-restored:${orgId}:${now.slice(0, 10)}`
  });

  return { restored: true };
}

export async function lockOrgForBillingFailure(org: BillingOrg) {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date();
  const subdomain = org.subdomain || org.slug;
  const deletionDays = getBillingInstanceDeletionDays();
  const instancesDeleteAfter = new Date(now.getTime() + deletionDays * MS_PER_DAY).toISOString();

  await supabase
    .from('organizations')
    .update({
      status: 'billing_locked',
      deployment_status: 'suspended',
      updated_at: now.toISOString()
    })
    .eq('id', org.id);

  await patchEntitlementMetadata(org.id, {
    billing_locked_at: now.toISOString(),
    instances_delete_after: instancesDeleteAfter
  });

  const { data: instances } = await supabase
    .from('instances')
    .update({
      status: 'suspended',
      provisioning_state: 'billing_suspended',
      updated_at: now.toISOString()
    })
    .eq('org_id', org.id)
    .is('deleted_at', null)
    .select('id');

  await supabase
    .from('org_deployments')
    .update({
      status: 'suspended',
      updated_at: now.toISOString()
    })
    .eq('org_id', org.id)
    .eq('environment', 'production');

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

  try {
    await deleteGoDaddyARecord(subdomain);
  } catch (error) {
    console.error(`DNS delink failed for org ${org.id}:`, error);
  }

  await supabase.from('worker_events').insert({
    org_id: org.id,
    event_type: 'billing.locked',
    severity: 'critical',
    summary: 'Billing grace expired; worker URL delinked and instances suspended.',
    payload: {
      instanceIds: (instances ?? []).map((instance: { id: string }) => instance.id),
      subdomain
    }
  });

  await notifyOrgAdmins({
    orgId: org.id,
    eventType: 'billing.locked',
    subject: 'Wasup Pro suspended — update payment to reconnect',
    text: `Payment for ${org.name} was not received during the grace period. Instances are disconnected and your worker URL is offline. Instances will be permanently deleted on ${new Date(instancesDeleteAfter).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} unless billing is restored.`,
    html: `<p>Payment for <strong>${org.name}</strong> was not received during the grace period.</p><p>Instances are disconnected and your worker URL is offline.</p><p>Instances will be permanently deleted on <strong>${new Date(instancesDeleteAfter).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong> unless billing is restored.</p>`,
    idempotencyKey: `billing-locked:${org.id}`,
    metadata: { subdomain, instancesDeleteAfter }
  });
}

export async function deleteOrgInstancesForBilling(org: BillingOrg) {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date().toISOString();
  const metadata = await readEntitlementMetadata(org.id);
  if (metadata.instances_deleted_at) {
    return { deleted: 0, skipped: true };
  }

  const { data: instances, error } = await supabase
    .from('instances')
    .select('id, name')
    .eq('org_id', org.id)
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  let deleted = 0;
  for (const instance of instances ?? []) {
    await releaseProxyForInstance(instance.id);
    await supabase
      .from('instances')
      .update({
        status: 'suspended',
        provisioning_state: 'billing_deleted',
        deleted_at: now,
        metadata: {
          billingAutoDeleted: true,
          deletedAt: now
        },
        updated_at: now
      })
      .eq('id', instance.id)
      .eq('org_id', org.id);
    deleted += 1;
  }

  if (deleted > 0) {
    await supabase.rpc('release_instance_entitlement', { p_org_id: org.id });
  }

  await patchEntitlementMetadata(org.id, {
    instances_deleted_at: now
  });

  await supabase.from('worker_events').insert({
    org_id: org.id,
    event_type: 'billing.instances_deleted',
    severity: 'critical',
    summary: `Billing suspension expired; ${deleted} instance${deleted === 1 ? '' : 's'} were permanently deleted.`,
    payload: {
      instanceIds: (instances ?? []).map((instance: { id: string }) => instance.id),
      deleted
    }
  });

  await notifyOrgAdmins({
    orgId: org.id,
    eventType: 'billing.instances_deleted',
    subject: 'Wasup instances deleted after billing suspension',
    text: `${deleted} WhatsApp instance${deleted === 1 ? '' : 's'} for ${org.name} were permanently deleted after the billing suspension period. Restore Wasup Pro to provision new instances.`,
    html: `<p><strong>${deleted}</strong> WhatsApp instance${deleted === 1 ? '' : 's'} for <strong>${org.name}</strong> were permanently deleted after the billing suspension period.</p><p>Restore Wasup Pro to provision new instances.</p>`,
    idempotencyKey: `billing-instances-deleted:${org.id}`,
    metadata: { deleted }
  });

  return { deleted, skipped: false };
}

export async function sweepBillingInstanceDeletion() {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date();

  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, slug, name, subdomain, status')
    .eq('status', 'billing_locked');

  if (error) throw new Error(error.message);

  const results = {
    checked: 0,
    deleted: 0,
    warnings: 0,
    errors: [] as Array<{ orgId: string; error: string }>
  };

  for (const org of orgs ?? []) {
    results.checked += 1;
    try {
      const metadata = await readEntitlementMetadata(org.id);
      if (metadata.instances_deleted_at) continue;

      const deleteAfter = metadata.instances_delete_after
        ? new Date(String(metadata.instances_delete_after))
        : null;
      if (!deleteAfter) continue;

      if (deleteAfter <= now) {
        const result = await deleteOrgInstancesForBilling(org as BillingOrg);
        results.deleted += result.deleted;
        continue;
      }

      const daysLeft = Math.ceil((deleteAfter.getTime() - now.getTime()) / MS_PER_DAY);
      if ([7, 3, 1, 0].includes(daysLeft)) {
        await notifyOrgAdmins({
          orgId: org.id,
          eventType: 'billing.instance_deletion_warning',
          subject:
            daysLeft === 0
              ? 'Wasup instances are scheduled for deletion today'
              : `Wasup instances will be deleted in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          text: `Update billing for ${org.name} to keep your WhatsApp instances. Automatic deletion is scheduled for ${deleteAfter.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.`,
          html: `<p>Update billing for <strong>${org.name}</strong> to keep your WhatsApp instances.</p><p>Automatic deletion is scheduled for <strong>${deleteAfter.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</strong>.</p>`,
          idempotencyKey: `billing-instance-delete-warning:${org.id}:${daysLeft}`
        });
        results.warnings += 1;
      }
    } catch (deleteError) {
      results.errors.push({
        orgId: org.id,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError)
      });
    }
  }

  return results;
}

export async function sweepBillingLifecycle() {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date();

  const { data: entitlements, error } = await supabase
    .from('billing_entitlements')
    .select('org_id, status')
    .in('status', Array.from(GRACE_STATUSES));

  if (error) throw new Error(error.message);

  const results = {
    checked: 0,
    locked: 0,
    warnings: 0,
    errors: [] as Array<{ orgId: string; error: string }>
  };

  for (const row of entitlements ?? []) {
    results.checked += 1;
    try {
      const { data: org } = await supabase
        .from('organizations')
        .select('id, slug, name, subdomain, status')
        .eq('id', row.org_id)
        .single();

      if (!org) continue;

      const metadata = await readEntitlementMetadata(org.id);
      if (metadata.billing_locked_at) continue;

      const graceEnds = metadata.billing_grace_ends_at ? new Date(String(metadata.billing_grace_ends_at)) : null;
      if (!graceEnds) {
        await markBillingGraceStarted(org.id);
        continue;
      }

      if (graceEnds <= now) {
        await lockOrgForBillingFailure(org as BillingOrg);
        results.locked += 1;
        continue;
      }

      const daysLeft = Math.ceil((graceEnds.getTime() - now.getTime()) / MS_PER_DAY);
      if ([7, 3, 1, 0].includes(daysLeft)) {
        await notifyOrgAdmins({
          orgId: org.id,
          eventType: 'billing.grace_warning',
          subject:
            daysLeft === 0
              ? 'Wasup Pro locks today unless payment is updated'
              : `Wasup Pro locks in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
          text: `Update billing for ${org.name} to keep your worker URL and instances available.`,
          html: `<p>Update billing for <strong>${org.name}</strong> to keep your worker URL and instances available.</p>`,
          idempotencyKey: `billing-grace-warning:${org.id}:${daysLeft}`
        });
        results.warnings += 1;
      }
    } catch (lockError) {
      results.errors.push({
        orgId: row.org_id,
        error: lockError instanceof Error ? lockError.message : String(lockError)
      });
    }
  }

  return results;
}
