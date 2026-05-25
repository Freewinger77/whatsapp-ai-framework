import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@clerk/clerk-react";
import {
  LockIcon,
  CopyIcon,
  CheckIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { type ApiKey } from "@/polymet/data/dashboard-data";
import {
  createBillingCheckout,
  getConnection,
  rotateApiKey,
  type ControlPlaneConnection,
  type WorkspacePlan,
} from "@/polymet/lib/control-plane-api";
import { copyWithToast } from "@/polymet/lib/copy-to-clipboard";
import { loadOneTimeApiKeys, storeOneTimeApiKey } from "@/polymet/lib/one-time-api-keys";
import { ACTIVE_DEPLOYMENT_STATUSES, useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import { ConnectionPageSkeleton } from "@/polymet/components/page-skeletons";
import { CredentialsProOverlay } from "@/polymet/components/credentials-pro-overlay";
import { ProBadge } from "@/polymet/components/pro-badge";
import { cn } from "@/lib/utils";
import { getWorkerLinks } from "@/polymet/lib/worker-links";

function CopyButton({
  value,
  label,
  disabled = false,
  onCopied,
}: {
  value: string | null | undefined;
  label: string;
  disabled?: boolean;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = String(value || "").trim();
    if (!text || text.includes("...") || text === "Not available yet") {
      toast.error("Nothing to copy", {
        description: "Rotate the key to issue a copyable secret, or wait until the base URL is ready.",
      });
      return;
    }

    const copied = await copyWithToast(text, label);
    if (!copied) return;
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label={copied ? "Copied" : label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <CopyIcon className="h-4 w-4" />}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function CredentialRow({
  label,
  hint,
  value,
  copyValue,
  copyLabel,
  disabled = false,
  trailing,
}: {
  label: string;
  hint?: string;
  value: string;
  copyValue?: string | null;
  copyLabel: string;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 border-b border-border/60 px-5 py-5 last:border-b-0 sm:grid-cols-[minmax(0,11rem)_1fr_auto] sm:items-center sm:gap-6",
        disabled && "opacity-60",
      )}
    >
      <div>
        <div className="text-sm font-semibold text-foreground">{label}</div>
        {hint && <div className="mt-1 text-sm text-muted-foreground">{hint}</div>}
      </div>

      <div
        className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-4 py-3 font-mono text-sm select-all"
        onClick={(event) => {
          const selection = window.getSelection();
          if (!selection) return;
          selection.selectAllChildren(event.currentTarget);
        }}
      >
        <LockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{value}</span>
      </div>

      <div className="flex items-center gap-2 sm:justify-end">
        <CopyButton
          value={copyValue ?? (value !== "Not available yet" ? value : null)}
          label={copyLabel}
          disabled={!(copyValue ?? (value !== "Not available yet" ? value : null))}
        />
        {trailing}
      </div>
    </div>
  );
}

function KeyCredentialRow({
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
  const [rotating, setRotating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setDisplayValue(keyData.masked);
    if (keyData.oneTimeSecret) setOneTimeSecret(keyData.oneTimeSecret);
  }, [keyData.masked, keyData.oneTimeSecret]);

  const doRotate = () => {
    if (disabled) {
      setConfirmOpen(false);
      toast.info("Workspace is still provisioning", {
        description: "Key rotation unlocks when the workspace is ready.",
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
        toast.success("Key rotated", {
          description: "Copy the new secret now — it won't be shown again.",
        });
      })
      .catch(() => {
        setDisplayValue(keyData.masked);
        setOneTimeSecret(null);
      })
      .finally(() => {
        setRotating(false);
      });
  };

  const hint = oneTimeSecret
    ? "Full secret ready to copy in this session"
    : keyData.expires;

  return (
    <>
      <CredentialRow
        label={keyData.label}
        hint={hint}
        value={displayValue}
        copyValue={oneTimeSecret ?? keyData.publicId ?? null}
        copyLabel={oneTimeSecret ? `Copy ${keyData.label}` : `Copy ${keyData.label} public id`}
        disabled={disabled}
        trailing={
          <IconButton
            label="Rotate key"
            onClick={() => setConfirmOpen(true)}
            disabled={disabled}
          >
            <RefreshCwIcon className={cn("h-4 w-4", rotating && "animate-spin")} />
          </IconButton>
        }
      />

      {confirmOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => setConfirmOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl animate-pop-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40">
                <AlertTriangleIcon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold">Rotate {keyData.label}?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The current key stops working immediately. You'll get one chance to copy the replacement in this browser.
              </p>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="h-10 rounded-lg border border-border px-4 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={doRotate}
                  disabled={disabled}
                  className="h-10 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rotate key
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function StatusBanner({
  provisioningActive,
  failed,
  deploymentStatus,
  deploymentProgress,
  error,
}: {
  provisioningActive: boolean;
  failed: boolean;
  deploymentStatus: string;
  deploymentProgress: ControlPlaneConnection["deployment"]["progress"] | null;
  error: string;
}) {
  if (!provisioningActive && !failed && !error) return null;

  const message = failed
    ? deploymentProgress?.message || error || "Setup didn't finish. Retry shortly or contact support."
    : deploymentProgress?.message || "Preparing your worker and credentials.";

  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4",
        failed
          ? "border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/30"
          : "border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/30",
      )}
    >
      <div className="flex items-start gap-3">
        {provisioningActive ? (
          <RefreshCwIcon className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
        ) : (
          <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-300" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">
            {provisioningActive ? "Setting up your workspace" : "Connection needs attention"}
          </div>
          <p
            role="status"
            aria-live="polite"
            className={cn(
              "mt-1 text-sm leading-relaxed",
              failed ? "text-red-700 dark:text-red-200" : "text-amber-900/80 dark:text-amber-100/80",
            )}
          >
            {message}
          </p>
          {provisioningActive && (
            <p className="mt-2 text-sm text-amber-900/70 dark:text-amber-100/70">
              We'll email you when it's ready. You can stay on this page.
            </p>
          )}
        </div>
        <span
          className={cn(
            "hidden shrink-0 rounded-full px-3 py-1 text-xs font-medium capitalize sm:inline-flex",
            failed
              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
          )}
        >
          {deploymentStatus.replace(/_/g, " ")}
        </span>
      </div>
    </div>
  );
}

export function ConnectionPage() {
  const { user } = useUser();
  const { refresh, updateDeploymentStatus } = useWorkspaceState();
  const [orgId, setOrgId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [deploymentStatus, setDeploymentStatus] = useState("not_started");
  const [deploymentProgress, setDeploymentProgress] = useState<ControlPlaneConnection["deployment"]["progress"] | null>(null);
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [credentialsLocked, setCredentialsLocked] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
      setPlan(connection.plan ?? null);
      setCredentialsLocked(Boolean(connection.credentialsLocked));
      setBaseUrl(connection.credentialsLocked ? "" : connection.organization.baseUrl || connection.deployment.base_url || "");
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
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
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
  const ready = deploymentStatus === "ready" && !error;
  const workerLinks = getWorkerLinks(baseUrl);

  const startCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const returnBase = `${window.location.origin}/#/connection`;
      const result = await createBillingCheckout({
        instanceQuantity: 1,
        contactEmail: user?.primaryEmailAddress?.emailAddress,
        successUrl: `${returnBase}?billing=success`,
        cancelUrl: `${returnBase}?billing=cancelled`,
      });
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      toast.error("Could not start checkout", {
        description: checkoutError instanceof Error ? checkoutError.message : "Checkout failed",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

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
          description: progressMessage,
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
          description: "Your credentials are ready to use.",
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
    <div className="mx-auto max-w-4xl space-y-8">
      {loading ? (
        <ConnectionPageSkeleton />
      ) : (
        <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Connection</h1>
            {plan?.tier === "pro" && <ProBadge />}
          </div>
          <p className="mt-2 max-w-xl text-base text-muted-foreground">
            Base URL and API keys for every instance in this workspace.
          </p>
          {plan?.tier === "pro" && plan.currentPeriodEnd && (
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly subscription renews{" "}
              {new Date(plan.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.
            </p>
          )}
        </div>
        {ready && plan?.tier === "pro" && (
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Ready
          </span>
        )}
      </div>

      <StatusBanner
        provisioningActive={provisioningActive}
        failed={failed}
        deploymentStatus={deploymentStatus}
        deploymentProgress={deploymentProgress}
        error={error}
      />

      {credentialsLocked ? (
        <CredentialsProOverlay plan={plan} onUpgrade={() => void startCheckout()} upgrading={checkoutLoading} />
      ) : (
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <div className="border-b border-border/60 px-5 py-4">
          <h2 className="text-lg font-semibold">Credentials</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use these in your app or automation. Rotate a key to reveal a copyable secret.
          </p>
        </div>

        <CredentialRow
          label="Base URL"
          hint="API endpoint for this workspace"
          value={baseUrl || "Not available yet"}
          copyValue={baseUrl || null}
          copyLabel="Copy base URL"
          disabled={!baseUrl}
        />

        {keyedRows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            API keys appear here once provisioning finishes.
          </div>
        ) : (
          keyedRows.map(({ key, kind }) => (
            <KeyCredentialRow
              key={key.id}
              keyData={key}
              keyKind={kind}
              orgId={orgId}
              disabled={provisioningActive}
            />
          ))
        )}
      </section>
      )}

      <p className="text-sm text-muted-foreground">
        Production keys use <span className="font-mono text-foreground/80">sk-prod</span>, development keys use{" "}
        <span className="font-mono text-foreground/80">sk-dev</span>. Full secrets are only shown once after rotation.
        {ready && workerLinks.playgroundUrl && (
          <>
            {" "}
            Paste a key into the{" "}
            <a href={workerLinks.playgroundUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">
              worker test console
            </a>
            .
          </>
        )}
      </p>
        </>
      )}
    </div>
  );
}
