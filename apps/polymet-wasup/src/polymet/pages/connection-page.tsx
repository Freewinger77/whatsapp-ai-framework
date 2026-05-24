import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  LockIcon,
  CopyIcon,
  CheckIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
} from "lucide-react";
import { toast } from "sonner";
import { type ApiKey } from "@/polymet/data/dashboard-data";
import { getConnection, rotateApiKey, type ControlPlaneConnection } from "@/polymet/lib/control-plane-api";
import { loadOneTimeApiKeys, storeOneTimeApiKey } from "@/polymet/lib/one-time-api-keys";
import { ACTIVE_DEPLOYMENT_STATUSES, useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import { cn } from "@/lib/utils";

function IconButton({
  label,
  tooltip,
  onClick,
  children,
  className,
  disabled = false,
}: {
  label: string;
  tooltip?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
          className
        )}
      >
        {children}
      </button>
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow transition-opacity group-hover:opacity-100">
          {tooltip}
        </div>
      )}
    </div>
  );
}

function KeyRow({
  keyData,
  keyKind,
  orgId,
  disabled = false,
}: {
  keyData: ApiKey;
  keyKind?: "live" | "test";
  orgId: string;
  disabled?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(keyData.masked);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(keyData.oneTimeSecret || null);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const copyValue = oneTimeSecret;
  const copyLabel = oneTimeSecret ? "Copy full secret" : "Full key unavailable";
  const statusLabel = oneTimeSecret ? "Ready to copy" : "Rotate to issue copyable key";

  useEffect(() => {
    setDisplayValue(keyData.masked);
    if (keyData.oneTimeSecret) setOneTimeSecret(keyData.oneTimeSecret);
  }, [keyData.masked, keyData.oneTimeSecret]);

  const doCopy = async () => {
    if (!copyValue || copyValue.includes("...")) {
      toast.error("Full key unavailable", {
        description: "Existing secrets cannot be recovered. Rotate this key to issue a replacement.",
      });
      return;
    }

    try {
      await navigator.clipboard?.writeText(copyValue);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 7000);
  };

  const doRotate = () => {
    if (disabled) {
      setConfirmOpen(false);
      toast.info("Workspace is still provisioning", {
        description: "API key rotation unlocks when the workspace is ready.",
      });
      return;
    }

    setConfirmOpen(false);
    setRotating(true);
    const rotate = keyKind
      ? rotateApiKey(keyKind)
      : Promise.reject(new Error("Unknown key kind"));

    rotate
      .then((result) => {
        setDisplayValue(result.apiKey.masked);
        setOneTimeSecret(result.secret);
        if (orgId) {
          storeOneTimeApiKey(orgId, {
            id: result.apiKey.id,
            public_id: result.apiKey.public_id,
            key_kind: result.apiKey.key_kind,
            secret: result.secret,
          });
        }
      })
      .catch(() => {
        setDisplayValue(keyData.masked);
        setOneTimeSecret(null);
      })
      .finally(() => {
        setRotating(false);
      });
  };

  return (
    <div
      aria-disabled={disabled}
      className={cn(
        "rounded-2xl border border-border/60 bg-card/80 p-5 transition-colors",
        disabled && "border-dashed bg-muted/20 text-muted-foreground shadow-none",
      )}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-base font-semibold">{keyData.label}</div>
          <div className="text-sm text-muted-foreground">{keyData.expires}</div>
        </div>
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]",
            oneTimeSecret
              ? "border-emerald-300/40 bg-emerald-100/70 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-border bg-muted/60 text-muted-foreground",
          )}
        >
          {oneTimeSecret && <CheckIcon className="h-3 w-3" />}
          {statusLabel}
        </span>
      </div>
      <p className={cn("mb-3 text-xs", oneTimeSecret ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
        {oneTimeSecret
          ? "A full key is available in this browser session. The key stays masked on screen, but Copy uses the real secret."
          : "The saved secret cannot be recovered. Rotate only when you want to replace this credential."}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/60 px-4 py-2.5 font-mono text-sm transition-opacity sm:max-w-md",
            rotating && "opacity-60",
            disabled && "bg-muted/30 text-muted-foreground/70 ring-1 ring-border/40",
          )}
        >
          <LockIcon className={cn("h-4 w-4 text-muted-foreground", disabled && "text-muted-foreground/50")} />
          <span className="truncate">{displayValue}</span>
        </div>

        <div className="group relative">
          <button
            type="button"
            onClick={doCopy}
            disabled={!copyValue}
            aria-label={copied ? "Copied" : copyLabel}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            {copied ? (
              <CheckIcon className="h-4 w-4 text-emerald-600" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
          </button>
          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow transition-opacity group-hover:opacity-100">
            {copied ? "Copied!" : copyLabel}
          </div>
        </div>

        <IconButton
          label="Rotate key"
          tooltip={disabled ? "Available when ready" : "Rotate key"}
          onClick={() => setConfirmOpen(true)}
          disabled={disabled}
        >
          <RefreshCwIcon
            className={cn("h-4 w-4", rotating && "animate-spin text-foreground")}
          />
        </IconButton>
      </div>

      {confirmOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-4"
            onClick={() => setConfirmOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-2xl animate-pop-in sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40">
                <AlertTriangleIcon className="h-5 w-5" />
              </div>
              <div className="text-base font-semibold">Rotate {keyData.label}?</div>
              <p className="mt-1 text-sm text-muted-foreground">
                This action will replace the saved key and make the new secret copyable in this browser session.
                The key remains masked on screen and the old key stops working immediately.
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={doRotate}
                  disabled={disabled}
                  className="h-9 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rotate key
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function BaseUrlCard({ baseUrl, disabled }: { baseUrl: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    if (!baseUrl) return;
    try {
      await navigator.clipboard?.writeText(baseUrl);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div
      aria-disabled={disabled}
      className={cn(
        "rounded-2xl border border-border/60 bg-card/80 p-5 transition-colors",
        disabled && "border-dashed bg-muted/20 text-muted-foreground shadow-none",
      )}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-base font-semibold">Organisation base URL</div>
          <div className="text-sm text-muted-foreground">
            Use this endpoint for API calls and worker diagnostics.
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {baseUrl ? "Ready to copy" : "Pending"}
        </span>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/60 px-4 py-2.5 font-mono text-sm transition-opacity sm:max-w-md",
            disabled && "bg-muted/30 text-muted-foreground/70 ring-1 ring-border/40",
          )}
        >
          <LockIcon className={cn("h-4 w-4 text-muted-foreground", disabled && "text-muted-foreground/50")} />
          <span className="truncate">{baseUrl || "Not available yet"}</span>
        </div>
        <IconButton
          label={copied ? "Copied base URL" : "Copy base URL"}
          tooltip={copied ? "Copied!" : "Copy base URL"}
          onClick={copyUrl}
          disabled={!baseUrl}
        >
          {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <CopyIcon className="h-4 w-4" />}
        </IconButton>
      </div>
    </div>
  );
}

function DownloadTile({ title, disabled = false }: { title: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="group flex h-28 w-32 flex-col justify-between rounded-xl border border-border/60 bg-card p-4 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-muted/50 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-card disabled:hover:shadow-none"
    >
      <div className="text-sm font-semibold leading-tight whitespace-pre-line">
        {title}
      </div>
      <div className="flex items-center justify-between gap-2">
        <CopyIcon className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:scale-110" />
        {disabled && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Disabled</span>}
      </div>
    </button>
  );
}

export function ConnectionPage() {
  const { refresh, updateDeploymentStatus } = useWorkspaceState();
  const [orgId, setOrgId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [deploymentStatus, setDeploymentStatus] = useState("not_started");
  const [deploymentProgress, setDeploymentProgress] = useState<ControlPlaneConnection["deployment"]["progress"] | null>(null);
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const lastDeploymentStatusRef = useRef<string | null>(null);
  const lastProvisioningNoticeKeyRef = useRef<string | null>(null);
  const sawProvisioningRef = useRef(false);
  const terminalNoticeStatusRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof window.setInterval> | undefined;

    const applyConnection = (connection: ControlPlaneConnection) => {
      const nextStatus = connection.deployment.status;
      const oneTimeKeys = [
        ...loadOneTimeApiKeys(connection.organization.id),
        ...(connection.oneTimeApiKeys ?? []),
      ];
      const oneTimeSecretById = new Map(oneTimeKeys.map((key) => [key.id, key.secret]));
      setOrgId(connection.organization.id);
      setBaseUrl(connection.organization.baseUrl || connection.deployment.base_url || "");
      setDeploymentStatus(nextStatus);
      updateDeploymentStatus(nextStatus);
      setDeploymentProgress(connection.deployment.progress);
      setApiKeys((currentKeys) => {
        const existingSecretById = new Map(
          currentKeys
            .filter((key) => key.oneTimeSecret)
            .map((key) => [key.id, key.oneTimeSecret as string]),
        );

        return connection.apiKeys.map((key) => ({
          id: key.id,
          label: key.key_kind === "live" ? "Production key" : "Development key",
          expires: key.expires_at ? `Expires ${new Date(key.expires_at).toLocaleDateString()}` : "Never expires",
          masked: key.masked,
          publicId: key.public_id,
          keyKind: key.key_kind,
          oneTimeSecret: oneTimeSecretById.get(key.id) || existingSecretById.get(key.id),
        }));
      });
      setError("");

      if (nextStatus === "ready" && lastDeploymentStatusRef.current !== "ready") {
        void refresh();
      }
      lastDeploymentStatusRef.current = nextStatus;
    };

    const loadConnection = () => {
      getConnection()
        .then((connection) => {
          if (cancelled) return;
          applyConnection(connection);

          const shouldPoll = ACTIVE_DEPLOYMENT_STATUSES.has(connection.deployment.status);
          if (shouldPoll && !pollTimer) {
            pollTimer = window.setInterval(loadConnection, 5000);
          } else if (!shouldPoll && pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = undefined;
          }
        })
        .catch((connectionError) => {
          if (cancelled) return;
          setBaseUrl("");
          setOrgId("");
          setApiKeys([]);
          setDeploymentStatus("unavailable");
          updateDeploymentStatus("unavailable");
          setDeploymentProgress(null);
          setError(connectionError instanceof Error ? connectionError.message : "Could not load connection details");
        });
    };

    loadConnection();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [refresh, updateDeploymentStatus]);

  const keyedRows = useMemo(
    () => apiKeys.map((key) => ({ key, kind: key.keyKind })),
    [apiKeys],
  );
  const provisioningActive = ACTIVE_DEPLOYMENT_STATUSES.has(deploymentStatus);
  const failed = deploymentStatus === "failed";

  useEffect(() => {
    const progressMessage =
      deploymentProgress?.message ||
      deploymentProgress?.label ||
      "Preparing your workspace.";
    const progressStage = deploymentProgress?.stage || deploymentStatus;

    if (provisioningActive) {
      const noticeKey = `${deploymentStatus}:${progressStage}:${progressMessage}`;
      sawProvisioningRef.current = true;
      terminalNoticeStatusRef.current = null;

      if (lastProvisioningNoticeKeyRef.current !== noticeKey) {
        lastProvisioningNoticeKeyRef.current = noticeKey;
        toast("Workspace provisioning", {
          id: "workspace-provisioning",
          description: `${progressMessage} We'll email you when it's ready, or you can wait here.`,
          duration: 7000,
          icon: <RefreshCwIcon className="h-4 w-4 animate-spin" />,
        });
      }
      return;
    }

    lastProvisioningNoticeKeyRef.current = null;

    if (deploymentStatus === "ready") {
      if (sawProvisioningRef.current && terminalNoticeStatusRef.current !== "ready") {
        terminalNoticeStatusRef.current = "ready";
        toast.success("Workspace ready", {
          id: "workspace-provisioning",
          description: "Your workspace is ready to use.",
          duration: 6000,
        });
      }
      sawProvisioningRef.current = false;
      return;
    }

    if (failed && terminalNoticeStatusRef.current !== "failed") {
      terminalNoticeStatusRef.current = "failed";
      toast.error("Workspace provisioning failed", {
        id: "workspace-provisioning",
        description:
          deploymentProgress?.message ||
          error ||
          "Please retry in a moment or contact support if this keeps happening.",
        duration: 10000,
      });
    }
  }, [
    deploymentProgress?.label,
    deploymentProgress?.message,
    deploymentProgress?.stage,
    deploymentStatus,
    error,
    failed,
    provisioningActive,
  ]);

  return (
    <div className="space-y-6 sm:space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Connection</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage org-level API credentials for every instance in this workspace.
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="text-sm text-muted-foreground">Workspace connection status</div>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-semibold sm:text-lg">
              {provisioningActive ? "Provisioning workspace" : failed ? "Connection needs attention" : "Connection ready"}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {provisioningActive
                ? "We are preparing the worker, credentials, and routing for this workspace."
                : failed
                  ? "Workspace setup did not finish. Advanced details are available below."
                  : "Org-level credentials are available for every instance in this workspace."}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs uppercase tracking-wider",
              failed
                ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                : provisioningActive
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {provisioningActive && <RefreshCwIcon className="h-3 w-3 animate-spin" />}
            {deploymentStatus}
          </span>
        </div>
        {deploymentProgress && (
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "mt-3 flex items-center gap-2 text-sm",
              failed ? "text-red-600 dark:text-red-300" : "text-muted-foreground",
            )}
          >
            {provisioningActive && (
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
                aria-label="Provisioning"
              />
            )}
            <span>{deploymentProgress.message}</span>
          </p>
        )}
        {failed && !error && (
          <p className="mt-2 text-sm text-muted-foreground">
            Please retry in a moment or contact support if this keeps happening.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="mt-4 rounded-xl border border-border/60 bg-muted/20">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
            aria-expanded={advancedOpen}
          >
            <span>Advanced connection details</span>
            <ChevronDownIcon className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen && (
            <div className="space-y-3 border-t border-border/60 px-4 py-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Organisation base URL
                </div>
                <div className="mt-2 break-all font-mono text-sm font-semibold">
                  {baseUrl || "Not available yet"}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this URL only for advanced worker diagnostics or direct API integrations.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:gap-10">
        <div className="space-y-6 sm:space-y-10">
          <BaseUrlCard baseUrl={baseUrl} disabled={!baseUrl} />
          {keyedRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
              API keys will appear here once this workspace has connection credentials.
            </div>
          ) : (
            keyedRows.map(({ key, kind }) => (
              <KeyRow key={key.id} keyData={key} keyKind={kind} orgId={orgId} disabled={provisioningActive} />
            ))
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 self-end sm:flex sm:gap-4">
          <DownloadTile title={"MCP\nJSON"} disabled />
          <DownloadTile title={"API\nSPEC"} disabled />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Production keys use the sk-prod prefix and Development keys use sk-dev. Copy buttons only copy full secrets that are available in this browser session; they never copy masked dots or public IDs.
      </p>
      <p className="text-xs text-muted-foreground">
        MCP configuration and OpenAPI copy/download actions are disabled in the customer dashboard for now.
      </p>
    </div>
  );
}
