import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { connectWorkerInstance } from '../../../../../../lib/worker-client';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../lib/worker-target';
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
    const worker = await connectWorkerInstance(workerRequestInput(target, target.instance), parsed.data);

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
