"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconActivity,
  IconBookings,
  IconChart,
  IconConvert,
  IconCustomers,
  IconDocs,
  IconLeads,
  IconMore,
  IconNps,
  IconScraper,
  IconTestimonials,
} from "./icons";
import { CountPill } from "./rs";
import { formatPollTime } from "@/lib/display";

const NAV = [
  { href: "/", label: "Dashboard", icon: <IconChart /> },
  { href: "/customers", label: "Customers", icon: <IconCustomers /> },
  { href: "/bookings", label: "Bookings", icon: <IconBookings /> },
  { href: "/enquiries", label: "Leads", icon: <IconLeads />, badge: true },
  { href: "/conversion", label: "Lead → booked", icon: <IconConvert /> },
  { href: "/nps", label: "NPS", icon: <span style={{ width: 20, height: 20, display: "grid", placeItems: "center", flexShrink: 0 }}><IconNps /></span> },
  { href: "/testimonials", label: "Testimonials", icon: <IconTestimonials /> },
  { href: "/activity", label: "Activity", icon: <span style={{ width: 20, height: 20, display: "grid", placeItems: "center", flexShrink: 0 }}><IconActivity /></span> },
  { href: "/scraper", label: "Scraper", icon: <IconScraper /> },
  { href: "/docs", label: "API docs", icon: <IconDocs /> },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/customers": "Customers",
  "/bookings": "Bookings",
  "/enquiries": "Leads",
  "/conversion": "Lead → booked",
  "/nps": "NPS",
  "/testimonials": "Testimonials",
  "/activity": "Activity",
  "/scraper": "Scraper",
  "/docs": "API docs",
  "/more": "More",
};

const MOBILE_TABS = [
  { href: "/", label: "Overview", icon: (size: number) => <IconChart size={size} />, match: (p: string) => p === "/" },
  { href: "/enquiries", label: "Leads", icon: (size: number) => <IconLeads size={size} />, match: (p: string) => p === "/enquiries" },
  { href: "/bookings", label: "Bookings", icon: (size: number) => <IconBookings size={size} />, match: (p: string) => p === "/bookings" },
  {
    href: "/more",
    label: "More",
    icon: (size: number) => <IconMore size={size} />,
    match: (p: string) => !["/", "/enquiries", "/bookings"].includes(p),
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [spin, setSpin] = useState(false);
  const [lastPoll, setLastPoll] = useState<string | null>(null);
  const [mode, setMode] = useState("live");
  const [leadBadge, setLeadBadge] = useState(0);

  async function refreshStatus() {
    try {
      const [statusRes, leadRes] = await Promise.all([fetch("/api/status"), fetch("/api/enquiries?hours=out&limit=200")]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setMode(data.mode || "live");
        const at = data.latestPoll?.finished_at || data.latestPoll?.started_at;
        setLastPoll(at || null);
      }
      if (leadRes.ok) {
        const data = await leadRes.json();
        setLeadBadge(Array.isArray(data.enquiries) ? data.enquiries.length : data.count || 0);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshStatus();
    const t = setInterval(() => void refreshStatus(), 30_000);
    return () => clearInterval(t);
  }, []);

  async function scrapeNow() {
    setSpin(true);
    try {
      await fetch("/api/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await refreshStatus();
    } finally {
      setSpin(false);
    }
  }

  const title = TITLES[pathname] || "Dashboard";
  const live = mode === "live" || mode === "Live";

  return (
    <div className="rs-app">
      <div className="desk-only" style={{ display: "flex", alignItems: "stretch", minHeight: "100vh", background: "rgb(255,255,255)" }}>
        <aside
          style={{
            width: 212,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            padding: "16px 16px 20px",
            boxSizing: "border-box",
            borderRight: "1px solid var(--black-4)",
            background: "rgb(255,255,255)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, height: 52, padding: "12px 8px", boxSizing: "border-box" }}>
            <div style={{ width: 28, height: 28, borderRadius: 80, flexShrink: 0, background: "url(/rapidscreen-mark.png) center / cover no-repeat" }} />
            <span style={{ font: "400 14px/20px Inter,sans-serif", fontStyle: "italic", color: "var(--text-sidebar)", whiteSpace: "nowrap" }}>
              TYRES4U.WASUP
            </span>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, paddingTop: 8 }}>
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? undefined : "rs-hover"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 36,
                    padding: 8,
                    borderRadius: 12,
                    boxSizing: "border-box",
                    background: active ? "var(--black-4)" : undefined,
                    color: "rgb(28,28,28)",
                    textDecoration: "none",
                  }}
                >
                  {item.icon}
                  <span style={{ font: `${active ? 500 : 400} 14px/20px Inter,sans-serif` }}>{item.label}</span>
                  {item.badge ? <span style={{ marginLeft: "auto" }}><CountPill n={leadBadge} /></span> : null}
                </Link>
              );
            })}
          </nav>
          <div style={{ background: "var(--background-2)", borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: "10px 12px", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 80, background: "var(--secondary-green)", flexShrink: 0 }} />
              <span style={{ font: "500 12px/16px Inter,sans-serif", color: "rgb(28,28,28)" }}>Poller {live ? "live" : mode}</span>
            </div>
            <div style={{ font: "400 10px/14px Inter,sans-serif", color: "var(--black-40)" }}>Every 1 minute · Vercel cron</div>
          </div>
        </aside>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "rgb(255,255,255)" }}>
          <header
            style={{
              height: 68,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "0 23px 0 33px",
              boxSizing: "border-box",
              borderBottom: "1px solid var(--black-4)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, font: "400 14px/20px Inter,sans-serif" }}>
              <span style={{ color: "var(--black-40)" }}>Tyres 4 U</span>
              <span style={{ color: "var(--black-20)" }}>/</span>
              <strong style={{ fontWeight: 600, color: "rgb(0,0,0)" }}>{title}</strong>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 24,
                padding: "0 10px",
                borderRadius: 80,
                boxShadow: "inset 0 0 0 1px var(--black-10)",
                boxSizing: "border-box",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 80, background: "var(--secondary-green)", flexShrink: 0 }} />
              <span style={{ font: "500 12px/16px Inter,sans-serif", color: "rgb(28,28,28)" }}>{live ? "live" : mode} mode</span>
            </div>
            <div style={{ flex: 1 }} />
            <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", whiteSpace: "nowrap" }}>
              Last poll {lastPoll ? formatPollTime(lastPoll) : "—"}
            </span>
            <button
              type="button"
              onClick={() => void scrapeNow()}
              disabled={spin}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 36,
                padding: "0 16px",
                border: 0,
                borderRadius: 12,
                background: "var(--surface-inverse)",
                color: "rgb(255,255,255)",
                font: "500 14px/20px Inter,sans-serif",
                cursor: spin ? "wait" : "pointer",
                opacity: spin ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>↻</span>Scrape now
            </button>
          </header>
          <div style={{ flex: 1, padding: pathname === "/" ? 0 : "25px 23px 46px 33px", boxSizing: "border-box" }}>{children}</div>
        </div>
      </div>

      <div className="mob-only rs-mob-shell">
        <div className="rs-mob-page">{children}</div>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "stretch", borderTop: "1px solid var(--black-4)", padding: "6px 8px 0", background: "rgb(255,255,255)" }}>
          {MOBILE_TABS.map((tab) => {
            const active = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                style={{
                  flex: 1,
                  minHeight: 52,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  borderRadius: 12,
                  background: active ? "var(--black-4)" : undefined,
                  color: "rgb(28,28,28)",
                  textDecoration: "none",
                }}
              >
                {tab.icon(22)}
                <span style={{ font: `${active ? 500 : 400} 10px/14px Inter,sans-serif` }}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

