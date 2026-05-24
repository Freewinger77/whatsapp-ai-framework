import { StatCard } from "@/polymet/components/stat-card";
import { STATS } from "@/polymet/data/dashboard-data";

export default function StatCardRender() {
  return (
    <div className="grid grid-cols-3 gap-4 p-6">
      {STATS.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}
