"use client";

import { useEffect, useState } from "react";
import { DashboardDesktop } from "@/components/dashboard-desktop";
import { DashboardMobile } from "@/components/dashboard-mobile";
import { PageLoader } from "@/components/tyre-loader";
import { formatPollClock } from "@/lib/display";
import type { AnalyticsData, ConversionData, EnquiryRow, EventRow } from "@/lib/dashboard-model";

export default function DashboardPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [enquiries, setEnquiries] = useState<EnquiryRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [conversion, setConversion] = useState<ConversionData | null>(null);
  const [pollClock, setPollClock] = useState("—");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        const [a, e, v, c, s] = await Promise.all([
          fetch(`/api/analytics?days=${days}`).then((r) => r.json()),
          fetch("/api/enquiries?limit=200").then((r) => r.json()),
          fetch("/api/events?limit=8").then((r) => r.json()),
          fetch(`/api/conversion?days=${days}`).then((r) => r.json()),
          fetch("/api/status").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setData(a);
        setEnquiries(e.enquiries || []);
        setEvents(v.events || []);
        setConversion(c.error ? null : c);
        const at = s.latestPoll?.finished_at || s.latestPoll?.started_at;
        setPollClock(at ? formatPollClock(at) : "—");
      } catch {
        /* keep last good frame */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const firstPaint = loading && !data;

  return (
    <>
      {loading ? <PageLoader /> : null}
      <div className="desk-only">
        <DashboardDesktop days={days} setDays={setDays} loading={firstPaint} data={data} enquiries={enquiries} events={events} conversion={conversion} />
      </div>
      <div className="mob-only flush-mob" style={{ height: "100%" }}>
        <DashboardMobile days={days} setDays={setDays} loading={loading} data={data} enquiries={enquiries} conversion={conversion} pollClock={pollClock} />
      </div>
    </>
  );
}
