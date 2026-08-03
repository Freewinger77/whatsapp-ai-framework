#!/usr/bin/env node
/**
 * Fleet-wide proxy attachment audit (no control-plane auth required).
 *
 * Usage:
 *   WASUP_WORKER_SHARED_SECRET=... node scripts/fleet-proxy-audit.mjs
 *   ONLY=wasup2,wasup3 node scripts/fleet-proxy-audit.mjs
 *   INCLUDE_ORG=0 node scripts/fleet-proxy-audit.mjs
 *
 * Reads shared workers from the same inventory as deploy-tctoken-hardening.sh.
 * Org VMs are NOT included here (needs Supabase) — use GET /api/v3/proxy/fleet for that.
 */

const SHARED = [
  ['wasup', 'https://wasup.northeurope.cloudapp.azure.com', '20.107.202.157'],
  ['wasup-dev', 'https://wasup-dev.northeurope.cloudapp.azure.com', '20.223.209.59'],
  ['wasup2', 'https://wasup2.northeurope.cloudapp.azure.com', '40.112.73.2'],
  ['wasup3', 'https://wasup3.northeurope.cloudapp.azure.com', '94.245.90.173'],
  ['wasup4', 'https://wasup4.northeurope.cloudapp.azure.com', '20.166.12.101'],
  ['wasup5', 'https://wasup5.northeurope.cloudapp.azure.com', '20.13.163.156'],
  ['wasup01', 'https://wasup01.northeurope.cloudapp.azure.com', '20.234.23.46'],
  ['wasup02', 'https://wasup02.northeurope.cloudapp.azure.com', '20.234.94.178'],
  ['wasup03', 'https://wasup03.northeurope.cloudapp.azure.com', '20.166.63.111'],
  ['wasup04', 'https://wasup04.northeurope.cloudapp.azure.com', '52.236.60.246'],
  ['wasup05', 'https://wasup05.northeurope.cloudapp.azure.com', '20.234.102.144'],
];

const secret = String(process.env.WASUP_WORKER_SHARED_SECRET || process.env.API_KEY || '').trim();
const only = String(process.env.ONLY || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function fetchJson(baseUrl, path) {
  const headers = { Accept: 'application/json' };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers['X-API-Key'] = secret;
    headers['X-Wasup-Worker-Secret'] = secret;
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function auditWorker([id, baseUrl, ip]) {
  try {
    const [instancesBody, poolBody, riskBody] = await Promise.all([
      fetchJson(baseUrl, '/api/instances'),
      fetchJson(baseUrl, '/api/proxy/pool').catch(() => null),
      fetchJson(baseUrl, '/api/fingerprint-risk').catch(() => null),
    ]);
    const instances = instancesBody.instances || [];
    let withProxy = 0;
    let direct = 0;
    for (const inst of instances) {
      const source = inst?.proxy?.source;
      const host = inst?.proxy?.effective?.host || inst?.proxy?.override?.host;
      if (host || (source && source !== 'none' && source !== 'disabled')) withProxy += 1;
      else direct += 1;
    }
    const pool = poolBody?.pool || poolBody;
    return {
      id,
      ip,
      reachable: true,
      instances: instances.length,
      connected: instances.filter((i) => i.status === 'connected').length,
      withProxy,
      direct,
      poolTotal: pool?.total ?? null,
      poolUsed: pool?.used ?? null,
      poolFree: pool?.free ?? null,
      fp: riskBody?.summary || null,
      groups: (riskBody?.groups || []).slice(0, 5),
    };
  } catch (error) {
    return {
      id,
      ip,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const targets = SHARED.filter(([id]) => !only.length || only.includes(id));
  console.log(`Fleet proxy audit — ${targets.length} workers${secret ? '' : ' (no shared secret; public reads only)'}\n`);
  const rows = await Promise.all(targets.map(auditWorker));

  let totalInst = 0;
  let totalProxy = 0;
  let totalDirect = 0;
  for (const row of rows) {
    if (!row.reachable) {
      console.log(`❌ ${row.id.padEnd(10)} DOWN  ${row.error}`);
      continue;
    }
    totalInst += row.instances;
    totalProxy += row.withProxy;
    totalDirect += row.direct;
    const fp = row.fp
      ? `FP H${row.fp.high}/A${row.fp.amber}/L${row.fp.low}`
      : 'FP n/a';
    const pool =
      row.poolTotal != null ? `pool ${row.poolUsed}/${row.poolTotal} free=${row.poolFree}` : 'pool n/a';
    console.log(
      `✅ ${row.id.padEnd(10)} inst ${String(row.connected).padStart(2)}/${String(row.instances).padStart(2)}  proxy ${String(row.withProxy).padStart(2)}  direct ${String(row.direct).padStart(2)}  ${pool}  ${fp}`,
    );
    for (const g of row.groups || []) {
      if (g.risk === 'high' || g.risk === 'amber' || g.count > 1) {
        console.log(
          `     · ${g.risk} ${g.fingerprint} ×${g.count} :: ${(g.members || []).map((m) => m.name || m).join(', ')}`,
        );
      }
    }
  }

  console.log('\n--- totals (reachable) ---');
  console.log(`instances=${totalInst}  withProxy=${totalProxy}  direct=${totalDirect}`);
  console.log(`up=${rows.filter((r) => r.reachable).length}/${rows.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
