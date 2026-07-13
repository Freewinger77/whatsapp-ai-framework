import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from './supabase-admin';
import { readPairingTokenFromRequest, verifyPairingLinkToken } from './pairing-link';
import { loadWorkerTarget, workerRequestInput } from './worker-target';
import {
  connectWorkerInstance,
  clearWorkerInstanceAuth,
  getWorkerInstanceQr
} from './worker-client';
import {
  mapWorkerInstanceStatus,
  workerPhoneFromResult,
  workerStatusFromResult
} from './worker-instance-state';

export const PAIRING_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

export async function authorizePublicPairingRequest(req: Request, instanceId: string) {
  const token = readPairingTokenFromRequest(req);
  if (!token) {
    return {
      error: NextResponse.json({ error: 'Pairing token is required.' }, { status: 401, headers: PAIRING_NO_STORE_HEADERS })
    };
  }

  const verified = verifyPairingLinkToken(token, instanceId);
  if (!verified.ok) {
    return {
      error: NextResponse.json({ error: verified.error }, { status: 401, headers: PAIRING_NO_STORE_HEADERS })
    };
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: instance } = await supabase
    .from('instances')
    .select('id, org_id, name, status, phone, legacy_instance_id, worker_endpoint, metadata')
    .eq('id', instanceId)
    .eq('org_id', verified.payload.orgId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!instance) {
    return {
      error: NextResponse.json({ error: 'Instance not found.' }, { status: 404, headers: PAIRING_NO_STORE_HEADERS })
    };
  }

  const target = await loadWorkerTarget(supabase, verified.payload.orgId, instanceId);
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return {
      error: NextResponse.json(
        { error: 'Worker deployment is not ready yet.' },
        { status: 409, headers: PAIRING_NO_STORE_HEADERS }
      )
    };
  }

  return {
    instance,
    orgId: verified.payload.orgId,
    workerInput: workerRequestInput(target, instance),
    deployment: target.deployment
  };
}

export async function updateInstanceFromWorkerStatus(
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
      lastPublicPairingSync: {
        status: effectiveWorkerStatus,
        syncedAt: new Date().toISOString(),
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

export async function publicConnectWorker(
  auth: Awaited<ReturnType<typeof authorizePublicPairingRequest>>,
  body: { pairingPhone?: string }
) {
  if ('error' in auth && auth.error) return auth.error;
  const supabase = getSupabaseAdmin() as any;

  try {
    const worker = await connectWorkerInstance(auth.workerInput, body);
    await updateInstanceFromWorkerStatus(
      supabase,
      auth.instance.id,
      auth.orgId,
      auth.instance.metadata,
      worker,
      workerStatusFromResult(worker) || 'connecting',
      null
    );
    return NextResponse.json({ success: true, worker }, { headers: PAIRING_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateInstanceFromWorkerStatus(
      supabase,
      auth.instance.id,
      auth.orgId,
      auth.instance.metadata,
      null,
      auth.instance.status,
      message
    );
    return NextResponse.json({ error: message }, { status: 502, headers: PAIRING_NO_STORE_HEADERS });
  }
}

export async function publicGetWorkerQr(auth: Awaited<ReturnType<typeof authorizePublicPairingRequest>>) {
  if ('error' in auth && auth.error) return auth.error;
  const supabase = getSupabaseAdmin() as any;

  try {
    const worker = await getWorkerInstanceQr(auth.workerInput);
    await updateInstanceFromWorkerStatus(
      supabase,
      auth.instance.id,
      auth.orgId,
      auth.instance.metadata,
      worker,
      worker.status,
      null
    );
    return NextResponse.json({ success: true, worker }, { headers: PAIRING_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateInstanceFromWorkerStatus(
      supabase,
      auth.instance.id,
      auth.orgId,
      auth.instance.metadata,
      null,
      auth.instance.status,
      message
    );
    return NextResponse.json({ error: message }, { status: 502, headers: PAIRING_NO_STORE_HEADERS });
  }
}

export async function publicClearWorkerAuth(auth: Awaited<ReturnType<typeof authorizePublicPairingRequest>>) {
  if ('error' in auth && auth.error) return auth.error;
  const supabase = getSupabaseAdmin() as any;

  try {
    const worker = await clearWorkerInstanceAuth(auth.workerInput);
    await updateInstanceFromWorkerStatus(
      supabase,
      auth.instance.id,
      auth.orgId,
      auth.instance.metadata,
      worker,
      workerStatusFromResult(worker) || 'disconnected',
      null
    );
    return NextResponse.json({ success: true, worker }, { headers: PAIRING_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502, headers: PAIRING_NO_STORE_HEADERS });
  }
}
