/** Catmull-Rom through daily values → cubic path in the RapidScreen 640×160 viewBox. */

export const CHART_W = 640;
export const CHART_H = 160;
export const CHART_Y_TOP = 26;
export const CHART_Y_BOT = 134;

export function catmullRomPath(
  values: number[],
  width = CHART_W,
  yTop = CHART_Y_TOP,
  yBot = CHART_Y_BOT,
): string {
  if (!values.length) return "";
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => ({
    x: n === 1 ? 0 : (i / (n - 1)) * width,
    y: yBot - (v / max) * (yBot - yTop),
  }));
  if (pts.length === 1) return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return d;
}

export function areaUnder(path: string, width = CHART_W, yBot = CHART_Y_BOT): string {
  if (!path) return "";
  return `${path} L ${fmt(width)} ${fmt(yBot)} L 0 ${fmt(yBot)} Z`;
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}
