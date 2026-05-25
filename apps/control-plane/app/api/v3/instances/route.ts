import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';
import { attachMessagesToday, countMessagesTodayByInstance } from '../../../../lib/instance-message-stats';
import { syncInstanceFromWorker } from '../../../../lib/sync-instance-worker-status';

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
  const counts = await countMessagesTodayByInstance(
    getSupabaseAdmin() as any,
    principal.orgId,
    instances.map((instance) => instance.id)
  ).catch(() => ({} as Record<string, number>));

  return NextResponse.json({
    success: true,
    instances: attachMessagesToday(instances, counts)
  });
}

async function syncConnectedPhonesFromWorker(supabase: any, orgId: string, instances: any[]) {
  const candidates = instances.filter(
    (instance) =>
      !instance.deleted_at &&
      instance.status !== "suspended" &&
      (instance.provisioning_state === "provisioned" ||
        instance.status === "connected" ||
        instance.status === "connecting" ||
        instance.status === "disconnected")
  );
  if (!candidates.length || !process.env.WASUP_WORKER_SHARED_SECRET) return instances;

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  const updatedById = new Map<string, any>();

  for (const instance of candidates) {
    try {
      const updated = await syncInstanceFromWorker(supabase, orgId, instance, deployment);
      if (updated) updatedById.set(instance.id, updated);
    } catch {
      // List reads should stay available even if a worker is temporarily unreachable.
    }
  }

  return instances.map((instance) => updatedById.get(instance.id) ?? instance);
}
