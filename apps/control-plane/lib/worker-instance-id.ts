export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEGACY_WORKER_ID_RE = /^wa_[a-z0-9]+_[a-z0-9]+$/i;

export type ControlPlaneInstanceRef = {
  id: string;
  legacy_instance_id?: string | null;
};

export function isUuid(value: string) {
  return UUID_RE.test(String(value || '').trim());
}

export function isLegacyWorkerInstanceId(value: string) {
  const id = String(value || '').trim();
  if (!id) return false;
  if (LEGACY_WORKER_ID_RE.test(id)) return true;
  return id.startsWith('wa_') && !isUuid(id);
}

export function getWorkerInstanceId(instance: ControlPlaneInstanceRef) {
  const legacy = String(instance.legacy_instance_id || '').trim();
  if (legacy) return legacy;
  return instance.id;
}

export async function resolveControlPlaneInstance(
  supabase: { from: (table: string) => any },
  orgId: string,
  workerInstanceId: string
) {
  const normalized = String(workerInstanceId || '').trim();
  if (!normalized) return null;

  if (isUuid(normalized)) {
    const { data } = await supabase
      .from('instances')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', normalized)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return data;
  }

  const { data: byLegacy } = await supabase
    .from('instances')
    .select('*')
    .eq('org_id', orgId)
    .eq('legacy_instance_id', normalized)
    .is('deleted_at', null)
    .maybeSingle();

  return byLegacy ?? null;
}
