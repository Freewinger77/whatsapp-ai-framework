import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarIcon, DownloadIcon, SearchIcon, XIcon } from "lucide-react";
import {
  type ActivityLogItem,
  type Instance,
  type LiveFeedItem,
} from "@/polymet/data/dashboard-data";
import { getDeepDive, listInstances } from "@/polymet/lib/control-plane-api";
import { DeepDivePageSkeleton } from "@/polymet/components/page-skeletons";
import { cn } from "@/lib/utils";

type Mode = "conversations" | "logs";

export function DeepDivePage() {
  const [params] = useSearchParams();
  const initialMode = params.get("mode") === "logs" ? "logs" : "conversations";
  const initialInstanceId = params.get("instance") ?? "all";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [liveConversations, setLiveConversations] = useState<LiveFeedItem[]>([]);
  const [liveLogs, setLiveLogs] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    listInstances()
      .then(setInstances)
      .catch(() => setInstances([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(() => {
      getDeepDive({
        type: mode === "conversations" ? "messages" : "logs",
        instanceId,
        search: query,
        from,
        to,
      })
        .then((result) => {
          if (cancelled) return;
          setLiveConversations(
            result.messages.map((message) => ({
              direction: message.direction === "outbound" ? "Sent" : "Received",
              phone: message.phone || "Unknown",
              text: message.body || "",
              instanceId: message.instance_id || "unknown",
              time: "Live",
              timestamp: message.created_at.slice(0, 16),
            })),
          );
          setLiveLogs(
            result.logs.map((log) => ({
              source: log.summary || log.event_type,
              level: mapSeverity(log.severity),
              instanceId: log.instance_id || "unknown",
              time: "Live",
              timestamp: log.created_at.slice(0, 16),
            })),
          );
          setApiError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setLiveConversations([]);
          setLiveLogs([]);
          setApiError(error instanceof Error ? error.message : "Could not load activity");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [from, instanceId, mode, query, to]);

  const inRange = (timestamp: string) => (!from || timestamp >= from) && (!to || timestamp <= to);

  const filteredConversations = useMemo(() => {
    return liveConversations.filter((item) => {
      const instanceMatch = instanceId === "all" || item.instanceId === instanceId;
      const timeMatch = inRange(item.timestamp);
      const searchMatch =
        !query ||
        item.phone.toLowerCase().includes(query.toLowerCase()) ||
        item.text.toLowerCase().includes(query.toLowerCase()) ||
        item.direction.toLowerCase().includes(query.toLowerCase());
      return instanceMatch && timeMatch && searchMatch;
    });
  }, [from, instanceId, liveConversations, query, to]);

  const filteredLogs = useMemo(() => {
    return liveLogs.filter((item) => {
      const instanceMatch = instanceId === "all" || item.instanceId === instanceId;
      const timeMatch = inRange(item.timestamp);
      const searchMatch =
        !query ||
        item.source.toLowerCase().includes(query.toLowerCase()) ||
        item.level.toLowerCase().includes(query.toLowerCase());
      return instanceMatch && timeMatch && searchMatch;
    });
  }, [from, instanceId, liveLogs, query, to]);

  const exportText = () => {
    const lines = mode === "conversations"
      ? filteredConversations.map((item) => `[${item.timestamp}] ${item.direction} ${item.phone} (${item.instanceId}): ${item.text}`)
      : filteredLogs.map((item) => `[${item.timestamp}] ${item.level} ${item.instanceId}: ${item.source}`);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wasup-${mode}-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Deep Dive</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search conversations and logs globally, or filter down to one live instance.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="inline-flex w-full rounded-lg border border-border/60 bg-muted/40 p-1 text-sm sm:w-fit">
          {(["conversations", "logs"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 capitalize transition-colors sm:flex-none",
                mode === item
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item}
            </button>
          ))}
        </div>

        <select
          value={instanceId}
          onChange={(event) => setInstanceId(event.target.value)}
          className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none sm:w-auto sm:min-w-44"
        >
          <option value="all">All instances</option>
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.name}
            </option>
          ))}
        </select>

        <div className="relative">
          <button
            type="button"
            onClick={() => setDateOpen((open) => !open)}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm hover:bg-muted sm:w-auto"
          >
            <CalendarIcon className="h-4 w-4" />
            <span>{formatDateRange(from, to)}</span>
          </button>
          {dateOpen && (
            <>
              <button
                type="button"
                aria-label="Close date range picker"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setDateOpen(false)}
              />
              <div className="fixed left-3 right-3 top-32 z-40 rounded-2xl border border-border bg-background p-4 shadow-xl animate-pop-in sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-[min(92vw,360px)]">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-semibold">Date range</div>
                  <button
                    type="button"
                    onClick={() => setDateOpen(false)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">From</span>
                    <input
                      type="datetime-local"
                      value={from}
                      onChange={(event) => setFrom(event.target.value)}
                      className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">To</span>
                    <input
                      type="datetime-local"
                      value={to}
                      onChange={(event) => setTo(event.target.value)}
                      className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              mode === "conversations"
                ? "Search by phone number, direction, or message..."
                : "Search by log source, severity, or error..."
            }
            className="h-10 w-full rounded-lg border border-border/60 bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>

        <button
          type="button"
          onClick={exportText}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm font-medium hover:bg-muted sm:w-auto"
        >
          <DownloadIcon className="h-4 w-4" />
          Export
        </button>
      </div>

      <div className="text-xs text-muted-foreground">
        {instanceId === "all"
          ? `${mode} across all instances.`
          : `${mode} filtered to ${instances.find((item) => item.id === instanceId)?.name || "selected instance"}.`}
      </div>

      {apiError && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {apiError}
        </div>
      )}

      {loading && liveConversations.length === 0 && liveLogs.length === 0 ? (
        <DeepDivePageSkeleton />
      ) : mode === "conversations" ? (
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Conversations</h2>
            <span className="text-sm text-muted-foreground">{filteredConversations.length} events</span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredConversations.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">No conversations found.</div>
            )}
            {filteredConversations.map((event, index) => {
              const instance = instances.find((item) => item.id === event.instanceId);
              return (
                <div
                  key={`${event.phone}-${event.time}-${index}`}
                  className="group relative py-4 first:pt-0 last:pb-0"
                >
                    <div className="relative rounded-xl transition-all duration-200 group-hover:z-20 group-hover:bg-card sm:group-hover:-mx-3 sm:group-hover:-my-2 sm:group-hover:p-3 sm:group-hover:shadow-xl">
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        <span className={event.direction === "Sent" ? "italic" : ""}>{event.direction}</span>{" "}
                        {event.phone}
                      </div>
                      <p className="mt-1 max-h-10 overflow-hidden text-sm text-muted-foreground transition-all duration-300 group-hover:max-h-40">{event.text}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Link to={`/instances/${event.instanceId}`} className="rounded-full bg-muted px-2.5 py-1 hover:text-foreground">
                        {instance?.name ?? event.instanceId}
                      </Link>
                      <span>{event.time}</span>
                      <span>{event.timestamp.replace("T", " ")}</span>
                    </div>
                  </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Logs</h2>
            <span className="text-sm text-muted-foreground">{filteredLogs.length} records</span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredLogs.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">No logs found.</div>
            )}
            {filteredLogs.map((item, index) => {
              const instance = instances.find((entry) => entry.id === item.instanceId);
              return (
                <div
                  key={`${item.source}-${index}`}
                  className="group relative grid gap-2 py-4 text-sm first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_140px_110px_150px] sm:gap-4"
                >
                  <span className="relative rounded-xl transition-all duration-200 group-hover:z-20 group-hover:-mx-3 group-hover:-my-2 group-hover:bg-card group-hover:p-3 group-hover:shadow-xl">
                    <span className="block max-h-10 overflow-hidden transition-all duration-300 group-hover:max-h-40">{item.source}</span>
                  </span>
                  <Link to={`/instances/${item.instanceId}`} className="text-muted-foreground hover:text-foreground">
                    {instance?.name ?? item.instanceId}
                  </Link>
                  <span className={levelTagClass(item.level)}>{item.level}</span>
                  <span className="text-muted-foreground">{item.timestamp.replace("T", " ")}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function formatDateRange(from: string, to: string) {
  const short = (value: string) => {
    if (!value) return "Any";
    const [, time = ""] = value.split("T");
    return time || value;
  };
  return `${short(from)} - ${short(to)}`;
}

function levelTagClass(level: string) {
  return cn(
    "inline-flex w-fit items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold",
    level === "Critical" && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 before:mr-1 before:content-['⚠']",
    level === "High" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    level === "Low" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
  );
}

function mapSeverity(severity: string): ActivityLogItem["level"] {
  if (severity === "critical" || severity === "error") return "Critical";
  if (severity === "warning") return "High";
  return "Low";
}
