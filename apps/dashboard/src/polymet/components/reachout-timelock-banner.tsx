import { useEffect, useState } from "react";
import type { ReachoutTimeLock } from "@/polymet/data/dashboard-data";
import { cn } from "@/lib/utils";

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

export function formatReachoutCountdown(endsAt: string | null | undefined, nowMs = Date.now()) {
  if (!endsAt) return null;
  const ends = new Date(endsAt).getTime();
  if (Number.isNaN(ends)) return null;
  const remainingMs = ends - nowMs;
  if (remainingMs <= 0) {
    return { expired: true as const, label: "Expired", shortLabel: "0d", daysLabel: "0d" };
  }

  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const label =
    days > 0
      ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const shortLabel = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
  const daysLabel = days > 0 ? `${days}d` : `${hours}h`;

  return { expired: false as const, label, shortLabel, daysLabel, remainingMs, days, hours };
}

export function humanizeReachoutEnforcement(type: string | null | undefined) {
  const raw = (type || "DEFAULT").trim();
  const map: Record<string, string> = {
    DEFAULT: "Account reach-out limit",
    WEB_COMPANION_ONLY: "Web companions only",
    RESTRICT_ALL_COMPANIONS: "All linked companions",
    BULK_MESSAGING: "Bulk messaging",
    BIZ_QUALITY: "Business quality",
  };
  return map[raw] || raw.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * One shared timer per interval for the whole app.
 * Sidebar used to mount N×1s timers (one per restricted instance) → battery melt.
 */
const sharedNowSubscribers = new Map<number, Set<() => void>>();
const sharedNowTimers = new Map<number, number>();

function subscribeSharedNow(intervalMs: number, onTick: () => void) {
  let set = sharedNowSubscribers.get(intervalMs);
  if (!set) {
    set = new Set();
    sharedNowSubscribers.set(intervalMs, set);
  }
  set.add(onTick);

  if (!sharedNowTimers.has(intervalMs)) {
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      for (const cb of sharedNowSubscribers.get(intervalMs) || []) cb();
    }, intervalMs);
    sharedNowTimers.set(intervalMs, id);
  }

  return () => {
    const subscribers = sharedNowSubscribers.get(intervalMs);
    subscribers?.delete(onTick);
    if (subscribers && subscribers.size === 0) {
      sharedNowSubscribers.delete(intervalMs);
      const timerId = sharedNowTimers.get(intervalMs);
      if (timerId != null) {
        window.clearInterval(timerId);
        sharedNowTimers.delete(intervalMs);
      }
    }
  };
}

function useSharedNow(intervalMs: number, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const tick = () => setNow(Date.now());
    const unsubscribe = subscribeSharedNow(intervalMs, tick);
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs]);
  return now;
}

type CountdownOptions = {
  /** Sidebar chips only need minute-level accuracy. Detail banners can stay at 1s. */
  intervalMs?: number;
};

export function useReachoutCountdown(
  endsAt: string | null | undefined,
  options: CountdownOptions = {},
) {
  const intervalMs = options.intervalMs ?? 1000;
  const enabled = !!endsAt;
  const now = useSharedNow(intervalMs, enabled);
  return formatReachoutCountdown(endsAt, now);
}

type BannerProps = {
  lock: ReachoutTimeLock | null | undefined;
  className?: string;
  compact?: boolean;
};

export function ReachoutTimelockBanner({ lock, className, compact }: BannerProps) {
  const countdown = useReachoutCountdown(lock?.isActive ? lock.timeEnforcementEnds : null, {
    intervalMs: 1000,
  });
  if (!lock?.isActive) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-orange-900/50 bg-orange-950/55 text-orange-100",
        compact ? "px-3 py-2 text-xs" : "p-4 text-sm",
        className,
      )}
    >
      <div className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>
        Companion reach-out restricted
      </div>
      <p className={cn("mt-1 opacity-90", compact ? "text-[11px] leading-snug" : "")}>
        {humanizeReachoutEnforcement(lock.enforcementType)}
        {countdown ? (
          <>
            {" · "}
            <span className="font-mono font-semibold tabular-nums tracking-tight">{countdown.label}</span>
            {!countdown.expired && lock.timeEnforcementEnds ? (
              <span className="opacity-70">
                {" "}
                (until {new Date(lock.timeEnforcementEnds).toLocaleString()})
              </span>
            ) : null}
          </>
        ) : (
          " · active (no expiry reported)"
        )}
      </p>
    </div>
  );
}

export function ReachoutTimelockBadge({ lock }: { lock: ReachoutTimeLock | null | undefined }) {
  const countdown = useReachoutCountdown(lock?.isActive ? lock.timeEnforcementEnds : null, {
    intervalMs: 30_000,
  });
  if (!lock?.isActive) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-600/90 px-3 py-1 text-xs font-medium text-orange-50 backdrop-blur">
      Restricted
      {countdown && !countdown.expired ? (
        <span className="font-mono tabular-nums opacity-95">{countdown.shortLabel || countdown.label}</span>
      ) : null}
    </span>
  );
}

/** Compact sidebar days-left chip (pair with a caution icon in the row). */
export function ReachoutSidebarChip({ lock }: { lock: ReachoutTimeLock | null | undefined }) {
  // Days-left only — no per-second React re-renders across the whole fleet sidebar.
  const countdown = useReachoutCountdown(lock?.isActive ? lock.timeEnforcementEnds : null, {
    intervalMs: 60_000,
  });
  if (!lock?.isActive) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300"
      title={
        countdown && !countdown.expired
          ? `Companion reach-out restricted · ${countdown.label}`
          : "Companion reach-out restricted"
      }
    >
      <span className="font-mono tabular-nums tracking-tight">
        {countdown?.expired ? "0d" : countdown?.daysLabel || "…"}
      </span>
    </span>
  );
}
