import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground">{p.date}</div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">
        {p.value.toLocaleString()}
      </div>
    </div>
  );
}

export function VolumeChart({
  data,
}: {
  data: { date: string; value: number }[];
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 30, right: 40, left: 10, bottom: 10 }}
          >
            <CartesianGrid
              stroke="hsl(var(--border))"
              vertical={false}
              strokeDasharray="0"
            />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <YAxis hide domain={[0, "dataMax + 400"]} />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "hsl(var(--foreground))",
                strokeDasharray: "3 3",
                strokeOpacity: 0.5,
              }}
            />
            <Line
              type="linear"
              dataKey="value"
              stroke="hsl(var(--foreground))"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 5,
                fill: "hsl(var(--foreground))",
                stroke: "hsl(var(--background))",
                strokeWidth: 2,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
