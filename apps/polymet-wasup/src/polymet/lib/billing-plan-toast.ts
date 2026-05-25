import { toast } from "sonner";
import type { WorkspacePlan } from "@/polymet/lib/control-plane-api";
import { wasupProSubscribeLabel, wasupProUpgradeDescription } from "@/polymet/lib/billing-copy";

export function showInstanceCreationTrialToast(onStartTrial: () => void) {
  toast("Start your trial to create instances", {
    id: "billing-instance-trial-required",
    description: wasupProUpgradeDescription(),
    duration: 8000,
    action: {
      label: wasupProSubscribeLabel(),
      onClick: onStartTrial,
    },
  });
}

export function showBillingPlanToast(plan: WorkspacePlan, onUpgrade?: () => void) {
  if (plan.tier === "pro") return;

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
      ? "Your worker URL is offline and instances are disconnected. Update billing to restore access."
      : plan.tier === "grace"
        ? `Update payment by ${graceEnds || "the deadline"} to keep your worker URL and API keys.`
        : wasupProUpgradeDescription();

  const cta = plan.tier === "locked" || plan.tier === "grace" ? "Update billing" : "Upgrade to Pro";

  toast(title, {
    id: `billing-plan-${plan.tier}`,
    description,
    duration: plan.tier === "free" ? 8000 : 12000,
    action: onUpgrade
      ? {
          label: cta,
          onClick: onUpgrade,
        }
      : undefined,
  });
}
