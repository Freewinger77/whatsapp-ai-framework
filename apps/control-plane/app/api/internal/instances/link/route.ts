import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { linkControlPlaneToWorkerInstance, syncOrgWorkerInstances } from '../../../../../lib/worker-instance-sync';
import { getWorkerInstance, listWorkerInstances } from '../../../../../lib/worker-client';

const LinkSchema = z.object({
  orgId: z.string().uuid(),
  controlPlaneInstanceId: z.string().uuid(),
  workerInstanceId: z.string().min(3).max(120),
  renameOnWorker: z.boolean().optional(),
  cleanupOrphanWorkers: z.boolean().optional()
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = LinkSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseAdmin() as any;
  const { orgId, controlPlaneInstanceId, workerInstanceId, renameOnWorker = true } = parsed.data;

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, org_id, status, base_url, public_ip, vm_name, azure_resource_group, azure_region')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (!deployment?.base_url) {
    return NextResponse.json({ error: 'Org deployment is not ready' }, { status: 409 });
  }

  const { data: cpInstance } = await supabase
    .from('instances')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', controlPlaneInstanceId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!cpInstance) {
    return NextResponse.json({ error: 'Control-plane instance not found' }, { status: 404 });
  }

  const workerLookup = await getWorkerInstance({
    endpoint: deployment.base_url,
    publicIp: deployment.public_ip,
    sharedSecret: requiredSecret,
    instanceId: workerInstanceId
  });

  if (!workerLookup.found) {
    return NextResponse.json({ error: 'Worker instance not found' }, { status: 404 });
  }

  const worker = workerLookup.result?.instance || workerLookup.result;
  const linked = await linkControlPlaneToWorkerInstance(
    supabase,
    orgId,
    deployment,
    cpInstance,
    worker,
    { renameOnWorker, sharedSecret: requiredSecret }
  );

  const syncResult = await syncOrgWorkerInstances(supabase, orgId, deployment, {
    cleanupOrphanWorkers: parsed.data.cleanupOrphanWorkers ?? true,
    importOrphanWorkers: false
  });

  const workerList = await listWorkerInstances({
    endpoint: deployment.base_url,
    publicIp: deployment.public_ip,
    sharedSecret: requiredSecret
  });

  return NextResponse.json({
    success: true,
    linked,
    syncResult,
    worker: {
      total: workerList.count,
      connected: workerList.instances.filter((item) => item.status === 'connected').length
    }
  });
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
