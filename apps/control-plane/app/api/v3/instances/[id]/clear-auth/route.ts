import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { clearWorkerInstanceAuth } from '../../../../../../lib/worker-client';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409 });
  }

  try {
    const worker = await clearWorkerInstanceAuth({
      endpoint: target.endpoint,
      publicIp: target.deployment?.public_ip ?? null,
      sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
      instanceId: id
    });

    await supabase
      .from('instances')
      .update({
        status: 'disconnected',
        phone: null,
        provisioning_state: 'provisioned',
        metadata: {
          ...(target.instance.metadata || {}),
          last_error: null,
          lastAuthClearedAt: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('org_id', principal.orgId);

    return NextResponse.json({ success: true, worker });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from('instances')
      .update({
        metadata: {
          ...(target.instance.metadata || {}),
          last_error: message,
          lastAuthClearAttempt: {
            attemptedAt: new Date().toISOString(),
            error: message
          }
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('org_id', principal.orgId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function loadWorkerTarget(supabase: any, orgId: string, instanceId: string) {
  const { data: instance } = await supabase
    .from('instances')
    .select('id, org_id, status, worker_endpoint, metadata')
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
