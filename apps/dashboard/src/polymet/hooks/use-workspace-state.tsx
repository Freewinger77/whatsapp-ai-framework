import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getConnection, getBillingEntitlements, listInstances, syncBillingEntitlements, type WorkspacePlan } from "@/polymet/lib/control-plane-api";
import { type Instance } from "@/polymet/data/dashboard-data";
import { getWorkerBaseUrl, getWorkerLinks } from "@/polymet/lib/worker-links";

type WorkspaceState = {
  instances: Instance[];
  loading: boolean;
  error: string;
  provisioningActive: boolean;
  deploymentStatus: string | null;
  workerLinks: ReturnType<typeof getWorkerLinks>;
  plan: WorkspacePlan | null;
  updateDeploymentStatus: (status: string | null) => void;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
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
  const [workerLinks, setWorkerLinks] = useState(getWorkerLinks(""));
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const updateDeploymentStatus = useCallback((status: string | null) => {
    setDeploymentStatus(status);
    if (status === "ready") clearProvisioningCache();
  }, []);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const nextInstances = await listInstances();
      setInstances(nextInstances);

      try {
        const connection = await getConnection();
        updateDeploymentStatus(connection.deployment.status);
        setWorkerLinks(getWorkerLinks(getWorkerBaseUrl(connection)));
        setPlan(connection.plan ?? null);
      } catch {
        updateDeploymentStatus(null);
        setWorkerLinks(getWorkerLinks(""));
        setPlan(null);
      }

      try {
        const billing = await getBillingEntitlements();
        setPlan(billing.plan);
      } catch {
        /* plan may already be set from connection */
      }

      setError("");
    } catch (refreshError) {
      setInstances([]);
      updateDeploymentStatus(null);
      setWorkerLinks(getWorkerLinks(""));
      setPlan(null);
      setError(refreshError instanceof Error ? refreshError.message : "Could not load workspace state");
    } finally {
      setLoading(false);
    }
  }, [updateDeploymentStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const billingReturnHandled = useRef(false);
  useEffect(() => {
    if (billingReturnHandled.current || typeof window === "undefined") return;

    const params = getHashSearchParams();
    const billingResult = params.get("billing");
    if (!billingResult) return;

    billingReturnHandled.current = true;
    const cleanUrl = stripHashQueryParam("billing");

    if (billingResult === "success") {
      void (async () => {
        const toastId = toast.loading("Activating Wasup Pro...", {
          description: "Syncing your subscription from Stripe.",
        });
        try {
          const result = await syncBillingEntitlements();
          await refresh({ silent: true });
          toast.success("Wasup Pro is active", {
            id: toastId,
            description:
              result.plan.tier === "pro"
                ? "Your workspace is upgraded. Credentials and instance creation are unlocked."
                : "Subscription synced. Refresh if features are still locked.",
          });
        } catch (syncError) {
          toast.error("Could not confirm subscription yet", {
            id: toastId,
            description:
              syncError instanceof Error
                ? syncError.message
                : "Stripe may still be processing. Try refreshing in a minute.",
          });
        } finally {
          window.history.replaceState(null, "", cleanUrl);
        }
      })();
      return;
    }

    if (billingResult === "cancelled") {
      toast.message("Checkout cancelled", {
        description: "No changes were made to your billing.",
      });
      window.history.replaceState(null, "", cleanUrl);
    }
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
      workerLinks,
      plan,
      updateDeploymentStatus,
      refresh,
    }),
    [deploymentStatus, error, instances, loading, plan, provisioningActive, refresh, updateDeploymentStatus, workerLinks],
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

function getHashSearchParams() {
  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function stripHashQueryParam(name: string) {
  const { origin, pathname, search, hash } = window.location;
  const routePart = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = routePart.indexOf("?");
  if (queryIndex === -1) return `${origin}${pathname}${search}${hash}`;

  const path = routePart.slice(0, queryIndex) || "/";
  const params = new URLSearchParams(routePart.slice(queryIndex + 1));
  params.delete(name);
  const nextQuery = params.toString();
  return `${origin}${pathname}${search}#${path}${nextQuery ? `?${nextQuery}` : ""}`;
}

export function InlineProvisioningSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent ${className}`}
      aria-label="Provisioning"
    />
  );
}
