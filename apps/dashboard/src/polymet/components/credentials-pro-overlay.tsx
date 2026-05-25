import { CreditCardIcon, LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspacePlan } from "@/polymet/lib/control-plane-api";
import { wasupProUpgradeDescription } from "@/polymet/lib/billing-copy";

function PlaceholderCredentialRow({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div className="grid gap-4 border-b border-border/60 px-5 py-5 last:border-b-0 sm:grid-cols-[minmax(0,11rem)_1fr_auto] sm:items-center sm:gap-6">
      <div>
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <div className="mt-1 text-sm text-muted-foreground">{hint}</div>
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/50 px-4 py-3 font-mono text-sm">
        <LockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-muted-foreground">{value}</span>
      </div>
      <div className="hidden h-9 w-9 rounded-lg border border-border/70 sm:block" />
    </div>
  );
}

export function CredentialsProOverlay({
  plan,
  onUpgrade,
  upgrading = false,
  className,
}: {
  plan: WorkspacePlan | null;
  onUpgrade: () => void;
  upgrading?: boolean;
  className?: string;
}) {
  const tier = plan?.tier ?? "free";
  const graceEnds = plan?.billingGraceEndsAt
    ? new Date(plan.billingGraceEndsAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  const title =
    tier === "locked"
      ? "Wasup Pro suspended"
      : tier === "grace"
        ? "Update payment to keep access"
        : "Unlock with Wasup Pro";

  const description =
    tier === "locked"
      ? "Your worker URL is offline and instances are disconnected. Restore billing to access credentials again."
      : tier === "grace"
        ? `Payment failed. Update billing by ${graceEnds || "the deadline"} to keep your base URL and API keys.`
        : wasupProUpgradeDescription();

  const cta = tier === "locked" || tier === "grace" ? "Update billing" : "Upgrade to Pro";

  return (
    <section className={cn("relative overflow-hidden rounded-2xl border border-border/60 bg-card", className)}>
      <div className="border-b border-border/60 px-5 py-4">
        <h2 className="text-lg font-semibold">Credentials</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use these in your app or automation. Rotate a key to reveal a copyable secret.
        </p>
      </div>

      <div className="relative min-h-[320px]">
      <div className="pointer-events-none select-none blur-[6px]" aria-hidden="true">
        <PlaceholderCredentialRow
          label="Base URL"
          hint="API endpoint for this workspace"
          value="https://your-workspace.wasup.co"
        />
        <PlaceholderCredentialRow
          label="Production key"
          hint="Never expires"
          value="sk-prod_••••••••••••••••"
        />
        <PlaceholderCredentialRow
          label="Development key"
          hint="Never expires"
          value="sk-dev_••••••••••••••••"
        />
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-background/55 p-4 backdrop-blur-[2px]">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <LockIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          <button
            type="button"
            onClick={onUpgrade}
            disabled={upgrading}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[200px]"
          >
            <CreditCardIcon className="h-4 w-4" />
            {upgrading ? "Opening checkout..." : cta}
          </button>
        </div>
      </div>
      </div>
    </section>
  );
}
