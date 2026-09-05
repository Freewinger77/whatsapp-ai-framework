"use client";

import { useEffect, useState } from "react";

const INTERVALS = [
  { label: "30 seconds", ms: 30_000 },
  { label: "1 minute", ms: 60_000 },
  { label: "5 minutes", ms: 300_000 },
  { label: "15 minutes", ms: 900_000 },
];

const KINDS = ["customers", "enquiries", "nps", "testimonials"];

export default function ScraperPage() {
  const [settings, setSettings] = useState({
    webhookUrl: "",
    signWebhooks: true,
    sendEachOnce: true,
    announceKinds: KINDS,
    pollIntervalMs: 60_000,
  });
  const [flash, setFlash] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSettings((s) => ({ ...s, ...d.settings })));
  }, []);

  async function save() {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setFlash(res.ok ? "Saved" : "Save failed");
  }

  async function scrape(full = false) {
    const res = await fetch("/api/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ announce: !full, fullExport: full }),
    });
    setResult(JSON.stringify(await res.json(), null, 2));
  }

  return (
    <div className="grid-12">
      <div className="span-8 card">
        <h2>Poll interval</h2>
        <div className="hint">Display only. Live ticks are Vercel cron `* * * * *` → GET /api/poll. Use 1 minute unless you change vercel.json.</div>
        <div className="filters" style={{ marginTop: 12 }}>
          {INTERVALS.map((i) => (
            <button key={i.ms} className={`chip ${settings.pollIntervalMs === i.ms ? "on" : ""}`} onClick={() => setSettings({ ...settings, pollIntervalMs: i.ms })}>
              {i.label}
            </button>
          ))}
        </div>
        <div className="row">
          <div>
            <div>Sign outbound webhooks</div>
            <div className="hint">Adds X-Signature HMAC-SHA256 using WEBHOOK_SECRET.</div>
          </div>
          <div className={`switch ${settings.signWebhooks ? "on" : ""}`} onClick={() => setSettings({ ...settings, signWebhooks: !settings.signWebhooks })}>
            <i />
          </div>
        </div>
        <div className="row">
          <div>
            <div>Send each once</div>
            <div className="hint">Unknown SMT id → webhook. Known ids refresh only.</div>
          </div>
          <div className={`switch ${settings.sendEachOnce ? "on" : ""}`} onClick={() => setSettings({ ...settings, sendEachOnce: !settings.sendEachOnce })}>
            <i />
          </div>
        </div>
        <h2 style={{ marginTop: 20 }}>Announce these types</h2>
        {KINDS.map((kind) => {
          const on = settings.announceKinds.includes(kind);
          return (
            <div className="row" key={kind}>
              <span>{kind}</span>
              <div
                className={`switch ${on ? "on" : ""}`}
                onClick={() =>
                  setSettings({
                    ...settings,
                    announceKinds: on ? settings.announceKinds.filter((k) => k !== kind) : [...settings.announceKinds, kind],
                  })
                }
              >
                <i />
              </div>
            </div>
          );
        })}
        <label className="hint" style={{ display: "block", marginTop: 16 }}>WEBHOOK_URL</label>
        <input
          value={settings.webhookUrl}
          onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
          placeholder="https://n8n…/webhook/tyres4u-smt"
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={() => void save()}>Save settings</button>
          <button className="btn ghost" onClick={() => void scrape(false)}>Scrape now</button>
          <button className="btn ghost" onClick={() => void scrape(true)}>Full export (no webhooks)</button>
        </div>
        {flash ? <p className="hint">{flash}</p> : null}
        {result ? <pre style={{ marginTop: 16, fontSize: 12 }}>{result}</pre> : null}
      </div>
      <div className="span-4 card">
        <h2>Hard rules</h2>
        <p className="hint">Do not write to dundee_* or chat_history.</p>
        <p className="hint">Do not PM2-restart wasup. This app is a sibling Vercel project.</p>
        <p className="hint">SMT password stays in gitignored env / Vercel — never in git.</p>
        <p className="hint">Backfill is `npm run backfill` because a 1-minute tick cannot walk every customer page.</p>
      </div>
    </div>
  );
}
