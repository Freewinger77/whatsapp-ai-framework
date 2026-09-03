import {
  getWorkerFingerprintRisk,
  getWorkerProxyPool,
  listWorkerInstances,
} from './worker-client';
import {
  getOrgFleetWorkers,
  getSharedFleetWorkers,
  getWorkerSharedSecret,
  type FleetWorkerDefinition,
  type FleetWorkerKind,
} from './fleet-workers';
import { getSupabaseAdmin } from './supabase-admin';

export type FleetProxyInstanceRow = {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  proxySource: string | null;
  fingerprint: string | null;
  fingerprintRisk: string | null;
  sharedWith: number | null;
  proxyHost: string | null;
  proxyPort: number | null;
  hasProxy: boolean;
};

export type FleetWorkerProxyAudit = {
  id: string;
  kind: FleetWorkerKind;
  label: string;
  baseUrl: string;
  publicIp: string | null;
  orgId?: string | null;
  orgSlug?: string | null;
  reachable: boolean;
  error?: string;
  instanceCount: number;
  connectedCount: number;
  withProxyCount: number;
  directCount: number;
  pool: {
    enabled: boolean;
    total: number;
    used: number;
    free: number;
  } | null;
  fingerprintSummary: { high: number; amber: number; low: number } | null;
  fingerprintGroups: Array<{
    fingerprint: string;
    risk: string;
    count: number;
    sharedWith: number;
    members: string[];
  }>;
  instances: FleetProxyInstanceRow[];
};

export type ControlPlaneProxySummary = {
  total: number;
  free: number;
  assigned: number;
  unavailable: number;
  byRegion: Array<{ regionCode: string; total: number; free: number; assigned: number; unavailable: number }>;
};

export type FleetProxyAuditResult = {
  success: true;
  generatedAt: string;
  sharedSecretConfigured: boolean;
  summary: {
    workersTotal: number;
    workersReachable: number;
    workersUnreachable: number;
    instancesTotal: number;
    instancesConnected: number;
    instancesWithProxy: number;
    instancesDirect: number;
    poolSlotsTotal: number;
    poolSlotsUsed: number;
    poolSlotsFree: number;
    fingerprintHighWorkers: number;
    fingerprintAmberWorkers: number;
  };
  controlPlanePool: ControlPlaneProxySummary;
  workers: FleetWorkerProxyAudit[];
};

type AuditOptions = {
  includeShared?: boolean;
  includeOrgDeployments?: boolean;
  workerIds?: string[] | null;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function redactHostPort(proxy: Record<string, any> | null | undefined) {
  if (!proxy) return { host: null as string | null, port: null as number | null };
  const host = typeof proxy.host === 'string' ? proxy.host : null;
  const port = typeof proxy.port === 'number' ? proxy.port : Number(proxy.port) || null;
  return { host, port };
}

async function auditOneWorker(worker: FleetWorkerDefinition & { orgId?: string | null; orgSlug?: string | null }): Promise<FleetWorkerProxyAudit> {
  const sharedSecret = getWorkerSharedSecret();
  const base: FleetWorkerProxyAudit = {
    id: worker.id,
    kind: worker.kind,
    label: worker.label,
    baseUrl: worker.baseUrl,
    publicIp: worker.publicIp,
    orgId: worker.orgId ?? null,
    orgSlug: worker.orgSlug ?? null,
    reachable: false,
    instanceCount: 0,
    connectedCount: 0,
    withProxyCount: 0,
    directCount: 0,
    pool: null,
    fingerprintSummary: null,
    fingerprintGroups: [],
    instances: [],
  };

  if (!sharedSecret) {
    return { ...base, error: 'WASUP_WORKER_SHARED_SECRET is not configured on the control plane' };
  }

  const input = {
    endpoint: worker.baseUrl,
    publicIp: worker.publicIp,
    sharedSecret,
  };

  try {
    const [instancesBody, poolBody, riskBody] = await Promise.all([
      listWorkerInstances(input),
      getWorkerProxyPool(input).catch(() => null),
      getWorkerFingerprintRisk(input).catch(() => null),
    ]);

    const instancesRaw = Array.isArray(asRecord(instancesBody).instances)
      ? (asRecord(instancesBody).instances as any[])
      : [];

    const riskById = new Map<string, any>();
    const riskRecord = asRecord(riskBody);
    for (const row of Array.isArray(riskRecord.instances) ? riskRecord.instances : []) {
      if (row?.id) riskById.set(String(row.id), row);
    }

    const instances: FleetProxyInstanceRow[] = instancesRaw.map((inst) => {
      const id = String(inst.id || '');
      const proxy = asRecord(inst.proxy);
      const effective = asRecord(proxy.effective || proxy.override);
      const source = typeof proxy.source === 'string' ? proxy.source : null;
      const hasProxy = Boolean(
        effective.host ||
          (source && source !== 'none' && source !== 'disabled')
      );
      const risk = riskById.get(id) || asRecord(inst.fingerprintRisk);
      const { host, port } = redactHostPort(effective);
      return {
        id,
        name: String(inst.name || id),
        status: String(inst.status || 'unknown'),
        phone: inst.connectedPhone || inst.phone || null,
        proxySource: source,
        fingerprint: typeof risk.fingerprint === 'string' ? risk.fingerprint : hasProxy && host ? `${host}:${port || ''}` : 'direct',
        fingerprintRisk: typeof risk.risk === 'string' ? risk.risk : null,
        sharedWith: typeof risk.sharedWith === 'number' ? risk.sharedWith : null,
        proxyHost: host,
        proxyPort: port,
        hasProxy,
      };
    });

    const poolRecord = asRecord(poolBody);
    const poolStatus = asRecord(poolRecord.pool || poolRecord);
    const pool =
      typeof poolStatus.total === 'number'
        ? {
            enabled: Boolean(poolStatus.enabled ?? poolStatus.total > 0),
            total: Number(poolStatus.total) || 0,
            used: Number(poolStatus.used) || 0,
            free: Number(poolStatus.free) || 0,
          }
        : null;

    const fingerprintGroups = Array.isArray(riskRecord.groups)
      ? riskRecord.groups.map((g: any) => ({
          fingerprint: String(g.fingerprint || 'direct'),
          risk: String(g.risk || 'unknown'),
          count: Number(g.count) || 0,
          sharedWith: Number(g.sharedWith) || 0,
          members: Array.isArray(g.members)
            ? g.members.map((m: any) => String(m.name || m.id || ''))
            : [],
        }))
      : [];

    return {
      ...base,
      reachable: true,
      instanceCount: instances.length,
      connectedCount: instances.filter((i) => i.status === 'connected').length,
      withProxyCount: instances.filter((i) => i.hasProxy).length,
      directCount: instances.filter((i) => !i.hasProxy).length,
      pool,
      fingerprintSummary: riskRecord.summary
        ? {
            high: Number(asRecord(riskRecord.summary).high) || 0,
            amber: Number(asRecord(riskRecord.summary).amber) || 0,
            low: Number(asRecord(riskRecord.summary).low) || 0,
          }
        : null,
      fingerprintGroups,
      instances,
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadControlPlanePoolSummary(): Promise<ControlPlaneProxySummary> {
  const supabase = getSupabaseAdmin() as any;
  const { data, error } = await supabase.from('proxy_pool_summary').select('*');
  if (error || !data) {
    // Fallback: count from proxy_allocations
    const { data: rows } = await supabase.from('proxy_allocations').select('region_code, status');
    const byRegion = new Map<string, { total: number; free: number; assigned: number; unavailable: number }>();
    for (const row of rows || []) {
      const code = String(row.region_code || 'unknown');
      if (!byRegion.has(code)) byRegion.set(code, { total: 0, free: 0, assigned: 0, unavailable: 0 });
      const bucket = byRegion.get(code)!;
      bucket.total += 1;
      if (row.status === 'free') bucket.free += 1;
      else if (row.status === 'assigned') bucket.assigned += 1;
      else bucket.unavailable += 1;
    }
    const list = [...byRegion.entries()].map(([regionCode, stats]) => ({ regionCode, ...stats }));
    return {
      total: list.reduce((n, r) => n + r.total, 0),
      free: list.reduce((n, r) => n + r.free, 0),
      assigned: list.reduce((n, r) => n + r.assigned, 0),
      unavailable: list.reduce((n, r) => n + r.unavailable, 0),
      byRegion: list,
    };
  }

  const byRegion = (data as any[]).map((row) => ({
    regionCode: String(row.region_code || row.regionCode || 'unknown'),
    total: Number(row.total) || 0,
    free: Number(row.free) || 0,
    assigned: Number(row.assigned) || 0,
    unavailable: Number(row.unavailable) || 0,
  }));

  return {
    total: byRegion.reduce((n, r) => n + r.total, 0),
    free: byRegion.reduce((n, r) => n + r.free, 0),
    assigned: byRegion.reduce((n, r) => n + r.assigned, 0),
    unavailable: byRegion.reduce((n, r) => n + r.unavailable, 0),
    byRegion,
  };
}

export async function buildFleetProxyAudit(options: AuditOptions = {}): Promise<FleetProxyAuditResult> {
  const includeShared = options.includeShared !== false;
  const includeOrg = options.includeOrgDeployments !== false;

  const workers: Array<FleetWorkerDefinition & { orgId?: string | null; orgSlug?: string | null }> = [];
  if (includeShared) {
    workers.push(...getSharedFleetWorkers(options.workerIds));
  }
  if (includeOrg) {
    workers.push(...(await getOrgFleetWorkers()));
  }

  const [controlPlanePool, audits] = await Promise.all([
    loadControlPlanePoolSummary(),
    Promise.all(workers.map((w) => auditOneWorker(w))),
  ]);

  const reachable = audits.filter((a) => a.reachable);
  const summary = {
    workersTotal: audits.length,
    workersReachable: reachable.length,
    workersUnreachable: audits.length - reachable.length,
    instancesTotal: reachable.reduce((n, a) => n + a.instanceCount, 0),
    instancesConnected: reachable.reduce((n, a) => n + a.connectedCount, 0),
    instancesWithProxy: reachable.reduce((n, a) => n + a.withProxyCount, 0),
    instancesDirect: reachable.reduce((n, a) => n + a.directCount, 0),
    poolSlotsTotal: reachable.reduce((n, a) => n + (a.pool?.total || 0), 0),
    poolSlotsUsed: reachable.reduce((n, a) => n + (a.pool?.used || 0), 0),
    poolSlotsFree: reachable.reduce((n, a) => n + (a.pool?.free || 0), 0),
    fingerprintHighWorkers: reachable.filter((a) => (a.fingerprintSummary?.high || 0) > 0).length,
    fingerprintAmberWorkers: reachable.filter((a) => (a.fingerprintSummary?.amber || 0) > 0).length,
  };

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    sharedSecretConfigured: Boolean(getWorkerSharedSecret()),
    summary,
    controlPlanePool,
    workers: audits.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
