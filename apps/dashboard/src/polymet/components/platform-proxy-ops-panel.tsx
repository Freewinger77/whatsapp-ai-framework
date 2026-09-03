import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import {
  attachProxyOps,
  detachProxyOps,
  getProxyOpsBoard,
  probeProxyOps,
  type ProxyOpsBoard,
} from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";

function ageLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function PlatformProxyOpsPanel() {
  const [board, setBoard] = useState<ProxyOpsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<"all" | "SE" | "UK">("all");
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [attachInstanceId, setAttachInstanceId] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getProxyOpsBoard();
      setBoard(data);
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Proxy ops failed";
      setError(message);
      if (!silent) toast.error("Proxy ops failed", { description: message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!board) return [];
    const q = query.trim().toLowerCase();
    return board.rows.filter((r) => {
      if (country !== "all" && r.country !== country) return false;
      if (!q) return true;
      return (
        (r.label || "").toLowerCase().includes(q) ||
        r.host.includes(q) ||
        r.workerLabel.toLowerCase().includes(q) ||
        (r.assignedInstanceName || "").toLowerCase().includes(q) ||
        (r.globalUsers || []).some(
          (u) =>
            u.instanceName.toLowerCase().includes(q) || u.workerLabel.toLowerCase().includes(q),
        )
      );
    });
  }, [board, query, country]);

  const targetsForWorker = useCallback(
    (workerId: string) => (board?.attachTargets || []).filter((t) => t.workerId === workerId),
    [board],
  );

  async function onProbeAll() {
    setProbing(true);
    try {
      const result = await probeProxyOps({});
      toast.success(`Probed ${result.probed} proxies`);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setProbing(false);
    }
  }

  async function onAttach(rowKey: string, workerId: string, label: string | null) {
    if (!label || !attachInstanceId) {
      toast.error("Pick an instance first");
      return;
    }
    setBusyKey(rowKey);
    try {
      await attachProxyOps({ workerId, instanceId: attachInstanceId, label });
      toast.success(`Attached ${label}`);
      setAttachFor(null);
      setAttachInstanceId("");
      await load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Attach failed";
      if (/already used/i.test(msg)) {
        if (confirm(`${msg}\n\nForce attach anyway?`)) {
          try {
            await attachProxyOps({ workerId, instanceId: attachInstanceId, label, forceShared: true });
            toast.success(`Force-attached ${label}`);
            setAttachFor(null);
            setAttachInstanceId("");
            await load(true);
            return;
          } catch (e2) {
            toast.error(e2 instanceof Error ? e2.message : "Force attach failed");
          }
        }
      } else {
        toast.error(msg);
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function onDetach(rowKey: string, workerId: string, instanceId: string | null, name: string | null) {
    if (!instanceId) return;
    if (!confirm(`Detach proxy from ${name || instanceId} and use DIRECT egress?`)) return;
    setBusyKey(rowKey);
    try {
      await detachProxyOps({ workerId, instanceId });
      toast.success(`Detached → direct (${name || instanceId})`);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Detach failed");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading && !board) {
    return <div className="rounded-xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">Loading proxy ops…</div>;
  }

  if (error && !board) {
    return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">{error}</div>;
  }

  if (!board) return null;
  const s = board.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">Proxy ops board</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Global tracking across wasup / wasup-dev / wasup2–5 / wasup01–05 + org VMs (dev.wasup).
            Shared host:port risk is fleet-wide. Hourly probe{" "}
            {board.hourlyDue ? "due" : `last ${ageLabel(board.lastHourlyProbeAt)}`}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
          >
            <RefreshCwIcon className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh map
          </button>
          <button
            type="button"
            onClick={() => void onProbeAll()}
            disabled={probing}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            {probing ? "Probing…" : "Probe all (live)"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {[
          ["Workers", `${s.workersReachable ?? "—"}/${s.workersTotal ?? "—"}`],
          ["Unique hosts", s.uniqueHosts ?? "—"],
          ["Slots", s.proxiesTotal],
          ["Free", s.free],
          ["In use", s.inUse],
          ["Connected+proxy", s.connectedAssigned],
          ["Direct connected", s.directConnected],
          ["Cross-worker", s.crossWorkerConflicts ?? s.sharedRiskHigh],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border/60 bg-card px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {(board.globalByHost || []).filter((g) => g.risk !== "low").length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs">
          <div className="font-medium text-amber-100">Fleet-wide shared egress</div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {(board.globalByHost || [])
              .filter((g) => g.risk !== "low")
              .slice(0, 8)
              .map((g) => (
                <li key={g.hostPort}>
                  <span className="font-mono text-foreground">{g.label || g.hostPort}</span>
                  {" · "}
                  {g.users.map((u) => `${u.instanceName}@${u.workerLabel}`).join(", ")}
                  {g.risk === "high" ? " · HIGH (2+ connected)" : " · amber"}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter label / host / instance…"
          className="min-w-[220px] flex-1 rounded-lg border border-border/60 bg-background px-3 py-1.5 text-sm"
        />
        {(["all", "SE", "UK"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCountry(c)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              country === c ? "bg-foreground text-background" : "bg-muted/50 text-muted-foreground",
            )}
          >
            {c === "all" ? "All" : c}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Worker</th>
              <th className="px-3 py-2">Host</th>
              <th className="px-3 py-2">Instance</th>
              <th className="px-3 py-2">Antiban</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Probe</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/40">
                <td className="px-3 py-2 font-mono">
                  <span className="font-semibold">{r.label || "—"}</span>
                  <span className="ml-1 text-muted-foreground">{r.country}</span>
                </td>
                <td className="px-3 py-2">{r.workerLabel}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {r.host}:{r.port}
                </td>
                <td className="px-3 py-2">
                  {r.assignedInstanceName ? (
                    <div>
                      <div>{r.assignedInstanceName}</div>
                      <div className="text-muted-foreground">{r.assignedStatus}</div>
                      {(r.globalUsers || []).filter((u) => u.workerId !== r.workerId).length > 0 && (
                        <div className="mt-1 text-[10px] text-amber-200">
                          also:{" "}
                          {(r.globalUsers || [])
                            .filter((u) => u.workerId !== r.workerId)
                            .map((u) => `${u.instanceName}@${u.workerLabel}`)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">free</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.antibanEnabled == null
                    ? "—"
                    : `${r.antibanEnabled ? "ON" : "off"}${r.antibanEnhanced ? " · enh" : ""}`}
                </td>
                <td className="px-3 py-2">
                  {r.globalRisk === "high"
                    ? `HIGH · ${r.globalConnectedCount ?? 0} connected`
                    : r.globalRisk === "amber"
                      ? `amber · shared×${r.globalSharedCount ?? r.sharedWith ?? 0}`
                      : r.fingerprintRisk || "—"}
                </td>
                <td className="px-3 py-2">
                  {r.lastProbe ? (
                    <div>
                      <div className={r.lastProbe.ok ? "text-emerald-300" : "text-red-300"}>
                        {r.lastProbe.ok ? `${r.lastProbe.latencyMs ?? "?"}ms` : "fail"}
                      </div>
                      <div className="text-muted-foreground">{ageLabel(r.lastProbe.probedAt)}</div>
                      {r.lastProbe.egressIp && (
                        <div className="font-mono text-[10px] text-muted-foreground">{r.lastProbe.egressIp}</div>
                      )}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {attachFor === r.key ? (
                      <div className="flex flex-col gap-1">
                        <select
                          value={attachInstanceId}
                          onChange={(e) => setAttachInstanceId(e.target.value)}
                          className="rounded border border-border/60 bg-background px-2 py-1"
                        >
                          <option value="">Select instance…</option>
                          {targetsForWorker(r.workerId).map((t) => (
                            <option key={t.instanceId} value={t.instanceId}>
                              {t.instanceName} ({t.status}){t.hasProxy ? " · has proxy" : ""}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={busyKey === r.key}
                            onClick={() => void onAttach(r.key, r.workerId, r.label)}
                            className="rounded bg-foreground px-2 py-0.5 text-[11px] text-background"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachFor(null);
                              setAttachInstanceId("");
                            }}
                            className="rounded border border-border/60 px-2 py-0.5 text-[11px]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!r.label || busyKey === r.key}
                        onClick={() => {
                          setAttachFor(r.key);
                          setAttachInstanceId("");
                        }}
                        className="rounded border border-border/60 px-2 py-0.5 text-[11px] hover:bg-muted/40 disabled:opacity-40"
                      >
                        Attach…
                      </button>
                    )}
                    {r.assignedInstanceId && (
                      <button
                        type="button"
                        disabled={busyKey === r.key}
                        onClick={() =>
                          void onDetach(r.key, r.workerId, r.assignedInstanceId, r.assignedInstanceName)
                        }
                        className="rounded border border-border/60 px-2 py-0.5 text-[11px] hover:bg-muted/40"
                      >
                        Force direct
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No catalog rows yet. Seed the fleet with deploy/scripts/seed-proxy-catalog.sh
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
