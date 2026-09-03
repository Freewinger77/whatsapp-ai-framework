import fs from 'fs/promises';
import path from 'path';
import {
  attachWorkerCatalogProxy,
  detachWorkerProxyDirect,
  getWorkerProxyCatalog,
  listWorkerInstances,
  probeWorkerCatalogProxy,
} from './worker-client';
import {
  getAllFleetWorkers,
  getWorkerSharedSecret,
  type FleetWorkerDefinition,
} from './fleet-workers';

export type ProxyProbeRecord = {
  key: string; // workerId|host:port or label
  workerId: string;
  label: string | null;
  host: string;
  port: number;
  latencyMs: number | null;
  egressIp: string | null;
  ok: boolean;
  error?: string;
  probedAt: string;
};

export type GlobalProxyUser = {
  workerId: string;
  workerLabel: string;
  instanceId: string;
  instanceName: string;
  status: string;
  connected: boolean;
};

type ProbeStore = {
  updatedAt: string | null;
  probes: Record<string, ProxyProbeRecord>;
};

const STORE_PATH = path.join(process.cwd(), '.data', 'proxy-probes.json');
const HOUR_MS = 60 * 60 * 1000;

async function readStore(): Promise<ProbeStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      updatedAt: data.updatedAt || null,
      probes: data.probes || {},
    };
  } catch {
    return { updatedAt: null, probes: {} };
  }
}

async function writeStore(store: ProbeStore) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

function workerInput(worker: FleetWorkerDefinition) {
  return {
    endpoint: worker.baseUrl,
    publicIp: worker.publicIp,
    sharedSecret: getWorkerSharedSecret() || '',
  };
}

function hostPortKey(host: string, port: number | string) {
  return `${String(host).trim()}:${Number(port) || 0}`;
}

function instanceHasProxy(inst: any): boolean {
  const proxy = inst?.proxy || {};
  const source = proxy.source;
  if (source && source !== 'none' && source !== 'disabled') return true;
  const eff = proxy.effective || proxy.override || proxy.active?.proxy;
  return Boolean(eff?.host && eff?.port);
}

function instanceProxyEndpoint(inst: any): { host: string; port: number; label: string | null } | null {
  const proxy = inst?.proxy || {};
  const eff = proxy.effective || proxy.override || proxy.active?.proxy || null;
  if (!eff?.host || !eff?.port) return null;
  return {
    host: String(eff.host),
    port: Number(eff.port) || 0,
    label: eff.label ? String(eff.label).toUpperCase() : null,
  };
}

export type ProxyOpsRow = {
  key: string;
  workerId: string;
  workerLabel: string;
  workerKind: 'shared' | 'org';
  label: string | null;
  country: string | null;
  host: string;
  port: number;
  inUse: boolean;
  assignedInstanceId: string | null;
  assignedInstanceName: string | null;
  assignedStatus: string | null;
  antibanEnabled: boolean | null;
  antibanEnhanced: boolean | null;
  /** Per-worker fingerprint hint (legacy). Prefer globalRisk. */
  fingerprintRisk: string | null;
  sharedWith: number | null;
  /** Cross-fleet occupancy for this host:port (all workers). */
  globalUsers: GlobalProxyUser[];
  globalSharedCount: number;
  globalConnectedCount: number;
  globalRisk: 'high' | 'amber' | 'low' | null;
  lastProbe: ProxyProbeRecord | null;
};

export type ProxyOpsBoard = {
  success: true;
  generatedAt: string;
  lastHourlyProbeAt: string | null;
  hourlyDue: boolean;
  summary: {
    workersTotal: number;
    workersReachable: number;
    proxiesTotal: number;
    uniqueHosts: number;
    free: number;
    inUse: number;
    connectedAssigned: number;
    directConnected: number;
    sharedRiskHigh: number;
    crossWorkerConflicts: number;
  };
  /** Global occupancy by host:port across the whole fleet. */
  globalByHost: Array<{
    hostPort: string;
    host: string;
    port: number;
    label: string | null;
    users: GlobalProxyUser[];
    connectedCount: number;
    risk: 'high' | 'amber' | 'low';
  }>;
  rows: ProxyOpsRow[];
  attachTargets: Array<{
    workerId: string;
    workerLabel: string;
    instanceId: string;
    instanceName: string;
    status: string;
    hasProxy: boolean;
  }>;
};

function riskForUsers(users: GlobalProxyUser[]): 'high' | 'amber' | 'low' {
  const connected = users.filter((u) => u.connected).length;
  if (connected >= 2) return 'high';
  if (users.length >= 2) return 'amber';
  return 'low';
}

async function resolveWorkers(filterId?: string | null): Promise<FleetWorkerDefinition[]> {
  const all = await getAllFleetWorkers();
  if (!filterId) return all;
  const want = filterId.trim().toLowerCase();
  return all.filter((w) => w.id.toLowerCase() === want);
}

export type FleetProxyOccupancy = {
  generatedAt: string;
  byHost: Record<
    string,
    Array<{
      workerId: string;
      workerLabel: string;
      instanceId: string;
      instanceName: string;
      status: string;
      connected: boolean;
      label: string | null;
    }>
  >;
  byLabel: Record<
    string,
    Array<{
      workerId: string;
      workerLabel: string;
      instanceId: string;
      instanceName: string;
      status: string;
      connected: boolean;
      hostPort: string;
    }>
  >;
};

/** Lightweight fleet occupancy for workers (no probe / full board). */
export async function getFleetProxyOccupancy(): Promise<FleetProxyOccupancy> {
  const sharedSecret = getWorkerSharedSecret();
  const workers = await getAllFleetWorkers();
  const byHost: FleetProxyOccupancy['byHost'] = {};
  const byLabel: FleetProxyOccupancy['byLabel'] = {};

  await Promise.all(
    workers.map(async (worker) => {
      if (!sharedSecret) return;
      const input = workerInput(worker);
      let instancesBody: any = null;
      try {
        instancesBody = await listWorkerInstances(input);
      } catch {
        return;
      }
      const instances = Array.isArray(instancesBody?.instances) ? instancesBody.instances : [];
      for (const inst of instances) {
        const ep = instanceProxyEndpoint(inst);
        if (!ep) continue;
        const hp = hostPortKey(ep.host, ep.port);
        const user = {
          workerId: worker.id,
          workerLabel: worker.label,
          instanceId: String(inst.id),
          instanceName: String(inst.name || inst.id),
          status: String(inst.status || 'unknown'),
          connected: inst.status === 'connected' || inst.status === 'connecting',
          label: ep.label,
        };
        (byHost[hp] ||= []).push(user);
        if (ep.label) {
          (byLabel[ep.label.toUpperCase()] ||= []).push({
            workerId: user.workerId,
            workerLabel: user.workerLabel,
            instanceId: user.instanceId,
            instanceName: user.instanceName,
            status: user.status,
            connected: user.connected,
            hostPort: hp,
          });
        }
      }
    })
  );

  return { generatedAt: new Date().toISOString(), byHost, byLabel };
}

export async function buildProxyOpsBoard(options?: { autoHourlyProbe?: boolean }): Promise<ProxyOpsBoard> {
  const store = await readStore();
  const hourlyDue =
    !store.updatedAt || Date.now() - new Date(store.updatedAt).getTime() > HOUR_MS;

  if (options?.autoHourlyProbe !== false && hourlyDue) {
    void probeProxyOps({ light: true }).catch(() => {});
  }

  const sharedSecret = getWorkerSharedSecret();
  const workers = await getAllFleetWorkers();
  const rows: ProxyOpsRow[] = [];
  const attachTargets: ProxyOpsBoard['attachTargets'] = [];
  const occupancy = new Map<string, GlobalProxyUser[]>();
  const labelByHost = new Map<string, string | null>();
  let directConnected = 0;

  type WorkerSnap = {
    worker: FleetWorkerDefinition;
    instances: any[];
    catalogEntries: any[];
  };
  const snaps: WorkerSnap[] = (
    await Promise.all(
      workers.map(async (worker) => {
        if (!sharedSecret) return null;
        const input = workerInput(worker);
        let catalog: any = null;
        let instancesBody: any = null;
        try {
          [catalog, instancesBody] = await Promise.all([
            getWorkerProxyCatalog(input).catch(() => null),
            listWorkerInstances(input).catch(() => null),
          ]);
        } catch {
          return null;
        }
        if (!instancesBody && !catalog) return null;
        return {
          worker,
          instances: Array.isArray(instancesBody?.instances) ? instancesBody.instances : [],
          catalogEntries: catalog?.catalog?.entries || catalog?.entries || [],
        } satisfies WorkerSnap;
      })
    )
  ).filter(Boolean) as WorkerSnap[];
  const workersReachable = snaps.length;

  // Pass 1: global occupancy from live instance effective proxies + catalog assignments
  for (const { worker, instances, catalogEntries } of snaps) {
    for (const inst of instances) {
      const hasProxy = instanceHasProxy(inst);
      if (inst.status === 'connected' && !hasProxy) directConnected += 1;
      attachTargets.push({
        workerId: worker.id,
        workerLabel: worker.label,
        instanceId: String(inst.id),
        instanceName: String(inst.name || inst.id),
        status: String(inst.status || 'unknown'),
        hasProxy,
      });

      const ep = instanceProxyEndpoint(inst);
      if (!ep) continue;
      const hp = hostPortKey(ep.host, ep.port);
      if (ep.label && !labelByHost.has(hp)) labelByHost.set(hp, ep.label);
      const list = occupancy.get(hp) || [];
      list.push({
        workerId: worker.id,
        workerLabel: worker.label,
        instanceId: String(inst.id),
        instanceName: String(inst.name || inst.id),
        status: String(inst.status || 'unknown'),
        connected: inst.status === 'connected' || inst.status === 'connecting',
      });
      occupancy.set(hp, list);
    }

    for (const e of catalogEntries) {
      if (e.label && e.host) {
        labelByHost.set(hostPortKey(e.host, e.port), String(e.label).toUpperCase());
      }
    }
  }

  // Pass 2: emit a row per worker catalog slot (+ synthetic rows for sticky proxies not in that worker's catalog)
  for (const { worker, instances, catalogEntries } of snaps) {
    const byId = new Map(instances.map((i: any) => [String(i.id), i]));
    const seenHostPorts = new Set<string>();

    for (const e of catalogEntries) {
      const host = String(e.host || '');
      const port = Number(e.port) || 0;
      if (!host || !port) continue;
      const hp = hostPortKey(host, port);
      seenHostPorts.add(hp);
      const key = `${worker.id}|${hp}`;
      const assignedId = e.assignedTo ? String(e.assignedTo) : null;
      const assigned = assignedId ? byId.get(assignedId) : null;
      // Prefer live instance mapping if catalog assignment stale
      const liveUsers = occupancy.get(hp) || [];
      const localUser = liveUsers.find((u) => u.workerId === worker.id) || null;
      const ab = assigned?.antibanV2 || byId.get(localUser?.instanceId || '')?.antibanV2 || {};
      const globalUsers = liveUsers;
      const globalRisk = globalUsers.length ? riskForUsers(globalUsers) : null;

      rows.push({
        key,
        workerId: worker.id,
        workerLabel: worker.label,
        workerKind: worker.kind,
        label: e.label || labelByHost.get(hp) || null,
        country: e.country || null,
        host,
        port,
        inUse: Boolean(e.inUse || assignedId || localUser),
        assignedInstanceId: localUser?.instanceId || assignedId,
        assignedInstanceName: localUser?.instanceName || assigned?.name || e.assignedName || null,
        assignedStatus: localUser?.status || assigned?.status || e.assignedStatus || null,
        antibanEnabled: typeof ab.enabled === 'boolean' ? ab.enabled : null,
        antibanEnhanced: typeof ab.enhancedMode === 'boolean' ? ab.enhancedMode : null,
        fingerprintRisk: globalRisk,
        sharedWith: Math.max(0, globalUsers.length - 1),
        globalUsers,
        globalSharedCount: globalUsers.length,
        globalConnectedCount: globalUsers.filter((u) => u.connected).length,
        globalRisk,
        lastProbe: store.probes[key] || store.probes[`global|${hp}`] || null,
      });
    }

    // Sticky/custom proxies on this worker that aren't catalogued locally
    for (const inst of instances) {
      const ep = instanceProxyEndpoint(inst);
      if (!ep) continue;
      const hp = hostPortKey(ep.host, ep.port);
      if (seenHostPorts.has(hp)) continue;
      seenHostPorts.add(hp);
      const globalUsers = occupancy.get(hp) || [];
      const globalRisk = riskForUsers(globalUsers);
      const ab = inst.antibanV2 || {};
      rows.push({
        key: `${worker.id}|${hp}`,
        workerId: worker.id,
        workerLabel: worker.label,
        workerKind: worker.kind,
        label: ep.label || labelByHost.get(hp) || null,
        country: null,
        host: ep.host,
        port: ep.port,
        inUse: true,
        assignedInstanceId: String(inst.id),
        assignedInstanceName: String(inst.name || inst.id),
        assignedStatus: String(inst.status || 'unknown'),
        antibanEnabled: typeof ab.enabled === 'boolean' ? ab.enabled : null,
        antibanEnhanced: typeof ab.enhancedMode === 'boolean' ? ab.enhancedMode : null,
        fingerprintRisk: globalRisk,
        sharedWith: Math.max(0, globalUsers.length - 1),
        globalUsers,
        globalSharedCount: globalUsers.length,
        globalConnectedCount: globalUsers.filter((u) => u.connected).length,
        globalRisk,
        lastProbe: store.probes[`${worker.id}|${hp}`] || null,
      });
    }
  }

  rows.sort((a, b) => {
    const ca = a.country || 'ZZ';
    const cb = b.country || 'ZZ';
    if (ca !== cb) return ca.localeCompare(cb);
    const la = String(a.label || a.host);
    const lb = String(b.label || b.host);
    if (la !== lb) return la.localeCompare(lb);
    return a.workerLabel.localeCompare(b.workerLabel);
  });

  const globalByHost = [...occupancy.entries()]
    .map(([hostPort, users]) => {
      const [host, portStr] = hostPort.split(':');
      return {
        hostPort,
        host,
        port: Number(portStr) || 0,
        label: labelByHost.get(hostPort) || null,
        users,
        connectedCount: users.filter((u) => u.connected).length,
        risk: riskForUsers(users),
      };
    })
    .sort((a, b) => b.connectedCount - a.connectedCount || b.users.length - a.users.length);

  const free = rows.filter((r) => !r.inUse).length;
  const connectedAssigned = rows.filter((r) => r.assignedStatus === 'connected').length;
  const uniqueHosts = new Set(rows.map((r) => hostPortKey(r.host, r.port))).size;

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    lastHourlyProbeAt: store.updatedAt,
    hourlyDue,
    summary: {
      workersTotal: workers.length,
      workersReachable,
      proxiesTotal: rows.length,
      uniqueHosts,
      free,
      inUse: rows.length - free,
      connectedAssigned,
      directConnected,
      sharedRiskHigh: rows.filter((r) => r.globalRisk === 'high').length,
      crossWorkerConflicts: globalByHost.filter((g) => {
        const workerIds = new Set(g.users.map((u) => u.workerId));
        return workerIds.size > 1 && g.connectedCount >= 1;
      }).length,
    },
    globalByHost,
    rows,
    attachTargets,
  };
}

export async function probeProxyOps(options?: { labels?: string[]; light?: boolean; workerId?: string }) {
  const sharedSecret = getWorkerSharedSecret();
  if (!sharedSecret) throw new Error('WASUP_WORKER_SHARED_SECRET is not configured');

  const store = await readStore();
  const workers = await resolveWorkers(options?.workerId || null);
  const wantLabels = options?.labels?.map((l) => l.toUpperCase()) || null;
  const results: ProxyProbeRecord[] = [];
  const probedHosts = new Set<string>();

  for (const worker of workers) {
    const input = workerInput(worker);
    let catalog: any;
    try {
      catalog = await getWorkerProxyCatalog(input);
    } catch {
      continue;
    }
    const entries = catalog?.catalog?.entries || [];
    for (const e of entries) {
      if (wantLabels && (!e.label || !wantLabels.includes(String(e.label).toUpperCase()))) continue;
      if (options?.light && e.inUse) continue;
      if (!e.label) continue;

      const hp = hostPortKey(e.host, e.port);
      // One live probe per unique host:port per run (avoid 11× same Webshare IP)
      if (probedHosts.has(hp)) {
        const existing = results.find((r) => hostPortKey(r.host, r.port) === hp);
        if (existing) {
          const key = `${worker.id}|${hp}`;
          const copy = { ...existing, key, workerId: worker.id };
          store.probes[key] = copy;
          results.push(copy);
        }
        continue;
      }
      probedHosts.add(hp);

      const key = `${worker.id}|${hp}`;
      try {
        const probed = await probeWorkerCatalogProxy(input, String(e.label));
        const rec: ProxyProbeRecord = {
          key,
          workerId: worker.id,
          label: e.label || null,
          host: String(e.host),
          port: Number(e.port) || 0,
          latencyMs: typeof probed.elapsedMs === 'number' ? probed.elapsedMs : null,
          egressIp: typeof probed.egressIp === 'string' ? probed.egressIp : null,
          ok: Boolean(probed.success ?? true),
          probedAt: new Date().toISOString(),
        };
        store.probes[key] = rec;
        store.probes[`global|${hp}`] = rec;
        results.push(rec);
      } catch (err) {
        const rec: ProxyProbeRecord = {
          key,
          workerId: worker.id,
          label: e.label || null,
          host: String(e.host),
          port: Number(e.port) || 0,
          latencyMs: null,
          egressIp: null,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          probedAt: new Date().toISOString(),
        };
        store.probes[key] = rec;
        results.push(rec);
      }
    }
  }

  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  return { success: true as const, probed: results.length, results, updatedAt: store.updatedAt };
}

export async function attachProxyOps(body: {
  workerId: string;
  instanceId: string;
  label: string;
  forceShared?: boolean;
}) {
  const workers = await getAllFleetWorkers();
  const worker = workers.find((w) => w.id === body.workerId);
  if (!worker) throw new Error(`Unknown worker ${body.workerId}`);
  const sharedSecret = getWorkerSharedSecret();
  if (!sharedSecret) throw new Error('WASUP_WORKER_SHARED_SECRET is not configured');

  // Hard block if another *connected* instance anywhere already owns this label/host
  if (!body.forceShared) {
    const board = await buildProxyOpsBoard({ autoHourlyProbe: false });
    const label = body.label.toUpperCase();
    const conflict = board.globalByHost.find(
      (g) =>
        (g.label || '').toUpperCase() === label &&
        g.users.some(
          (u) =>
            u.connected &&
            !(u.workerId === body.workerId && u.instanceId === body.instanceId)
        )
    );
    if (conflict) {
      const who = conflict.users
        .filter((u) => u.connected)
        .map((u) => `${u.instanceName}@${u.workerLabel}`)
        .join(', ');
      throw new Error(
        `Proxy ${label} (${conflict.hostPort}) already used by connected: ${who}. Pass forceShared=true to override.`
      );
    }
  }

  return attachWorkerCatalogProxy(workerInput(worker), body.instanceId, body.label, {
    forceShared: !!body.forceShared,
  });
}

export async function detachProxyOps(body: { workerId: string; instanceId: string }) {
  const workers = await getAllFleetWorkers();
  const worker = workers.find((w) => w.id === body.workerId);
  if (!worker) throw new Error(`Unknown worker ${body.workerId}`);
  const sharedSecret = getWorkerSharedSecret();
  if (!sharedSecret) throw new Error('WASUP_WORKER_SHARED_SECRET is not configured');
  return detachWorkerProxyDirect(workerInput(worker), body.instanceId);
}
