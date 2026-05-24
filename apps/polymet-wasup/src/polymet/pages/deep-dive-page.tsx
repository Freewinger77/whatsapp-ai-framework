import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarIcon, DownloadIcon, SearchIcon, XIcon } from "lucide-react";
import {
  INSTANCE_ACTIVITY_LOG,
  INSTANCES,
  LIVE_FEED,
} from "@/polymet/data/dashboard-data";
import { cn } from "@/lib/utils";

type Mode = "conversations" | "logs";

export function DeepDivePage() {
  const [params] = useSearchParams();
  const initialMode = params.get("mode") === "logs" ? "logs" : "conversations";
  const initialInstanceId = params.get("instance") ?? "all";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [instanceId, setInstanceId] = useState(initialInstanceId);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("2026-05-14T01:00");
  const [to, setTo] = useState("2026-05-14T02:05");
  const [dateOpen, setDateOpen] = useState(false);

  const inRange = (timestamp: string) => (!from || timestamp >= from) && (!to || timestamp <= to);

  const filteredConversations = useMemo(() => {
    return LIVE_FEED.filter((item) => {
      const instanceMatch = instanceId === "all" || item.instanceId === instanceId;
      const timeMatch = inRange(item.timestamp);
      const searchMatch =
        !query ||
        item.phone.toLowerCase().includes(query.toLowerCase()) ||
        item.text.toLowerCase().includes(query.toLowerCase()) ||
        item.direction.toLowerCase().includes(query.toLowerCase());
      return instanceMatch && timeMatch && searchMatch;
    });
  }, [from, instanceId, query, to]);

  const filteredLogs = useMemo(() => {
    return INSTANCE_ACTIVITY_LOG.filter((item) => {
      const instanceMatch = instanceId === "all" || item.instanceId === instanceId;
      const timeMatch = inRange(item.timestamp);
      const searchMatch =
        !query ||
        item.source.toLowerCase().includes(query.toLowerCase()) ||
        item.level.toLowerCase().includes(query.toLowerCase());
      return instanceMatch && timeMatch && searchMatch;
    });
  }, [from, instanceId, query, to]);

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
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Deep Dive</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search conversations and logs globally, or filter down to one live instance.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex w-fit rounded-lg border border-border/60 bg-muted/40 p-1 text-sm">
          {(["conversations", "logs"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={cn(
                "rounded-md px-3 py-1.5 capitalize transition-colors",
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
          className="h-10 min-w-44 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none"
        >
          <option value="all">All instances</option>
          {INSTANCES.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.name}
            </option>
          ))}
        </select>

        <div className="relative">
          <button
            type="button"
            onClick={() => setDateOpen((open) => !open)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm hover:bg-muted"
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
              <div className="absolute left-0 top-full z-40 mt-2 w-[min(92vw,360px)] rounded-2xl border border-border bg-background p-4 shadow-xl animate-pop-in">
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

        <div className="relative min-w-[220px] flex-1">
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
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          <DownloadIcon className="h-4 w-4" />
          Export
        </button>
      </div>

      <div className="text-xs text-muted-foreground">
        {instanceId === "all"
          ? `${mode} across all instances.`
          : `${mode} filtered to ${INSTANCES.find((item) => item.id === instanceId)?.name}.`}
      </div>

      {mode === "conversations" ? (
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Conversations</h2>
            <span className="text-sm text-muted-foreground">{filteredConversations.length} events</span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredConversations.map((event, index) => {
              const instance = INSTANCES.find((item) => item.id === event.instanceId);
              return (
                <div
                  key={`${event.phone}-${event.time}-${index}`}
                  className="group relative py-4 first:pt-0 last:pb-0"
                >
                  <div className="relative rounded-xl transition-all duration-200 group-hover:z-20 group-hover:-mx-3 group-hover:-my-2 group-hover:bg-card group-hover:p-3 group-hover:shadow-xl">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        <span className={event.direction === "Sent" ? "italic" : ""}>{event.direction}</span>{" "}
                        {event.phone}
                      </div>
                      <p className="mt-1 max-h-10 overflow-hidden text-sm text-muted-foreground transition-all duration-300 group-hover:max-h-40">{event.text}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">Logs</h2>
            <span className="text-sm text-muted-foreground">{filteredLogs.length} records</span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredLogs.map((item, index) => {
              const instance = INSTANCES.find((entry) => entry.id === item.instanceId);
              return (
                <div
                  key={`${item.source}-${index}`}
                  className="group relative grid grid-cols-[1fr_140px_130px_150px] items-start gap-4 py-4 text-sm first:pt-0 last:pb-0"
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
