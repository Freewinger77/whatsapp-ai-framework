"use client";

import { useEffect, useMemo, useState } from "react";

type Analytics = {
  kpi: {
    customers: number;
    newCustomers30d: number;
    enquiries: number;
    inHours: number;
    outHours: number;
    npsHeadline: number | null;
  };
  byDay: Array<{ date: string; total: number; inHours: number; outHours: number }>;
  typeMix: Array<{ name: string; value: number }>;
  smtHeadlineNps: number | null;
};

type Enquiry = {
  smt_id: string;
  name: string;
  phone: string | null;
  status: string | null;
  in_hours: boolean;
  enquired_at: string | null;
};

type EventRow = { id: string; kind: string; message: string; created_at: string };

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [a, e, v] = await Promise.all([
          fetch("/api/analytics").then((r) => r.json()),
          fetch("/api/enquiries?limit=8").then((r) => r.json()),
          fetch("/api/events?limit=8").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setData(a);
        setEnquiries(e.enquiries || []);
        setEvents(v.events || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const chart = useMemo(() => {
    const days = data?.byDay ?? [];
    const max = Math.max(1, ...days.map((d) => d.total));
    return { days, max };
  }, [data]);

  const kpi = data?.kpi;
  const mixTotal = (data?.typeMix || []).reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className="grid-12">
      <div className="span-12 kpis">
        {[
          { label: "Customers discovered", value: kpi?.customers ?? "—", sub: "HTML walk · not Reports bookings" },
          { label: "New this 30d", value: kpi?.newCustomers30d ?? "—", sub: "first seen in this CRM" },
          { label: "Enquiries", value: kpi?.enquiries ?? "—", sub: `${kpi?.inHours ?? 0} in-hours · ${kpi?.outHours ?? 0} out` },
          { label: "NPS", value: kpi?.npsHeadline != null ? `${kpi.npsHeadline}%` : "—", sub: data?.smtHeadlineNps != null ? `SMT headline ${data.smtHeadlineNps}%` : "vs SMT headline" },
        ].map((m) => (
          <div className="card" key={m.label}>
            <div className="hint">{m.label}</div>
            <div className="metric">{m.value}</div>
            <div className="hint">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="span-8 card">
        <h2>Enquiries by day</h2>
        <div className="hint">Last 30 days · in-hours Mon–Sat 09:00–17:00 UK</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160, marginTop: 16 }}>
          {chart.days.length ? (
            chart.days.map((d) => (
              <div key={d.date} title={`${d.date}: ${d.total}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2 }}>
                <div style={{ height: `${(d.outHours / chart.max) * 140}px`, background: "rgba(245,190,70,0.7)", borderRadius: 3 }} />
                <div style={{ height: `${(d.inHours / chart.max) * 140}px`, background: "rgb(28,28,30)", borderRadius: 3 }} />
              </div>
            ))
          ) : (
            <div className="hint">No enquiry volume yet — run a scrape or backfill.</div>
          )}
        </div>
      </div>

      <div className="span-4 card">
        <h2>Type mix</h2>
        <div className="hint">Enquiry status</div>
        {(data?.typeMix || []).map((t) => (
          <div key={t.name} className="row">
            <span>{t.name}</span>
            <strong>{t.value} · {Math.round((t.value / mixTotal) * 100)}%</strong>
          </div>
        ))}
        {!data?.typeMix?.length ? <p className="hint">Waiting for rows.</p> : null}
      </div>

      <div className="span-8 card">
        <h2>Recent enquiries</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Hours</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((e) => (
              <tr key={e.smt_id}>
                <td>{e.name}</td>
                <td>{e.phone}</td>
                <td>
                  <span className={`badge ${e.in_hours ? "in" : "out"}`}>{e.in_hours ? "In hours" : "Out of hours"}</span>
                </td>
                <td>{e.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="span-4 card">
        <h2>Activity</h2>
        {events.map((e) => (
          <div key={e.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ font: "500 13px/18px Inter,sans-serif" }}>{e.kind}</div>
            <div className="hint">{e.message}</div>
          </div>
        ))}
        {error ? <p className="err">{error}</p> : null}
      </div>

      <div className="span-12 card">
        <h2>Reconcile vs SMT</h2>
        <div className="hint">CRM list pages are the census (pager footer rows are ignored). Reports → New/Existing Customer Bookings are booking charts (~243 new-customer bookings over ~12 months), not the customer list.</div>
        <div className="row"><span>Customers</span><strong>14 pages · 275 View ids (CSV export matches)</strong></div>
        <div className="row"><span>Enquiries</span><strong>4 pages · 80 View ids</strong></div>
        <div className="row"><span>NPS rows</span><strong>3 pages · 28 scores · SMT headline 71.43%</strong></div>
        <div className="row"><span>Testimonials</span><strong>5 quotes</strong></div>
      </div>
    </div>
  );
}
