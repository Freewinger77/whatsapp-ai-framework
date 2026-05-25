import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertCircleIcon, CheckCircle2Icon, PlusIcon, XIcon } from "lucide-react";
import { REGION_OPTIONS } from "@/polymet/data/dashboard-data";
import { instanceGradient } from "@/polymet/data/instance-colors";
import {
  createBillingCheckout,
  createInstance,
  getBillingEntitlements,
  getProxyAvailability,
  regionLabelToCode,
  type BillingEntitlementsResult,
} from "@/polymet/lib/control-plane-api";
import { InlineProvisioningSpinner, useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import { InstancesGridSkeleton } from "@/polymet/components/page-skeletons";
import { instancePhoneLabel, instanceStatusDotClass, instanceStatusLabel } from "@/polymet/lib/instance-status";
import { wasupProSubscribeLabel, wasupProUpgradeDescription } from "@/polymet/lib/billing-copy";
import { showBillingPlanToast, showInstanceCreationTrialToast } from "@/polymet/lib/billing-plan-toast";
import { cn } from "@/lib/utils";

export function InstancesPage() {
  const { user } = useUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [createCardShake, setCreateCardShake] = useState(false);
  const { instances, error: workspaceError, provisioningActive, loading, refresh, plan } = useWorkspaceState();

  const startCheckout = async () => {
    try {
      const returnBase = `${window.location.origin}/#/instances`;
      const result = await createBillingCheckout({
        instanceQuantity: 1,
        contactEmail: user?.primaryEmailAddress?.emailAddress,
        successUrl: `${returnBase}?billing=success`,
        cancelUrl: `${returnBase}?billing=cancelled`,
      });
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      toast.error("Could not start checkout", {
        description: checkoutError instanceof Error ? checkoutError.message : "Please try again shortly.",
      });
    }
  };

  const handleCreateClick = () => {
    if (provisioningActive) return;

    if (plan?.canCreateInstances) {
      setCreateOpen(true);
      return;
    }

    setCreateCardShake(true);
    window.setTimeout(() => setCreateCardShake(false), 420);

    if (!plan || plan.tier === "free") {
      showInstanceCreationTrialToast(() => void startCheckout());
      return;
    }

    showBillingPlanToast(plan, () => void startCheckout());
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Instances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live WhatsApp numbers, regional proxies, webhooks, and pairing state.
          </p>
        </div>
      </div>

      {loading && instances.length === 0 ? (
        <InstancesGridSkeleton tiles={Math.max(2, instances.length || 2)} />
      ) : (
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {workspaceError && (
          <div className="col-span-full rounded-2xl border border-red-200 bg-red-50/70 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            We could not load your instances. Please refresh or try again shortly.
          </div>
        )}

        {instances.map((inst) => (
          <Link key={inst.id} to={`/instances/${inst.id}`} className="group block text-left">
            <InstanceGridTile
              footer={
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{inst.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{instancePhoneLabel(inst)}</div>
                  </div>
                  <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", instanceStatusDotClass(inst.status))} />
                </>
              }
            >
              <div
                className="absolute inset-0 overflow-hidden rounded-2xl border border-border/40 shadow-sm transition-all duration-300 ease-out will-change-transform group-hover:-translate-y-1 group-hover:shadow-xl group-hover:brightness-110"
                style={{ background: instanceGradient(inst.id) }}
              >
                <div className="absolute left-5 top-4 text-2xl font-semibold text-white/95 transition-transform duration-300 group-hover:translate-x-0.5">
                  {inst.name}
                </div>
                <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between gap-2 text-white/90">
                  <span className="rounded-full bg-black/20 px-3 py-1 text-xs backdrop-blur">{inst.region}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-xs backdrop-blur">
                    {(inst.status === "provisioning" || inst.status === "connecting") && (
                      <InlineProvisioningSpinner className="h-2.5 w-2.5" />
                    )}
                    {inst.status === "quality-warning" ? "⚠ " : ""}
                    {instanceStatusLabel(inst.status)}
                  </span>
                </div>
              </div>
            </InstanceGridTile>
          </Link>
        ))}

        <button
          type="button"
          onClick={handleCreateClick}
          disabled={provisioningActive}
          aria-label="Create instance"
          className={cn(
            "group block w-full text-left disabled:cursor-not-allowed disabled:opacity-60",
            createCardShake && "animate-wasup-shake",
          )}
        >
          <InstanceGridTile
            footer={
              <>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold text-foreground">Add instance</div>
                  <div className="text-sm text-muted-foreground">Create a new number</div>
                </div>
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
              </>
            }
          >
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:border-foreground/30 group-hover:bg-muted/60">
              <PlusIcon
                className="h-10 w-10 text-muted-foreground transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110"
                strokeWidth={1.5}
              />
            </div>
          </InstanceGridTile>
        </button>
      </div>
      )}

      {createOpen &&
        createPortal(
          <CreateInstanceModal
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false);
              void refresh();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function InstanceGridTile({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative w-full pt-[100%]">
        <div className="absolute inset-0">{children}</div>
      </div>
      <div className="flex min-h-[3.25rem] items-start justify-between gap-3">{footer}</div>
    </div>
  );
}

function CreateInstanceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user } = useUser();
  const navigate = useNavigate();
  const { provisioningActive } = useWorkspaceState();
  const [selectedRegion, setSelectedRegion] =
    useState<(typeof REGION_OPTIONS)[number]>("Finland");
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<Record<string, number>>({});
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [entitlementState, setEntitlementState] = useState<{
    status: "loading" | "ready" | "error";
    data: BillingEntitlementsResult | null;
    message: string;
  }>({ status: "loading", data: null, message: "" });
  const availableProxies = availability[regionLabelToCode(selectedRegion)];
  const entitlement = entitlementState.data?.entitlement;
  const createBlocked = provisioningActive || entitlementState.status !== "ready" || !entitlement?.allowed;

  useEffect(() => {
    getBillingEntitlements()
      .then((data) => setEntitlementState({ status: "ready", data, message: "" }))
      .catch((entitlementError) => {
        setEntitlementState({
          status: "error",
          data: null,
          message: entitlementError instanceof Error ? entitlementError.message : "Could not verify instance entitlement",
        });
      });

    getProxyAvailability()
      .then((payload) => {
        setAvailability(Object.fromEntries(payload.availability.map((item) => [item.region_code, item.free])));
      })
      .catch(() => setAvailability({}));
  }, []);

  const submit = async () => {
    if (createBlocked || submitting) return;
    setSubmitting(true);
    setError("");
    const toastId = toast.loading("Provisioning resources...", {
      description: "Workspace provisioning started.",
    });
    try {
      const result = await createInstance({ name: name.trim() || "WhatsApp instance", region: selectedRegion, webhookUrl: webhookUrl.trim() });
      const instanceId = result.instance?.id;
      const workerAttempted = Boolean((result.worker as { attempted?: unknown } | null | undefined)?.attempted);
      toast.success(workerAttempted ? "Instance created" : "Instance queued", {
        id: toastId,
        description: workerAttempted
          ? "Opening the instance settings page."
          : "Opening the instance settings page while the workspace worker finishes provisioning.",
      });
      onCreated();
      navigate(instanceId ? `/instances/${instanceId}` : "/instances");
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Could not create instance";
      setError(message);
      toast.error("Could not create instance", {
        id: toastId,
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startCheckout = async () => {
    setCheckoutLoading(true);
    setError("");
    try {
      const returnBase = `${window.location.origin}/#/instances`;
      const result = await createBillingCheckout({
        instanceQuantity: 1,
        contactEmail: user?.primaryEmailAddress?.emailAddress,
        successUrl: `${returnBase}?billing=success`,
        cancelUrl: `${returnBase}?billing=cancelled`,
      });
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Could not start checkout";
      setError(message);
      toast.error("Could not start checkout", { description: message });
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-2xl animate-pop-in sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Create WhatsApp instance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Name it, attach your webhook, and choose a region. Billing/proxy checks happen before worker deploy.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Instance name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
            </Field>
            <Field label="Region">
              <select
                value={selectedRegion}
                onChange={(event) =>
                  setSelectedRegion(
                    event.target.value as (typeof REGION_OPTIONS)[number],
                  )
                }
                className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              >
                {REGION_OPTIONS.map((region) => (
                  <option key={region}>{region}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Webhook URL">
            <input
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </Field>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          {provisioningActive && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Your workspace is provisioning. You can create another instance when it is ready.
            </div>
          )}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-medium text-foreground">
                {entitlement?.allowed ? (
                  <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircleIcon className="h-4 w-4 text-amber-600" />
                )}
                {provisioningActive ? "Workspace provisioning" : entitlementLabel(entitlementState)}
              </div>
              {entitlement && (
                <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground">
                  {entitlement.availableSlots}
                </span>
              )}
            </div>
            <p className="mt-1">
              {provisioningActive
                ? "Your workspace is provisioning. You can create another instance when it is ready."
                : entitlementDescription(entitlementState)}
            </p>
            <p className="mt-1">
              {availableProxies === undefined
                ? `Proxy availability for ${selectedRegion} will be checked during provisioning.`
                : `${selectedRegion} has ${availableProxies} ${availableProxies === 1 ? "proxy" : "proxies"} available.`}
            </p>
            {shouldShowUpgrade(entitlementState) && (
              <button
                type="button"
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="mt-3 inline-flex rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkoutLoading ? "Opening checkout..." : wasupProSubscribeLabel()}
              </button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || createBlocked}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create instance"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function entitlementLabel(state: {
  status: "loading" | "ready" | "error";
  data: BillingEntitlementsResult | null;
  message: string;
}) {
  if (state.status === "loading") return "Checking instance entitlement";
  if (state.status === "error") return "Entitlement check unavailable";
  const entitlement = state.data?.entitlement;
  if (!entitlement?.allowed) return "Instance creation unavailable";
  return "Wasup Pro slot available";
}

function entitlementDescription(state: {
  status: "loading" | "ready" | "error";
  data: BillingEntitlementsResult | null;
  message: string;
}) {
  if (state.status === "loading") return "Checking your workspace entitlement before enabling creation.";
  if (state.status === "error") return state.message || "Could not verify your workspace entitlement.";
  const entitlement = state.data?.entitlement;
  if (!entitlement) return "Could not verify your workspace entitlement.";
  if (!entitlement.allowed) return blockedEntitlementMessage(entitlement.reason);
  return `Wasup Pro — ${entitlement.availableSlots} of ${entitlement.paidInstanceLimit || state.data?.plan.proInstanceLimit || 5} instance slots available.`;
}

function blockedEntitlementMessage(reason: string | null) {
  if (reason === "pro_subscription_required") {
    return wasupProUpgradeDescription();
  }
  if (reason === "billing_locked") {
    return "Billing is suspended. Update payment to reconnect instances and create new ones.";
  }
  if (reason === "billing_grace") {
    return "Payment failed. Update billing during the 14-day grace period to keep creating instances.";
  }
  if (reason === "trial_expired") return "Your free trial has expired. Upgrade to Wasup Pro to create instances.";
  if (reason === "trial_instance_limit_reached") return "Free accounts cannot create instances. Upgrade to Wasup Pro.";
  if (reason === "instance_limit_reached") return "You reached the Pro limit of 5 instances.";
  if (reason?.startsWith("billing_status_")) return "Billing is not active for this workspace.";
  return "Upgrade to Wasup Pro to create instances.";
}

function shouldShowUpgrade(state: {
  status: "loading" | "ready" | "error";
  data: BillingEntitlementsResult | null;
  message: string;
}) {
  const reason = state.data?.entitlement.reason;
  return state.status === "ready" && !state.data?.entitlement.allowed && (
    reason === "trial_expired" ||
    reason === "trial_instance_limit_reached" ||
    reason === "instance_limit_reached" ||
    Boolean(reason?.startsWith("billing_status_"))
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
