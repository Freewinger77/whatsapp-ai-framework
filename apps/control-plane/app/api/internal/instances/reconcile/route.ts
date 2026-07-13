import { NextResponse } from 'next/server';
import { reconcileQueuedWorkerInstances } from '../../../../../lib/org-deployments';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { checkWorkerHealth } from '../../../../../lib/worker-client';
import { syncAllReadyOrgWorkers } from '../../../../../lib/worker-instance-sync';

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: deployments, error } = await supabase
    .from('org_deployments')
    .select('id, org_id, status, health, base_url, public_ip, vm_name, azure_region, azure_resource_group')
    .eq('status', 'ready');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const deployment of deployments ?? []) {
    const health = await checkWorkerHealth({
      endpoint: deployment.base_url,
      publicIp: deployment.public_ip,
      sharedSecret: requiredSecret
    });

    if (!health.reachable) {
      const message = health.error || 'Worker health is not reachable.';
      await markProvisioningInstancesFailed(supabase, deployment, message);
      results.push({ id: deployment.id, ready: false, error: message });
      continue;
    }

    try {
      const workerReconcile = await reconcileQueuedWorkerInstances(deployment.org_id, deployment);
      results.push({ id: deployment.id, ready: true, workerReconcile });
    } catch (reconcileError) {
      const message = reconcileError instanceof Error ? reconcileError.message : String(reconcileError);
      await markProvisioningInstancesFailed(supabase, deployment, message);
      results.push({ id: deployment.id, ready: true, error: message });
    }
  }

  return NextResponse.json({ success: true, checked: results.length, results });
}

export async function PUT(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin() as any;
  const body = await req.json().catch(() => ({}));
  const results = await syncAllReadyOrgWorkers(supabase, {
    cleanupOrphanWorkers: body.cleanupOrphanWorkers ?? true,
    importOrphanWorkers: body.importOrphanWorkers ?? true,
    linkSuggestions: body.linkSuggestions
  });

  return NextResponse.json({ success: true, checked: results.length, results });
}

async function markProvisioningInstancesFailed(supabase: any, deployment: any, message: string) {
  const { data: instances } = await supabase
    .from('instances')
    .select('id, metadata')
    .eq('org_id', deployment.org_id)
    .or('status.eq.provisioning,provisioning_state.eq.desired')
    .is('deleted_at', null);

  for (const instance of instances ?? []) {
    const failedAt = new Date().toISOString();
    await supabase
      .from('instances')
      .update({
        status: 'error',
        provisioning_state: 'failed',
        metadata: {
          ...(instance.metadata || {}),
          deploymentId: deployment.id,
          deploymentStatus: deployment.status,
          last_error: message,
          lastWorkerReconcile: {
            attempted: true,
            reconciledAt: failedAt,
            error: message
          }
        },
        updated_at: failedAt
      })
      .eq('id', instance.id);

    await supabase.from('worker_events').insert({
      org_id: deployment.org_id,
      instance_id: instance.id,
      event_type: 'instance.worker_reconcile_failed',
      severity: 'error',
      summary: message,
      payload: { deploymentId: deployment.id }
    });
  }
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
