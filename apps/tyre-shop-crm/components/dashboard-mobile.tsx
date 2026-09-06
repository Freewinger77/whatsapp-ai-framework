"use client";

import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { ChangeLine, Chip, CountPill, Dot, RsLineChart, WhatsAppButton } from "./rs";
import { formatCallbackWhen, formatUkPhone, leadDisplayName, periodTitle, periodVsLabel, whatsappHref } from "@/lib/display";
import { callbacks, chartLabels, npsLabel, type AnalyticsData, type ConversionData, type EnquiryRow } from "@/lib/dashboard-model";

export function DashboardMobile({
  days,
  setDays,
  data,
  enquiries,
  conversion,
  pollClock,
}: {
  days: number;
  setDays: (n: number) => void;
  data: AnalyticsData | null;
  enquiries: EnquiryRow[];
  conversion: ConversionData | null;
  pollClock: string;
}) {
  const mix = data?.mix;
  const pct = data?.pct;
  const prev = data?.previous;
  const kpi = data?.kpi;
  const series = data?.series ?? [];
  const labels = chartLabels(series);
  const vs = periodVsLabel(days);
  const callList = callbacks(enquiries, data?.from, data?.to);
  const oldest = callList[0];

  return (
    <div style={{ height: "100%", boxSizing: "border-box", padding: 0, display: "flex", flexDirection: "column", background: "rgb(255,255,255)" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 12px", borderBottom: "1px solid var(--black-4)" }}>
        <BrandLogo height={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "600 16px/20px Inter,sans-serif" }}>{periodTitle(days)}</div>
          <div style={{ font: "400 10px/14px Inter,sans-serif", color: "var(--black-40)" }}>Tyres 4 U · poller live · {pollClock}</div>
        </div>
        <span style={{ width: 8, height: 8, borderRadius: 80, background: "var(--secondary-green)", flexShrink: 0 }} />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Chip height={36} on={days === 7} onClick={() => setDays(7)}>7 days</Chip>
          <Chip height={36} on={days === 30} onClick={() => setDays(30)}>30 days</Chip>
          <Chip height={36} on={days === 90} onClick={() => setDays(90)}>90 days</Chip>
        </div>

        <div style={{ background: "var(--surface-inverse)", borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ font: "500 14px/20px Inter,sans-serif", color: "rgba(255,255,255,0.8)" }}>Leads this week</span>
          <span style={{ font: "600 44px/52px Inter,sans-serif", letterSpacing: "-0.02em", color: "rgb(255,255,255)" }}>{mix?.leads ?? "—"}</span>
          <span style={{ font: "400 12px/16px Inter,sans-serif", color: "rgba(255,255,255,0.8)" }}>
            <ChangeLine light value={pct?.vsPrevious.leads} vs={vs} extra={prev ? `${prev.leads} lead${prev.leads === 1 ? "" : "s"}` : undefined} />
          </span>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Mini label="Bookings" value={mix?.bookings ?? "—"} sub={<ChangeLine value={pct?.vsPrevious.bookings} vs={vs} />} />
          <Mini label="Lead → booked" value={conversion ? `${conversion.peoplePct}%` : "—"} sub={`${conversion?.uniqueBooked ?? "—"} of ${conversion?.uniqueLeadPeople ?? "—"} people`} />
        </div>

        <div style={{ background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ font: "500 14px/20px Inter,sans-serif" }}>After hours / store hours</span>
            <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{mix?.leads ?? 0} leads</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, font: "400 12px/16px Inter,sans-serif", color: "var(--black-80)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="rgb(28,28,30)" />Store hours {mix?.inHours ?? 0}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Dot color="var(--logo-2)" />After hours {mix?.outHours ?? 0}</span>
          </div>
          <RsLineChart series={[series.map((d) => d.inHours), series.map((d) => d.outHours)]} colors={["rgb(28,28,30)", "rgb(79,80,127)"]} labels={labels} height={120} labelSize={10} />
          <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>
            {pct?.afterHours != null ? `${pct.afterHours}% arrive outside store hours.` : "No leads in this period."}
          </span>
        </div>

        <Link
          href="/enquiries"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minHeight: 56,
            padding: "12px 16px",
            borderRadius: 16,
            boxShadow: "inset 0 0 0 1px var(--black-10)",
            boxSizing: "border-box",
            color: "rgb(28,28,28)",
            textDecoration: "none",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", font: "500 14px/20px Inter,sans-serif" }}>Needs calling back</span>
            <span style={{ display: "block", font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>
              After hours first{oldest ? ` · oldest ${formatCallbackWhen(oldest.enquired_at)}` : ""}
            </span>
          </span>
          <CountPill n={callList.length} height={24} />
        </Link>

        <div style={{ display: "flex", gap: 12 }}>
          <Mini label="Email leads" value={kpi?.emailLeads ?? "—"} />
          <Mini label="Customers" value={kpi?.customers ?? "—"} />
          <Mini label="NPS" value={npsLabel(kpi?.npsHeadline)} compact />
        </div>

        <Link
          href="/"
          className="desk-jump"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--black-10)", font: "500 14px/20px Inter,sans-serif", color: "rgb(28,28,28)", textDecoration: "none" }}
        >
          See the full dashboard
        </Link>
      </div>
    </div>
  );
}

function Mini({ label, value, sub, compact }: { label: string; value: React.ReactNode; sub?: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: compact ? 14 : 14, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>{label}</span>
      <span style={{ font: "600 24px/32px Inter,sans-serif" }}>{value}</span>
      {sub ? <span style={{ font: "400 10px/14px Inter,sans-serif", color: "var(--black-80)" }}>{sub}</span> : null}
    </div>
  );
}

export function CallbacksMobile({
  enquiries,
  hours,
  setHours,
}: {
  enquiries: EnquiryRow[];
  hours: "out" | "all" | "in";
  setHours: (h: "out" | "all" | "in") => void;
}) {
  const rows =
    hours === "out" ? callbacks(enquiries) : hours === "in" ? enquiries.filter((e) => e.in_hours) : [...enquiries].sort((a, b) => String(a.enquired_at || "").localeCompare(String(b.enquired_at || "")));
  const after = callbacks(enquiries);
  const store = enquiries.filter((e) => e.in_hours);
  const noNumber = after.filter((e) => !whatsappHref(e.phone)).length;

  return (
    <div style={{ height: "100%", boxSizing: "border-box", padding: 0, display: "flex", flexDirection: "column", background: "rgb(255,255,255)" }}>
      <div style={{ flexShrink: 0, padding: "8px 16px 12px", borderBottom: "1px solid var(--black-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ font: "600 16px/20px Inter,sans-serif" }}>Needs calling back</div>
          <CountPill n={after.length} />
        </div>
        <div style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>Nobody answered the phone. Oldest first.</div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: 8, padding: "12px 16px" }}>
        <Chip height={36} on={hours === "out"} onClick={() => setHours("out")}>After hours</Chip>
        <Chip height={36} on={hours === "all"} onClick={() => setHours("all")}>All leads</Chip>
        <Chip height={36} on={hours === "in"} onClick={() => setHours("in")}>Store hours</Chip>
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {rows.map((row, i) => {
          const name = leadDisplayName(row.name);
          const href = whatsappHref(row.phone);
          const last = i === rows.length - 1;
          return (
            <div key={row.smt_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderTop: "1px solid var(--black-4)", borderBottom: last ? "1px solid var(--black-4)" : undefined }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ font: "500 14px/20px Inter,sans-serif", color: name.missing ? "var(--black-40)" : undefined }}>{name.text}</span>
                <span style={{ font: "400 12px/16px Inter,sans-serif", color: href ? "var(--black-80)" : "var(--black-20)" }}>
                  {href ? `${formatUkPhone(row.phone)} · ${row.channel === "phone" ? "phone lead" : "email lead"}` : "No number to call"}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, font: "400 10px/14px Inter,sans-serif", color: "var(--black-40)" }}>
                  <Dot color={row.in_hours ? "rgb(28,28,30)" : "var(--logo-2)"} size={6} />
                  {row.in_hours ? "Store hours" : "After hours"} · {formatCallbackWhen(row.enquired_at)}
                </span>
              </div>
              <WhatsAppButton href={href} label={false} />
            </div>
          );
        })}
        <div style={{ padding: 16 }}>
          <div style={{ background: "var(--background-2)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--black-4)", padding: 14, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ font: "400 12px/16px Inter,sans-serif", color: "var(--black-40)" }}>Also this week</span>
            <span style={{ font: "400 14px/20px Inter,sans-serif", color: "var(--black-80)" }}>
              {store.length} store-hours lead{store.length === 1 ? " was" : "s were"} answered on the day. {noNumber} of {after.length} after-hours leads {noNumber === 1 ? "has" : "have"} no number.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
