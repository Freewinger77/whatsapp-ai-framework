import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { syncAllReadyOrgWorkers, syncOrgWorkerInstances } from '../../../../../lib/worker-instance-sync';

const SyncSchema = z.object({
  orgId: z.string().uuid().optional(),
  cleanupOrphanWorkers: z.boolean().optional(),
  importOrphanWorkers: z.boolean().optional(),
  linkSuggestions: z
    .array(
      z.object({
        controlPlaneInstanceId: z.string().uuid(),
        workerInstanceId: z.string().min(3).max(120)
      })
    )
    .optional()
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = SyncSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseAdmin() as any;
  const options = {
    cleanupOrphanWorkers: parsed.data.cleanupOrphanWorkers ?? true,
    importOrphanWorkers: parsed.data.importOrphanWorkers ?? true,
    linkSuggestions: parsed.data.linkSuggestions
  };

  try {
    if (parsed.data.orgId) {
      const { data: deployment } = await supabase
        .from('org_deployments')
        .select('id, org_id, status, base_url, public_ip, vm_name, azure_resource_group, azure_region')
        .eq('org_id', parsed.data.orgId)
        .eq('environment', 'production')
        .maybeSingle();

      if (!deployment) {
        return NextResponse.json({ error: 'Org deployment not found' }, { status: 404 });
      }

      const result = await syncOrgWorkerInstances(supabase, parsed.data.orgId, deployment, options);
      return NextResponse.json({ success: true, result });
    }

    const results = await syncAllReadyOrgWorkers(supabase, options);
    return NextResponse.json({ success: true, checked: results.length, results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
