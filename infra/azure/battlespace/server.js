/**
 * WASUP BATTLESPACE - Command & Control Dashboard
 *
 * Aggregates status from all regional WhatsApp deployments and serves
 * a live map UI. API keys for each region are held server-side only.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { REGIONS, EXPANSION_COUNTRIES, MAP_COUNTRIES_ISO } from './fleet.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const BATTLESPACE_TOKEN = process.env.BATTLESPACE_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);
const POLL_TIMEOUT_MS = parseInt(process.env.POLL_TIMEOUT_MS || '10000', 10);
const COOKIE_NAME = 'bs_token';

if (!BATTLESPACE_TOKEN) {
    console.warn('[battlespace] WARNING: BATTLESPACE_TOKEN not set - dashboard is UNAUTHENTICATED');
}

// Enrich regions with their API keys from env (never sent to frontend).
const regionsWithKeys = REGIONS.map((r) => ({
    ...r,
    apiKey: process.env[r.envKey] || '',
}));

console.log(`[battlespace] Loaded ${regionsWithKeys.length} regions`);
for (const r of regionsWithKeys) {
    const keyStatus = r.apiKey ? `key:${r.apiKey.slice(0, 6)}...` : 'NO KEY';
    console.log(`  - ${r.code.padEnd(10)} ${r.url.padEnd(45)} ${keyStatus}`);
}

// ---------------------------------------------------------------------------
// Fleet status cache (refreshed by background poller)
// ---------------------------------------------------------------------------
let fleetCache = {
    polledAt: null,
    regions: regionsWithKeys.map((r) => ({
        code: r.code,
        status: 'unknown',
        httpCode: 0,
        latencyMs: 0,
        instanceCount: 0,
        uptime: 0,
        error: null,
    })),
};

async function fetchWithTimeout(url, { headers = {}, timeoutMs = POLL_TIMEOUT_MS } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { headers, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function pollRegion(region) {
    const started = Date.now();
    const headers = region.apiKey ? { 'X-API-Key': region.apiKey } : {};

    // Fire the three polls in parallel so a slow region doesn't stall the batch.
    const [healthResult, poolResult, instancesResult] = await Promise.allSettled([
        fetchWithTimeout(`${region.url}/api/health`, { headers }),
        fetchWithTimeout(`${region.url}/api/proxy/pool`, { headers }),
        fetchWithTimeout(`${region.url}/api/instances`, { headers }),
    ]);

    const latencyMs = Date.now() - started;

    // -- Health (authoritative for region status) --
    let status = 'offline';
    let httpCode = 0;
    let instanceCount = 0;
    let connectedCount = 0;
    let uptime = 0;
    let error = null;

    if (healthResult.status === 'fulfilled') {
        const resp = healthResult.value;
        httpCode = resp.status;
        let body = null;
        try { body = await resp.json(); } catch { /* ignore */ }

        if (resp.status === 200 && body && body.status === 'ok') {
            status = 'healthy';
            instanceCount = (body.instances && (body.instances.total ?? body.instances.count)) || 0;
            connectedCount = (body.instances && (body.instances.connected ?? 0)) || 0;
            uptime = body.uptime || 0;
        } else if (resp.status === 401 || resp.status === 403) {
            status = 'auth-failed';
            error = 'API key rejected';
        } else {
            status = 'degraded';
            error = `HTTP ${resp.status}`;
        }
    } else {
        const err = healthResult.reason;
        error = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'fetch failed';
    }

    // -- Proxy pool (new code only; absent on old-code regions -> returns null here) --
    let pool = null;
    if (poolResult.status === 'fulfilled' && poolResult.value.ok) {
        try {
            const body = await poolResult.value.json();
            if (body && body.pool) {
                pool = {
                    enabled: !!body.pool.enabled,
                    total: body.pool.total || 0,
                    used: body.pool.used || 0,
                    free: body.pool.free || 0,
                    entries: Array.isArray(body.pool.entries)
                        ? body.pool.entries.map((e) => ({
                            id: e.id,
                            host: e.host,
                            port: e.port,
                            assignedTo: e.assignedTo || null,
                        }))
                        : [],
                };
            }
        } catch { /* region on old code -> ignore */ }
    }

    // -- Instances list with proxy detail + v2 anti-ban summary --
    let instances = [];
    if (instancesResult.status === 'fulfilled' && instancesResult.value.ok) {
        try {
            const body = await instancesResult.value.json();
            if (body && Array.isArray(body.instances)) {
                instances = body.instances.map((i) => {
                    const px = i.proxy || {};
                    const override = px.override || null;
                    const eff = px.effective || null;
                    const active = px.active || null;
                    const v2 = i.antibanV2 || null;
                    return {
                        id: i.id,
                        name: i.name,
                        status: i.status,
                        phone: i.connectedPhone || null,
                        connectedAt: i.connectedAt || null,
                        proxy: {
                            source: px.source || 'none',
                            host: eff ? eff.host : null,
                            port: eff ? eff.port : null,
                            origin: override ? override.origin : null,
                            active: active
                                ? {
                                    source: active.source,
                                    host: active.proxy && active.proxy.host,
                                    port: active.proxy && active.proxy.port,
                                    boundAt: active.boundAt,
                                }
                                : null,
                        },
                        antibanV2: v2
                            ? {
                                enabled: v2.enabled,
                                running: v2.running,
                                preset: v2.preset,
                                health: v2.health || null,
                                warmup: v2.warmup || null,
                                retryTracker: v2.retryTracker || null,
                                sessionStability: v2.sessionStability || null,
                                messagesAllowed: v2.messagesAllowed || 0,
                                messagesBlocked: v2.messagesBlocked || 0,
                                isPaused: !!(v2.health && v2.health.isPaused),
                            }
                            : null,
                    };
                });
            }
        } catch { /* ignore */ }
    }

    return {
        code: region.code,
        status,
        httpCode,
        latencyMs,
        instanceCount,
        connectedCount,
        uptime,
        error,
        pool,        // null on regions without pool support / not configured
        instances,   // array of { id, name, status, proxy: {...} }
    };
}

async function pollAllRegions() {
    const results = await Promise.all(regionsWithKeys.map((r) => pollRegion(r)));
    fleetCache = { polledAt: new Date().toISOString(), regions: results };
    const healthy = results.filter((r) => r.status === 'healthy').length;
    console.log(
        `[battlespace] poll complete at ${fleetCache.polledAt} - ${healthy}/${results.length} healthy`
    );
}

async function repollSingleRegion(regionCode) {
    const region = regionsWithKeys.find((r) => r.code === regionCode);
    if (!region) return;
    const fresh = await pollRegion(region);
    const idx = fleetCache.regions.findIndex((r) => r.code === regionCode);
    if (idx >= 0) fleetCache.regions[idx] = fresh;
    else fleetCache.regions.push(fresh);
}

pollAllRegions().catch((e) => console.error('[battlespace] initial poll failed', e));
setInterval(() => {
    pollAllRegions().catch((e) => console.error('[battlespace] poll failed', e));
}, POLL_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Parse cookies manually to avoid extra deps.
app.use((req, res, next) => {
    req.cookies = {};
    const raw = req.headers.cookie;
    if (raw) {
        for (const pair of raw.split(';')) {
            const [k, ...v] = pair.trim().split('=');
            if (k) req.cookies[k] = decodeURIComponent(v.join('='));
        }
    }
    next();
});

function isAuthenticated(req) {
    if (!BATTLESPACE_TOKEN) return true;
    if (req.cookies[COOKIE_NAME] === BATTLESPACE_TOKEN) return true;
    const header = req.headers['x-battlespace-token'];
    if (header && header === BATTLESPACE_TOKEN) return true;
    return false;
}

function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    return res.status(401).json({ error: 'unauthenticated' });
}

// -- Login page (HTML form) --
app.get('/login', (req, res) => {
    res.type('html').send(loginPage(false));
});

// -- Login handler --
app.post('/login', (req, res) => {
    const submitted = (req.body && req.body.token) || '';
    if (!BATTLESPACE_TOKEN || submitted === BATTLESPACE_TOKEN) {
        res.setHeader(
            'Set-Cookie',
            `${COOKIE_NAME}=${encodeURIComponent(BATTLESPACE_TOKEN)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`
        );
        return res.redirect('/');
    }
    res.status(401).type('html').send(loginPage(true));
});

// -- Logout --
app.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0`);
    res.redirect('/login');
});

// -- Protected static assets --
app.get('/', (req, res) => {
    if (!isAuthenticated(req)) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Public static (CSS/JS/GeoJSON) so the login page styling works too.
app.use(express.static(path.join(__dirname, 'public')));

// -- API: fleet status --
app.get('/api/fleet', requireAuth, (req, res) => {
    res.json({
        polledAt: fleetCache.polledAt,
        pollIntervalMs: POLL_INTERVAL_MS,
        regions: fleetCache.regions,
    });
});

// -- API: region metadata (safe to expose, no keys) --
app.get('/api/regions', requireAuth, (req, res) => {
    const safeRegions = regionsWithKeys.map((r) => ({
        code: r.code,
        label: r.label,
        subtitle: r.subtitle,
        countryIso: r.countryIso,
        splitLabel: r.splitLabel || null,
        url: r.url,
        dcLat: r.dcLat,
        dcLng: r.dcLng,
        hasApiKey: !!r.apiKey,
    }));
    res.json({
        regions: safeRegions,
        expansionCountries: EXPANSION_COUNTRIES,
        mapCountriesIso: MAP_COUNTRIES_ISO,
    });
});

// -- API: one-shot API key reveal for a region (auth required) --
// Returns the region's API key so the frontend can show a "copy key" button.
// This endpoint is intentionally simple: it requires the battlespace cookie,
// which is itself protected by BATTLESPACE_TOKEN.
app.get('/api/regions/:code/key', requireAuth, (req, res) => {
    const region = regionsWithKeys.find((r) => r.code === req.params.code);
    if (!region) return res.status(404).json({ error: 'unknown region' });
    if (!region.apiKey) return res.status(404).json({ error: 'no api key configured' });
    res.json({ code: region.code, apiKey: region.apiKey });
});

// -- API: keys vault — all regions + their keys + URLs in one shot --
// Used by the dashboard's KEYS VAULT panel. Returns full keys; gated by
// the battlespace cookie which is itself gated by BATTLESPACE_TOKEN.
app.get('/api/keys', requireAuth, (req, res) => {
    res.json({
        regions: regionsWithKeys.map((r) => ({
            code: r.code,
            label: r.label,
            url: r.url,
            envKey: r.envKey,
            apiKey: r.apiKey || null,
            hasApiKey: !!r.apiKey,
        })),
        battlespaceToken: BATTLESPACE_TOKEN || null,
        // Useful pre-formatted exports
        bashEnv: regionsWithKeys
            .filter((r) => r.apiKey)
            .map((r) => `export ${r.envKey}=${r.apiKey}\nexport ${r.code.toUpperCase().replace(/-/g, '_')}_URL=${r.url}`)
            .join('\n'),
    });
});

// -- API: force re-poll on demand --
app.post('/api/fleet/refresh', requireAuth, async (req, res) => {
    await pollAllRegions();
    res.json({ ok: true, polledAt: fleetCache.polledAt });
});

// -- API: verify a specific instance's egress IP (server-to-server using region API key) --
// POST /api/regions/:code/instances/:id/verify
// Calls the regional app's /api/instances/:id/proxy/verify and forwards the result.
// Includes `match` flag = egressIp === proxy.host (definitive proof traffic tunneled).
app.post('/api/regions/:code/instances/:id/verify', requireAuth, async (req, res) => {
    const region = regionsWithKeys.find((r) => r.code === req.params.code);
    if (!region) return res.status(404).json({ error: 'unknown region' });
    if (!region.apiKey) return res.status(400).json({ error: 'region has no api key configured' });
    return handleVerify(res, region, req.params.id, Date.now());
});

// -- API: anti-ban v2 pass-through routes --
async function passthroughInstanceCall(req, res, method, suffix, body = null) {
    const region = regionsWithKeys.find((r) => r.code === req.params.code);
    if (!region) return res.status(404).json({ error: 'unknown region' });
    if (!region.apiKey) return res.status(400).json({ error: 'region has no api key configured' });

    const url = `${region.url}/api/instances/${encodeURIComponent(req.params.id)}${suffix}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
        const init = {
            method,
            headers: { 'X-API-Key': region.apiKey },
            signal: ctrl.signal,
        };
        if (body !== null && method !== 'GET') {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const upstream = await fetch(url, init);
        const respBody = await upstream.json().catch(() => null);
        // Refresh this region in the cache so the dashboard reflects state quickly
        repollSingleRegion(req.params.code).catch(() => {});
        res.status(upstream.status).json(respBody || { error: 'empty response' });
    } catch (err) {
        res.status(502).json({
            error: 'passthrough failed',
            message: err.name === 'AbortError' ? 'timeout' : err.message,
        });
    } finally {
        clearTimeout(timer);
    }
}

// GET full v2 status for one instance
app.get('/api/regions/:code/instances/:id/antiban-v2', requireAuth, (req, res) =>
    passthroughInstanceCall(req, res, 'GET', '/antiban-v2'));

// PUT v2 config
app.put('/api/regions/:code/instances/:id/antiban-v2/config', requireAuth, (req, res) =>
    passthroughInstanceCall(req, res, 'PUT', '/antiban-v2/config', req.body || {}));

// POST v2 pause / resume / reset
app.post('/api/regions/:code/instances/:id/antiban-v2/pause', requireAuth, (req, res) =>
    passthroughInstanceCall(req, res, 'POST', '/antiban-v2/pause'));
app.post('/api/regions/:code/instances/:id/antiban-v2/resume', requireAuth, (req, res) =>
    passthroughInstanceCall(req, res, 'POST', '/antiban-v2/resume'));
app.post('/api/regions/:code/instances/:id/antiban-v2/reset', requireAuth, (req, res) =>
    passthroughInstanceCall(req, res, 'POST', '/antiban-v2/reset'));

// -- API: add a proxy to a region's pool (runtime, no restart) --
// POST /api/regions/:code/pool/entries
// Body: { url | shorthand | {host,port,username,password} | entries:[...] }
app.post('/api/regions/:code/pool/entries', requireAuth, async (req, res) => {
    const region = regionsWithKeys.find((r) => r.code === req.params.code);
    if (!region) return res.status(404).json({ error: 'unknown region' });
    if (!region.apiKey) return res.status(400).json({ error: 'region has no api key configured' });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
        const upstream = await fetch(`${region.url}/api/proxy/pool/entries`, {
            method: 'POST',
            headers: { 'X-API-Key': region.apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body || {}),
            signal: ctrl.signal,
        });
        const body = await upstream.json().catch(() => null);
        // Refresh only this region's cache entry (fast, keeps dashboard fresh)
        await repollSingleRegion(req.params.code).catch(() => {});
        res.status(upstream.status).json(body || { error: 'empty response' });
    } catch (err) {
        res.status(502).json({
            error: 'add failed',
            message: err.name === 'AbortError' ? 'timeout' : err.message,
        });
    } finally {
        clearTimeout(timer);
    }
});

// -- API: remove a proxy slot from a region's pool --
// DELETE /api/regions/:code/pool/entries/:slotId?confirm=true
app.delete('/api/regions/:code/pool/entries/:slotId', requireAuth, async (req, res) => {
    const region = regionsWithKeys.find((r) => r.code === req.params.code);
    if (!region) return res.status(404).json({ error: 'unknown region' });
    if (!region.apiKey) return res.status(400).json({ error: 'region has no api key configured' });

    const confirm = req.query.confirm === 'true' || req.query.confirm === '1' ? '?confirm=true' : '';
    const url = `${region.url}/api/proxy/pool/entries/${encodeURIComponent(req.params.slotId)}${confirm}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
        const upstream = await fetch(url, {
            method: 'DELETE',
            headers: { 'X-API-Key': region.apiKey },
            signal: ctrl.signal,
        });
        const body = await upstream.json().catch(() => null);
        await repollSingleRegion(req.params.code).catch(() => {});
        res.status(upstream.status).json(body || { error: 'empty response' });
    } catch (err) {
        res.status(502).json({
            error: 'remove failed',
            message: err.name === 'AbortError' ? 'timeout' : err.message,
        });
    } finally {
        clearTimeout(timer);
    }
});

async function handleVerify(res, region, instanceId, started) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
        const upstream = await fetch(
            `${region.url}/api/instances/${encodeURIComponent(instanceId)}/proxy/verify`,
            {
                method: 'POST',
                headers: { 'X-API-Key': region.apiKey, 'Content-Type': 'application/json' },
                body: '{}',
                signal: ctrl.signal,
            }
        );
        let body = null;
        try { body = await upstream.json(); } catch { /* ignore */ }
        const elapsedMs = Date.now() - started;

        if (!upstream.ok || !body) {
            return res.status(upstream.status || 502).json({
                error: 'upstream error',
                httpCode: upstream.status,
                body,
                elapsedMs,
            });
        }

        const egressIp = body.egressIp || null;
        const proxyHost = (body.proxy && body.proxy.host) || null;
        const match = !!egressIp && !!proxyHost && egressIp === proxyHost;

        res.json({
            ok: body.success !== false,
            regionCode: region.code,
            instanceId,
            egressIp,
            proxy: body.proxy || null,
            proxySource: body.proxySource || null,
            active: body.active || null,
            elapsedMs: body.elapsedMs ?? elapsedMs,
            match,
            // human-readable verdict for the UI
            verdict: egressIp
                ? (proxyHost
                    ? (match ? 'MATCH' : 'MISMATCH')
                    : 'DIRECT')
                : 'UNKNOWN',
        });
    } catch (err) {
        res.status(502).json({
            error: 'verify failed',
            message: err.name === 'AbortError' ? 'timeout' : err.message,
            elapsedMs: Date.now() - started,
        });
    } finally {
        clearTimeout(timer);
    }
}

// -- Health for Azure probe --
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        role: 'battlespace',
        regions: regionsWithKeys.length,
        lastPolledAt: fleetCache.polledAt,
    });
});

app.listen(PORT, () => {
    console.log(`[battlespace] listening on :${PORT}`);
});

// ---------------------------------------------------------------------------
// Login HTML (inlined to keep the asset list lean)
// ---------------------------------------------------------------------------
function loginPage(error) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BATTLESPACE // AUTH</title>
<link rel="stylesheet" href="/style.css">
</head>
<body class="login-body">
<div class="login-card">
    <div class="login-title">WASUP // BATTLESPACE</div>
    <div class="login-sub">Command &amp; Control Authentication</div>
    <form method="POST" action="/login">
        <input type="password" name="token" placeholder="ACCESS TOKEN" autofocus required>
        <button type="submit">ENGAGE</button>
    </form>
    ${error ? '<div class="login-error">INVALID TOKEN</div>' : ''}
</div>
</body>
</html>`;
}
