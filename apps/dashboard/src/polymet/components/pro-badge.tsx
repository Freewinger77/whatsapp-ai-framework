import { cn } from "@/lib/utils";

export function ProBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
        className,
      )}
    >
      Pro
    </span>
  );
}
