import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';
import { getWorkerInstance } from '../../../../lib/worker-client';
import { mapWorkerInstanceStatus, workerPhoneFromResult, workerStatusFromResult } from '../../../../lib/worker-instance-state';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;

  const { data, error } = await (getSupabaseAdmin() as any)
    .from('instances')
    .select(`
      *,
      proxy_allocations(id, region_code, host, port, source, status, assigned_at),
      instance_profiles(display_name, about, picture_url, picture_status)
    `)
    .eq('org_id', principal.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const instances = await syncConnectedPhonesFromWorker(getSupabaseAdmin() as any, principal.orgId, data ?? []);
  return NextResponse.json({ success: true, instances });
}

async function syncConnectedPhonesFromWorker(supabase: any, orgId: string, instances: any[]) {
  const candidates = instances.filter((instance) => instance.status === 'connected' && !instance.phone);
  if (!candidates.length || !process.env.WASUP_WORKER_SHARED_SECRET) return instances;

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  const updatedById = new Map<string, any>();

  for (const instance of candidates) {
    const endpoint = instance.worker_endpoint || deployment?.base_url || null;
    if (!endpoint) continue;

    try {
      const worker = await getWorkerInstance({
        endpoint,
        publicIp: deployment?.public_ip ?? null,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
        instanceId: instance.id
      });

      if (!worker.found) continue;

      const workerStatus = workerStatusFromResult(worker.result);
      const status = mapWorkerInstanceStatus(workerStatus);
      const phone = status === 'connected' ? workerPhoneFromResult(worker.result) : null;
      const syncedAt = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        status,
        provisioning_state: 'provisioned',
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

      if (phone) updatePayload.phone = phone;

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

      if (updated) updatedById.set(instance.id, updated);
    } catch {
      // List reads should stay available even if a worker is temporarily unreachable.
    }
  }

  return instances.map((instance) => updatedById.get(instance.id) ?? instance);
}
