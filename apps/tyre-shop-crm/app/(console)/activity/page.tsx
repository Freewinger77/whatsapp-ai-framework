"use client";

import { useEffect, useState } from "react";

type EventRow = { id: string; kind: string; message: string; created_at: string; record_type: string | null; record_id: string | null };

export default function ActivityPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  useEffect(() => {
    void fetch("/api/events")
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []));
  }, []);
  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Kind</th>
            <th>Message</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.created_at?.replace("T", " ").slice(0, 19)}</td>
              <td>{e.kind}</td>
              <td>{e.message}</td>
              <td>{e.record_type ? `${e.record_type}:${e.record_id}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
