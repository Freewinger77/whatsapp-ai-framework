import { getWorkerInstanceId } from './worker-instance-id';

export async function loadWorkerTarget(supabase: any, orgId: string, instanceId: string) {
  const { data: instance } = await supabase
    .from('instances')
    .select('id, org_id, name, status, provisioning_state, legacy_instance_id, worker_endpoint, webhook_url, metadata')
    .eq('org_id', orgId)
    .eq('id', instanceId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!instance) return { instance: null, deployment: null, endpoint: null, workerInstanceId: null };

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  return {
    instance,
    deployment,
    endpoint: instance.worker_endpoint || deployment?.base_url || null,
    workerInstanceId: getWorkerInstanceId(instance)
  };
}

export function workerRequestInput(
  target: { deployment: { public_ip?: string | null } | null; endpoint: string | null },
  instance: { id: string; legacy_instance_id?: string | null } | string
) {
  const workerInstanceId = typeof instance === 'string' ? instance : getWorkerInstanceId(instance);
  return {
    endpoint: target.endpoint,
    publicIp: target.deployment?.public_ip ?? null,
    sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null,
    instanceId: workerInstanceId
  };
}
