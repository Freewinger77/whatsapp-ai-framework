const health = {
  ok: true,
  mode: "live",
  shop: "Tyres 4 U",
  platform: "sellmoretyres",
    trackedKinds: ["customers", "enquiries", "bookings", "nps", "testimonials"],
  pollIntervalMs: 60000,
  webhookConfigured: false,
  inHours: "Mon–Sat 09:00–17:00 Europe/London",
};

const outbound = {
  event: "enquiry.created",
  platform: "sellmoretyres",
  shop: "Tyres 4 U",
  in_hours: true,
  record: { id: "2001", name: "Liam Scott", phone: "+447700900011", at: "2026-09-04T09:20:00+01:00" },
};

export default function DocsPage() {
  return (
    <div className="docs grid-12">
      <div className="span-8 card">
        <h2>We made an API for a CRM that has none</h2>
        <p className="hint">Sell More Tyres admin is a session-gated ASP.NET MVC site. This service logs in, scrapes Customers / Enquiries / NPS / Testimonials, stores `smt_*` rows, and emits one webhook per new id.</p>
        <h2 style={{ marginTop: 20 }}>Flow</h2>
        <ol>
          <li>Form login at /Account/Login → persist ASP.NET cookies.</li>
          <li>Prefer the admin’s own list XHR; fall back to HTML tables or Customers/Export CSV.</li>
          <li>Unknown SMT id → insert + optional webhook. Known id → refresh only.</li>
          <li>Vercel cron every minute hits GET /api/poll (same job as Scrape now).</li>
          <li>Full history is `npm run backfill` with announce: false.</li>
        </ol>
        {[
          ["GET", "/api/health", "Liveness + config flags.", JSON.stringify(health, null, 2)],
          ["GET", "/api/status", "SMT ping, counts, latest poll.", ""],
          ["GET", "/api/customers?format=csv", "Customers. Also /enquiries /nps.", ""],
          ["GET", "/api/analytics?days=7", "Filled London-day series: leads, email, phone, customers, in/out hours, donut mix, % vs previous period.", ""],
          ["GET", "/api/bookings", "SMT bookings export, unique OrderID. Filters: fitted / new / abandoned / cancelled.", ""],
          ["GET", "/api/conversion?days=7", "Email leads in that London-day window matched to booked customers by phone or email. Omit days for all time.", ""],
          ["GET", "/api/events", "poll.ok, webhook.sent, customer.created, …", ""],
          ["POST", "/api/poll", "One scrape tick. GET also works for Vercel cron.", '{ "scraped": 12, "newCount": 1, "webhooked": 1 }'],
          ["POST", "/api/webhooks/outbound", "Internal send helper.", JSON.stringify(outbound, null, 2)],
          ["POST", "/api/items/:type/:id/webhook", "Resend one record.", ""],
        ].map((e) => (
          <div key={e[1]} style={{ marginTop: 18 }}>
            <div>
              <span className={`method ${String(e[0]).toLowerCase()}`}>{e[0]}</span>{" "}
              <code>{e[1]}</code>
            </div>
            <div className="hint">{e[2]}</div>
            {e[3] ? <pre>{e[3]}</pre> : null}
          </div>
        ))}
      </div>
      <div className="span-4 card">
        <h2>Auth</h2>
        <p className="hint">Dashboard cookie `smt_gate` (HMAC of DUNDEE_DASHBOARD_PASSWORD). Cron uses Bearer CRON_SECRET. /api/health is open.</p>
        <h2>In-hours</h2>
        <p className="hint">Fixed in v1: Mon–Sat 09:00–17:00 Europe/London. Sunday and evenings are out of hours — that split is what the booking agent uses.</p>
      </div>
    </div>
  );
}
