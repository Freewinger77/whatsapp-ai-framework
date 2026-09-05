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
  in_hours: boolean;
  enquired_at: string | null;
  first_seen_at: string;
};

export default function EnquiriesPage() {
  const [hours, setHours] = useState<"all" | "in" | "out">("all");
  return (
    <>
      <div className="filters">
        <button className={`chip ${hours === "all" ? "on" : ""}`} onClick={() => setHours("all")}>All hours</button>
        <button className={`chip ${hours === "in" ? "on" : ""}`} onClick={() => setHours("in")}>In hours</button>
        <button className={`chip ${hours === "out" ? "on" : ""}`} onClick={() => setHours("out")}>Out of hours</button>
      </div>
      <RecordsTable<Row>
        endpoint="/api/enquiries"
        extraQuery={hours === "all" ? "" : `hours=${hours}`}
        filters={[
          { id: "all", label: "All" },
          { id: "new", label: "New" },
          { id: "needs", label: "Needs attention" },
        ]}
        columns={[
          { key: "name", label: "Name", render: (r) => r.name },
          { key: "phone", label: "Phone", render: (r) => r.phone },
          { key: "hours", label: "Hours", render: (r) => <span className={`badge ${r.in_hours ? "in" : "out"}`}>{r.in_hours ? "In hours" : "Out of hours"}</span> },
          { key: "status", label: "Status", render: (r) => r.status },
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
              ["Source", r.source],
              ["Status", r.status],
              ["In hours", r.in_hours ? "Yes · Mon–Sat 09:00–17:00 UK" : "No"],
              ["Enquired", r.enquired_at],
              ["SMT id", r.smt_id],
            ].map(([k, v]) => (
              <div className="field" key={String(k)}>
                <span className="hint">{k}</span>
                <span>{String(v || "—")}</span>
              </div>
            ))}
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
