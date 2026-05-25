import { NextResponse } from 'next/server';
import { standardizeWorkerRuntime } from '../../../../../lib/azure-vm-provisioner';
import { getServerEnv } from '../../../../../lib/env';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { checkWorkerSurfaceMarkers } from '../../../../../lib/worker-surface';

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const force = Boolean((body as { force?: boolean }).force);
  const orgId = typeof (body as { orgId?: string }).orgId === 'string' ? (body as { orgId: string }).orgId : null;

  const supabase = getSupabaseAdmin() as any;
  let query = supabase
    .from('org_deployments')
    .select('id, org_id, azure_resource_group, vm_name, base_url, status')
    .eq('status', 'ready');

  if (orgId) query = query.eq('org_id', orgId);

  const { data: deployments, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const env = getServerEnv();
  const results = [];

  for (const deployment of deployments ?? []) {
    if (!deployment.azure_resource_group || !deployment.vm_name) {
      results.push({ orgId: deployment.org_id, skipped: true, reason: 'missing_azure_metadata' });
      continue;
    }

    const surface = await checkWorkerSurfaceMarkers(deployment.base_url);
    if (!force && surface.ok) {
      results.push({ orgId: deployment.org_id, skipped: true, reason: 'surface_ok', surface });
      continue;
    }

    try {
      const standardized = await standardizeWorkerRuntime({
        resourceGroup: deployment.azure_resource_group,
        vmName: deployment.vm_name,
        workerGitRepo: env.WASUP_WORKER_GIT_REPO,
        workerGitRef: env.WASUP_WORKER_GIT_REF
      });

      const after = await checkWorkerSurfaceMarkers(deployment.base_url);
      results.push({
        orgId: deployment.org_id,
        standardized,
        before: surface,
        after
      });
    } catch (error) {
      results.push({
        orgId: deployment.org_id,
        error: error instanceof Error ? error.message : String(error),
        before: surface
      });
    }
  }

  return NextResponse.json({
    success: true,
    gitRef: env.WASUP_WORKER_GIT_REF,
    checked: results.length,
    results
  });
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
