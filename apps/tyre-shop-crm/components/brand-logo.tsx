const LOGO_W = 720;
const LOGO_H = 246;

export function BrandLogo({
  height = 36,
  subtitle,
}: {
  height?: number;
  subtitle?: string;
}) {
  const width = Math.round((height * LOGO_W) / LOGO_H);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <img
        src="/tyres4u-logo.png"
        alt="Tyres 4 U"
        width={width}
        height={height}
        style={{ width, height, objectFit: "contain", display: "block", flexShrink: 0 }}
      />
      {subtitle ? (
        <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{subtitle}</span>
      ) : null}
    </div>
  );
}
