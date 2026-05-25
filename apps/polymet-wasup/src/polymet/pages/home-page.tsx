import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import {
  STATS,
  type ActivityLogItem,
  type Instance,
  type LiveFeedItem,
  type Stat,
  type VolumePoint,
} from "@/polymet/data/dashboard-data";
import { StatCard } from "@/polymet/components/stat-card";
import { HomeInstanceTabSkeleton, HomePageSkeleton } from "@/polymet/components/page-skeletons";
import { VolumeChart } from "@/polymet/components/volume-chart";
import { getDeepDive, listInstances } from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";

export function HomePage() {
  const [tab, setTab] = useState<"Conversations" | "Instance">("Conversations");
  const [now, setNow] = useState(() => new Date());
  const [instances, setInstances] = useState<Instance[]>([]);
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [feed, setFeed] = useState<LiveFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const { user } = useUser();
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const stats = useMemo(() => buildStats(feed), [feed]);
  const volumeSeries = useMemo(() => buildVolumeSeries(feed), [feed]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([listInstances(), getDeepDive({ type: "all" })])
      .then(([nextInstances, activity]) => {
        setInstances(nextInstances);
        setFeed(
          activity.messages.map((message) => ({
            direction: message.direction === "outbound" ? "Sent" : "Received",
            phone: message.phone || "Unknown",
            text: message.body || "",
            instanceId: message.instance_id || "unknown",
            time: "Live",
            timestamp: message.created_at.slice(0, 16),
          })),
        );
        setLogs(
          activity.logs.map((log) => ({
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
        setInstances([]);
        setFeed([]);
        setLogs([]);
        setApiError(error instanceof Error ? error.message : "Could not load dashboard data");
      })
      .finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const h = Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone,
      }).format(now),
    );
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="wasup-display-headline font-serif text-[2.125rem] font-normal italic sm:text-[2.75rem]">
            {greeting()}, {user?.firstName || user?.fullName || "there"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Let's catch up.</p>
        </div>
        <div className="inline-flex w-full rounded-lg border border-border/60 bg-muted/40 p-1 text-sm sm:w-auto">
          {(["Conversations", "Instance"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 transition-colors sm:flex-none",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "Conversations" ? (
        loading ? (
          <HomePageSkeleton />
        ) : (
        <>
          {apiError && (
            <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {apiError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {stats.map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>

          <VolumeChart data={volumeSeries} />
        </>
        )
      ) : loading ? (
        <HomeInstanceTabSkeleton />
      ) : (
        <InstanceOverview instances={instances} logs={logs} feed={feed} />
      )}
    </div>
  );
}

function InstanceOverview({
  instances,
  logs,
  feed,
}: {
  instances: Instance[];
  logs: ActivityLogItem[];
  feed: LiveFeedItem[];
}) {
  const active = instances.filter((item) => item.status === "active").length;
  const warnings = instances.filter((item) => item.status === "quality-warning").length;

  return (
    <div className="space-y-6 animate-fade-up sm:space-y-10">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm sm:p-7">
          <div className="text-sm font-semibold">Active</div>
          <div className="mt-4 text-4xl font-semibold tracking-tight">{active}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm sm:p-7">
          <div className="text-sm font-semibold">Quality Warnings</div>
          <div className="mt-4 text-4xl font-semibold tracking-tight">{warnings}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Activity Log</h2>
          <div className="relative mt-5 max-h-[276px] space-y-4 overflow-hidden">
            {logs.length === 0 && <EmptyPanelCopy>No activity yet.</EmptyPanelCopy>}
            {logs.map((item, index) => (
              <div
                key={`${item.source}-${index}`}
                style={{ animationDelay: `${index * 35}ms` }}
                className={cn(
                  "flex items-start justify-between gap-4 animate-feed-ticket",
                  index === 4 && "!opacity-70",
                  index > 4 && "hidden"
                )}
              >
                <div>
                  <div className="text-sm font-semibold">{item.source}</div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{item.time} · Wasup log event</p>
                </div>
                <span className={levelTagClass(item.level)}>{item.level}</span>
              </div>
            ))}
          </div>
          <Link
            to="/deep-dive?view=instance&mode=logs"
            className="mx-auto mt-5 block w-fit text-sm text-muted-foreground hover:text-foreground"
          >
            See more
          </Link>
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Live Feed</h2>
          <div className="relative mt-5 max-h-[276px] space-y-4 overflow-hidden">
            {feed.length === 0 && <EmptyPanelCopy>No conversations yet.</EmptyPanelCopy>}
            {feed.map((event, index) => (
              <div
                key={`${event.direction}-${index}`}
                style={{ animationDelay: `${index * 35}ms` }}
                className={cn("animate-feed-ticket", index === 3 && "!opacity-70", index > 3 && "hidden")}
              >
                <div className="text-sm font-semibold">
                  <span className={event.direction === "Sent" ? "italic" : ""}>
                    {event.direction}
                  </span>{" "}
                  {event.phone}
                </div>
                <p className="text-sm text-muted-foreground">{event.text}</p>
              </div>
            ))}
          </div>
          <Link
            to="/deep-dive?view=instance&mode=conversations"
            className="mx-auto mt-5 block w-fit text-sm text-muted-foreground hover:text-foreground"
          >
            See more
          </Link>
        </section>
      </div>
    </div>
  );
}

function EmptyPanelCopy({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function levelTagClass(level: string) {
  return cn(
    "inline-flex w-fit items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold",
    level === "Critical" && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 before:mr-1 before:content-['⚠']",
    level === "High" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    level === "Low" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
  );
}

function buildStats(feed: LiveFeedItem[]): Stat[] {
  if (feed.length === 0) return STATS;

  return [
    { label: "Volume", value: feed.length.toLocaleString(), sub: "Conversation events loaded" },
    { label: "Hours saved", value: "0", sub: "Connect automation metrics to track this" },
    { label: "Best time to contact", value: bestTimeLabel(feed), sub: "Based on replies" },
  ];
}

function buildVolumeSeries(feed: LiveFeedItem[]): VolumePoint[] {
  const counts = new Map<string, number>();
  for (const event of feed) {
    const label = event.timestamp.slice(5, 10) || "Today";
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

function bestTimeLabel(feed: LiveFeedItem[]) {
  const firstTimestamp = feed[0]?.timestamp;
  if (!firstTimestamp) return "No data";
  const [, time = ""] = firstTimestamp.split("T");
  return time || "No data";
}

function mapSeverity(severity: string): ActivityLogItem["level"] {
  if (severity === "critical" || severity === "error") return "Critical";
  if (severity === "warning") return "High";
  return "Low";
}
