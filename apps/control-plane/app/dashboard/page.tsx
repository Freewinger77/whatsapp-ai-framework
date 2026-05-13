import { getDashboardSummary } from '../../lib/dashboard';
import { getWasupPrincipal } from '../../lib/auth';

export default async function DashboardPage() {
  const principal = await getWasupPrincipal();
  const summary = await getDashboardSummary();
  const onlineRegions = summary.legacyRegions.filter((region) => region.status === 'online').length;

  return (
    <div className="dashboard">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Wasup v3 command center</div>
          <h2>{principal?.orgName ?? 'Wasup'} SaaS operations</h2>
          <p>
            Manage customers, WhatsApp workers, pairing, proxies, behaviour modes, API access,
            webhook delivery, and legacy fleet migration from one place.
          </p>
          <div className="action-row">
            <button className="primary-btn">Create customer</button>
            <button className="secondary-btn">Provision instance</button>
            <a className="secondary-btn" href="#api">View API docs</a>
          </div>
        </div>
        <div className="hero-status">
          <StatusDot status={summary.setupReady ? 'online' : 'degraded'} />
          <strong>{summary.setupReady ? 'Supabase connected' : 'Demo mode active'}</strong>
          <span>{summary.setupReady ? 'Live control-plane data' : 'Connect Supabase to persist orgs and workers'}</span>
        </div>
      </section>

      <section className="grid">
        <Metric label="Customers" value={summary.organizations} detail="B2B org accounts" />
        <Metric label="Instances" value={summary.instances} detail="Workers / WhatsApp numbers" />
        <Metric label="Connected" value={summary.connectedInstances} detail="Ready for traffic" />
        <Metric label="Legacy fleet" value={onlineRegions} detail={`${summary.legacyRegions.length} endpoints tracked`} />
      </section>

      <section className="split-grid">
        <div className="panel">
          <PanelHeader title="Customers" subtitle="Agency/client accounts with their API base and worker count." action="Add org" />
          <div className="org-list">
            {summary.orgs.map((org) => (
              <div className="org-row" key={org.id}>
                <div>
                  <strong>{org.name}</strong>
                  <span>{org.api_base_url}</span>
                </div>
                <div className="row-meta">
                  <span className="pill">{org.plan}</span>
                  <span className="pill">{org.connected}/{org.instances} connected</span>
                  <span className={`status-badge ${org.status}`}>{org.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Provisioning" subtitle="Create isolated workers with sticky regional identity." action="Run wizard" />
          <div className="wizard-card">
            <Step number="1" title="Choose customer" body="Attach the instance to an org and API key scope." />
            <Step number="2" title="Select region + proxy" body="Allocate a stable regional proxy before QR pairing." />
            <Step number="3" title="Pair WhatsApp" body="Render QR/pairing code and persist auth in the worker volume." />
          </div>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Instances" subtitle="Per-customer WhatsApp workers, pairing status, proxy identity, and behaviour profile." action="New instance" />
        <div className="instance-grid">
          {summary.instanceRows.map((instance) => (
            <article className="instance-card" key={instance.id}>
              <div className="instance-head">
                <div>
                  <strong>{instance.name}</strong>
                  <span>{instance.org_slug} · {instance.phone ?? 'No phone linked yet'}</span>
                </div>
                <span className={`status-badge ${instance.status}`}>{prettyStatus(instance.status)}</span>
              </div>
              <div className="instance-body">
                <Info label="Region" value={instance.region_code} />
                <Info label="Proxy" value={instance.proxy_label} />
                <Info label="Behaviour" value={prettyProfile(instance.behavior_profile)} />
                <Info label="Webhook" value={instance.webhook_url ? 'Configured' : 'Not set'} />
              </div>
              <div className="qr-placeholder">
                <div className="qr-box">{instance.status === 'awaiting_pair' ? 'QR' : 'WA'}</div>
                <div>
                  <strong>{instance.status === 'connected' ? 'Connected worker' : 'Pairing placeholder'}</strong>
                  <p>{instance.status === 'connected' ? 'Ready to send, receive, and route webhooks.' : 'QR/pairing code will render here once the worker is live.'}</p>
                </div>
              </div>
              <div className="action-row compact">
                <button className="secondary-btn">Settings</button>
                <button className="secondary-btn">Connect</button>
                <button className="secondary-btn">Logs</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="split-grid">
        <div className="panel">
          <PanelHeader title="Behaviour profiles" subtitle="Productized modes for ban protection vs notification reliability." />
          <div className="profile-list">
            <Profile name="Bot-native" tag="Automation" body="Typing, read receipts, delays, active-device emulation, and Wasup Anti-Ban defaults." />
            <Profile name="Notification-first" tag="Balanced" body="Delay read/typing to give the phone a notification window, then respond naturally." />
            <Profile name="Notification-max" tag="Human-first" body="Prioritize lock-screen alerts; typing off and unavailable reasserted after activity." />
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Proxy inventory" subtitle="Sticky regional identity per WhatsApp worker." action="Import pool" />
          <div className="proxy-map">
            {['North Europe', 'UK South', 'UK West', 'Germany', 'France', 'Sweden'].map((region, index) => (
              <div className="proxy-row" key={region}>
                <span>{region}</span>
                <strong>{index < 3 ? 'Capacity ready' : 'Provider pending'}</strong>
                <em>{index < 3 ? `${5 - index} free slots` : 'on-demand'}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="split-grid" id="api">
        <div className="panel">
          <PanelHeader title="API keys & docs" subtitle="Give each org a scoped Wasup v3 API key." action="Create key" />
          <div className="code-card">
            <code>POST https://api.wasup.ai/v3/instances/{'{instanceId}'}/send</code>
            <code>X-Wasup-Key: wsp_v3_••••••</code>
            <code>Webhook signature: X-Wasup-Signature</code>
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Webhook settings" subtitle="Centralized delivery, retries, signatures, and dead-letter visibility." action="Test webhook" />
          <div className="webhook-card">
            <Info label="Delivery owner" value="Control plane" />
            <Info label="Retries" value="3 attempts + dead letter" />
            <Info label="Signing" value="HMAC per org" />
            <Info label="Log retention" value="30 days (configurable)" />
          </div>
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Legacy fleet" subtitle="Existing VM and regional apps stay visible while customers migrate to v3 workers." />
        <div className="legacy-grid">
          {summary.legacyRegions.map((region) => (
            <a className="legacy-card" href={region.url} key={region.code} target="_blank" rel="noreferrer">
              <StatusDot status={region.status} />
              <div>
                <strong>{region.label}</strong>
                <span>{region.kind} · {region.url.replace('https://', '')}</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHeader title="Activity" subtitle="Worker lifecycle, pairing, proxy, webhook, and anti-ban events." />
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Org</th>
              <th>Instance</th>
              <th>Type</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {summary.recentEvents.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.created_at).toLocaleString('en-GB')}</td>
                <td>{event.org_slug ?? event.org_id}</td>
                <td>{event.instance_name ?? event.instance_id ?? '-'}</td>
                <td>{event.event_type}</td>
                <td>{event.summary ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <p className="muted">{detail}</p>
    </div>
  );
}

function PanelHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: string }) {
  return (
    <div className="panel-head">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action ? <button className="secondary-btn">{action}</button> : null}
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Profile({ name, tag, body }: { name: string; tag: string; body: string }) {
  return (
    <div className="profile-card">
      <div>
        <strong>{name}</strong>
        <span>{body}</span>
      </div>
      <em>{tag}</em>
    </div>
  );
}

function StatusDot({ status }: { status: 'online' | 'degraded' | 'unknown' | string }) {
  return <span className={`dot ${status}`} />;
}

function prettyStatus(status: string) {
  return status.replace(/_/g, ' ');
}

function prettyProfile(profile: string) {
  return profile.replace(/-/g, ' ');
}
