"use client";

import { useEffect, useMemo, useState } from "react";
import { Change, Donut, LineChart, LineLabels } from "@/components/charts";

type DayPoint = {
  date: string;
  label: string;
  leads: number;
  email: number;
  phone: number;
  customers: number;
  inHours: number;
  outHours: number;
};

type Analytics = {
  kpi: {
    customers: number;
    newCustomers30d: number;
    enquiries: number;
    inHours: number;
    outHours: number;
    emailLeads: number;
    phoneLeads: number;
    npsHeadline: number | null;
  };
  series: DayPoint[];
  mix: {
    email: number;
    phone: number;
    leads: number;
    customers: number;
    inHours: number;
    outHours: number;
  };
  pct: {
    afterHours: number | null;
    phoneOfLeads: number | null;
    emailOfLeads: number | null;
    newCustomersOfAll: number | null;
    vsPrevious: {
      leads: number | null;
      email: number | null;
      phone: number | null;
      customers: number | null;
    };
  };
  byDay: Array<{ date: string; total: number; inHours: number; outHours: number }>;
  typeMix: Array<{ name: string; value: number }>;
  smtHeadlineNps: number | null;
};

type Enquiry = {
  smt_id: string;
  name: string;
  phone: string | null;
  channel: string | null;
  status: string | null;
  message: string | null;
  in_hours: boolean;
  enquired_at: string | null;
};

type Conversion = {
  emailLeadRows: number;
  uniqueBooked: number;
  matchedRows: number;
  openRows: number;
  rowPct: number;
  peoplePct: number;
  uniqueLeadPeople: number;
  people: Array<{ key: string; name: string; phone: string | null; enquiryCount: number }>;
};

type EventRow = { id: string; kind: string; message: string; created_at: string };

export default function DashboardPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Analytics | null>(null);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [a, e, v, c] = await Promise.all([
          fetch(`/api/analytics?days=${days}`).then((r) => r.json()),
          fetch("/api/enquiries?limit=8").then((r) => r.json()),
          fetch("/api/events?limit=8").then((r) => r.json()),
          fetch("/api/conversion").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setData(a);
        setEnquiries(e.enquiries || []);
        setEvents(v.events || []);
        setConversion(c.error ? null : c);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const series = useMemo(() => data?.series ?? [], [data]);
  const labels = useMemo(() => series.map((d) => d.label), [series]);
  const kpi = data?.kpi;
  const mix = data?.mix;
  const pct = data?.pct;

  return (
    <div className="grid-12">
      <div className="span-12 kpis">
        {[
          { label: "Customers", value: kpi?.customers ?? "—", sub: "Booked CRM list · not leads" },
          { label: "Email leads", value: kpi?.emailLeads ?? kpi?.enquiries ?? "—", sub: "Enquiry Received · name + phone" },
          { label: "Phone leads", value: kpi?.phoneLeads ?? 0, sub: "Phone Enquiry Received · SMT home" },
          { label: "NPS", value: kpi?.npsHeadline != null ? `${kpi.npsHeadline}%` : "—", sub: data?.smtHeadlineNps != null ? `SMT headline ${data.smtHeadlineNps}%` : "vs SMT headline" },
        ].map((m) => (
          <div className="card" key={m.label}>
            <div className="hint">{m.label}</div>
            <div className="metric">{m.value}</div>
            <div className="hint">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="span-12 period">
        {[7, 30, 90].map((n) => (
          <button key={n} className={`chip ${days === n ? "on" : ""}`} type="button" onClick={() => setDays(n)}>
            Last {n} days
          </button>
        ))}
      </div>

      <div className="span-8 card">
        <div className="chart-head">
          <h2>After hours / store hours</h2>
          <span className="hint">{mix?.leads ?? 0} leads this period</span>
        </div>
        <div className="legend">
          <span><i className="store" /> Store hours {mix?.inHours ?? 0}</span>
          <span><i className="after" /> After hours {mix?.outHours ?? 0}</span>
        </div>
        <LineChart
          series={series.map((d) => ({ label: d.label, values: [d.inHours, d.outHours] }))}
          colors={["rgb(28,28,30)", "rgb(122, 86, 168)"]}
        />
        <LineLabels labels={labels} />
        <p className="hint" style={{ margin: "12px 0 0" }}>
          {pct?.afterHours != null
            ? `${pct.afterHours}% of leads arrive outside store hours.`
            : "No leads in this period."}{" "}
          Mon–Sat 09:00–17:00 UK.
        </p>
      </div>

      <div className="span-4 card">
        <h2>Lead split</h2>
        <div className="hint">Email form vs phone enquiry</div>
        <div className="donut-card" style={{ marginTop: 12 }}>
          <Donut
            slices={[
              { label: "Email", value: mix?.email ?? 0, color: "rgb(76, 152, 253)" },
              { label: "Phone", value: mix?.phone ?? 0, color: "rgb(79, 80, 127)" },
            ]}
            center={String(mix?.leads ?? 0)}
          />
          <div className="donut-key">
            <div className="row"><span className="legend"><i className="email" /> Email</span><strong>{mix?.email ?? 0} · {pct?.emailOfLeads ?? 0}%</strong></div>
            <div className="row"><span className="legend"><i className="phone" /> Phone</span><strong>{mix?.phone ?? 0} · {pct?.phoneOfLeads ?? 0}%</strong></div>
            <Change value={pct?.vsPrevious.leads} />
          </div>
        </div>
      </div>

      <div className="span-4 card">
        <h2>Hours split</h2>
        <div className="hint">Same period · store vs after hours</div>
        <div className="donut-card" style={{ marginTop: 12 }}>
          <Donut
            slices={[
              { label: "Store hours", value: mix?.inHours ?? 0, color: "rgb(28,28,30)" },
              { label: "After hours", value: mix?.outHours ?? 0, color: "rgb(122, 86, 168)" },
            ]}
            center={pct?.afterHours != null ? `${Math.round(pct.afterHours)}%` : "0"}
          />
          <div className="donut-key">
            <div className="row"><span className="legend"><i className="store" /> Store hours</span><strong>{mix?.inHours ?? 0}</strong></div>
            <div className="row"><span className="legend"><i className="after" /> After hours</span><strong>{mix?.outHours ?? 0}</strong></div>
            <p className="hint" style={{ margin: "8px 0 0" }}>
              {pct?.afterHours != null ? `${pct.afterHours}% after hours` : "No leads yet"}
            </p>
          </div>
        </div>
      </div>

      <div className="span-4 card">
        <div className="chart-head">
          <h2>Leads per day</h2>
          <span className="hint">{mix?.leads ?? 0}</span>
        </div>
        <div className="legend"><span><i className="leads" /> Email + phone</span></div>
        <LineChart series={series.map((d) => ({ label: d.label, values: [d.leads] }))} colors={["rgb(28,28,30)"]} />
        <LineLabels labels={labels} />
        <Change value={pct?.vsPrevious.leads} />
      </div>

      <div className="span-4 card">
        <div className="chart-head">
          <h2>Phone enquiries</h2>
          <span className="hint">{mix?.phone ?? 0}</span>
        </div>
        <div className="legend"><span><i className="phone" /> Phone Enquiry Received</span></div>
        <LineChart series={series.map((d) => ({ label: d.label, values: [d.phone] }))} colors={["rgb(79, 80, 127)"]} />
        <LineLabels labels={labels} />
        <Change value={pct?.vsPrevious.phone} />
      </div>

      <div className="span-6 card">
        <div className="chart-head">
          <h2>Emails</h2>
          <span className="hint">{mix?.email ?? 0}</span>
        </div>
        <div className="legend"><span><i className="email" /> Enquiry Received</span></div>
        <LineChart series={series.map((d) => ({ label: d.label, values: [d.email] }))} colors={["rgb(76, 152, 253)"]} />
        <LineLabels labels={labels} />
        <Change value={pct?.vsPrevious.email} />
      </div>

      <div className="span-6 card">
        <div className="chart-head">
          <h2>Customers</h2>
          <span className="hint">{mix?.customers ?? 0} booked</span>
        </div>
        <div className="legend"><span><i className="store" /> Last booking date from SMT</span></div>
        <LineChart series={series.map((d) => ({ label: d.label, values: [d.customers] }))} colors={["rgb(28,28,30)"]} />
        <LineLabels labels={labels} />
        <p className="hint" style={{ margin: "10px 0 0" }}>
          {pct?.newCustomersOfAll != null
            ? `${pct.newCustomersOfAll}% of all ${kpi?.customers ?? 0} booked customers have a booking date in this period.`
            : `KPI is ${kpi?.customers ?? 0} on the booked list. SMT did not give a booking date on those rows, so the daily line stays empty.`}{" "}
          <Change value={pct?.vsPrevious.customers} />
        </p>
      </div>

      <div className="span-12 card">
        <h2>Email enquiry → booked</h2>
        <div className="hint">Same phone or email on the Customers list. Open Lead → booked in the sidebar for the full list.</div>
        <div className="row"><span>Email enquiries</span><strong>{conversion?.emailLeadRows ?? "—"}</strong></div>
        <div className="row"><span>Unique people booked</span><strong>{conversion?.uniqueBooked ?? "—"} · {conversion?.peoplePct ?? 0}%</strong></div>
        <div className="row"><span>Enquiry rows that match</span><strong>{conversion?.matchedRows ?? "—"} · {conversion?.rowPct ?? 0}%</strong></div>
        <div className="row"><span>Still open</span><strong>{conversion?.openRows ?? "—"}</strong></div>
        {(conversion?.people || []).slice(0, 6).map((p) => (
          <div className="row" key={p.key}>
            <span>{p.name}{p.enquiryCount > 1 ? ` · ${p.enquiryCount} enquiries` : ""}</span>
            <strong className="phone">{p.phone || "—"}</strong>
          </div>
        ))}
      </div>

      <div className="span-8 card">
        <h2>Recent leads</h2>
        <div className="hint">Name and phone from SMT. Phone-channel home items often have no caller ID.</div>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Channel</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((e) => (
              <tr key={e.smt_id}>
                <td>
                  <div>{e.name}</div>
                  {e.message ? <div className="hint">{e.message.slice(0, 72)}{e.message.length > 72 ? "…" : ""}</div> : null}
                </td>
                <td className="phone">{e.phone || "—"}</td>
                <td>
                  <span className={`badge ${e.channel === "phone" ? "phone" : "email"}`}>
                    {e.channel === "phone" ? "Phone enquiry" : "Email enquiry"}
                  </span>
                </td>
                <td>
                  <span className={`badge ${e.in_hours ? "in" : "out"}`}>{e.in_hours ? "In hours" : "Out of hours"}</span>
                </td>
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
