export default function HomePage() {
  return (
    <section className="grid">
      <div className="card wide">
        <div className="label">Wasup SaaS</div>
        <div className="value">WhatsApp infrastructure for AI agents and customer ops.</div>
        <p className="muted">
          Manage organizations, isolated WhatsApp workers, sticky regional proxies,
          behaviour profiles, API keys, and fleet health.
        </p>
        <a className="pill" href="/dashboard">Open dashboard</a>
      </div>
      <div className="card">
        <div className="label">Stack</div>
        <p>Clerk + Supabase + AKS + Azure Key Vault</p>
      </div>
    </section>
  );
}
