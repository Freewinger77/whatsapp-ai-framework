"use client";

import { useState } from "react";
import { RecordsTable } from "@/components/records-table";

type Row = {
  smt_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string | null;
  source: string | null;
  channel: string | null;
  message: string | null;
  notes: string | null;
  tags: string | null;
  in_hours: boolean;
  enquired_at: string | null;
  first_seen_at: string;
};

export default function EnquiriesPage() {
  const [hours, setHours] = useState<"all" | "in" | "out">("all");
  const [channel, setChannel] = useState<"all" | "email" | "phone">("all");
  const [booked, setBooked] = useState<"all" | "yes" | "no">("all");
  const extra = [
    hours === "all" ? "" : `hours=${hours}`,
    channel === "all" ? "" : `channel=${channel}`,
    booked === "all" ? "" : `booked=${booked}`,
  ]
    .filter(Boolean)
    .join("&");
  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Leads, not booked customers. Email = SMT “Enquiry Received”. Phone = SMT “Phone Enquiry Received”.
      </p>
      <div className="filters">
        <button className={`chip ${hours === "all" ? "on" : ""}`} onClick={() => setHours("all")}>All hours</button>
        <button className={`chip ${hours === "in" ? "on" : ""}`} onClick={() => setHours("in")}>In hours</button>
        <button className={`chip ${hours === "out" ? "on" : ""}`} onClick={() => setHours("out")}>Out of hours</button>
        <button className={`chip ${channel === "all" ? "on" : ""}`} onClick={() => setChannel("all")}>All channels</button>
        <button className={`chip ${channel === "email" ? "on" : ""}`} onClick={() => setChannel("email")}>Email</button>
        <button className={`chip ${channel === "phone" ? "on" : ""}`} onClick={() => setChannel("phone")}>Phone</button>
        <button className={`chip ${booked === "all" ? "on" : ""}`} onClick={() => setBooked("all")}>All outcomes</button>
        <button className={`chip ${booked === "yes" ? "on" : ""}`} onClick={() => setBooked("yes")}>Booked</button>
        <button className={`chip ${booked === "no" ? "on" : ""}`} onClick={() => setBooked("no")}>Open</button>
      </div>
      <RecordsTable<Row>
        endpoint="/api/enquiries"
        extraQuery={extra}
        filters={[
          { id: "all", label: "All" },
          { id: "new", label: "New" },
          { id: "needs", label: "Needs attention" },
        ]}
        columns={[
          { key: "name", label: "Name", render: (r) => r.name },
          { key: "phone", label: "Phone", render: (r) => <span className="phone">{r.phone || "—"}</span> },
          {
            key: "channel",
            label: "Channel",
            render: (r) => (
              <span className={`badge ${r.channel === "phone" ? "phone" : "email"}`}>
                {r.channel === "phone" ? "Phone enquiry" : "Email enquiry"}
              </span>
            ),
          },
          { key: "hours", label: "Hours", render: (r) => <span className={`badge ${r.in_hours ? "in" : "out"}`}>{r.in_hours ? "In hours" : "Out of hours"}</span> },
          { key: "at", label: "Enquired", render: (r) => (r.enquired_at || r.first_seen_at)?.replace("T", " ").slice(0, 16) },
        ]}
        renderFlyout={(r, events, onClose) => (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2>{r.name}</h2>
              <button className="btn ghost" onClick={onClose}>Close</button>
            </div>
            {[
              ["Phone", r.phone],
              ["Email", r.email],
              ["Channel", r.channel === "phone" ? "Phone Enquiry Received" : "Enquiry Received"],
              ["Source", r.source],
              ["Status", r.status],
              ["Tags", r.tags],
              ["In hours", r.in_hours ? "Yes · Mon–Sat 09:00–17:00 UK" : "No"],
              ["Enquired", r.enquired_at],
              ["SMT id", r.smt_id],
            ].map(([k, v]) => (
              <div className="field" key={String(k)}>
                <span className="hint">{k}</span>
                <span>{String(v || "—")}</span>
              </div>
            ))}
            {r.message ? (
              <>
                <h2 style={{ marginTop: 24 }}>Message</h2>
                <div className="quote">{r.message}</div>
              </>
            ) : null}
            {r.notes ? (
              <>
                <h2 style={{ marginTop: 24 }}>Notes</h2>
                <div className="quote">{r.notes.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}</div>
              </>
            ) : null}
            <h2 style={{ marginTop: 24 }}>Events</h2>
            {(events as Array<{ id: string; kind: string; message: string }>).map((e) => (
              <div key={e.id} className="hint" style={{ padding: "6px 0" }}>{e.kind} · {e.message}</div>
            ))}
            <button className="btn" style={{ marginTop: 16 }} onClick={() => void fetch(`/api/items/enquiries/${r.smt_id}/webhook`, { method: "POST" })}>
              Resend webhook
            </button>
          </>
        )}
      />
    </>
  );
}
