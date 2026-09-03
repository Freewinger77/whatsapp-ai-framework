import type { Instance } from "@/polymet/data/dashboard-data";

const METADATA_KEY = "wasupSidebarInstanceOrder";
const LOCAL_PREFIX = "wasup:sidebar-instance-order:";

export type InstanceOrderMap = Record<string, string[]>;

function scopeKey(orgId: string | null | undefined) {
  return orgId?.trim() || "default";
}

export function instanceSidebarOrderStorageKey(orgId: string | null | undefined) {
  return `${LOCAL_PREFIX}${scopeKey(orgId)}`;
}

export function readLocalInstanceOrder(orgId: string | null | undefined): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(instanceSidebarOrderStorageKey(orgId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeLocalInstanceOrder(orgId: string | null | undefined, order: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(instanceSidebarOrderStorageKey(orgId), JSON.stringify(order));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readMetadataInstanceOrder(
  metadata: Record<string, unknown> | null | undefined,
  orgId: string | null | undefined,
): string[] {
  const map = metadata?.[METADATA_KEY];
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const order = (map as InstanceOrderMap)[scopeKey(orgId)];
  return Array.isArray(order) ? order.filter((id): id is string => typeof id === "string") : [];
}

export function mergeMetadataInstanceOrder(
  metadata: Record<string, unknown> | null | undefined,
  orgId: string | null | undefined,
  order: string[],
): Record<string, unknown> {
  const prev = metadata?.[METADATA_KEY];
  const prevMap =
    prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as InstanceOrderMap) : {};
  return {
    ...(metadata || {}),
    [METADATA_KEY]: {
      ...prevMap,
      [scopeKey(orgId)]: order,
    },
  };
}

/** Live / connecting float up; offline / unknown sink. Custom order is secondary within each band. */
export function instanceConnectionSortRank(status: Instance["status"]): number {
  switch (status) {
    case "active":
    case "quality-warning":
      return 0;
    case "connecting":
    case "provisioning":
      return 1;
    case "offline":
    default:
      return 2;
  }
}

export function sortInstancesForSidebar<T extends Pick<Instance, "id" | "name" | "status">>(
  instances: T[],
  order: string[] = [],
): T[] {
  const orderMap = new Map(order.map((id, index) => [id, index]));
  return [...instances].sort((a, b) => {
    const rankDiff = instanceConnectionSortRank(a.status) - instanceConnectionSortRank(b.status);
    if (rankDiff !== 0) return rankDiff;

    const aIdx = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const bIdx = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    if (aIdx !== bIdx) return aIdx - bIdx;

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function moveIdInOrder(order: string[], fromId: string, toId: string, allIds: string[]): string[] {
  const base = order.length ? [...order] : [...allIds];
  for (const id of allIds) {
    if (!base.includes(id)) base.push(id);
  }
  const fromIdx = base.indexOf(fromId);
  const toIdx = base.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return base;
  const [moved] = base.splice(fromIdx, 1);
  base.splice(toIdx, 0, moved);
  return base;
}
