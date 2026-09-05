"use client";

import { RecordsTable } from "@/components/records-table";

type Row = {
  smt_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  stage: string | null;
  first_seen_at: string;
};

export default function CustomersPage() {
  return (
    <RecordsTable<Row>
      endpoint="/api/customers"
      filters={[
        { id: "all", label: "All" },
        { id: "new", label: "New" },
        { id: "needs", label: "Needs attention" },
      ]}
      columns={[
        { key: "name", label: "Name", render: (r) => r.name },
        { key: "phone", label: "Phone", render: (r) => r.phone },
        { key: "source", label: "Source", render: (r) => r.source },
        { key: "stage", label: "Stage", render: (r) => r.stage },
        { key: "seen", label: "First seen", render: (r) => r.first_seen_at?.slice(0, 10) },
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
            ["Stage", r.stage],
            ["First seen", r.first_seen_at],
            ["SMT id", r.smt_id],
          ].map(([k, v]) => (
            <div className="field" key={String(k)}>
              <span className="hint">{k}</span>
              <span>{v || "—"}</span>
            </div>
          ))}
          <h2 style={{ marginTop: 24 }}>Events</h2>
          {(events as Array<{ id: string; kind: string; message: string }>).map((e) => (
            <div key={e.id} className="hint" style={{ padding: "6px 0" }}>{e.kind} · {e.message}</div>
          ))}
          <button
            className="btn"
            style={{ marginTop: 16 }}
            onClick={() => void fetch(`/api/items/customers/${r.smt_id}/webhook`, { method: "POST" })}
          >
            Resend webhook
          </button>
        </>
      )}
    />
  );
}
