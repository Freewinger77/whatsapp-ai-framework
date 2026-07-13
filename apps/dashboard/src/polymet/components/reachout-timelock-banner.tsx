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
  if (remainingMs <= 0) return { expired: true as const, label: "Expired — refresh to recheck" };

  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const label =
    days > 0
      ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { expired: false as const, label, remainingMs };
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

export function useReachoutCountdown(endsAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return formatReachoutCountdown(endsAt, now);
}

type BannerProps = {
  lock: ReachoutTimeLock | null | undefined;
  className?: string;
  compact?: boolean;
};

export function ReachoutTimelockBanner({ lock, className, compact }: BannerProps) {
  const countdown = useReachoutCountdown(lock?.isActive ? lock.timeEnforcementEnds : null);
  if (!lock?.isActive) return null;

  return (
    <div
      className={cn(
        "rounded-2xl border border-amber-300/80 bg-amber-50/90 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100",
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
  const countdown = useReachoutCountdown(lock?.isActive ? lock.timeEnforcementEnds : null);
  if (!lock?.isActive) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-white backdrop-blur">
      Restricted
      {countdown && !countdown.expired ? (
        <span className="font-mono tabular-nums opacity-95">{countdown.label}</span>
      ) : null}
    </span>
  );
}
