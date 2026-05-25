export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-md">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-4 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
