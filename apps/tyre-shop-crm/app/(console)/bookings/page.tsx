"use client";

import { RecordsTable } from "@/components/records-table";

type Row = {
  smt_id: string;
  customer_name: string;
  vrn: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  status: string | null;
  status_norm: string | null;
  created_at_smt: string | null;
  fitting_at: string | null;
  order_total: number | null;
  services: string | null;
  in_hours: boolean;
};

export default function BookingsPage() {
  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        SMT bookings export (unique OrderID). These are jobs, not leads. Fitted / abandoned / cancelled / new.
      </p>
      <RecordsTable<Row>
        endpoint="/api/bookings"
        filters={[
          { id: "all", label: "All" },
          { id: "fitted", label: "Fitted" },
          { id: "new", label: "New" },
          { id: "abandoned", label: "Abandoned" },
          { id: "cancelled", label: "Cancelled" },
        ]}
        columns={[
          { key: "customer", label: "Customer", render: (r) => r.customer_name },
          { key: "vrn", label: "VRN", render: (r) => r.vrn || "—" },
          { key: "status", label: "Status", render: (r) => r.status || r.status_norm },
          { key: "created", label: "Created", render: (r) => r.created_at_smt?.slice(0, 16).replace("T", " ") || "—" },
          { key: "fitting", label: "Fitting", render: (r) => r.fitting_at?.slice(0, 16).replace("T", " ") || "—" },
          { key: "total", label: "Total", render: (r) => (r.order_total != null ? `£${Number(r.order_total).toFixed(2)}` : "—") },
        ]}
        renderFlyout={(r, _events, onClose) => (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2>{r.customer_name}</h2>
              <button className="btn ghost" onClick={onClose}>Close</button>
            </div>
            {[
              ["Order", r.smt_id],
              ["Status", r.status],
              ["VRN", r.vrn],
              ["Vehicle", [r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ")],
              ["Created", r.created_at_smt],
              ["Fitting", r.fitting_at],
              ["Hours", r.in_hours ? "In hours" : "Out of hours"],
              ["Total", r.order_total != null ? `£${Number(r.order_total).toFixed(2)}` : "—"],
              ["Services", r.services],
            ].map(([k, v]) => (
              <div className="field" key={String(k)}>
                <span className="hint">{k}</span>
                <span>{v || "—"}</span>
              </div>
            ))}
          </>
        )}
      />
    </>
  );
}
