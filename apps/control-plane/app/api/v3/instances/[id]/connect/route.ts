import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { connectWorkerInstance } from '../../../../../../lib/worker-client';
import { mapWorkerInstanceStatus, workerPhoneFromResult, workerStatusFromResult } from '../../../../../../lib/worker-instance-state';

const ConnectSchema = z.object({
  pairingPhone: z.string().min(6).max(32).optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const parsed = ConnectSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409 });
  }

  try {
    const worker = await connectWorkerInstance(
      {
        endpoint: target.endpoint,
        publicIp: target.deployment?.public_ip ?? null,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
        instanceId: id
      },
      parsed.data
    );

    await updateInstanceFromWorkerStatus(
      supabase,
      id,
      principal.orgId,
      target.instance.metadata,
      worker,
      workerStatusFromResult(worker) || 'connecting',
      null
    );
    return NextResponse.json({ success: true, worker });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateInstanceFromWorkerStatus(supabase, id, principal.orgId, target.instance.metadata, null, target.instance.status, message);
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

async function updateInstanceFromWorkerStatus(
  supabase: any,
  instanceId: string,
  orgId: string,
  existingMetadata: Record<string, unknown> | null,
  workerResult: unknown,
  workerStatus: string,
  lastError: string | null
) {
  const status = mapWorkerInstanceStatus(workerStatus);
  const phone = status === 'connected' ? workerPhoneFromResult(workerResult) : null;
  const updatePayload: Record<string, unknown> = {
    status,
    provisioning_state: 'provisioned',
    metadata: {
      ...(existingMetadata || {}),
      last_error: lastError,
      lastConnectAttempt: {
        status: workerStatus,
        attemptedAt: new Date().toISOString(),
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
