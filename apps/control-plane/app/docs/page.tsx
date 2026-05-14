const requiredInputs = [
  {
    title: 'Supabase',
    body: 'Project URL, service-role key, database password access for migrations, and confirmation that this control plane can own the Wasup v3 schema.'
  },
  {
    title: 'Clerk',
    body: 'Publishable key, secret key, org/user setup decision, webhook signing secret later, and which Clerk org role maps to owner/admin/operator/viewer.'
  },
  {
    title: 'Stripe',
    body: 'Secret key, webhook secret, live vs test mode, currency, per-instance monthly price, credit pack size/price, and business billing details.'
  },
  {
    title: 'Azure',
    body: 'Subscription ID, tenant ID, resource group, AKS or Container Apps choice, Key Vault name, region list, and service principal credentials.'
  },
  {
    title: 'Proxy Provider',
    body: 'Provider name, whether they have an API, region coverage, auth method, pricing/limits, or an uploaded CSV/TXT proxy pool if manual.'
  },
  {
    title: 'Product Rules',
    body: 'How many message credits each sent/received/seen event costs, whether trials are allowed, overage behavior, and suspension grace period.'
  }
];

const apiRows = [
  ['POST', '/api/v3/billing/checkout', 'Creates a Stripe Checkout session for instance seats and optional message credits.'],
  ['GET', '/api/v3/billing/entitlements', 'Returns paid slots, active instances, billing status, and credit balance.'],
  ['POST', '/api/v3/provision/instances', 'Reserves one paid slot and creates desired worker state. Returns 402 if unpaid or full.'],
  ['POST', '/api/webhooks/stripe', 'Receives subscription events and syncs entitlement state from Stripe.'],
  ['POST', '/api/internal/usage-events', 'Workers report sent, received, seen, and webhook usage with idempotency keys.']
];

export default function DocsPage() {
  return (
    <div className="docs-page">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Paid provisioning docs</div>
          <h2>Sell WhatsApp instances, then provision only what was paid for.</h2>
          <p>
            The control plane uses Stripe as the billing source of truth, Supabase as the entitlement cache,
            Clerk for user and organization identity, and Azure workers for isolated WhatsApp runtime.
          </p>
          <div className="action-row">
            <a className="primary-btn" href="/dashboard">Open dashboard</a>
            <a className="secondary-btn" href="/docs#needs">What I need from you</a>
            <a className="secondary-btn" href="/docs#api">API surface</a>
          </div>
        </div>
        <div className="hero-status">
          <span className="dot online" />
          <strong>Billing gate is implemented</strong>
          <span>Provisioning now requires an active paid entitlement with free instance capacity.</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>How The Flow Works</h3>
            <p>From payment to Azure worker desired state.</p>
          </div>
        </div>
        <div className="docs-flow">
          <Step number="1" title="Customer pays" body="Clerk identifies the org, then Stripe Checkout sells instance seats and optional recurring message credits." />
          <Step number="2" title="Stripe syncs" body="Stripe webhooks update Supabase billing_entitlements with subscription status, slot limit, period, and credits." />
          <Step number="3" title="Provision request arrives" body="The API atomically reserves one available paid instance slot before creating a desired instance row." />
          <Step number="4" title="Proxy is allocated" body="Provisioner uses provider API or imported pool, then stores proxy secrets in Azure Key Vault." />
          <Step number="5" title="Worker deploys" body="Azure AKS or Container Apps worker owns the WhatsApp socket, pairing, webhook config, and runtime events." />
          <Step number="6" title="Usage is metered" body="Workers report sent/received/seen/webhook events with idempotency keys, and message credits are debited." />
        </div>
      </section>

      <section className="split-grid" id="needs">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>What I Need From You</h3>
              <p>These are the concrete inputs needed before real deployment.</p>
            </div>
          </div>
          <div className="docs-list">
            {requiredInputs.map((item) => (
              <div className="docs-item" key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Recommended Stripe Catalog</h3>
              <p>Simple pricing model that maps cleanly to entitlement checks.</p>
            </div>
          </div>
          <div className="code-card">
            <code>Wasup WhatsApp Instance Seat: 1 recurring seat = 1 provisionable instance</code>
            <code>Wasup Message Credits: recurring pack, e.g. 1,000 credits per quantity</code>
            <code>Metadata: wasupEntitlement=instance | message_credits</code>
            <code>Run: STRIPE_SECRET_KEY=... npm run stripe:products</code>
          </div>
        </div>
      </section>

      <section className="panel" id="api">
        <div className="panel-head">
          <div>
            <h3>API Surface</h3>
            <p>The endpoints currently implemented for billing, provisioning, and metering.</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {apiRows.map(([method, path, purpose]) => (
              <tr key={path}>
                <td>{method}</td>
                <td><code>{path}</code></td>
                <td>{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="split-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Proxy Decision</h3>
              <p>Best path depends on the provider.</p>
            </div>
          </div>
          <div className="docs-list">
            <div className="docs-item">
              <strong>Provider API</strong>
              <span>Best if available. The provisioner leases a region-specific sticky proxy per paid instance.</span>
            </div>
            <div className="docs-item">
              <strong>Imported Pool</strong>
              <span>Works now. Upload proxies to Supabase/Key Vault, then assign free rows from proxy_allocations.</span>
            </div>
            <div className="docs-item">
              <strong>Hybrid</strong>
              <span>Use provider API first, then fall back to manual uploaded stock when the provider has no capacity.</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Still To Build</h3>
              <p>The entitlement gate exists; these are the next production pieces.</p>
            </div>
          </div>
          <div className="docs-list">
            <div className="docs-item">
              <strong>Azure provisioner</strong>
              <span>Reconciles desired instances into AKS/Container Apps workers and writes status back.</span>
            </div>
            <div className="docs-item">
              <strong>Clerk sync webhooks</strong>
              <span>Keeps organizations and members mirrored into Supabase for strict tenant isolation.</span>
            </div>
            <div className="docs-item">
              <strong>Customer UI forms</strong>
              <span>Checkout, instance wizard, webhook settings, QR/pairing, billing state, and usage charts.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="step">
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}
