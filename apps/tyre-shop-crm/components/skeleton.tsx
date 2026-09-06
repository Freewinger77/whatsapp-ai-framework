import type { ReactNode } from "react";
import { TyreLoader } from "./tyre-loader";

export function Bone({
  width = "100%",
  height = 16,
  radius = 8,
  light,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  light?: boolean;
}) {
  return (
    <span
      className={light ? "rs-skel rs-skel-light" : "rs-skel"}
      style={{ width, height, borderRadius: radius, display: "block" }}
    />
  );
}

export function SkCard({
  children,
  basis = 260,
  height,
  invert,
  pad = 16,
}: {
  children?: ReactNode;
  basis?: number;
  height?: number;
  invert?: boolean;
  pad?: number;
}) {
  return (
    <div
      className={invert ? "rs-skel-card inv" : "rs-skel-card"}
      style={{ flex: `1 1 ${basis}px`, minWidth: 0, minHeight: height, padding: pad }}
    >
      {children}
    </div>
  );
}

export function DashboardDesktopSkeleton() {
  return (
    <div className="rs-skel-wrap">
      <TyreLoader size={180} />
      <div className="rs-skel-stack">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <SkCard basis={260} pad={20}>
          <Bone width={110} height={14} />
          <Bone width={72} height={44} radius={10} />
          <Bone width={160} height={12} />
        </SkCard>
        <SkCard basis={260} pad={20}>
          <Bone width={130} height={14} />
          <Bone width={64} height={44} radius={10} />
          <Bone width={150} height={12} />
        </SkCard>
        <SkCard basis={260} pad={20} invert>
          <Bone width={120} height={14} light />
          <Bone width={88} height={44} radius={10} light />
          <Bone width={180} height={12} light />
        </SkCard>
      </div>

      <div className="rs-skel-rule" />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <SkCard basis={270} height={280}>
          <Bone width={160} height={16} />
          <Bone width="100%" height={180} radius={12} />
          <Bone width="70%" height={12} />
        </SkCard>
        <SkCard basis={270} height={280}>
          <Bone width={120} height={16} />
          <Bone width="100%" height={180} radius={12} />
          <Bone width="60%" height={12} />
        </SkCard>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <SkCard basis={260} height={180}>
          <Bone width={90} height={16} />
          <div style={{ display: "flex", gap: 20, alignItems: "center", marginTop: 12 }}>
            <Bone width={112} height={112} radius={80} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              <Bone width="80%" height={12} />
              <Bone width="70%" height={12} />
            </div>
          </div>
        </SkCard>
        <SkCard basis={260} height={180}>
          <Bone width={100} height={16} />
          <div style={{ display: "flex", gap: 20, alignItems: "center", marginTop: 12 }}>
            <Bone width={112} height={112} radius={80} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              <Bone width="75%" height={12} />
              <Bone width="65%" height={12} />
            </div>
          </div>
        </SkCard>
      </div>

      <div className="rs-skel-rule" />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkCard key={i} basis={180} height={96}>
            <Bone width={80} height={12} />
            <Bone width={56} height={28} radius={8} />
            <Bone width="90%" height={12} />
          </SkCard>
        ))}
      </div>

      <SkCard basis={800} height={64}>
        <Bone width={180} height={18} />
        <Bone width={220} height={12} />
      </SkCard>
      </div>
    </div>
  );
}

export function DashboardMobileSkeleton() {
  return (
    <div className="rs-skel-wrap">
      <TyreLoader size={140} />
      <div className="rs-skel-stack">
      <SkCard basis={300} pad={20} invert>
        <Bone width={100} height={14} light />
        <Bone width={64} height={44} radius={10} light />
        <Bone width={140} height={12} light />
      </SkCard>
      <div style={{ display: "flex", gap: 12 }}>
        <SkCard basis={140} height={88}>
          <Bone width={70} height={12} />
          <Bone width={40} height={28} />
        </SkCard>
        <SkCard basis={140} height={88}>
          <Bone width={90} height={12} />
          <Bone width={48} height={28} />
        </SkCard>
      </div>
      <SkCard basis={300} height={200}>
        <Bone width={160} height={16} />
        <Bone width="100%" height={120} radius={12} />
      </SkCard>
      <SkCard basis={300} height={56}>
        <Bone width={150} height={16} />
      </SkCard>
      </div>
    </div>
  );
}
