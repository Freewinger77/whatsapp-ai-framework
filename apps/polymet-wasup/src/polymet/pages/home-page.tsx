import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  INSTANCE_ACTIVITY_LOG,
  INSTANCES,
  LIVE_FEED,
  STATS,
  USER,
  VOLUME_SERIES,
} from "@/polymet/data/dashboard-data";
import { StatCard } from "@/polymet/components/stat-card";
import { VolumeChart } from "@/polymet/components/volume-chart";
import { cn } from "@/lib/utils";

export function HomePage() {
  const [tab, setTab] = useState<"Conversations" | "Instance">("Conversations");
  const [now, setNow] = useState(() => new Date());
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
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
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting()}, <span className="font-normal">{USER.name}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Let's catch up.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-1 text-sm">
          {(["Conversations", "Instance"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
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
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {STATS.map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>

          <VolumeChart data={VOLUME_SERIES} />
        </>
      ) : (
        <InstanceOverview />
      )}
    </div>
  );
}

function InstanceOverview() {
  const active = INSTANCES.filter((item) => item.status === "active").length;
  const warnings = INSTANCES.filter((item) => item.status === "quality-warning").length;

  return (
    <div className="space-y-10 animate-fade-up">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card p-7 shadow-sm">
          <div className="text-sm font-semibold">Active</div>
          <div className="mt-4 text-4xl font-semibold tracking-tight">{active}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-7 shadow-sm">
          <div className="text-sm font-semibold">Quality Warnings</div>
          <div className="mt-4 text-4xl font-semibold tracking-tight">{warnings}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Activity Log</h2>
          <div className="relative mt-5 max-h-[276px] space-y-4 overflow-hidden">
            {INSTANCE_ACTIVITY_LOG.map((item, index) => (
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
            {LIVE_FEED.map((event, index) => (
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

export function levelTagClass(level: string) {
  return cn(
    "inline-flex w-fit items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold",
    level === "Critical" && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 before:mr-1 before:content-['⚠']",
    level === "High" && "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    level === "Low" && "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
  );
}
