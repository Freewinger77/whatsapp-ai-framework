const SRC = "/tyres4u-logo.png?v=3";

export function BrandLogo({
  size = "sidebar",
  subtitle,
}: {
  size?: "login" | "sidebar" | "mobile";
  subtitle?: string;
}) {
  return (
    <div className={`brand-lockup brand-lockup--${size}`}>
      <span className="brand-mark" role="img" aria-label="Tyres 4 U" style={{ backgroundImage: `url(${SRC})` }} />
      {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
    </div>
  );
}
