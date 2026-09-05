"use client";

import { useEffect, useState } from "react";

export type Filter = "all" | "new" | "needs";

export function RecordsTable<T extends { smt_id: string }>({
  endpoint,
  filters,
  extraQuery,
  columns,
  renderFlyout,
}: {
  endpoint: string;
  filters?: Array<{ id: Filter | string; label: string }>;
  extraQuery?: string;
  columns: Array<{ key: string; label: string; render: (row: T) => React.ReactNode }>;
  renderFlyout: (row: T, events: unknown[], onClose: () => void) => React.ReactNode;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [rows, setRows] = useState<T[]>([]);
  const [selected, setSelected] = useState<T | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (filter !== "all") qs.set("filter", filter);
    if (extraQuery) {
      for (const part of extraQuery.replace(/^\?/, "").split("&")) {
        const [k, v] = part.split("=");
        if (k) qs.set(k, decodeURIComponent(v || ""));
      }
    }
    fetch(`${endpoint}?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        setRows((data.bookings || data.customers || data.enquiries || data.nps || data.testimonials || []) as T[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [endpoint, extraQuery, filter]);

  async function open(row: T) {
    setSelected(row);
    const type = endpoint.replace("/api/", "").replace(/s$/, "");
    const res = await fetch(`${endpoint}/${row.smt_id}`).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setEvents(data.events || []);
    } else {
      setEvents([]);
    }
    void type;
  }

  return (
    <>
      {filters ? (
        <div className="filters">
          {filters.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
          <a className="chip" href={`${endpoint}?format=csv`}>
            Export CSV
          </a>
        </div>
      ) : null}
      {error ? <p className="err">{error}</p> : null}
      <div className="card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.smt_id} onClick={() => void open(row)}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={columns.length} className="hint" style={{ padding: 20 }}>
                  No rows yet. Run Scrape now or npm run backfill.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selected ? (
        <div className="flyout" onClick={() => setSelected(null)}>
          <div className="flyout-card" onClick={(e) => e.stopPropagation()}>
            {renderFlyout(selected, events, () => setSelected(null))}
          </div>
        </div>
      ) : null}
    </>
  );
}
