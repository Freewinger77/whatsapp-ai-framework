"use client";

import { useEffect, useState } from "react";

type Row = {
  smt_id: string;
  score: number;
  reason: string | null;
  comment: string | null;
  name: string | null;
  phone: string | null;
  scored_at: string | null;
};

export default function NpsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [headline, setHeadline] = useState<number | null>(null);

  useEffect(() => {
    void fetch("/api/nps")
      .then((r) => r.json())
      .then((d) => {
        setRows(d.nps || []);
        setHeadline(d.headline);
      });
  }, []);

  return (
    <>
      <div className="kpis" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="hint">Computed NPS</div>
          <div className="metric">{headline != null ? `${headline}%` : "—"}</div>
          <div className="hint">(% promoters 9–10) − (% detractors 0–6)</div>
        </div>
        <div className="card">
          <div className="hint">Responses</div>
          <div className="metric">{rows.length}</div>
          <div className="hint">from smt_nps</div>
        </div>
      </div>
      <div className="filters">
        <a className="chip" href="/api/nps?format=csv">Export CSV</a>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Score</th>
              <th>Date</th>
              <th>Reason</th>
              <th>Comment</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.smt_id}>
                <td>{r.score}</td>
                <td>{r.scored_at?.slice(0, 10)}</td>
                <td>{r.reason}</td>
                <td>{r.comment}</td>
                <td>{r.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
