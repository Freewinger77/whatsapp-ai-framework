import { ExternalLinkIcon } from "lucide-react";

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
    <div className="flex items-start justify-between gap-6 border-b border-border/60 py-5 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage billing and destructive workspace actions.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Billing
        </h2>
        <div className="rounded-xl border border-border/60 bg-card px-5">
          <Row label="Stripe customer portal" hint="Update payment method, invoices, instance seats, and message credits.">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              Manage billing
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </button>
          </Row>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Danger Zone
        </h2>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5">
          <Row label="Delete workspace" hint="This action is permanent">
            <button
              type="button"
              className="h-9 rounded-md border border-destructive/40 bg-background px-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              Delete
            </button>
          </Row>
        </div>
      </section>
    </div>
  );
}
