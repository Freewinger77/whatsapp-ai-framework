import { getWorkerInstance } from './worker-client';
import { getWorkerInstanceId } from './worker-instance-id';
import { mapWorkerInstanceStatus, workerPhoneFromResult, workerStatusFromResult } from './worker-instance-state';

type SupabaseAdmin = {
  from: (table: string) => any;
};

export function connectionEventToInstanceStatus(eventType: string, payload: Record<string, unknown> = {}) {
  const payloadStatus = typeof payload.status === 'string' ? payload.status : null;
  if (payloadStatus) {
    return mapWorkerInstanceStatus(payloadStatus);
  }

  if (eventType === 'connection.open') return 'connected';
  if (eventType === 'connection.connecting') return 'connecting';
  if (eventType === 'connection.error') return 'error';
  if (eventType === 'connection.close' || eventType === 'connection.disconnected') return 'disconnected';
  return null;
}

export function isConnectionStatusEvent(eventType: string) {
  return eventType.startsWith('connection.');
}

export async function applyInstanceConnectionStatus(
  supabase: SupabaseAdmin,
  orgId: string,
  instanceId: string,
  status: string,
  options: {
    phone?: string | null;
    existingMetadata?: Record<string, unknown> | null;
    syncKey?: string;
    lastError?: string | null;
  } = {}
) {
  const mappedStatus = mapWorkerInstanceStatus(status);
  const phone =
    mappedStatus === 'connected' && options.phone
      ? options.phone
      : mappedStatus === 'connected'
        ? undefined
        : null;

  const syncedAt = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: mappedStatus,
    provisioning_state: 'provisioned',
    metadata: {
      ...(options.existingMetadata || {}),
      last_error: options.lastError ?? null,
      [options.syncKey || 'lastConnectionEvent']: {
        status: mappedStatus,
        syncedAt,
        phoneSynced: Boolean(phone)
      }
    },
    updated_at: syncedAt
  };

  if (phone !== undefined) {
    updatePayload.phone = phone;
  }

  await supabase.from('instances').update(updatePayload).eq('id', instanceId).eq('org_id', orgId);
}

export async function syncInstanceFromWorker(
  supabase: SupabaseAdmin,
  orgId: string,
  instance: Record<string, any>,
  deployment: { base_url?: string | null; public_ip?: string | null } | null
) {
  const endpoint = instance.worker_endpoint || deployment?.base_url || null;
  if (!endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) return null;

  const worker = await getWorkerInstance({
    endpoint,
    publicIp: deployment?.public_ip ?? null,
    sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
    instanceId: getWorkerInstanceId(instance)
  });

  if (!worker.found) return null;

  const workerStatus = workerStatusFromResult(worker.result);
  const status = mapWorkerInstanceStatus(workerStatus);
  const phone = status === 'connected' ? workerPhoneFromResult(worker.result) : null;
  const syncedAt = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status,
    provisioning_state: 'provisioned',
    phone,
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
}

export function shouldLiveSyncInstanceFromWorker(instance: Record<string, any>) {
  if (instance.deleted_at) return false;
  if (instance.status === 'suspended') return false;
  return true;
}
