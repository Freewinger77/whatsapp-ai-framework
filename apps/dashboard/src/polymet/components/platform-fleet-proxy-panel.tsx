import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { getFleetProxyAudit, type FleetProxyAudit } from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-300 ring-red-500/30",
  amber: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

export function PlatformFleetProxyPanel() {
  const [audit, setAudit] = useState<FleetProxyAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [includeOrg, setIncludeOrg] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await getFleetProxyAudit({ includeOrg, includeShared: true });
        setAudit(data);
        setError("");
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Fleet proxy audit failed";
        setError(message);
        if (!silent) toast.error("Fleet proxy audit failed", { description: message });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [includeOrg],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const workers = useMemo(() => {
    if (!audit) return [];
    const q = query.trim().toLowerCase();
    if (!q) return audit.workers;
    return audit.workers.filter(
      (w) =>
        w.id.toLowerCase().includes(q) ||
        w.label.toLowerCase().includes(q) ||
        (w.orgSlug || "").toLowerCase().includes(q) ||
        w.instances.some((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)),
    );
  }, [audit, query]);

  if (loading && !audit) {
    return <div className="rounded-xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">Loading fleet proxy map…</div>;
  }

  if (error && !audit) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!audit) return null;

  const s = audit.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">Fleet proxy map</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Live attach counts across shared workers (wasup → wasup05, wasup-dev) and org VMs from
            control-plane deployments. Generated {new Date(audit.generatedAt).toLocaleString()}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeOrg}
              onChange={(event) => setIncludeOrg(event.target.checked)}
              className="rounded border-border"
            />
            Include org VMs
          </label>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
          >
            <RefreshCwIcon className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {!audit.sharedSecretConfigured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Control plane is missing <code>WASUP_WORKER_SHARED_SECRET</code> — shared worker probes will fail.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Workers up" value={`${s.workersReachable}/${s.workersTotal}`} detail={`${s.workersUnreachable} unreachable`} />
        <MiniStat label="Instances" value={String(s.instancesTotal)} detail={`${s.instancesConnected} connected`} />
        <MiniStat label="With proxy" value={String(s.instancesWithProxy)} detail={`${s.instancesDirect} on direct egress`} />
        <MiniStat
          label="Worker pools"
          value={`${s.poolSlotsUsed}/${s.poolSlotsTotal}`}
          detail={`${s.poolSlotsFree} free slots · CP ${audit.controlPlanePool.assigned}/${audit.controlPlanePool.total} assigned`}
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className={cn("rounded-full px-2.5 py-1 ring-1", RISK_STYLES.high)}>
          FP high workers: {s.fingerprintHighWorkers}
        </span>
        <span className={cn("rounded-full px-2.5 py-1 ring-1", RISK_STYLES.amber)}>
          FP amber workers: {s.fingerprintAmberWorkers}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground ring-1 ring-border/60">
          CP pool free: {audit.controlPlanePool.free}
        </span>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter worker, org, or instance…"
        className="h-10 w-full max-w-xl rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
      />

      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border/60 bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Worker</th>
              <th className="px-4 py-3 font-medium">Reach</th>
              <th className="px-4 py-3 font-medium">Instances</th>
              <th className="px-4 py-3 font-medium">Proxy / direct</th>
              <th className="px-4 py-3 font-medium">Pool</th>
              <th className="px-4 py-3 font-medium">FP risk</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((worker) => {
              const open = expandedId === worker.id;
              const worst =
                (worker.fingerprintSummary?.high || 0) > 0
                  ? "high"
                  : (worker.fingerprintSummary?.amber || 0) > 0
                    ? "amber"
                    : worker.reachable
                      ? "low"
                      : "unknown";
              return (
                <Fragment key={worker.id}>
                  <tr
                    className="cursor-pointer border-b border-border/40 hover:bg-muted/20"
                    onClick={() => setExpandedId(open ? null : worker.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{worker.label}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{worker.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      {worker.reachable ? (
                        <span className="text-emerald-300">up</span>
                      ) : (
                        <span className="text-red-300" title={worker.error}>
                          down
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {worker.connectedCount}/{worker.instanceCount}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-emerald-300">{worker.withProxyCount}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className={worker.directCount > 0 ? "text-amber-300" : "text-muted-foreground"}>
                        {worker.directCount} direct
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {worker.pool
                        ? `${worker.pool.used}/${worker.pool.total} (free ${worker.pool.free})`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {worker.reachable ? (
                        <span className={cn("rounded-full px-2 py-0.5 text-xs ring-1", RISK_STYLES[worst] || "bg-muted")}>
                          {worst}
                          {worker.fingerprintSummary
                            ? ` · H${worker.fingerprintSummary.high}/A${worker.fingerprintSummary.amber}/L${worker.fingerprintSummary.low}`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{worker.error?.slice(0, 48) || "—"}</span>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-border/40 bg-muted/10">
                      <td colSpan={6} className="px-4 py-3">
                        {!worker.reachable ? (
                          <p className="text-xs text-red-200">{worker.error || "Unreachable"}</p>
                        ) : worker.instances.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No instances on this worker.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="py-1 pr-3 text-left font-medium">Instance</th>
                                  <th className="py-1 pr-3 text-left font-medium">Status</th>
                                  <th className="py-1 pr-3 text-left font-medium">Egress</th>
                                  <th className="py-1 pr-3 text-left font-medium">Source</th>
                                  <th className="py-1 text-left font-medium">FP</th>
                                </tr>
                              </thead>
                              <tbody>
                                {worker.instances.map((inst) => (
                                  <tr key={inst.id} className="border-t border-border/30">
                                    <td className="py-1.5 pr-3">
                                      <div className="font-medium">{inst.name}</div>
                                      <div className="font-mono text-[10px] text-muted-foreground">{inst.id}</div>
                                    </td>
                                    <td className="py-1.5 pr-3 capitalize">{inst.status}</td>
                                    <td className="py-1.5 pr-3 font-mono">
                                      {inst.hasProxy && inst.proxyHost
                                        ? `${inst.proxyHost}:${inst.proxyPort || ""}`
                                        : "direct"}
                                    </td>
                                    <td className="py-1.5 pr-3">{inst.proxySource || "—"}</td>
                                    <td className="py-1.5">
                                      <span
                                        className={cn(
                                          "rounded-full px-2 py-0.5 ring-1",
                                          RISK_STYLES[inst.fingerprintRisk || ""] || "bg-muted text-muted-foreground ring-border/50",
                                        )}
                                      >
                                        {inst.fingerprintRisk || "n/a"}
                                        {typeof inst.sharedWith === "number" ? ` · +${inst.sharedWith}` : ""}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!workers.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No workers matched.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
