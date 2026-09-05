"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/customers", label: "Customers" },
  { href: "/enquiries", label: "Enquiries" },
  { href: "/nps", label: "NPS" },
  { href: "/testimonials", label: "Testimonials" },
  { href: "/activity", label: "Activity" },
  { href: "/scraper", label: "Scraper" },
  { href: "/docs", label: "API docs" },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/customers": "Customers",
  "/enquiries": "Enquiries",
  "/nps": "NPS",
  "/testimonials": "Testimonials",
  "/activity": "Activity",
  "/scraper": "Scraper",
  "/docs": "API docs",
};

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [spin, setSpin] = useState(false);
  const [lastPoll, setLastPoll] = useState("—");
  const [mode, setMode] = useState("live");

  async function refreshStatus() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) return;
      const data = await res.json();
      setMode(data.mode || "live");
      const at = data.latestPoll?.finished_at || data.latestPoll?.started_at;
      setLastPoll(at ? new Date(at).toLocaleTimeString("en-GB") : "never");
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

  return (
    <div className="shell">
      <aside className="aside">
        <div className="brand">TYRES4U.WASUP</div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""}>
              <span className="ic">•</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="poller-card">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span className="dot" />
            <span style={{ font: "500 12px/16px Inter,sans-serif" }}>Poller {mode}</span>
          </div>
          <div className="hint">Every 1 minute · Vercel cron</div>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="crumb">
            Tyres 4 U <span>/</span> <strong>{TITLES[pathname] || "Dashboard"}</strong>
          </div>
          <div className="live">
            <span className="dot" />
            {mode} mode
          </div>
          <div className="grow" />
          <div className="hint">Last poll {lastPoll}</div>
          <button className="btn" onClick={() => void scrapeNow()} disabled={spin}>
            <span className={spin ? "pulse" : ""}>↻</span>
            Scrape now
          </button>
        </header>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}
