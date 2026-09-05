"use client";

import { useEffect, useState } from "react";

type Row = { smt_id: string; name: string; quote: string; published_at: string | null };

export default function TestimonialsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    void fetch("/api/testimonials")
      .then((r) => r.json())
      .then((d) => setRows(d.testimonials || []));
  }, []);
  return (
    <>
      <div className="filters">
        <a className="chip" href="/api/testimonials?format=csv">Export CSV</a>
      </div>
      {rows.map((r) => (
        <div className="quote" key={r.smt_id}>
          <div style={{ font: "600 16px/24px Inter,sans-serif" }}>“{r.quote}”</div>
          <div className="hint" style={{ marginTop: 8 }}>{r.name} · {r.published_at?.slice(0, 10) || "undated"}</div>
        </div>
      ))}
      {!rows.length ? <p className="hint">No testimonials scraped yet.</p> : null}
    </>
  );
}
