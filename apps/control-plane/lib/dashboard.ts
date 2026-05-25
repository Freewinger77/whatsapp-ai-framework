import { getSupabaseAdmin } from './supabase-admin';

export type WorkerEventFeedRow = {
  id: string;
  org_id: string | null;
  org_slug: string | null;
  instance_id: string | null;
  instance_name: string | null;
  event_type: string;
  severity: string;
  summary: string | null;
  created_at: string;
};

export type OrgRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  region_preference: string | null;
  api_base_url: string | null;
  connected: number;
  instances: number;
};

export type InstanceRow = {
  id: string;
  org_id: string;
  org_slug: string;
  name: string;
  phone: string | null;
  status: string;
  region_code: string;
  behavior_profile: string;
  proxy_label: string;
  webhook_url: string | null;
  worker_endpoint: string | null;
};

export type LegacyRegion = {
  label: string;
  code: string;
  url: string;
  status: 'online' | 'degraded' | 'unknown';
  kind: 'vm' | 'regional' | 'console';
};

export type DashboardData = Awaited<ReturnType<typeof getDashboardSummary>>;

export async function getDashboardSummary() {
  try {
    const supabase = getSupabaseAdmin() as any;
    const [
      organizations,
      instances,
      connectedInstances,
      proxyAllocations,
      recentEvents,
      orgs,
      instancesData
    ] = await Promise.all([
      countRows('organizations'),
      countRows('instances'),
      countRows('instances', 'status', 'connected'),
      countRows('proxy_allocations', 'status', 'assigned'),
      supabase
        .from('worker_event_feed')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('organizations')
        .select('id, slug, name, plan, status, region_preference, api_base_url')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('instances')
        .select('id, org_id, name, phone, status, region_code, behavior_profile, proxy_policy, webhook_url, worker_endpoint')
        .order('created_at', { ascending: false })
        .limit(30)
    ]);

    return {
      organizations,
      instances,
      connectedInstances,
      proxyAllocations,
      recentEvents: (recentEvents.data ?? []) as WorkerEventFeedRow[],
      orgs: normalizeOrgs(orgs.data ?? [], instancesData.data ?? []),
      instanceRows: normalizeInstances(instancesData.data ?? [], orgs.data ?? []),
      legacyRegions: await getLegacyRegions(),
      setupReady: true
    };
  } catch {
    return {
      organizations: 0,
      instances: 0,
      connectedInstances: 0,
      proxyAllocations: 0,
      recentEvents: [],
      orgs: [],
      instanceRows: [],
      legacyRegions: await getLegacyRegions(),
      setupReady: false
    };
  }
}

async function countRows(table: 'organizations' | 'instances' | 'proxy_allocations', column?: string, value?: string) {
  let query = (getSupabaseAdmin() as any)
    .from(table)
    .select('id', { count: 'exact', head: true });

  if (column && value) {
    query = query.eq(column, value);
  }

  const { count } = await query;
  return count ?? 0;
}

function normalizeOrgs(rows: any[], instances: any[]): OrgRow[] {
  if (!rows.length) return [];

  return rows.map((org) => {
    const orgInstances = instances.filter((item) => item.org_id === org.id);
    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      plan: org.plan ?? 'starter',
      status: org.status ?? 'active',
      region_preference: org.region_preference ?? null,
      api_base_url: org.api_base_url ?? `https://api.wasup.ai/v3/orgs/${org.slug}`,
      connected: orgInstances.filter((item) => item.status === 'connected').length,
      instances: orgInstances.length
    };
  });
}

function normalizeInstances(rows: any[], orgs: any[]): InstanceRow[] {
  if (!rows.length) return [];
  const orgById = new Map(orgs.map((org) => [org.id, org.slug]));

  return rows.map((item) => ({
    id: item.id,
    org_id: item.org_id,
    org_slug: orgById.get(item.org_id) ?? 'org',
    name: item.name,
    phone: item.phone ?? null,
    status: item.status,
    region_code: item.region_code,
    behavior_profile: item.behavior_profile ?? 'notification-balanced',
    proxy_label: `${item.region_code} · ${item.proxy_policy ?? 'auto'}`,
    webhook_url: item.webhook_url ?? null,
    worker_endpoint: item.worker_endpoint ?? null
  }));
}

async function getLegacyRegions(): Promise<LegacyRegion[]> {
  const regions: Omit<LegacyRegion, 'status'>[] = [
    { label: 'North Europe VM', code: 'vm-neu', url: 'https://wasup.northeurope.cloudapp.azure.com', kind: 'vm' },
    { label: 'Console', code: 'console', url: 'https://wasup-console.azurewebsites.net', kind: 'console' },
    { label: 'Germany', code: 'de', url: 'https://wasup-de.azurewebsites.net', kind: 'regional' },
    { label: 'France', code: 'fr', url: 'https://wasup-fr.azurewebsites.net', kind: 'regional' },
    { label: 'Italy', code: 'it', url: 'https://wasup-it.azurewebsites.net', kind: 'regional' },
    { label: 'Finland', code: 'fi', url: 'https://wasup-fi.azurewebsites.net', kind: 'regional' },
    { label: 'Sweden', code: 'se', url: 'https://wasup-se.azurewebsites.net', kind: 'regional' },
    { label: 'Norway', code: 'no', url: 'https://wasup-no.azurewebsites.net', kind: 'regional' },
    { label: 'UK South', code: 'uk-south', url: 'https://wasup-uk-south.azurewebsites.net', kind: 'regional' },
    { label: 'UK West', code: 'uk-west', url: 'https://wasup-uk-west.azurewebsites.net', kind: 'regional' }
  ];

  const checks = await Promise.all(
    regions.map(async (region) => {
      try {
        const res = await fetch(`${region.url}/api/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(2500)
        });
        return { ...region, status: res.ok ? 'online' : 'degraded' } as LegacyRegion;
      } catch {
        return { ...region, status: 'unknown' } as LegacyRegion;
      }
    })
  );

  return checks;
}

