"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  ChangeLine,
  Chip,
  CountPill,
  Dot,
  RsDonut,
  RsLineChart,
  SectionRule,
  WhatsAppButton,
  td,
  tdLast,
  th,
} from "./rs";
import {
  formatActivityLine,
  formatActivityWhen,
  formatDayRange,
  formatLeadWhen,
  formatUkPhone,
  leadDisplayName,
  listPages,
  periodTitle,
  periodVsLabel,
  whatsappHref,
} from "@/lib/display";
import { callbacks, chartLabels, npsLabel, recentLeads, type AnalyticsData, type ConversionData, type EnquiryRow, type EventRow } from "@/lib/dashboard-model";

export function DashboardDesktop({
  days,
  setDays,
  data,
  enquiries,
  events,
  conversion,
}: {
  days: number;
  setDays: (n: number) => void;
  data: AnalyticsData | null;
  enquiries: EnquiryRow[];
  events: EventRow[];
  conversion: ConversionData | null;
}) {
  const kpi = data?.kpi;
  const mix = data?.mix;
  const pct = data?.pct;
  const prev = data?.previous;
  const series = data?.series ?? [];
  const labels = chartLabels(series);
  const vs = periodVsLabel(days);
  const callList = callbacks(enquiries, data?.from, data?.to);
  const recent = recentLeads(enquiries, 5);
  const after = pct?.afterHours;
  const range = data ? formatDayRange(data.from, data.to) : "";
  const [callbacksOpen, setCallbacksOpen] = useState(false);

  return (
    <div style={{ flex: 1, padding: "25px 23px 46px 33px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ font: "600 24px/32px Inter,sans-serif", margin: 0, color: "rgb(0,0,0)" }}>{periodTitle(days)}</h1>
          <p style={{ font: "400 14px/20px Inter,sans-serif", color: "var(--black-40)", margin: "4px 0 0" }}>
            {range ? `${range}. ` : ""}Mon–Sat 09:00–17:00 UK is store hours; everything else is after hours.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Chip on={days === 7} onClick={() => setDays(7)}>Last 7 days</Chip>
          <Chip on={days === 30} onClick={() => setDays(30)}>Last 30 days</Chip>
          <Chip on={days === 90} onClick={() => setDays(90)}>Last 90 days</Chip>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <Hero
          label="Leads this week"
          value={mix?.leads ?? "—"}
          sub={<ChangeLine value={pct?.vsPrevious.leads} vs={vs} extra={prev ? `${prev.leads} lead${prev.leads === 1 ? "" : "s"}` : undefined} />}
        />
        <Hero
          label="Bookings this week"
          value={mix?.bookings ?? "—"}
          sub={<ChangeLine value={pct?.vsPrevious.bookings} vs={vs} extra={prev ? `${prev.bookings} created` : undefined} />}
        />
        <Hero
          invert
          label="Lead → booked"
          value={conversion ? `${conversion.peoplePct}%` : "—"}
          sub={`${conversion?.uniqueBooked ?? "—"} of ${conversion?.uniqueLeadPeople ?? "—"} unique people who emailed`}
        />
      </div>

      <SectionRule label="Where the leads come from" />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <ChartCard
          title="After hours / store hours"
          meta={`${mix?.leads ?? 0} leads this period`}
          legend={
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(28,28,30)" />Store hours {mix?.inHours ?? 0}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="var(--logo-2)" />After hours {mix?.outHours ?? 0}</span>
            </>
          }
          chart={<RsLineChart series={[series.map((d) => d.inHours), series.map((d) => d.outHours)]} colors={["rgb(28,28,30)", "rgb(79,80,127)"]} labels={labels} height={180} />}
          foot={`${after != null ? `${after}% of leads arrive outside store hours.` : "No leads in this period."} Mon–Sat 09:00–17:00 UK.`}
        />
        <ChartCard
          title="Leads per day"
          meta={`${mix?.leads ?? 0} leads this period`}
          legend={
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: "rgba(0,0,0,0.1)", display: "block" }} />Email + phone {mix?.leads ?? 0}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(76,152,253)" />Enquiry Received {mix?.email ?? 0}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="var(--logo-2)" />Phone Enquiry Received {mix?.phone ?? 0}</span>
            </>
          }
          chart={<RsLineChart fillFirst series={[series.map((d) => d.leads), series.map((d) => d.email), series.map((d) => d.phone)]} colors={["rgba(0,0,0,0)", "rgb(76,152,253)", "rgb(79,80,127)"]} labels={labels} height={180} />}
          foot={
            <>
              Total <span style={{ color: "var(--black-80)" }}><ChangeLine value={pct?.vsPrevious.leads} vs="previous period" /></span>. Emails {pct?.vsPrevious.email === 0 ? "flat" : ""}, phone enquiries <span style={{ color: "var(--black-80)" }}><ChangeLine value={pct?.vsPrevious.phone} vs="previous period" /></span>.
            </>
          }
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <DonutCard
          title="Lead split"
          hint="Email form vs phone enquiry"
          donut={<RsDonut slices={[{ value: mix?.email ?? 0, color: "rgb(76,152,253)" }, { value: mix?.phone ?? 0, color: "rgb(79,80,127)" }]} center={String(mix?.leads ?? 0)} />}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(76,152,253)" />Email</span>
            <strong style={{ fontWeight: 600, color: "rgb(0,0,0)" }}>{mix?.email ?? 0} · {pct?.emailOfLeads ?? 0}%</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="var(--logo-2)" />Phone</span>
            <strong style={{ fontWeight: 600, color: "rgb(0,0,0)" }}>{mix?.phone ?? 0} · {pct?.phoneOfLeads ?? 0}%</strong>
          </div>
          <span style={{ font: "400 10px/14px Inter,sans-serif", color: "var(--black-80)" }}>
            <ChangeLine value={pct?.vsPrevious.leads} vs="previous period" />
          </span>
        </DonutCard>
        <DonutCard
          title="Hours split"
          hint="Same period · store vs after hours"
          donut={<RsDonut slices={[{ value: mix?.outHours ?? 0, color: "rgb(79,80,127)" }, { value: mix?.inHours ?? 0, color: "rgb(28,28,30)" }]} center={after != null ? `${Math.round(after)}%` : "0%"} />}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(28,28,30)" />Store hours</span>
            <strong style={{ fontWeight: 600, color: "rgb(0,0,0)" }}>{mix?.inHours ?? 0}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="var(--logo-2)" />After hours</span>
            <strong style={{ fontWeight: 600, color: "rgb(0,0,0)" }}>{mix?.outHours ?? 0}</strong>
          </div>
          <p style={{ font: "400 10px/14px Inter,sans-serif", color: "var(--black-40)", margin: 0 }}>{after != null ? `${after}% after hours` : "No leads yet"}</p>
        </DonutCard>
      </div>

      <SectionRule label="Totals on the CRM lists" />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <Total label="Customers" value={kpi?.customers ?? "—"} sub="Booked CRM list · not leads" />
        <Total label="Email leads" value={kpi?.emailLeads ?? "—"} sub="Enquiry Received · name + phone" />
        <Total label="Phone leads" value={kpi?.phoneLeads ?? "—"} sub="Phone Enquiry Received · SMT home" />
        <Total label="Bookings" value={kpi?.fitted ?? "—"} sub={`${kpi?.bookings ?? 0} orders · ${kpi?.abandoned ?? 0} abandoned`} />
        <Total label="NPS" value={npsLabel(kpi?.npsHeadline)} sub={data?.smtHeadlineNps != null ? `SMT headline ${data.smtHeadlineNps}%` : "SMT headline"} />
      </div>

      <div style={{ background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          type="button"
          onClick={() => setCallbacksOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            border: 0,
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", width: 12, flexShrink: 0 }}>{callbacksOpen ? "▾" : "▸"}</span>
          <h2 style={{ font: "600 16px/24px Inter,sans-serif", color: "rgb(0,0,0)", margin: 0 }}>Needs calling back</h2>
          <CountPill n={callList.length} />
          <div style={{ flex: 1 }} />
          <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{callbacksOpen ? "Hide list" : "After hours first"}</span>
        </button>
        {callbacksOpen ? (
          <>
            <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", textWrap: "pretty" }}>
              Leads that came in outside store hours, so nobody answered the phone. Oldest at the top.
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
              <div style={{ ...callbackGrid, height: 32 }}>
                <span style={callbackHead}>Name</span>
                <span style={callbackHead}>Phone</span>
                <span style={callbackHead}>Received</span>
                <span style={callbackHead}>Hours</span>
                <span style={{ ...callbackHead, textAlign: "right" }}>Action</span>
              </div>
              {callList.length ? callList.map((row) => {
                const name = leadDisplayName(row.name);
                const phone = formatUkPhone(row.phone);
                return (
                  <div key={row.smt_id} style={callbackGrid}>
                    <div style={{ ...callbackCell, fontWeight: 500, color: name.missing ? "var(--black-40)" : "rgb(0,0,0)" }}>{name.text}</div>
                    <div style={{ ...callbackCell, color: phone ? "var(--black-80)" : "var(--black-20)", fontVariantNumeric: "tabular-nums" }}>{phone || "—"}</div>
                    <div style={{ ...callbackCell, color: "var(--black-80)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatLeadWhen(row.enquired_at)}</div>
                    <div style={{ ...callbackCell, display: "flex", alignItems: "center", gap: 6, color: "var(--black-80)", whiteSpace: "nowrap" }}>
                      <Dot color="var(--logo-2)" />After hours
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                      <WhatsAppButton href={whatsappHref(row.phone)} />
                    </div>
                  </div>
                );
              }) : (
                <div style={{ padding: "12px 0", borderTop: "1px solid var(--black-4)", font: "400 14px/20px Inter,sans-serif", color: "var(--black-40)" }}>No after-hours leads in the feed.</div>
              )}
            </div>
          </>
        ) : (
          <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>
            {callList.length ? `${callList.length} after-hours lead${callList.length === 1 ? "" : "s"} · tap to open` : "No after-hours leads in this period."}
          </div>
        )}
      </div>

      <SectionRule label="Turning into bookings" />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <ChartCard
          basis={280}
          title="Bookings"
          meta={`${mix?.bookings ?? 0} created`}
          legend={
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(28,28,30)" />Created {mix?.bookings ?? 0}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="var(--logo-2)" />Fitted {mix?.fitted ?? 0}</span>
            </>
          }
          chart={<RsLineChart series={[series.map((d) => d.bookings), series.map((d) => d.fitted)]} colors={["rgb(28,28,30)", "rgb(79,80,127)"]} labels={labels} height={130} labelSize={10} />}
          foot={
            <>
              {pct?.fittedOfBookings != null ? `${pct.fittedOfBookings}% of bookings created in this period were fitted / complete.` : "No bookings in this period."}{" "}
              <span style={{ color: "var(--black-80)" }}><ChangeLine value={pct?.vsPrevious.bookings} vs="previous period" /></span>
            </>
          }
        />
        <ChartCard
          basis={280}
          title="Customers"
          meta={`${mix?.customers ?? 0} booked`}
          legend={<span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(28,28,30)" />Last booking date from SMT</span>}
          chart={<RsLineChart series={[series.map((d) => d.customers)]} colors={["rgb(28,28,30)"]} labels={labels} height={130} labelSize={10} />}
          foot={`${pct?.newCustomersOfAll != null ? `${pct.newCustomersOfAll}% of all ${kpi?.customers ?? 0} booked customers have a booking date in this period.` : `KPI is ${kpi?.customers ?? 0} on the booked list.`} ${pct?.vsPrevious.customers === 0 ? "Flat vs previous period" : ""}`}
        />
      </div>

      <div style={{ background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", margin: 0 }}>Email enquiry → booked</h2>
        <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", textWrap: "pretty" }}>
          Same phone or email on the Customers list. This is not a proven “booked after the enquiry” timestamp — SMT does not give that.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 12 }}>
          <Stat label="Email enquiries" value={conversion?.emailLeadRows ?? "—"} sub={`${conversion?.uniqueLeadPeople ?? "—"} unique people`} />
          <Stat label="Matched to booked" value={conversion?.uniqueBooked ?? "—"} sub={`${conversion?.peoplePct ?? 0}% of unique leads`} />
          <Stat label="Enquiry rows that booked" value={conversion?.matchedRows ?? "—"} sub={`${conversion?.rowPct ?? 0}% of email rows`} />
          <Stat label="Still open" value={conversion?.openRows ?? "—"} sub="no matching customer phone/email" />
        </div>
        <div style={{ display: "flex", height: 8, borderRadius: 80, overflow: "hidden", background: "var(--black-4)", marginTop: 8 }}>
          <span style={{ width: `${Math.max(0, conversion?.peoplePct ?? 0)}%`, background: "rgb(28,28,30)" }} />
        </div>
        <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{conversion?.uniqueBooked ?? 0} booked · {conversion?.openRows ?? 0} open</span>
        <div style={{ marginTop: 12 }}>
          <div style={{ font: "500 14px/20px Inter,sans-serif", marginBottom: 4 }}>People who booked</div>
          <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>One row per person. Enquiry count is how many email leads they sent.</div>
          <table style={{ marginTop: 8, borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Phone</th>
                <th style={th}>Email</th>
                <th style={th}>Enquiries</th>
                <th style={{ ...th, padding: "8px 0" }}>Customer id</th>
              </tr>
            </thead>
            <tbody>
              {(conversion?.people || []).map((p, i, arr) => {
                const last = i === arr.length - 1;
                const cell = last ? { ...td, borderBottom: 0 } : td;
                const cellLast = last ? { ...tdLast, borderBottom: 0 } : tdLast;
                return (
                  <tr key={p.key}>
                    <td style={cell}>{p.name}</td>
                    <td style={{ ...cell, font: "600 14px/20px Inter,sans-serif" }}>{p.phone || "—"}</td>
                    <td style={{ ...cell, color: "var(--black-80)" }}>{p.email || "—"}</td>
                    <td style={{ ...cell, color: "var(--black-80)" }}>{p.enquiryCount}</td>
                    <td style={{ ...cellLast, color: "var(--black-80)" }}>{p.customerSmtId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <SectionRule label="Raw feeds and data quality" />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        <div style={{ flex: "2 1 440px", minWidth: 0, background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", margin: 0 }}>Recent leads</h2>
          <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", textWrap: "pretty" }}>Name and phone from SMT. Phone-channel home items often have no caller ID.</div>
          <table style={{ marginTop: 8, borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Phone</th>
                <th style={th}>Received</th>
                <th style={th}>Channel</th>
                <th style={{ ...th, padding: "8px 0" }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row, i, arr) => {
                const name = leadDisplayName(row.name);
                const last = i === arr.length - 1;
                const cell = last ? { ...td, borderBottom: 0 } : td;
                const cellLast = last ? { ...tdLast, borderBottom: 0 } : tdLast;
                return (
                  <tr key={row.smt_id}>
                    <td style={{ ...cell, color: name.missing ? "var(--black-40)" : undefined }}>{name.text}</td>
                    <td style={{ ...cell, font: row.phone ? "600 14px/20px Inter,sans-serif" : "400 14px/20px Inter,sans-serif", color: row.phone ? undefined : "var(--black-20)" }}>{formatUkPhone(row.phone) || "—"}</td>
                    <td style={{ ...cell, color: "var(--black-80)" }}>{formatLeadWhen(row.enquired_at)}</td>
                    <td style={{ ...cell, color: "var(--black-80)" }}>{row.channel === "phone" ? "Phone" : "Email"}</td>
                    <td style={{ ...cellLast, color: "var(--black-80)" }}>{row.in_hours ? "Store hours" : "After hours"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ flex: "1 1 280px", minWidth: 0, background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", margin: 0 }}>Activity</h2>
          <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>Newest first</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            {events.slice(0, 6).map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid var(--black-4)" }}>
                <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", width: 76, flexShrink: 0 }}>{formatActivityWhen(e.created_at)}</span>
                <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)", flex: 1, minWidth: 0 }}>{formatActivityLine(e.kind, e.message)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", margin: 0 }}>Reconcile vs SMT</h2>
        <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", maxWidth: 820, textWrap: "pretty" }}>
          CRM list pages are the census (pager footer rows are ignored). Reports → New/Existing Customer Bookings are booking charts (~243 new-customer bookings over ~12 months), not the customer list.
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          <RecRow label="Customers" value={`${listPages(kpi?.customers ?? 0, 20)} pages · ${kpi?.customers ?? 0} View ids (CSV export matches)`} />
          <RecRow label="Enquiries" value={`${listPages(kpi?.emailLeads ?? 0, 20)} pages · ${kpi?.emailLeads ?? 0} View ids`} />
          <RecRow label="NPS rows" value={`${listPages(kpi?.nps ?? 0, 10)} pages · ${kpi?.nps ?? 0} scores · SMT headline ${data?.smtHeadlineNps ?? kpi?.npsHeadline ?? "—"}%`} />
          <RecRow label="Bookings export" value={`${kpi?.bookings ?? 0} orders · ${kpi?.fitted ?? 0} fitted · ${kpi?.abandoned ?? 0} abandoned · ${kpi?.cancelled ?? 0} cancelled`} />
          <RecRow label="Testimonials" value={`${kpi?.testimonials ?? 0} quotes`} />
        </div>
      </div>
    </div>
  );
}

function Hero({ label, value, sub, invert }: { label: string; value: ReactNode; sub: ReactNode; invert?: boolean }) {
  return (
    <div
      style={{
        flex: "1 1 260px",
        minWidth: 0,
        background: invert ? "var(--surface-inverse)" : "rgb(255,255,255)",
        borderRadius: 20,
        boxShadow: invert ? undefined : "inset 0 0 0 1px var(--black-10)",
        padding: 20,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ font: "500 14px/20px Inter,sans-serif", color: invert ? "rgba(255,255,255,0.8)" : "var(--black-80)" }}>{label}</div>
      <div style={{ font: "600 44px/52px Inter,sans-serif", letterSpacing: "-0.02em", color: invert ? "rgb(255,255,255)" : "rgb(0,0,0)" }}>{value}</div>
      <div style={{ font: "400 12px/16px Inter,sans-serif", color: invert ? "rgba(255,255,255,0.8)" : "var(--black-80)" }}>{sub}</div>
    </div>
  );
}

function Total({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div style={{ flex: "1 1 180px", minWidth: 0, background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{label}</div>
      <div style={{ font: "600 24px/32px Inter,sans-serif", color: "rgb(0,0,0)" }}>{value}</div>
      <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{sub}</div>
    </div>
  );
}

function ChartCard({
  title,
  meta,
  legend,
  chart,
  foot,
  basis = 270,
}: {
  title: string;
  meta: string;
  legend: ReactNode;
  chart: ReactNode;
  foot: ReactNode;
  basis?: number;
}) {
  return (
    <div style={{ flex: `1 1 ${basis}px`, minWidth: 0, background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", margin: 0 }}>{title}</h2>
        <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{meta}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)" }}>{legend}</div>
      {chart}
      <p style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)", margin: 0 }}>{foot}</p>
    </div>
  );
}

function DonutCard({ title, hint, donut, children }: { title: string; hint: string; donut: ReactNode; children: ReactNode }) {
  return (
    <div style={{ flex: "1 1 260px", minWidth: 0, background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4 }}>
      <h2 style={{ font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", margin: 0 }}>{title}</h2>
      <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{hint}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
        {donut}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2, padding: "12px 0", borderTop: "1px solid var(--black-4)" }}>
      <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{label}</span>
      <strong style={{ font: "600 24px/32px Inter,sans-serif" }}>{value}</strong>
      <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{sub}</span>
    </div>
  );
}

const callbackGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1.4fr) 148px 158px 118px 150px",
  alignItems: "center",
  columnGap: 16,
  height: 52,
  padding: 0,
  borderTop: "1px solid var(--black-4)",
  boxSizing: "border-box",
};

const callbackHead: CSSProperties = {
  font: "500 12px/16px Inter,sans-serif",
  color: "var(--black-40)",
  display: "flex",
  alignItems: "center",
  height: "100%",
};

const callbackCell: CSSProperties = {
  font: "400 14px/20px Inter,sans-serif",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  height: "100%",
};

function RecRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid var(--black-4)", font: "400 14px/20px Inter,sans-serif" }}>
      <span style={{ color: "var(--black-80)" }}>{label}</span>
      <strong style={{ fontWeight: 600, textAlign: "right" }}>{value}</strong>
    </div>
  );
}

