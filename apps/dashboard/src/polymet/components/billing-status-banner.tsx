import { AlertTriangleIcon, CreditCardIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { BillingEntitlementsResult } from "@/polymet/lib/control-plane-api";
import { wasupProUpgradeDescription } from "@/polymet/lib/billing-copy";

export function BillingStatusBanner({
  plan,
  onUpgrade,
  upgrading = false,
  className,
}: {
  plan: BillingEntitlementsResult["plan"] | null | undefined;
  onUpgrade?: () => void;
  upgrading?: boolean;
  className?: string;
}) {
  if (!plan) return null;

  if (plan.tier === "pro") return null;

  const graceEnds = plan.billingGraceEndsAt
    ? new Date(plan.billingGraceEndsAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const title =
    plan.tier === "locked"
      ? "Wasup Pro suspended"
      : plan.tier === "grace"
        ? "Payment failed — grace period active"
        : "Wasup Pro required";

  const description =
    plan.tier === "locked"
      ? "Your worker URL is offline and instances are disconnected. Update billing to restore access and reconnect."
      : plan.tier === "grace"
        ? `Update payment by ${graceEnds || "the grace deadline"} to avoid disconnecting instances and losing your worker URL.`
        : wasupProUpgradeDescription();

  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-4",
        plan.tier === "locked"
          ? "border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/30"
          : plan.tier === "grace"
            ? "border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/30"
            : "border-border/70 bg-muted/30",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangleIcon
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0",
              plan.tier === "locked" ? "text-red-600" : "text-amber-700 dark:text-amber-300",
            )}
          />
          <div>
            <div className="text-base font-semibold">{title}</div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
            {plan.tier === "pro" && plan.currentPeriodEnd && (
              <p className="mt-2 text-xs text-muted-foreground">
                Monthly subscription renews{" "}
                {new Date(plan.currentPeriodEnd).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                .
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          {onUpgrade ? (
            <button
              type="button"
              onClick={onUpgrade}
              disabled={upgrading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CreditCardIcon className="h-4 w-4" />
              {plan.tier === "locked" || plan.tier === "grace" ? "Update billing" : "Upgrade to Pro"}
            </button>
          ) : (
            <Link
              to="/settings"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"
            >
              <CreditCardIcon className="h-4 w-4" />
              Manage billing
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
