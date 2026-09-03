/**
 * Shared + org worker inventory for fleet-wide ops (proxy audit, deploys).
 * Shared hosts mirror deploy/scripts/deploy-tctoken-hardening.sh.
 */

import { getSupabaseAdmin } from './supabase-admin';

export type FleetWorkerKind = 'shared' | 'org';

export type FleetWorkerDefinition = {
  id: string;
  kind: FleetWorkerKind;
  label: string;
  baseUrl: string;
  publicIp: string | null;
  sshUser?: string;
  appPath?: string;
  pm2Name?: string;
  orgId?: string | null;
  orgSlug?: string | null;
};

/** Canonical shared NEU workers (wasup / wasup-dev / wasup2–5 / wasup01–05). */
export const SHARED_FLEET_WORKERS: FleetWorkerDefinition[] = [
  {
    id: 'wasup',
    kind: 'shared',
    label: 'wasup (primary)',
    baseUrl: 'https://wasup.northeurope.cloudapp.azure.com',
    publicIp: '20.107.202.157',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup-dev',
    kind: 'shared',
    label: 'wasup-dev',
    baseUrl: 'https://wasup-dev.northeurope.cloudapp.azure.com',
    publicIp: '20.223.209.59',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup2',
    kind: 'shared',
    label: 'wasup2',
    baseUrl: 'https://wasup2.northeurope.cloudapp.azure.com',
    publicIp: '40.112.73.2',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup3',
    kind: 'shared',
    label: 'wasup3',
    baseUrl: 'https://wasup3.northeurope.cloudapp.azure.com',
    publicIp: '94.245.90.173',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup4',
    kind: 'shared',
    label: 'wasup4',
    baseUrl: 'https://wasup4.northeurope.cloudapp.azure.com',
    publicIp: '20.166.12.101',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup5',
    kind: 'shared',
    label: 'wasup5',
    baseUrl: 'https://wasup5.northeurope.cloudapp.azure.com',
    publicIp: '20.13.163.156',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup01',
    kind: 'shared',
    label: 'wasup01',
    baseUrl: 'https://wasup01.northeurope.cloudapp.azure.com',
    publicIp: '20.234.23.46',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup02',
    kind: 'shared',
    label: 'wasup02',
    baseUrl: 'https://wasup02.northeurope.cloudapp.azure.com',
    publicIp: '20.234.94.178',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup03',
    kind: 'shared',
    label: 'wasup03',
    baseUrl: 'https://wasup03.northeurope.cloudapp.azure.com',
    publicIp: '20.166.63.111',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup04',
    kind: 'shared',
    label: 'wasup04',
    baseUrl: 'https://wasup04.northeurope.cloudapp.azure.com',
    publicIp: '52.236.60.246',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
  {
    id: 'wasup05',
    kind: 'shared',
    label: 'wasup05',
    baseUrl: 'https://wasup05.northeurope.cloudapp.azure.com',
    publicIp: '20.234.102.144',
    sshUser: 'azureuser',
    appPath: '/opt/whatsapp-ai/app',
    pm2Name: 'whatsapp-api',
  },
];

export function getSharedFleetWorkers(filterIds?: string[] | null): FleetWorkerDefinition[] {
  if (!filterIds?.length) return SHARED_FLEET_WORKERS;
  const want = new Set(filterIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
  return SHARED_FLEET_WORKERS.filter((w) => want.has(w.id.toLowerCase()));
}

/** Ready org VMs provisioned via dev.wasup (Bashir, Mousa, …). */
export async function getOrgFleetWorkers(): Promise<FleetWorkerDefinition[]> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase
    .from('org_deployments')
    .select('id, org_id, status, base_url, public_ip, vm_name, organizations(slug, name)')
    .in('status', ['ready', 'dns_pending', 'provisioned'])
    .not('base_url', 'is', null)
    .limit(200);

  if (error) {
    console.warn('[fleet-workers] org_deployments query failed:', error.message);
    return [];
  }

  const sharedUrls = new Set(
    SHARED_FLEET_WORKERS.map((w) => w.baseUrl.replace(/\/$/, '').toLowerCase())
  );

  return (data || [])
    .map((row: any) => {
      const baseUrl = String(row.base_url || '').replace(/\/$/, '');
      if (!baseUrl) return null;
      if (sharedUrls.has(baseUrl.toLowerCase())) return null;
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      const slug = org?.slug || row.vm_name || row.id;
      return {
        id: `org:${slug || row.id}`,
        kind: 'org' as const,
        label: `org/${slug || row.id}${org?.name ? ` (${org.name})` : ''}`,
        baseUrl,
        publicIp: row.public_ip || null,
        orgId: row.org_id || null,
        orgSlug: org?.slug || null,
      } satisfies FleetWorkerDefinition;
    })
    .filter(Boolean) as FleetWorkerDefinition[];
}

/** Shared NEU fleet + live org workers — source of truth for global proxy ops. */
export async function getAllFleetWorkers(filterIds?: string[] | null): Promise<FleetWorkerDefinition[]> {
  const [shared, org] = await Promise.all([
    Promise.resolve(getSharedFleetWorkers(filterIds)),
    getOrgFleetWorkers(),
  ]);
  const merged = [...shared, ...org];
  if (!filterIds?.length) return merged;
  const want = new Set(filterIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
  return merged.filter((w) => want.has(w.id.toLowerCase()));
}

export function getWorkerSharedSecret(): string | null {
  const secret = String(process.env.WASUP_WORKER_SHARED_SECRET || '').trim();
  return secret || null;
}
