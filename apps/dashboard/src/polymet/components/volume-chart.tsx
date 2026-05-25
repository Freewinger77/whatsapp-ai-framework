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
  const hasData = data.length > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card p-3 sm:p-4">
      <div className="relative h-64 w-full sm:h-80">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 24, right: 16, left: 0, bottom: 8 }}
            >
              <CartesianGrid
                stroke="hsl(var(--border))"
                vertical={false}
                strokeDasharray="3 6"
                strokeLinecap="round"
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
                  strokeDasharray: "3 6",
                  strokeLinecap: "round",
                  strokeOpacity: 0.35,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--foreground))"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
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
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-center">
            <div className="text-base font-semibold">No conversation data yet</div>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Connect an instance and start receiving messages to see volume trends here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
