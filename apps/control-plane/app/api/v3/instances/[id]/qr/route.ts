import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { getWorkerInstanceQr } from '../../../../../../lib/worker-client';
import { mapWorkerInstanceStatus, workerPhoneFromResult, workerStatusFromResult } from '../../../../../../lib/worker-instance-state';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404, headers: NO_STORE_HEADERS });
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409, headers: NO_STORE_HEADERS });
  }

  try {
    const worker = await getWorkerInstanceQr({
      endpoint: target.endpoint,
      publicIp: target.deployment?.public_ip ?? null,
      sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
      instanceId: id
    });

    await updateInstanceFromWorkerStatus(supabase, id, principal.orgId, target.instance.metadata, worker, worker.status, null);
    return NextResponse.json({ success: true, worker }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateInstanceFromWorkerStatus(supabase, id, principal.orgId, target.instance.metadata, null, target.instance.status, message);
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE_HEADERS });
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

async function updateInstanceFromWorkerStatus(
  supabase: any,
  instanceId: string,
  orgId: string,
  existingMetadata: Record<string, unknown> | null,
  workerResult: unknown,
  workerStatus: string,
  lastError: string | null
) {
  const effectiveWorkerStatus = workerStatusFromResult(workerResult) || workerStatus;
  const status = mapWorkerInstanceStatus(effectiveWorkerStatus);
  const phone = status === 'connected' ? workerPhoneFromResult(workerResult) : null;
  const updatePayload: Record<string, unknown> = {
    status,
    provisioning_state: 'provisioned',
    metadata: {
      ...(existingMetadata || {}),
      last_error: lastError,
      lastQrFetch: {
        status: effectiveWorkerStatus,
        fetchedAt: new Date().toISOString(),
        error: lastError,
        phoneSynced: Boolean(phone)
      }
    },
    updated_at: new Date().toISOString()
  };

  if (phone) updatePayload.phone = phone;

  await supabase
    .from('instances')
    .update(updatePayload)
    .eq('id', instanceId)
    .eq('org_id', orgId);
}
