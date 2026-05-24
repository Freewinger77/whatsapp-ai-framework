import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { releasePaidInstanceSlot } from '../../../../../lib/billing';
import { releaseProxyForInstance } from '../../../../../lib/proxy-pool';
import { recordAppNotification } from '../../../../../lib/notifications';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { deleteWorkerInstance, getWorkerInstance, updateWorkerInstance } from '../../../../../lib/worker-client';

const UpdateInstanceSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  webhookUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
  webhookSigningSecret: z.string().max(256).nullable().optional()
});
import { mapWorkerInstanceStatus, workerPhoneFromResult, workerStatusFromResult } from '../../../../../lib/worker-instance-state';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(_req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;

  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from('instances')
    .select(`
      *,
      proxy_allocations(id, region_code, host, port, source, status, assigned_at),
      instance_profiles(display_name, about, picture_url, picture_status)
    `)
    .eq('org_id', principal.orgId)
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const synced = await syncTransientInstanceFromWorker(supabase, principal.orgId, data);
  return NextResponse.json({ success: true, instance: synced ?? data });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const parsed = UpdateInstanceSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const body = parsed.data;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.webhookUrl !== undefined) updates.webhook_url = body.webhookUrl || null;
  if (body.webhookSigningSecret !== undefined) {
    updates.webhook_secret_ref = body.webhookSigningSecret?.trim() ? 'configured-on-worker' : null;
  }

  const { data, error } = await supabase
    .from('instances')
    .update(updates)
    .eq('id', id)
    .eq('org_id', principal.orgId)
    .select(`
      *,
      proxy_allocations(id, region_code, host, port, source, status, assigned_at),
      instance_profiles(display_name, about, picture_url, picture_status)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let worker: unknown = null;
  const workerBody: Record<string, unknown> = {};
  if (body.name !== undefined) workerBody.name = body.name;
  if (body.webhookUrl !== undefined) workerBody.webhookUrl = body.webhookUrl || '';
  if (body.webhookSigningSecret !== undefined) workerBody.webhookSigningSecret = body.webhookSigningSecret?.trim() || '';

  if (Object.keys(workerBody).length && target.endpoint && process.env.WASUP_WORKER_SHARED_SECRET) {
    try {
      worker = await updateWorkerInstance({
        endpoint: target.endpoint,
        publicIp: target.deployment?.public_ip ?? null,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
        instanceId: id
      }, workerBody);
    } catch (workerError) {
      return NextResponse.json(
        {
          error: workerError instanceof Error ? workerError.message : String(workerError),
          instance: data
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ success: true, instance: data, worker });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;

  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  const instance = target.instance;

  if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });

  const workerSecret = process.env.WASUP_WORKER_SHARED_SECRET || null;
  const hasProvisionedWorkerState =
    instance.provisioning_state === 'provisioned' ||
    ['connected', 'connecting', 'disconnected'].includes(instance.status);
  let worker:
    | { attempted: true; result?: unknown; alreadyDeleted?: boolean }
    | { attempted: false; reason: string }
    | null = null;

  if (target.endpoint && workerSecret && hasProvisionedWorkerState) {
    try {
      worker = await deleteWorkerInstance({
        endpoint: target.endpoint,
        publicIp: target.deployment?.public_ip ?? null,
        sharedSecret: workerSecret,
        instanceId: id
      });
    } catch (workerError) {
      const message = workerError instanceof Error ? workerError.message : String(workerError);
      await recordDeletionFailure(supabase, {
        orgId: principal.orgId,
        instanceId: id,
        metadata: instance.metadata,
        instanceName: instance.name,
        message,
        deploymentId: target.deployment?.id ?? null
      });
      return NextResponse.json(
        {
          error: message,
          message: 'The worker instance could not be deleted. Control-plane state and proxy allocation were left intact.'
        },
        { status: 502 }
      );
    }
  } else if (hasProvisionedWorkerState) {
    const message = !target.endpoint
      ? 'Worker endpoint is missing for a provisioned instance.'
      : 'Worker shared secret is not configured.';
    await recordDeletionFailure(supabase, {
      orgId: principal.orgId,
      instanceId: id,
      metadata: instance.metadata,
      instanceName: instance.name,
      message,
      deploymentId: target.deployment?.id ?? null
    });
    return NextResponse.json(
      {
        error: message,
        message: 'The worker instance could not be deleted. Control-plane state and proxy allocation were left intact.'
      },
      { status: 409 }
    );
  } else {
    worker = { attempted: false, reason: 'worker_not_provisioned' };
  }

  await releaseProxyForInstance(id);
  await releasePaidInstanceSlot(principal.orgId);

  const { error } = await supabase
    .from('instances')
    .update({
      status: 'suspended',
      provisioning_state: 'deleted',
      deleted_at: new Date().toISOString(),
      metadata: {
        ...(instance.metadata || {}),
        last_error: null,
        lastDeleteAttempt: {
          status: 'deleted',
          attemptedAt: new Date().toISOString(),
          worker
        }
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('org_id', principal.orgId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('worker_events').insert({
    org_id: principal.orgId,
    instance_id: id,
    event_type: 'instance.deleted',
    severity: 'warning',
    summary: worker?.attempted
      ? 'Instance deleted on worker and proxy lease released.'
      : 'Queued instance deleted before worker provisioning; proxy lease released.',
    payload: {
      deploymentId: target.deployment?.id ?? null,
      worker
    }
  });

  await recordAppNotification({
    orgId: principal.orgId,
    eventType: 'instance.deleted',
    kind: 'instance',
    severity: 'success',
    title: 'Instance deleted',
    body: `${instance.name || 'Instance'} was deleted successfully.`,
    idempotencyKey: `in-app:instance-deleted:${id}`,
    metadata: {
      instanceId: id,
      instanceName: instance.name ?? null,
      deploymentId: target.deployment?.id ?? null,
      workerCleanup: worker?.attempted ? 'completed' : 'not_needed'
    }
  });

  return NextResponse.json({ success: true, worker });
}

async function loadWorkerTarget(supabase: any, orgId: string, instanceId: string) {
  const { data: instance } = await supabase
    .from('instances')
    .select('id, org_id, name, status, provisioning_state, worker_endpoint, metadata')
    .eq('org_id', orgId)
    .eq('id', instanceId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!instance) return { instance: null, deployment: null, endpoint: null };

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  return {
    instance,
    deployment,
    endpoint: instance.worker_endpoint || deployment?.base_url || null
  };
}

async function syncTransientInstanceFromWorker(supabase: any, orgId: string, instance: any) {
  const shouldSync =
    ['provisioning', 'connecting'].includes(instance.status) ||
    instance.provisioning_state === 'desired' ||
    (instance.status === 'connected' && !instance.phone);

  if (!shouldSync) {
    return null;
  }

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  const endpoint = instance.worker_endpoint || deployment?.base_url || null;
  if (!endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) return null;

  try {
    const worker = await getWorkerInstance({
      endpoint,
      publicIp: deployment?.public_ip ?? null,
      sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
      instanceId: instance.id
    });

    if (!worker.found) return null;

    const workerStatus = workerStatusFromResult(worker.result);
    const status = mapWorkerInstanceStatus(workerStatus);
    const phone = status === 'connected' ? workerPhoneFromResult(worker.result) : null;
    const syncedAt = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status,
      provisioning_state: 'provisioned',
      metadata: {
        ...(instance.metadata || {}),
        last_error: null,
        lastWorkerStatusSync: {
          status: workerStatus,
          syncedAt,
          phoneSynced: Boolean(phone)
        }
      },
      updated_at: syncedAt
    };

    if (phone) updatePayload.phone = phone;

    const { data: updated } = await supabase
      .from('instances')
      .update(updatePayload)
      .eq('id', instance.id)
      .eq('org_id', orgId)
      .select(`
        *,
        proxy_allocations(id, region_code, host, port, source, status, assigned_at),
        instance_profiles(display_name, about, picture_url, picture_status)
      `)
      .single();

    return updated ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from('instances')
      .update({
        metadata: {
          ...(instance.metadata || {}),
          last_error: message,
          lastWorkerStatusSync: {
            status: 'failed',
            syncedAt: new Date().toISOString(),
            error: message
          }
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', instance.id)
      .eq('org_id', orgId);
    return null;
  }
}

async function recordDeletionFailure(
  supabase: any,
  input: {
    orgId: string;
    instanceId: string;
    metadata: Record<string, unknown> | null;
    instanceName?: string | null;
    message: string;
    deploymentId: string | null;
  }
) {
  const attemptedAt = new Date().toISOString();
  await supabase
    .from('instances')
    .update({
      metadata: {
        ...(input.metadata || {}),
        last_error: input.message,
        lastDeleteAttempt: {
          status: 'failed',
          attemptedAt,
          error: input.message
        }
      },
      updated_at: attemptedAt
    })
    .eq('id', input.instanceId)
    .eq('org_id', input.orgId);

  await supabase.from('worker_events').insert({
    org_id: input.orgId,
    instance_id: input.instanceId,
    event_type: 'instance.delete_failed',
    severity: 'error',
    summary: input.message,
    payload: { deploymentId: input.deploymentId }
  });

  await recordAppNotification({
    orgId: input.orgId,
    eventType: 'instance.delete_failed',
    kind: 'instance',
    severity: 'error',
    title: 'Instance deletion failed',
    body: input.message,
    idempotencyKey: `in-app:instance-delete-failed:${input.instanceId}`,
    metadata: {
      instanceId: input.instanceId,
      instanceName: input.instanceName ?? null,
      deploymentId: input.deploymentId
    },
    error: input.message
  });
}
