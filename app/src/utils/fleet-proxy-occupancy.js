/**
 * Fetch fleet-wide proxy occupancy from the control plane so worker UIs
 * mark SE/UK slots used on *any* worker (wasup / wasup2 / org VMs / …).
 */

const DEFAULT_CP = 'https://control-plane.wasup.co';
const CACHE_TTL_MS = 15_000;

let cache = { at: 0, data: null };

function controlPlaneBase() {
    return String(process.env.WASUP_CONTROL_PLANE_URL || process.env.CONTROL_PLANE_URL || DEFAULT_CP)
        .trim()
        .replace(/\/+$/, '');
}

function workerSecret() {
    return String(process.env.WASUP_WORKER_SHARED_SECRET || process.env.API_KEY || '').trim();
}

/**
 * @returns {Promise<{
 *   byHost: Record<string, Array<{workerId:string,workerLabel:string,instanceId:string,instanceName:string,status:string,connected:boolean,label:string|null}>>,
 *   byLabel: Record<string, Array<{workerId:string,workerLabel:string,instanceId:string,instanceName:string,status:string,connected:boolean,hostPort:string}>>,
 *   generatedAt?: string,
 * } | null>}
 */
export async function fetchFleetProxyOccupancy({ force = false } = {}) {
    const now = Date.now();
    if (!force && cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;

    const secret = workerSecret();
    const base = controlPlaneBase();
    if (!secret || !base) return cache.data;

    try {
        const axios = (await import('axios')).default;
        const res = await axios.get(`${base}/api/internal/proxy/occupancy`, {
            timeout: 12_000,
            headers: {
                'X-Wasup-Worker-Secret': secret,
                'X-API-Key': secret,
                Authorization: `Bearer ${secret}`,
            },
            validateStatus: () => true,
        });
        if (res.status !== 200 || !res.data?.success) {
            console.warn(
                `[fleet-proxy-occupancy] CP ${res.status}:`,
                typeof res.data === 'object' ? res.data?.error || JSON.stringify(res.data).slice(0, 120) : res.status
            );
            return cache.data;
        }
        cache = {
            at: now,
            data: {
                byHost: res.data.byHost || {},
                byLabel: res.data.byLabel || {},
                generatedAt: res.data.generatedAt || null,
            },
        };
        return cache.data;
    } catch (err) {
        console.warn('[fleet-proxy-occupancy] fetch failed:', err.message);
        return cache.data;
    }
}

/**
 * Merge fleet occupancy into a local getCatalog() payload.
 * Marks slots used elsewhere and annotates who holds them.
 */
export function enrichCatalogWithFleetOccupancy(catalog, occupancy, { localWorkerId = null } = {}) {
    if (!catalog || !occupancy) return catalog;
    const byHost = occupancy.byHost || {};
    const byLabel = occupancy.byLabel || {};

    const enrichEntry = (entry) => {
        if (!entry) return entry;
        const hp = `${entry.host}:${entry.port}`;
        const label = entry.label ? String(entry.label).toUpperCase() : null;
        const hostUsers = byHost[hp] || [];
        const labelUsers = label ? byLabel[label] || [] : [];
        // Prefer host match; fall back to label (same Webshare exit)
        const users = hostUsers.length ? hostUsers : labelUsers;
        const others = users.filter((u) => {
            if (localWorkerId && u.workerId === localWorkerId && u.instanceId === entry.assignedTo) return false;
            if (entry.assignedTo && u.instanceId === entry.assignedTo) return false;
            return true;
        });
        const connectedOthers = others.filter((u) => u.connected);
        const primary = connectedOthers[0] || others[0] || null;
        const fleetInUse = others.length > 0;
        const localInUse = !!entry.inUse || !!entry.assignedTo;

        return {
            ...entry,
            inUse: localInUse || fleetInUse,
            fleetInUse,
            fleetConnected: connectedOthers.length > 0,
            fleetUsers: others.map((u) => ({
                workerId: u.workerId,
                workerLabel: u.workerLabel,
                instanceId: u.instanceId,
                instanceName: u.instanceName,
                status: u.status,
                connected: u.connected,
            })),
            assignedName:
                entry.assignedName ||
                (primary
                    ? `${primary.instanceName}@${primary.workerLabel.replace(/^org\//, '')}`
                    : null),
            assignedStatus: entry.assignedStatus || primary?.status || null,
            fleetOccupiedBy: primary
                ? `${primary.instanceName}@${primary.workerLabel}`
                : null,
        };
    };

    const byCountry = {};
    for (const [country, list] of Object.entries(catalog.byCountry || {})) {
        byCountry[country] = (list || []).map(enrichEntry);
    }
    const entries = (catalog.entries || []).map(enrichEntry);

    return {
        ...catalog,
        byCountry,
        entries,
        fleetOccupancyAt: occupancy.generatedAt || null,
        fleetEnriched: true,
    };
}
