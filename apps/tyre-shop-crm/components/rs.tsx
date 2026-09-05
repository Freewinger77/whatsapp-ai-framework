"use client";

import type { CSSProperties, ReactNode } from "react";
import { areaUnder, catmullRomPath } from "@/lib/chart-path";
import { IconWhatsApp } from "./icons";

export function Chip({
  on,
  children,
  onClick,
  height = 32,
}: {
  on?: boolean;
  children: ReactNode;
  onClick?: () => void;
  height?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height,
        padding: "0 14px",
        border: 0,
        borderRadius: 80,
        background: on ? "var(--surface-inverse)" : "transparent",
        boxShadow: on ? undefined : "inset 0 0 0 1px var(--black-10)",
        color: on ? "rgb(255,255,255)" : "rgb(28,28,28)",
        font: `${on ? 500 : 400} 14px/20px Inter,sans-serif`,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: "pointer",
      }}
      className={on ? undefined : "rs-hover"}
    >
      {children}
    </button>
  );
}

export function CountPill({ n, height = 20 }: { n: number; height?: number }) {
  return (
    <span
      style={{
        minWidth: height,
        height,
        padding: height > 20 ? "0 8px" : "0 6px",
        borderRadius: 80,
        background: "var(--surface-inverse)",
        color: "rgb(255,255,255)",
        font: `600 12px/${height}px Inter,sans-serif`,
        textAlign: "center",
        boxSizing: "border-box",
      }}
    >
      {n}
    </span>
  );
}

export function SectionRule({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ font: "500 14px/20px Inter,sans-serif", color: "var(--black-40)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--black-4)" }} />
    </div>
  );
}

export function Dot({ color, size = 8, radius = 80 }: { color: string; size?: number; radius?: number }) {
  return (
    <i
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color,
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}

export function RsLineChart({
  series,
  colors,
  fillFirst,
  labels,
  height,
  labelSize = 12,
}: {
  series: number[][];
  colors: string[];
  fillFirst?: boolean;
  labels: string[];
  height: number;
  labelSize?: number;
}) {
  return (
    <div style={{ background: "rgb(255,255,255)", borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: "12px 12px 8px" }}>
      <svg viewBox="0 0 640 160" preserveAspectRatio="none" style={{ display: "block", width: "100%", height }} aria-hidden="true">
        {fillFirst && series[0] ? (
          <path d={areaUnder(catmullRomPath(series[0]))} fill="rgba(0,0,0,0.06)" stroke="none" />
        ) : null}
        {series.map((values, i) => (
          <path
            key={colors[i] || i}
            d={catmullRomPath(values)}
            fill="none"
            stroke={colors[i]}
            strokeWidth="2"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          font: `400 ${labelSize}px/${labelSize + 4}px Inter,sans-serif`,
          color: "var(--black-40)",
          paddingTop: 6,
        }}
      >
        {labels.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function RsDonut({
  slices,
  center,
}: {
  slices: Array<{ value: number; color: string }>;
  center: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 36;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: "relative", width: 112, height: 112, flexShrink: 0, display: "grid", placeItems: "center" }}>
      <svg viewBox="0 0 96 96" width="112" height="112" aria-hidden="true">
        <circle cx="48" cy="48" r="36" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="12" />
        {total
          ? slices.map((slice, i) => {
              const len = (slice.value / total) * c;
              const el = (
                <circle
                  key={`${slice.color}-${i}`}
                  cx="48"
                  cy="48"
                  r="36"
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="12"
                  strokeDasharray={`${round1(len)} ${round1(c)}`}
                  strokeDashoffset={-round1(offset)}
                  transform="rotate(-90 48 48)"
                />
              );
              offset += len;
              return el;
            })
          : null}
      </svg>
      <strong style={{ position: "absolute", font: "600 24px/32px Inter,sans-serif", color: "rgb(0,0,0)" }}>{center}</strong>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function WhatsAppButton({ href, label = true }: { href: string | null; label?: boolean }) {
  const inner = (
    <>
      <IconWhatsApp size={label ? 18 : 22} />
      {label ? "WhatsApp" : null}
    </>
  );
  const style: CSSProperties = label
    ? {
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: "0 14px",
        border: 0,
        borderRadius: 12,
        background: "transparent",
        boxShadow: "inset 0 0 0 1px var(--black-10)",
        font: "500 14px/20px Inter,sans-serif",
        color: "rgb(28,28,28)",
        cursor: href ? "pointer" : "default",
        whiteSpace: "nowrap",
        textDecoration: "none",
      }
    : {
        width: 44,
        height: 44,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        border: 0,
        borderRadius: 12,
        background: "transparent",
        boxShadow: "inset 0 0 0 1px var(--black-10)",
        cursor: href ? "pointer" : "default",
        textDecoration: "none",
      };
  if (!href) {
    return (
      <span style={{ ...style, opacity: label ? undefined : 0.35, color: "var(--black-20)", boxShadow: label ? undefined : "inset 0 0 0 1px var(--black-4)", cursor: "default" }}>
        {label ? "No number to call" : inner}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="rs-hover" style={style}>
      {inner}
    </a>
  );
}

export function ChangeLine({
  value,
  vs,
  extra,
  light,
}: {
  value: number | null | undefined;
  vs: string;
  extra?: string;
  light?: boolean;
}) {
  if (value == null) {
    return <span style={{ font: "400 12px/16px Inter,sans-serif", color: light ? "rgba(255,255,255,0.8)" : "var(--black-80)" }}>vs {vs}</span>;
  }
  if (value === 0) {
    return (
      <span style={{ font: "400 12px/16px Inter,sans-serif", color: light ? "rgba(255,255,255,0.8)" : "var(--black-40)" }}>
        Flat vs previous period{extra ? ` ${extra}` : ""}
      </span>
    );
  }
  const up = value > 0;
  return (
    <span style={{ font: "400 12px/16px Inter,sans-serif", color: light ? "rgba(255,255,255,0.8)" : "var(--black-80)" }}>
      <span style={{ color: up ? "rgb(48,209,88)" : "rgb(255,59,48)" }}>{up ? "↑" : "↓"}</span> {Math.abs(value)}% vs {vs}
      {extra ? ` · ${extra}` : ""}
    </span>
  );
}

export const th: CSSProperties = {
  textAlign: "left",
  font: "500 12px/16px Inter,sans-serif",
  color: "var(--black-40)",
  padding: "8px 12px 8px 0",
  borderBottom: "1px solid var(--black-4)",
};

export const td: CSSProperties = {
  font: "400 14px/20px Inter,sans-serif",
  padding: "10px 12px 10px 0",
  borderBottom: "1px solid var(--black-4)",
};

export const tdLast: CSSProperties = {
  font: "400 14px/20px Inter,sans-serif",
  padding: "10px 0",
  borderBottom: "1px solid var(--black-4)",
};
