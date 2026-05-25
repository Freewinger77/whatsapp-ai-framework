import { useEffect, useState } from "react";
import { useClerk, useOrganization, useUser } from "@clerk/clerk-react";
import { AlertTriangleIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  createBillingCheckout,
  createBillingPortalSession,
  getBillingEntitlements,
  resetCustomerWorkspace,
  type BillingEntitlementsResult,
} from "@/polymet/lib/control-plane-api";
import { ProBadge } from "@/polymet/components/pro-badge";
import { SettingsPageSkeleton } from "@/polymet/components/page-skeletons";
import { showBillingPlanToast } from "@/polymet/lib/billing-plan-toast";
import { wasupProPlanHint, wasupProSubscribeLabel } from "@/polymet/lib/billing-copy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 py-5 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0 shrink-0 sm:text-right">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { membership } = useOrganization();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [billing, setBilling] = useState<BillingEntitlementsResult | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingActionLoading, setBillingActionLoading] = useState<"checkout" | "portal" | null>(null);
  const canRequestReset = !!membership && membership.role.includes("owner");

  useEffect(() => {
    getBillingEntitlements()
      .then(setBilling)
      .catch(() => setBilling(null))
      .finally(() => setBillingLoading(false));
  }, []);

  const startCheckout = async () => {
    setBillingActionLoading("checkout");
    try {
      const returnBase = `${window.location.origin}/#/settings`;
      const result = await createBillingCheckout({
        instanceQuantity: 1,
        contactEmail: user?.primaryEmailAddress?.emailAddress,
        successUrl: `${returnBase}?billing=success`,
        cancelUrl: `${returnBase}?billing=cancelled`,
      });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      toast.error("Could not start checkout", {
        description: error instanceof Error ? error.message : "Please try again shortly.",
      });
    } finally {
      setBillingActionLoading(null);
    }
  };

  useEffect(() => {
    if (billingLoading || !billing?.plan || billing.plan.tier === "pro") return;
    showBillingPlanToast(billing.plan, () => void startCheckout());
  }, [billing, billingLoading]);

  const openBillingPortal = async () => {
    setBillingActionLoading("portal");
    try {
      const result = await createBillingPortalSession({
        returnUrl: `${window.location.origin}/#/settings`,
      });
      window.location.assign(result.portalUrl);
    } catch (error) {
      toast.error("Could not open billing portal", {
        description: error instanceof Error ? error.message : "Please try again shortly.",
      });
    } finally {
      setBillingActionLoading(null);
    }
  };

  const submitCustomerReset = async () => {
    if (deleteConfirmation !== "DELETE" || deleteLoading) return;

    setDeleteLoading(true);
    const toastId = toast.loading("Deleting workspace...", {
      description: "Cleaning instances, proxies, VM resources, and account data.",
    });

    try {
      const result = await resetCustomerWorkspace({ confirmation: "DELETE" });
      toast.success("Workspace deleted", {
        id: toastId,
        description: `${result.instancesDeleted} instance${result.instancesDeleted === 1 ? "" : "s"} cleaned up. Signing out...`,
      });
      setDeleteOpen(false);
      await signOut({ redirectUrl: "/#/sign-in" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace reset failed";
      toast.error("Workspace reset failed", {
        id: toastId,
        description: message,
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {billingLoading ? (
        <SettingsPageSkeleton />
      ) : (
        <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage billing and destructive workspace actions.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Billing
        </h2>
        <div className="rounded-xl border border-border/60 bg-card px-4 sm:px-5">
          <Row label="Plan" hint={wasupProPlanHint()}>
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-end gap-2 sm:justify-end">
                {billing?.plan?.tier === "pro" ? (
                  <>
                    <ProBadge />
                    <span className="text-muted-foreground">
                      {billing.billing.active_instance_count}/
                      {billing.plan?.proInstanceLimit || billing.billing.paid_instance_limit || 5} instances
                    </span>
                  </>
                ) : billingLoading ? (
                  "Loading..."
                ) : (
                  <span className="font-medium capitalize">
                    {billing?.plan?.tier || billing?.billing.billing_status || "Free"}
                  </span>
                )}
              </div>
              {billing?.plan?.currentPeriodEnd && (
                <div className="text-xs text-muted-foreground">
                  {billing.plan.billingStatus === "trialing" ? "Trial ends" : "Renews"}{" "}
                  {new Date(billing.plan.trialEndsAt || billing.plan.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </div>
              )}
            </div>
          </Row>
          <Row label="Wasup Pro" hint={wasupProPlanHint()}>
            <button
              type="button"
              onClick={startCheckout}
              disabled={billingActionLoading !== null}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {billingActionLoading === "checkout" ? "Opening..." : billing?.plan?.tier === "pro" ? "Manage upgrade" : wasupProSubscribeLabel()}
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </button>
          </Row>
          <Row label="Stripe customer portal" hint="Update payment method, invoices, or cancel your monthly subscription.">
            <button
              type="button"
              onClick={openBillingPortal}
              disabled={billingActionLoading !== null}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted sm:w-auto"
            >
              {billingActionLoading === "portal" ? "Opening..." : "Manage billing"}
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </button>
          </Row>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Danger Zone
        </h2>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 sm:px-5">
          <Row
            label="Delete customer workspace"
            hint="Permanently deletes instances, releases proxies, removes the worker VM, deletes workspace data, and closes this account."
          >
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              disabled={!canRequestReset}
              className="h-9 w-full rounded-md border border-destructive/40 bg-background px-3 text-sm font-medium text-destructive hover:bg-destructive/10 sm:w-auto"
            >
              Delete workspace
            </button>
            {!canRequestReset && (
              <p className="mt-2 text-xs text-muted-foreground">
                Only workspace owners can delete the customer account.
              </p>
            )}
          </Row>
        </div>
      </section>

      <Dialog open={deleteOpen} onOpenChange={(open) => !deleteLoading && setDeleteOpen(open)}>
        <DialogContent className="border-destructive/40">
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="h-5 w-5" />
            </div>
            <DialogTitle>Delete this customer workspace?</DialogTitle>
            <DialogDescription>
              This permanently deletes the workspace, WhatsApp instances, worker VM,
              logs, API keys, proxy assignments, organisation data, and your Clerk account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-muted-foreground">
              This does not delete Wasup platform infrastructure, Stripe products, or
              imported proxy pool records. Assigned proxies are released back to the pool.
            </div>
            <label className="block text-sm font-medium" htmlFor="delete-confirmation">
              Type <span className="font-mono text-destructive">DELETE</span> to confirm
            </label>
            <input
              id="delete-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              disabled={deleteLoading}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-60"
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLoading}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitCustomerReset}
              disabled={deleteLoading || deleteConfirmation !== "DELETE"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2Icon className="h-4 w-4" />
              {deleteLoading ? "Deleting..." : "Delete workspace"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}
