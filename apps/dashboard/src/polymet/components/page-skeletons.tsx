import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function StatCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border border-border/60 bg-card p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-9 w-20" />
          <Skeleton className="mt-4 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 sm:p-6">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="mt-6 h-[220px] w-full rounded-lg" />
    </div>
  );
}

export function HomePageSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <StatCardsSkeleton />
      <ChartSkeleton />
    </div>
  );
}

export function HomeInstanceTabSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in sm:space-y-10">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card p-5 sm:p-7">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="mt-4 h-10 w-12" />
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-5 sm:p-7">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-10 w-12" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelListSkeleton titleWidth="w-28" rows={4} />
        <PanelListSkeleton titleWidth="w-24" rows={4} />
      </div>
    </div>
  );
}

export function InstancesGridSkeleton({ tiles = 2 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: tiles }).map((_, index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="aspect-square w-full rounded-2xl" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="mt-1 h-2.5 w-2.5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConnectionPageSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <div className="border-b border-border/60 px-5 py-4">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="grid gap-4 border-b border-border/60 px-5 py-5 last:border-b-0 sm:grid-cols-[minmax(0,11rem)_1fr_auto] sm:items-center"
          >
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeepDivePageSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Skeleton className="h-10 w-full rounded-lg sm:w-52" />
        <Skeleton className="h-10 w-full rounded-lg sm:w-44" />
        <Skeleton className="h-10 w-full rounded-lg sm:w-36" />
        <Skeleton className="h-10 min-w-0 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg sm:w-28" />
      </div>
      <Skeleton className="h-4 w-48" />
      <PanelListSkeleton titleWidth="w-32" rows={6} tall />
    </div>
  );
}

export function SettingsPageSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in">
      <div className="space-y-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="rounded-xl border border-border/60 bg-card px-4 sm:px-5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3 border-b border-border/60 py-5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-9 w-full rounded-md sm:w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstanceDetailSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <Skeleton className="h-20 w-20 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-48 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
      <StatCardsSkeleton count={3} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <PanelListSkeleton titleWidth="w-28" rows={5} tall />
        <div className="space-y-4">
          <PanelListSkeleton titleWidth="w-20" rows={3} />
          <PanelListSkeleton titleWidth="w-28" rows={2} />
        </div>
      </div>
    </div>
  );
}

function PanelListSkeleton({
  titleWidth,
  rows,
  tall = false,
}: {
  titleWidth: string;
  rows: number;
  tall?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border border-border/60 bg-card p-5 shadow-sm", tall && "min-h-[360px]")}>
      <Skeleton className={cn("h-5", titleWidth)} />
      <div className="mt-5 space-y-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-full max-w-[240px]" />
            <Skeleton className="h-3 w-full max-w-[180px]" />
          </div>
        ))}
      </div>
    </div>
  );
}
