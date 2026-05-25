export async function loadWorkerTarget(supabase: any, orgId: string, instanceId: string) {
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

export function workerRequestInput(
  target: { deployment: { public_ip?: string | null } | null; endpoint: string | null },
  instanceId: string
) {
  return {
    endpoint: target.endpoint,
    publicIp: target.deployment?.public_ip ?? null,
    sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null,
    instanceId
  };
}
