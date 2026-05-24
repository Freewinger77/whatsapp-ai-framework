import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getConnection, listInstances } from "@/polymet/lib/control-plane-api";
import { type Instance } from "@/polymet/data/dashboard-data";

type WorkspaceState = {
  instances: Instance[];
  loading: boolean;
  error: string;
  provisioningActive: boolean;
  deploymentStatus: string | null;
  updateDeploymentStatus: (status: string | null) => void;
  refresh: () => Promise<void>;
};

const WorkspaceStateContext = createContext<WorkspaceState | null>(null);

export const ACTIVE_DEPLOYMENT_STATUSES = new Set([
  "not_started",
  "queued",
  "provisioning",
  "dns_pending",
]);

const NAVIGATION_LOCK_DEPLOYMENT_STATUSES = new Set([
  ...ACTIVE_DEPLOYMENT_STATUSES,
]);

const PROVISIONING_CACHE_KEYS = [
  "provisioningActive",
  "workspaceProvisioningActive",
  "wasup:provisioningActive",
  "wasup.provisioningActive",
];

export function WorkspaceStateProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [deploymentStatus, setDeploymentStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const updateDeploymentStatus = useCallback((status: string | null) => {
    setDeploymentStatus(status);
    if (status === "ready") clearProvisioningCache();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextInstances = await listInstances();
      setInstances(nextInstances);

      try {
        const connection = await getConnection();
        updateDeploymentStatus(connection.deployment.status);
      } catch {
        updateDeploymentStatus(null);
      }

      setError("");
    } catch (refreshError) {
      setInstances([]);
      updateDeploymentStatus(null);
      setError(refreshError instanceof Error ? refreshError.message : "Could not load workspace state");
    } finally {
      setLoading(false);
    }
  }, [updateDeploymentStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const provisioningActive = useMemo(
    () => isWorkspaceNavigationLocked(instances, deploymentStatus),
    [deploymentStatus, instances],
  );

  const value = useMemo(
    () => ({
      instances,
      loading,
      error,
      provisioningActive,
      deploymentStatus,
      updateDeploymentStatus,
      refresh,
    }),
    [deploymentStatus, error, instances, loading, provisioningActive, refresh, updateDeploymentStatus],
  );

  return (
    <WorkspaceStateContext.Provider value={value}>
      {children}
    </WorkspaceStateContext.Provider>
  );
}

export function useWorkspaceState() {
  const state = useContext(WorkspaceStateContext);
  if (!state) {
    throw new Error("useWorkspaceState must be used within WorkspaceStateProvider");
  }
  return state;
}

export function isWorkspaceNavigationLocked(instances: Instance[], deploymentStatus: string | null) {
  const normalizedStatus = deploymentStatus?.toLowerCase() || null;

  if (normalizedStatus === "ready") return false;
  if (normalizedStatus && NAVIGATION_LOCK_DEPLOYMENT_STATUSES.has(normalizedStatus)) return true;

  return instances.some((instance) => instance.status === "provisioning");
}

function clearProvisioningCache() {
  if (typeof window === "undefined") return;

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of PROVISIONING_CACHE_KEYS) {
      storage.removeItem(key);
    }
  }
}

export function InlineProvisioningSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent ${className}`}
      aria-label="Provisioning"
    />
  );
}
