import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { PlatformProxyPoolPanel } from "@/polymet/components/platform-proxy-pool-panel";
import {
  blockPlatformOrganization,
  deletePlatformOrganization,
  deletePlatformOrganizationVm,
  getPlatformOverview,
  removeProxyFromPool,
  unblockPlatformOrganization,
  type PlatformOverview,
  type PlatformOrgRow,
  type PlatformProxyRow,
} from "@/polymet/lib/control-plane-api";
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
  const [proxySearch, setProxySearch] = useState("");
  const [proxyStatusFilter, setProxyStatusFilter] = useState<"all" | "free" | "assigned">("all");
  const [actionOrgId, setActionOrgId] = useState<string | null>(null);

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

  const filteredProxies = useMemo(() => {
    if (!overview) return [];
    const query = proxySearch.trim().toLowerCase();
    return overview.proxies.filter((proxy) => {
      if (proxyStatusFilter === "free" && proxy.status !== "free") return false;
      if (proxyStatusFilter === "assigned" && proxy.status !== "assigned") return false;
      if (!query) return true;
      return (
        proxy.host.toLowerCase().includes(query) ||
        proxy.regionCode.toLowerCase().includes(query) ||
        (proxy.orgSlug || "").toLowerCase().includes(query) ||
        (proxy.instanceName || "").toLowerCase().includes(query)
      );
    });
  }, [overview, proxySearch, proxyStatusFilter]);

  const runOrgAction = async (orgId: string, action: () => Promise<unknown>, successMessage: string) => {
    setActionOrgId(orgId);
    try {
      await action();
      toast.success(successMessage);
      await loadOverview(true);
    } catch (actionError) {
      toast.error("Action failed", {
        description: actionError instanceof Error ? actionError.message : "Please try again.",
      });
    } finally {
      setActionOrgId(null);
    }
  };

  const handleRemoveProxy = async (proxy: PlatformProxyRow, force = false) => {
    const label = `${proxy.host}:${proxy.port}`;
    if (proxy.status === "assigned" && !force) {
      const confirmed = window.confirm(
        `${label} is assigned to ${proxy.instanceName || "an instance"}. Force remove anyway?`,
      );
      if (!confirmed) return;
      return handleRemoveProxy(proxy, true);
    }

    if (!window.confirm(`Remove proxy ${label} from the pool?`)) return;

    try {
      await removeProxyFromPool(proxy.id, force);
      toast.success("Proxy removed");
      await loadOverview(true);
    } catch (removeError) {
      toast.error("Could not remove proxy", {
        description: removeError instanceof Error ? removeError.message : "Please try again.",
      });
    }
  };

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
            Orgs, billing, VMs, instances, proxy pool utilization, and operator actions.
          </p>
          {overview?.generatedAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Updated {new Date(overview.generatedAt).toLocaleString()}
              {overview.summary.totalVmCostUsd > 0 && (
                <> · Est. fleet VM cost ${overview.summary.totalVmCostUsd.toFixed(2)}/mo</>
              )}
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Organizations" value={overview.summary.totalOrganizations} detail={`${overview.summary.blockedOrganizations} blocked`} />
            <StatCard label="Instances" value={overview.summary.totalInstances} detail={`${overview.summary.connectedInstances} connected`} />
            <StatCard label="Worker VMs" value={overview.summary.readyDeployments} detail={`${overview.summary.failedDeployments} failed`} />
            <StatCard label="Proxy pool" value={overview.summary.proxyFree} detail={`${overview.summary.proxyAssigned} assigned · ${overview.summary.proxyTotal} total`} />
            <StatCard label="Est. VM cost" value={overview.summary.totalVmCostUsd} detail="USD / month (fleet)" prefix="$" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Billing mix</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Pro" value={overview.summary.proOrganizations} />
                <Metric label="Trialing" value={overview.summary.trialingOrganizations} />
                <Metric label="Grace" value={overview.summary.graceOrganizations} />
                <Metric label="Blocked" value={overview.summary.blockedOrganizations} />
                <Metric label="Locked" value={overview.summary.lockedOrganizations} />
                <Metric label="Free" value={overview.summary.freeOrganizations} />
              </div>
            </section>

            <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Proxy utilization</h2>
              <div className="space-y-2">
                {overview.proxyPool.map((region) => (
                  <div key={region.regionCode} className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2 text-sm">
                    <span className="font-mono uppercase">{region.regionCode}</span>
                    <span className="text-muted-foreground">
                      {region.assigned} in use · {region.free} free · {region.total} total
                    </span>
                  </div>
                ))}
                {!overview.proxyPool.length && <p className="text-sm text-muted-foreground">No proxies imported yet.</p>}
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
            <OrgTable organizations={overview.organizations.slice(0, 8)} compact actionOrgId={actionOrgId} onAction={runOrgAction} />
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
            <OrgTable organizations={filteredOrganizations} actionOrgId={actionOrgId} onAction={runOrgAction} />
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
                <div className="mt-1 text-lg font-semibold">{region.assigned} in use</div>
                <div className="text-xs text-muted-foreground">{region.free} free · {region.total} total</div>
              </div>
            ))}
          </div>

          <PlatformProxyPoolPanel onChanged={() => void loadOverview(true)} />

          <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">All proxies</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {overview.summary.proxyAssigned} assigned · {overview.summary.proxyFree} free · {overview.summary.proxyTotal} total
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["all", "assigned", "free"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setProxyStatusFilter(filter)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium capitalize",
                      proxyStatusFilter === filter ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={proxySearch}
              onChange={(event) => setProxySearch(event.target.value)}
              placeholder="Search host, region, org, or instance"
              className="mb-4 h-10 w-full max-w-xl rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-border/60 bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Proxy</th>
                    <th className="px-3 py-2 font-medium">Region</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Utilization</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProxies.map((proxy) => (
                    <tr key={proxy.id} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-2 font-mono">{proxy.host}:{proxy.port}</td>
                      <td className="px-3 py-2 uppercase">{proxy.regionCode}</td>
                      <td className="px-3 py-2 capitalize">{proxy.status}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {proxy.instanceName ? (
                          <>
                            <div>{proxy.instanceName}</div>
                            <div>{proxy.orgSlug || proxy.orgName || "Unknown org"}</div>
                          </>
                        ) : (
                          "Unassigned"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void handleRemoveProxy(proxy)}
                          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2Icon className="h-3 w-3" />
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredProxies.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                        No proxies match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  prefix,
}: {
  label: string;
  value: number;
  detail: string;
  prefix?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-4 sm:px-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">
        {prefix}
        {typeof value === "number" && prefix ? value.toFixed(2) : value}
      </div>
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

function OrgTable({
  organizations,
  compact = false,
  actionOrgId,
  onAction,
}: {
  organizations: PlatformOrgRow[];
  compact?: boolean;
  actionOrgId: string | null;
  onAction: (orgId: string, action: () => Promise<unknown>, successMessage: string) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Organization</th>
            <th className="px-3 py-2 font-medium">Plan</th>
            <th className="px-3 py-2 font-medium">Instances</th>
            {!compact && <th className="px-3 py-2 font-medium">VM</th>}
            {!compact && <th className="px-3 py-2 font-medium">Cost</th>}
            {!compact && <th className="px-3 py-2 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {organizations.map((org) => {
            const blocked = org.orgStatus === "platform_blocked";
            const busy = actionOrgId === org.id;
            return (
              <tr key={org.id} className="border-b border-border/40 last:border-0 align-top">
                <td className="px-3 py-3">
                  <div className="font-medium">{org.name}</div>
                  <div className="text-xs text-muted-foreground">{org.slug}</div>
                  {blocked && <div className="mt-1 text-xs text-red-300">Platform blocked</div>}
                  {!compact && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{org.id}</div>}
                </td>
                <td className="px-3 py-3">
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TIER_STYLES[org.tier] || TIER_STYLES.free)}>
                    {org.tier}
                    {org.billingStatus === "trialing" ? " · trial" : ""}
                  </span>
                  <div className="mt-1 capitalize text-xs text-muted-foreground">{org.billingStatus || "none"}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium">{org.instanceCounts.total} total</div>
                  <div className="text-xs text-muted-foreground">
                    {org.instanceCounts.connected} connected · {org.activeInstanceCount}/{org.paidInstanceLimit || 0} billed slots
                  </div>
                </td>
                {!compact && (
                  <td className="px-3 py-3">
                    <div className={cn("capitalize", DEPLOYMENT_STYLES[org.deployment?.status || "not_started"])}>
                      {org.deployment?.status || org.deploymentStatus || "not_started"}
                    </div>
                    <div className="text-xs text-muted-foreground">{org.deployment?.vmSize || "—"}</div>
                    {org.deployment?.publicIp && <div className="font-mono text-xs text-muted-foreground">{org.deployment.publicIp}</div>}
                    {org.deployment?.baseUrl && (
                      <a href={org.deployment.baseUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs hover:underline">
                        Worker <ExternalLinkIcon className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                )}
                {!compact && (
                  <td className="px-3 py-3">
                    {org.deployment?.vmCostUsd ? (
                      <>
                        <div className="font-medium">${org.deployment.vmCostUsd.toFixed(2)}/mo</div>
                        <div className="text-xs text-muted-foreground">est. Azure</div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                )}
                {!compact && (
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {blocked ? (
                        <ActionButton
                          label="Unblock"
                          busy={busy}
                          onClick={() => onAction(org.id, () => unblockPlatformOrganization(org.id), "Organization unblocked")}
                        />
                      ) : (
                        <ActionButton
                          label="Block"
                          tone="warn"
                          busy={busy}
                          onClick={() => {
                            if (!window.confirm(`Block ${org.name}? API keys revoke and instances suspend.`)) return;
                            const reason = window.prompt("Block reason (optional)") || undefined;
                            void onAction(org.id, () => blockPlatformOrganization(org.id, reason), "Organization blocked");
                          }}
                        />
                      )}
                      <ActionButton
                        label="Delete VM"
                        tone="danger"
                        busy={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete VM for ${org.name}? Org data stays; worker goes offline.`)) return;
                          void onAction(org.id, () => deletePlatformOrganizationVm(org.id), "VM deletion started");
                        }}
                      />
                      <ActionButton
                        label="Delete org"
                        tone="danger"
                        busy={busy}
                        onClick={() => {
                          if (!window.confirm(`Permanently delete ${org.name}, all instances, and trigger VM cleanup?`)) return;
                          void onAction(org.id, () => deletePlatformOrganization(org.id), "Organization deleted");
                        }}
                      />
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
          {!organizations.length && (
            <tr>
              <td colSpan={compact ? 3 : 6} className="px-3 py-8 text-center text-muted-foreground">
                No organizations found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  tone?: "default" | "warn" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50",
        tone === "danger" && "border-destructive/40 text-destructive hover:bg-destructive/10",
        tone === "warn" && "border-amber-500/40 text-amber-300 hover:bg-amber-500/10",
        tone === "default" && "border-border hover:bg-muted",
      )}
    >
      {busy ? "..." : label}
    </button>
  );
}
