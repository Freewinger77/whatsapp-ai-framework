"use client";

import Link from "next/link";
import {
  IconActivity,
  IconConvert,
  IconCustomers,
  IconDocs,
  IconNps,
  IconScraper,
} from "@/components/icons";

const ITEMS = [
  { href: "/customers", label: "Customers", icon: <IconCustomers size={22} /> },
  { href: "/conversion", label: "Lead → booked", icon: <IconConvert size={22} /> },
  { href: "/nps", label: "NPS", icon: <span style={{ width: 22, height: 22, display: "grid", placeItems: "center" }}><IconNps size={17} /></span> },
  { href: "/activity", label: "Activity", icon: <span style={{ width: 22, height: 22, display: "grid", placeItems: "center" }}><IconActivity size={17} /></span> },
  { href: "/scraper", label: "Scraper", icon: <IconScraper size={22} /> },
  { href: "/docs", label: "API docs", icon: <IconDocs size={22} /> },
];

export default function MorePage() {
  return (
    <>
      <div className="desk-only">
        <h1 className="page-title">More</h1>
        <p className="page-hint">The rest of the console. Same lists as the sidebar.</p>
      </div>
      <div className="mob-only flush-mob" style={{ height: "100%", flexDirection: "column", background: "rgb(255,255,255)" }}>
        <div style={{ flexShrink: 0, padding: "8px 16px 12px", borderBottom: "1px solid var(--black-4)" }}>
          <div style={{ font: "600 16px/20px Inter,sans-serif" }}>More</div>
          <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>Customers, NPS, scraper, docs</div>
        </div>
        <div className="more-list">
          {ITEMS.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
