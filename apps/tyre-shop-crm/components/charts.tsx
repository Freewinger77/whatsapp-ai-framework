"use client";

type Point = { label: string; values: number[] };

function maxOf(series: Point[]): number {
  return Math.max(1, ...series.flatMap((p) => p.values));
}

function coords(series: Point[], seriesIndex: number, width: number, height: number, pad: number) {
  const max = maxOf(series);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const n = Math.max(1, series.length - 1);
  return series.map((p, i) => ({
    x: pad + (i / n) * innerW,
    y: pad + innerH - (p.values[seriesIndex] / max) * innerH,
  }));
}

function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function LineChart({
  series,
  colors,
  height = 148,
}: {
  series: Point[];
  colors: string[];
  height?: number;
}) {
  const width = 560;
  const pad = 10;
  if (!series.length) {
    return <p className="hint">No volume in this period.</p>;
  }
  return (
    <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" preserveAspectRatio="none">
      {colors.map((color, idx) => {
        const pts = coords(series, idx, width, height, pad);
        return (
          <path
            key={color}
            d={smoothPath(pts)}
            fill="none"
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

export function LineLabels({ labels }: { labels: string[] }) {
  return (
    <div className="line-labels">
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

export function Donut({
  slices,
  center,
}: {
  slices: Array<{ label: string; value: number; color: string }>;
  center: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 36;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 96 96" width="112" height="112" aria-hidden>
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="12" />
        {total
          ? slices.map((slice) => {
              const len = (slice.value / total) * c;
              const el = (
                <circle
                  key={slice.label}
                  cx="48"
                  cy="48"
                  r={r}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="12"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  transform="rotate(-90 48 48)"
                />
              );
              offset += len;
              return el;
            })
          : null}
      </svg>
      <div className="donut-center">
        <strong>{center}</strong>
      </div>
    </div>
  );
}

export function Change({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="hint">vs previous period</span>;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span className={`delta ${flat ? "flat" : up ? "up" : "down"}`}>
      {flat ? "Flat vs previous period" : `${up ? "↑" : "↓"} ${Math.abs(value)}% vs previous period`}
    </span>
  );
}
