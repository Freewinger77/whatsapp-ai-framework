export function BrandLogo({
  height = 36,
  subtitle,
}: {
  height?: number;
  subtitle?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <img
        src="/tyres4u-logo.png"
        alt="Tyres 4 U"
        height={height}
        style={{ height, width: "auto", display: "block", maxWidth: "100%" }}
      />
      {subtitle ? (
        <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{subtitle}</span>
      ) : null}
    </div>
  );
}
