import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { releasePaidInstanceSlot } from '../../../../../lib/billing';
import { deleteGoDaddyARecord } from '../../../../../lib/godaddy';
import { deprovisionOrgDeployment } from '../../../../../lib/org-deployments';
import { releaseProxyForInstance } from '../../../../../lib/proxy-pool';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { deleteWorkerInstance } from '../../../../../lib/worker-client';

const ResetSchema = z.object({
  confirmation: z.literal('DELETE')
});

type CleanupWarning = {
  step: string;
  targetId?: string;
  message: string;
};

type CleanupCount = {
  table: string;
  deleted: number | null;
};

export async function DELETE(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  if (principal.role !== 'owner') {
    return NextResponse.json({ error: 'Owner role required' }, { status: 403 });
  }

  const parsed = ResetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Confirmation required',
        message: 'Type DELETE to permanently reset this workspace and account.'
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name, clerk_org_id, subdomain')
    .eq('id', principal.orgId)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: orgError?.message || 'Organization not found' }, { status: 404 });
  }

  const { data: instances, error: instancesError } = await supabase
    .from('instances')
    .select('id, name, status, provisioning_state, worker_endpoint, metadata')
    .eq('org_id', principal.orgId)
    .is('deleted_at', null);

  if (instancesError) {
    return NextResponse.json({ error: instancesError.message }, { status: 500 });
  }

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', principal.orgId)
    .eq('environment', 'production')
    .maybeSingle();

  const warnings: CleanupWarning[] = [];
  const instanceResults = [];
  const workerSecret = process.env.WASUP_WORKER_SHARED_SECRET || null;

  for (const instance of instances ?? []) {
    const endpoint = instance.worker_endpoint || deployment?.base_url || null;
    const hasProvisionedWorkerState =
      instance.provisioning_state === 'provisioned' ||
      ['connected', 'connecting', 'disconnected'].includes(instance.status);

    let worker:
      | { attempted: true; result?: unknown; alreadyDeleted?: boolean }
      | { attempted: false; reason: string };

    if (endpoint && workerSecret && hasProvisionedWorkerState) {
      try {
        worker = await deleteWorkerInstance({
          endpoint,
          publicIp: deployment?.public_ip ?? null,
          sharedSecret: workerSecret,
          instanceId: instance.id
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        worker = { attempted: false, reason: 'worker_delete_failed' };
        warnings.push({ step: 'worker_instance_delete', targetId: instance.id, message });
      }
    } else {
      worker = {
        attempted: false,
        reason: hasProvisionedWorkerState
          ? !endpoint
            ? 'worker_endpoint_missing'
            : 'worker_secret_missing'
          : 'worker_not_provisioned'
      };
    }

    await releaseProxyForInstance(instance.id);
    await releasePaidInstanceSlot(principal.orgId).catch((error) => {
      warnings.push({
        step: 'billing_slot_release',
        targetId: instance.id,
        message: error instanceof Error ? error.message : String(error)
      });
    });

    const deletedAt = new Date().toISOString();
    const { error: instanceDeleteError } = await supabase
      .from('instances')
      .update({
        status: 'suspended',
        provisioning_state: 'deleted',
        deleted_at: deletedAt,
        metadata: {
          ...(instance.metadata || {}),
          last_error: null,
          customerReset: {
            requestedBy: principal.actorId,
            requestedAt: deletedAt,
            worker
          }
        },
        updated_at: deletedAt
      })
      .eq('id', instance.id)
      .eq('org_id', principal.orgId);

    if (instanceDeleteError) {
      return NextResponse.json({ error: instanceDeleteError.message }, { status: 500 });
    }

    instanceResults.push({ id: instance.id, worker });
  }

  let deprovisioning;
  try {
    deprovisioning = await deprovisionOrgDeployment(principal.orgId, principal.actorId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'VM deprovisioning failed' },
      { status: 502 }
    );
  }

  if (org.subdomain || org.slug) {
    try {
      await deleteGoDaddyARecord(org.subdomain || org.slug);
    } catch (error) {
      warnings.push({
        step: 'dns_delete',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const orgScopedRows = await deleteOrgScopedRows(supabase, principal.orgId, warnings);

  await supabase.from('audit_events').insert({
    org_id: principal.orgId,
    actor_clerk_user_id: principal.actorId,
    action: 'customer.reset_requested',
    target_type: 'organization',
    target_id: principal.orgId,
    metadata: {
      instancesDeleted: instanceResults.length,
      deprovisioning: sanitizeDeprovisioning(deprovisioning),
      orgScopedRows,
      warnings
    }
  });

  const { error: orgDeleteError } = await supabase
    .from('organizations')
    .delete()
    .eq('id', principal.orgId);

  if (orgDeleteError) {
    return NextResponse.json({ error: orgDeleteError.message }, { status: 500 });
  }

  const accountDeletion = await deleteClerkRecords({
    clerkOrgId: org.clerk_org_id,
    userId: principal.actorId
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({ step: 'clerk_account_delete', message });
    return {
      organizationDeleted: false,
      userDeleted: false,
      reason: 'clerk_delete_failed'
    };
  });

  return NextResponse.json({
    success: true,
    organization: { id: org.id, slug: org.slug, name: org.name },
    instancesDeleted: instanceResults.length,
    vmDeprovisioning: sanitizeDeprovisioning(deprovisioning),
    orgScopedRows,
    warnings,
    accountDeletion
  });
}

async function deleteOrgScopedRows(supabase: any, orgId: string, warnings: CleanupWarning[]): Promise<CleanupCount[]> {
  const tables = [
    'notification_events',
    'instance_messages',
    'handoff_numbers',
    'instance_profiles',
    'usage_events',
    'webhook_deliveries',
    'worker_events'
  ];
  const counts: CleanupCount[] = [];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table)
      .delete()
      .eq('org_id', orgId)
      .select('id');

    if (error) {
      warnings.push({ step: 'org_scoped_row_delete', targetId: table, message: error.message });
      counts.push({ table, deleted: null });
      continue;
    }

    counts.push({ table, deleted: Array.isArray(data) ? data.length : null });
  }

  return counts;
}

function sanitizeDeprovisioning(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const source = value as { requested?: unknown; reason?: unknown; deployment?: Record<string, unknown> };
  const deployment = source.deployment;

  return {
    requested: source.requested,
    reason: source.reason,
    deployment: deployment
      ? {
          id: deployment.id,
          status: deployment.status,
          azure_resource_group: deployment.azure_resource_group,
          azure_region: deployment.azure_region,
          vm_name: deployment.vm_name,
          public_ip: deployment.public_ip,
          fqdn: deployment.fqdn,
          base_url: deployment.base_url
        }
      : undefined
  };
}

async function deleteClerkRecords(input: { clerkOrgId: string | null; userId: string }) {
  if (!process.env.CLERK_SECRET_KEY) {
    return {
      organizationDeleted: false,
      userDeleted: false,
      reason: 'clerk_secret_not_configured'
    };
  }

  const clerk = await clerkClient();
  let organizationDeleted = false;

  if (input.clerkOrgId) {
    try {
      await clerk.organizations.deleteOrganization(input.clerkOrgId);
      organizationDeleted = true;
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : null;
      if (status !== 404) throw error;
    }
  }

  await clerk.users.deleteUser(input.userId);
  return { organizationDeleted, userDeleted: true };
}
