"use client";

import { useEffect, useState } from "react";

type Conversion = {
  emailLeadRows: number;
  uniqueLeadPeople: number;
  matchedRows: number;
  uniqueBooked: number;
  openRows: number;
  rowPct: number;
  peoplePct: number;
  matches: Array<{
    leadSmtId: string;
    leadName: string;
    leadPhone: string | null;
    leadEmail: string | null;
    enquiredAt: string | null;
    message: string | null;
    customerSmtId: string;
    customerName: string;
    how: string;
  }>;
  people: Array<{
    key: string;
    name: string;
    phone: string | null;
    email: string | null;
    enquiryCount: number;
    customerSmtId: string;
    customerName: string;
    lastEnquiredAt: string | null;
  }>;
};

export default function ConversionPage() {
  const [data, setData] = useState<Conversion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conversion")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const bookedWidth = data ? Math.max(4, (data.uniqueBooked / Math.max(1, data.uniqueLeadPeople)) * 100) : 0;

  return (
    <div className="grid-12">
      <div className="span-12 kpis">
        {[
          { label: "Email enquiries", value: data?.emailLeadRows ?? "—", sub: `${data?.uniqueLeadPeople ?? "—"} unique people` },
          { label: "Matched to booked", value: data?.uniqueBooked ?? "—", sub: `${data?.peoplePct ?? 0}% of unique leads` },
          { label: "Enquiry rows that booked", value: data?.matchedRows ?? "—", sub: `${data?.rowPct ?? 0}% of email rows` },
          { label: "Still open", value: data?.openRows ?? "—", sub: "no matching customer phone/email" },
        ].map((m) => (
          <div className="card" key={m.label}>
            <div className="hint">{m.label}</div>
            <div className="metric">{m.value}</div>
            <div className="hint">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="span-12 card">
        <h2>Email enquiry → booked customer</h2>
        <div className="hint">
          Same phone or email on the SMT Customers list. This is not a proven “booked after the enquiry” timestamp — SMT does not give that.
        </div>
        <div style={{ marginTop: 16, height: 16, background: "rgba(0,0,0,0.06)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ width: `${bookedWidth}%`, height: "100%", background: "rgb(28,28,30)" }} />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {data ? `${data.uniqueBooked} booked · ${data.openRows} open` : "Loading…"}
        </div>
      </div>

      <div className="span-12 card">
        <h2>People who booked</h2>
        <div className="hint">One row per person. Enquiry count is how many email leads they sent.</div>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Enquiries</th>
              <th>Customer id</th>
            </tr>
          </thead>
          <tbody>
            {(data?.people || []).map((p) => (
              <tr key={p.key}>
                <td>{p.name}</td>
                <td className="phone">{p.phone || "—"}</td>
                <td>{p.email || "—"}</td>
                <td>{p.enquiryCount}</td>
                <td>{p.customerSmtId}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.people?.length ? <p className="hint">No matches yet.</p> : null}
      </div>

      <div className="span-12 card">
        <h2>Matched enquiry rows</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Phone</th>
              <th>Booked as</th>
              <th>Match</th>
              <th>Enquired</th>
            </tr>
          </thead>
          <tbody>
            {(data?.matches || []).map((m) => (
              <tr key={m.leadSmtId}>
                <td>
                  <div>{m.leadName}</div>
                  {m.message ? <div className="hint">{m.message.slice(0, 80)}{m.message.length > 80 ? "…" : ""}</div> : null}
                </td>
                <td className="phone">{m.leadPhone || "—"}</td>
                <td>{m.customerName}</td>
                <td><span className="badge email">{m.how}</span></td>
                <td>{m.enquiredAt?.replace("T", " ").slice(0, 16) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}
