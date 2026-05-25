import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { PlatformProxyPoolPanel } from "@/polymet/components/platform-proxy-pool-panel";
import { getPlatformOverview, type PlatformOverview, type PlatformOrgRow } from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";

type AdminTab = "overview" | "organizations" | "fleet" | "proxies";

const TIER_STYLES: Record<string, string> = {
  pro: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  grace: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  locked: "bg-red-500/15 text-red-300 ring-red-500/30",
  free: "bg-muted text-muted-foreground ring-border/60",
};

const DEPLOYMENT_STYLES: Record<string, string> = {
  ready: "text-emerald-300",
  failed: "text-red-300",
  provisioning: "text-amber-300",
  queued: "text-amber-300",
  dns_pending: "text-amber-300",
  suspended: "text-red-300",
  not_started: "text-muted-foreground",
};

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("overview");
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [fleetSearch, setFleetSearch] = useState("");

  const loadOverview = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getPlatformOverview();
      setOverview(data);
      setError("");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Could not load platform overview";
      setError(message);
      if (!silent) toast.error("Platform overview failed", { description: message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(true), 30_000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const filteredOrganizations = useMemo(() => {
    const query = orgSearch.trim().toLowerCase();
    if (!overview || !query) return overview?.organizations ?? [];
    return overview.organizations.filter(
      (org) =>
        org.name.toLowerCase().includes(query) ||
        org.slug.toLowerCase().includes(query) ||
        org.id.toLowerCase().includes(query) ||
        (org.apiBaseUrl || "").toLowerCase().includes(query),
    );
  }, [overview, orgSearch]);

  const filteredInstances = useMemo(() => {
    const query = fleetSearch.trim().toLowerCase();
    if (!overview || !query) return overview?.instances ?? [];
    return overview.instances.filter(
      (instance) =>
        instance.name.toLowerCase().includes(query) ||
        instance.orgName.toLowerCase().includes(query) ||
        instance.orgSlug.toLowerCase().includes(query) ||
        (instance.phone || "").toLowerCase().includes(query) ||
        instance.regionCode.toLowerCase().includes(query),
    );
  }, [overview, fleetSearch]);

  if (loading && !overview) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-muted/60" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-muted/30" />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Platform Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cross-tenant orgs, billing, worker VMs, instances, and proxy inventory.
          </p>
          {overview?.generatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Updated {new Date(overview.generatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadOverview(true)}
          disabled={refreshing}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          <RefreshCwIcon className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["overview", "Overview"],
            ["organizations", "Organizations"],
            ["fleet", "Fleet"],
            ["proxies", "Proxies"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              tab === key ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && overview && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Organizations" value={overview.summary.totalOrganizations} detail={`${overview.summary.proOrganizations} active Pro · ${overview.summary.trialingOrganizations} trialing`} />
            <StatCard label="Instances" value={overview.summary.totalInstances} detail={`${overview.summary.connectedInstances} connected`} />
            <StatCard label="Worker VMs" value={overview.summary.readyDeployments} detail={`${overview.summary.failedDeployments} failed`} />
            <StatCard label="Proxy pool" value={overview.summary.proxyFree} detail={`${overview.summary.proxyAssigned} assigned · ${overview.summary.proxyTotal} total`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Billing mix</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Pro" value={overview.summary.proOrganizations} />
                <Metric label="Trialing" value={overview.summary.trialingOrganizations} />
                <Metric label="Grace" value={overview.summary.graceOrganizations} />
                <Metric label="Locked" value={overview.summary.lockedOrganizations} />
                <Metric label="Free" value={overview.summary.freeOrganizations} />
              </div>
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Proxy by region</h2>
              <div className="space-y-2">
                {overview.proxyPool.map((region) => (
                  <div key={region.regionCode} className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm">
                    <span className="font-mono uppercase">{region.regionCode}</span>
                    <span className="text-muted-foreground">
                      {region.free} free · {region.assigned} assigned · {region.total} total
                    </span>
                  </div>
                ))}
                {!overview.proxyPool.length && (
                  <p className="text-sm text-muted-foreground">No proxies imported yet.</p>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent organizations</h2>
              <button type="button" onClick={() => setTab("organizations")} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                View all
              </button>
            </div>
            <OrgTable organizations={overview.organizations.slice(0, 8)} compact />
          </section>
        </div>
      )}

      {tab === "organizations" && overview && (
        <section className="space-y-4">
          <input
            value={orgSearch}
            onChange={(event) => setOrgSearch(event.target.value)}
            placeholder="Search org name, slug, ID, or base URL"
            className="h-10 w-full max-w-xl rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
            <OrgTable organizations={filteredOrganizations} />
          </div>
        </section>
      )}

      {tab === "fleet" && overview && (
        <section className="space-y-4">
          <input
            value={fleetSearch}
            onChange={(event) => setFleetSearch(event.target.value)}
            placeholder="Search instance, org, phone, or region"
            className="h-10 w-full max-w-xl rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Instance</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Region</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                </tr>
              </thead>
              <tbody>
                {filteredInstances.map((instance) => (
                  <tr key={instance.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{instance.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{instance.id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{instance.orgName}</div>
                      <div className="text-xs text-muted-foreground">{instance.orgSlug}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{instance.status}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase">{instance.regionCode}</td>
                    <td className="px-4 py-3 font-mono text-xs">{instance.phone || "—"}</td>
                  </tr>
                ))}
                {!filteredInstances.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No instances match this search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "proxies" && overview && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.proxyPool.map((region) => (
              <div key={region.regionCode} className="rounded-xl border border-border/60 bg-card px-4 py-3">
                <div className="font-mono text-xs uppercase text-muted-foreground">{region.regionCode}</div>
                <div className="mt-1 text-lg font-semibold">{region.free} free</div>
                <div className="text-xs text-muted-foreground">{region.assigned} assigned · {region.total} total</div>
              </div>
            ))}
          </div>
          <PlatformProxyPoolPanel />
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4 sm:px-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function OrgTable({ organizations, compact = false }: { organizations: PlatformOrgRow[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Organization</th>
            <th className="px-3 py-2 font-medium">Plan</th>
            <th className="px-3 py-2 font-medium">Billing</th>
            <th className="px-3 py-2 font-medium">Instances</th>
            {!compact && <th className="px-3 py-2 font-medium">VM</th>}
            {!compact && <th className="px-3 py-2 font-medium">Worker URL</th>}
          </tr>
        </thead>
        <tbody>
          {organizations.map((org) => (
            <tr key={org.id} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-3">
                <div className="font-medium">{org.name}</div>
                <div className="text-xs text-muted-foreground">{org.slug}</div>
                {!compact && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{org.id}</div>}
              </td>
              <td className="px-3 py-3">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TIER_STYLES[org.tier] || TIER_STYLES.free)}>
                  {org.tier}
                  {org.billingStatus === "trialing" ? " · trial" : ""}
                </span>
              </td>
              <td className="px-3 py-3">
                <div className="capitalize">{org.billingStatus || "none"}</div>
                {org.currentPeriodEnd && (
                  <div className="text-xs text-muted-foreground">
                    Renews {new Date(org.currentPeriodEnd).toLocaleDateString()}
                  </div>
                )}
                {org.instancesDeleteAfter && (
                  <div className="text-xs text-red-300">
                    Deletes {new Date(org.instancesDeleteAfter).toLocaleDateString()}
                  </div>
                )}
              </td>
              <td className="px-3 py-3">
                {org.activeInstanceCount}/{org.paidInstanceLimit || 0}
                <div className="text-xs text-muted-foreground">
                  {org.instanceCounts.connected} connected
                </div>
              </td>
              {!compact && (
                <td className="px-3 py-3">
                  <div className={cn("capitalize", DEPLOYMENT_STYLES[org.deployment?.status || "not_started"])}>
                    {org.deployment?.status || org.deploymentStatus || "not_started"}
                  </div>
                  {org.deployment?.lastError && (
                    <div className="mt-1 max-w-xs truncate text-xs text-red-300" title={org.deployment.lastError}>
                      {org.deployment.lastError}
                    </div>
                  )}
                  {org.deployment?.publicIp && (
                    <div className="font-mono text-xs text-muted-foreground">{org.deployment.publicIp}</div>
                  )}
                </td>
              )}
              {!compact && (
                <td className="px-3 py-3">
                  {org.deployment?.baseUrl || org.apiBaseUrl ? (
                    <a
                      href={org.deployment?.baseUrl || org.apiBaseUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
                    >
                      Open worker
                      <ExternalLinkIcon className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not provisioned</span>
                  )}
                </td>
              )}
            </tr>
          ))}
          {!organizations.length && (
            <tr>
              <td colSpan={compact ? 4 : 6} className="px-3 py-8 text-center text-muted-foreground">
                No organizations found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
