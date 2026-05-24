/* WASUP // BATTLESPACE - client-side command & control logic */

const REFRESH_MS = 10000;

const state = {
    regions: [],
    expansionCountries: [],
    mapCountriesIso: [],
    fleet: {},
    selectedCode: null,
    countryLayers: {},
    markers: {},
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
    try {
        const [meta, geo, ottoman, southAsia] = await Promise.all([
            fetch('/api/regions').then((r) => r.json()),
            fetch('/eu.geojson').then((r) => r.json()),
            fetch('/ottoman-peak.geojson').then((r) => r.json()).catch(() => null),
            fetch('/south-asia.geojson').then((r) => r.json()).catch(() => null),
        ]);
        state.regions = meta.regions;
        state.expansionCountries = meta.expansionCountries;
        state.mapCountriesIso = meta.mapCountriesIso;

        renderMap(geo, { ottoman, southAsia });
        renderSidebar();
        renderExpansion();
        initKeysVault();

        await pollFleet();
        setInterval(pollFleet, REFRESH_MS);
        setInterval(tickClock, 1000);

        document.getElementById('refresh-btn').addEventListener('click', forcePoll);
    } catch (err) {
        console.error('init failed', err);
        document.getElementById('foot-link-status').textContent = 'ERROR: ' + err.message;
    }
})();

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
let map;

function renderMap(geojson, decorativeLayers = {}) {
    // Default view stays EU-centred (same as before the easter eggs existed).
    // Max bounds are extended east + south so a curious user who pans around
    // will stumble across the decorative layers, but they never appear on the
    // initial load.
    map = L.map('map', {
        zoomControl: true,
        attributionControl: true,
        minZoom: 3,
        maxZoom: 7,
        worldCopyJump: false,
        maxBounds: [[10, -35], [75, 85]],
    }).setView([52, 10], 4);

    L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 19,
        }
    ).addTo(map);

    // -- Decorative theatres (non-interactive easter eggs) --
    // Styled like `country-other` so they blend in with unused countries.
    // Rendered BEFORE the EU layer so EU polygons sit on top.
    if (decorativeLayers.ottoman) {
        L.geoJSON(decorativeLayers.ottoman, {
            interactive: false,
            style: () => ({ className: 'country-other' }),
        }).addTo(map);
    }
    if (decorativeLayers.southAsia) {
        L.geoJSON(decorativeLayers.southAsia, {
            interactive: false,
            style: () => ({ className: 'country-other' }),
        }).addTo(map);
    }

    // Country polygons
    L.geoJSON(geojson, {
        style: () => ({ weight: 1 }),
        onEachFeature: (feature, layer) => {
            const iso = feature.properties.iso;
            const className = classifyCountry(iso, 'unknown');
            layer.setStyle({ className });
            state.countryLayers[iso] = layer;

            layer.on('click', () => {
                const regions = regionsForCountry(iso);
                if (regions.length === 1) {
                    selectRegion(regions[0].code);
                } else if (regions.length > 1) {
                    // UK split: pick whichever is closer to the clicked point.
                    // For now just select first; markers are still individually clickable.
                    selectRegion(regions[0].code);
                }
            });

            layer.on('mouseover', () => {
                layer.setStyle({ weight: 2 });
            });
            layer.on('mouseout', () => {
                layer.setStyle({ weight: 1 });
            });

            const regions = regionsForCountry(iso);
            if (regions.length === 0) {
                const isExpansion = state.expansionCountries.some((e) => e.countryIso === iso);
                layer.bindTooltip(
                    `<b>${feature.properties.name}</b><br>${isExpansion ? 'EXPANSION SLOT' : 'OUT OF SCOPE'}`,
                    { direction: 'top' }
                );
            } else {
                const sub = regions.length > 1 ? `${regions.length} ZONES` : regions[0].subtitle;
                layer.bindTooltip(
                    `<b>${feature.properties.name}</b><br>${sub}`,
                    { direction: 'top' }
                );
            }
        },
    }).addTo(map);

    // Datacenter markers for every deployed region
    for (const region of state.regions) {
        const marker = L.marker([region.dcLat, region.dcLng], {
            icon: makeDcIcon(region, 'unknown'),
            riseOnHover: true,
        }).addTo(map);

        marker.on('click', () => {
            selectRegion(region.code);
        });

        state.markers[region.code] = marker;
    }

    // Expansion markers
    for (const exp of state.expansionCountries) {
        L.circleMarker([exp.lat, exp.lng], {
            radius: 6,
            className: 'expansion-marker',
            interactive: true,
        })
            .bindTooltip(`<b>${exp.label}</b><br>EXPANSION SLOT`, { direction: 'top' })
            .addTo(map);
    }
}

function classifyCountry(iso, status) {
    const regions = regionsForCountry(iso);
    if (regions.length > 0) {
        return `country-covered ${status}`;
    }
    const isExpansion = state.expansionCountries.some((e) => e.countryIso === iso);
    if (isExpansion) return 'country-expansion';
    return 'country-other';
}

function regionsForCountry(iso) {
    return state.regions.filter((r) => r.countryIso === iso);
}

function makeDcIcon(region, status) {
    const sub = region.splitLabel ? `<tspan class="dc-label-sub" dx="4">${region.splitLabel}</tspan>` : '';
    const label = region.label.toUpperCase();
    const html = `
    <svg class="dc-marker ${status}" width="180" height="60" viewBox="-90 -30 180 60" xmlns="http://www.w3.org/2000/svg" overflow="visible">
        <circle class="dc-marker-ring" cx="0" cy="0" r="12"/>
        <circle class="dc-marker-core" cx="0" cy="0" r="4"/>
        <text class="dc-label" x="8" y="-8">${label}${sub}</text>
    </svg>`;
    return L.divIcon({
        html,
        className: '',
        iconSize: [180, 60],
        iconAnchor: [90, 30],
    });
}

function updateMarkerStatus(regionCode, status) {
    const region = state.regions.find((r) => r.code === regionCode);
    if (!region) return;
    const marker = state.markers[regionCode];
    if (!marker) return;
    marker.setIcon(makeDcIcon(region, status));
}

function updateCountryStatus() {
    for (const iso of Object.keys(state.countryLayers)) {
        const regions = regionsForCountry(iso);
        if (regions.length === 0) continue;
        const statuses = regions.map((r) => state.fleet[r.code]?.status || 'unknown');
        let combined = 'healthy';
        if (statuses.every((s) => s === 'offline')) combined = 'offline';
        else if (statuses.some((s) => s === 'offline' || s === 'degraded' || s === 'auth-failed')) combined = 'degraded';
        else if (statuses.every((s) => s === 'healthy')) combined = 'healthy';
        else combined = 'unknown';
        state.countryLayers[iso].setStyle({ className: `country-covered ${combined}` });
    }
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function renderSidebar() {
    const list = document.getElementById('region-list');
    list.innerHTML = '';
    for (const region of state.regions) {
        const card = document.createElement('div');
        card.className = 'region-card unknown';
        card.dataset.code = region.code;
        card.innerHTML = `
            <div class="region-card-top">
                <div>
                    <div class="region-code">${region.code.toUpperCase()} / ${region.countryIso}</div>
                    <div class="region-label">${region.label}</div>
                    <div class="region-sub">${region.subtitle}</div>
                </div>
                <div class="region-status"><span class="region-status-dot status-unknown"></span></div>
            </div>
            <div class="region-card-bottom">
                <span class="region-metric">INST <b data-metric="instances">-</b></span>
                <span class="region-metric">UP <b data-metric="uptime">-</b></span>
                <span class="region-metric">LAT <b data-metric="latency">-</b></span>
                <span class="region-metric pool-chip" data-metric="pool" hidden>POOL <b>-</b></span>
            </div>
        `;
        card.addEventListener('click', () => selectRegion(region.code));
        list.appendChild(card);
    }
}

function renderExpansion() {
    const list = document.getElementById('expansion-list');
    list.innerHTML = '';
    for (const exp of state.expansionCountries) {
        const card = document.createElement('div');
        card.className = 'expansion-card';
        card.innerHTML = `<span>${exp.countryIso} / ${exp.label}</span>`;
        list.appendChild(card);
    }
}

function updateSidebar() {
    for (const region of state.regions) {
        const card = document.querySelector(`.region-card[data-code="${region.code}"]`);
        if (!card) continue;
        const r = state.fleet[region.code] || {};
        const status = r.status || 'unknown';
        card.className = `region-card ${status}` + (region.code === state.selectedCode ? ' active' : '');
        card.querySelector('.region-status-dot').className = `region-status-dot status-${status}`;
        card.querySelector('[data-metric="instances"]').textContent =
            r.connectedCount != null ? `${r.connectedCount}/${r.instanceCount}` : '-';
        card.querySelector('[data-metric="uptime"]').textContent = formatUptime(r.uptime);
        card.querySelector('[data-metric="latency"]').textContent = r.latencyMs ? `${r.latencyMs}ms` : '-';

        const poolChip = card.querySelector('[data-metric="pool"]');
        if (poolChip) {
            if (r.pool && r.pool.enabled) {
                poolChip.hidden = false;
                poolChip.querySelector('b').textContent = `${r.pool.used}/${r.pool.total}`;
                poolChip.classList.toggle('pool-full', r.pool.free === 0);
                poolChip.classList.toggle('pool-partial', r.pool.used > 0 && r.pool.free > 0);
            } else {
                poolChip.hidden = true;
            }
        }
    }
}

function updateTopStats() {
    const results = Object.values(state.fleet).filter((v) => v && v.code);
    const healthy = results.filter((r) => r.status === 'healthy').length;
    const offline = results.filter((r) => r.status === 'offline').length;
    const totalInstances = results.reduce((s, r) => s + (r.instanceCount || 0), 0);
    const proxiedInstances = results.reduce((s, r) => s + ((r.pool && r.pool.used) || 0), 0);
    const poolFree = results.reduce((s, r) => s + ((r.pool && r.pool.free) || 0), 0);

    // Anti-ban v2 aggregations across all instances
    let warming = 0;
    let atRisk = 0;
    for (const r of results) {
        for (const inst of (r.instances || [])) {
            const v2 = inst.antibanV2;
            if (!v2) continue;
            if (v2.warmup && v2.warmup.complete === false) warming++;
            const risk = v2.health && v2.health.risk;
            if (risk === 'medium' || risk === 'high' || risk === 'critical') atRisk++;
        }
    }

    document.getElementById('stat-nodes').textContent = state.regions.length;
    document.getElementById('stat-healthy').textContent = healthy;
    document.getElementById('stat-offline').textContent = offline;
    document.getElementById('stat-instances').textContent = totalInstances;
    const proxEl = document.getElementById('stat-proxied');
    if (proxEl) proxEl.textContent = `${proxiedInstances}/${proxiedInstances + poolFree}`;
    const wEl = document.getElementById('stat-warming');
    if (wEl) wEl.textContent = warming;
    const aEl = document.getElementById('stat-atrisk');
    if (aEl) aEl.textContent = atRisk;
    document.getElementById('stat-polled').textContent =
        state.fleet._polledAt ? new Date(state.fleet._polledAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + ' UTC' : '--';
}

// ---------------------------------------------------------------------------
// Selection / detail panel
// ---------------------------------------------------------------------------
async function selectRegion(code) {
    state.selectedCode = code;
    const region = state.regions.find((r) => r.code === code);
    if (!region) return;

    document.querySelectorAll('.region-card').forEach((c) =>
        c.classList.toggle('active', c.dataset.code === code)
    );

    const panel = document.getElementById('detail-panel');
    const body = document.getElementById('detail-body');
    panel.hidden = false;

    const r = state.fleet[code] || {};
    const statusText = (r.status || 'unknown').toUpperCase();

    body.innerHTML = `
        <div class="detail-row"><span class="detail-label">Code</span><span class="detail-value">${region.code}</span></div>
        <div class="detail-row"><span class="detail-label">Country</span><span class="detail-value">${region.countryIso} / ${region.label}${region.splitLabel ? ' (' + region.splitLabel + ')' : ''}</span></div>
        <div class="detail-row"><span class="detail-label">DC</span><span class="detail-value">${region.subtitle}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusText}${r.error ? ' - ' + r.error : ''}</span></div>
        <div class="detail-row"><span class="detail-label">Instances</span><span class="detail-value">${r.connectedCount ?? '-'} / ${r.instanceCount ?? '-'}</span></div>
        <div class="detail-row"><span class="detail-label">Uptime</span><span class="detail-value">${formatUptime(r.uptime)}</span></div>
        <div class="detail-row"><span class="detail-label">Latency</span><span class="detail-value">${r.latencyMs ? r.latencyMs + ' ms' : '-'}</span></div>
        <div class="detail-row"><span class="detail-label">URL</span><span class="detail-value"><a href="${region.url}" target="_blank" rel="noopener">${region.url.replace('https://','')}</a></span></div>
        <div class="detail-row"><span class="detail-label">API Key</span><span class="detail-value" id="detail-key">${region.hasApiKey ? '•••••••• <button class="detail-btn" style="padding:2px 8px;font-size:9px" id="reveal-key-btn">REVEAL</button>' : 'NOT SET'}</span></div>

        ${renderPoolSection(code, r.pool)}
        ${renderInstancesSection(code, r.instances)}

        <div class="detail-actions">
            <button class="detail-btn primary" id="open-dashboard-btn">OPEN DASHBOARD</button>
            <button class="detail-btn" id="copy-url-btn">COPY URL</button>
        </div>
    `;

    wireDetailPanelButtons(code);

    // Fly map camera to the selected region.
    map.flyTo([region.dcLat, region.dcLng], 6, { duration: 0.8 });

    document.getElementById('open-dashboard-btn').addEventListener('click', async () => {
        // Try to open with API key prefilled. The regional app UI accepts ?apikey= via localStorage bootstrap.
        let key = '';
        if (region.hasApiKey) {
            try {
                const resp = await fetch(`/api/regions/${region.code}/key`);
                if (resp.ok) {
                    const j = await resp.json();
                    key = j.apiKey || '';
                }
            } catch { /* silent */ }
        }
        const target = key ? `${region.url}/?apikey=${encodeURIComponent(key)}` : region.url;
        window.open(target, '_blank', 'noopener');
    });

    document.getElementById('copy-url-btn').addEventListener('click', async () => {
        await navigator.clipboard.writeText(region.url);
        document.getElementById('copy-url-btn').textContent = 'COPIED';
        setTimeout(() => (document.getElementById('copy-url-btn').textContent = 'COPY URL'), 1500);
    });

    const revealBtn = document.getElementById('reveal-key-btn');
    if (revealBtn) {
        revealBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                const resp = await fetch(`/api/regions/${region.code}/key`);
                if (!resp.ok) throw new Error('fetch failed');
                const j = await resp.json();
                const cell = document.getElementById('detail-key');
                cell.innerHTML = `<code style="font-size:10px">${j.apiKey}</code> <button class="detail-btn" style="padding:2px 8px;font-size:9px" id="copy-key-btn">COPY</button>`;
                document.getElementById('copy-key-btn').addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    await navigator.clipboard.writeText(j.apiKey);
                    ev.target.textContent = 'COPIED';
                });
            } catch (err) {
                alert('Failed to fetch API key: ' + err.message);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Pool + instances detail
// ---------------------------------------------------------------------------
function renderPoolSection(regionCode, pool) {
    // If pool is null the region is on old code (pre-pool feature). Hide.
    if (!pool) return '';

    const entries = pool.entries || [];
    const rows = entries.map((e, idx) => {
        const used = !!e.assignedTo;
        return `
            <div class="proxy-row ${used ? 'used' : 'free'}">
                <span class="proxy-slot-num">#${idx + 1}</span>
                <span class="proxy-endpoint"><code>${escapeHtml(e.host)}:${e.port}</code></span>
                <span class="proxy-assigned">${used ? escapeHtml(e.assignedTo) : '<em>free</em>'}</span>
                <button class="proxy-remove-btn"
                        data-region="${regionCode}"
                        data-slot-id="${escapeAttr(e.id)}"
                        data-assigned="${used ? '1' : '0'}"
                        title="Remove this proxy from the pool">✕</button>
            </div>
        `;
    }).join('');

    const meta = entries.length === 0
        ? `<span class="detail-section-meta pool-empty">EMPTY - add proxies below</span>`
        : `<span class="detail-section-meta">${pool.used}/${pool.total} USED</span>`;

    return `
        <div class="detail-section">
            <div class="detail-section-head">
                <span class="detail-section-title">PROXY POOL</span>
                ${meta}
                <button class="detail-section-btn pool-add-toggle"
                        data-region="${regionCode}">+ ADD PROXY</button>
            </div>

            <div class="pool-add-form" data-region="${regionCode}" hidden>
                <div class="pool-add-row">
                    <input type="text" class="pool-input" data-field="shorthand"
                           placeholder="host:port:username:password">
                </div>
                <div class="pool-add-or">— or —</div>
                <div class="pool-add-row pool-add-structured">
                    <input type="text" class="pool-input" data-field="host" placeholder="host / IP">
                    <input type="text" class="pool-input pool-input-sm" data-field="port" placeholder="port">
                    <input type="text" class="pool-input" data-field="username" placeholder="username">
                    <input type="text" class="pool-input" data-field="password" placeholder="password">
                </div>
                <div class="pool-add-actions">
                    <button class="detail-btn primary pool-add-submit" data-region="${regionCode}">ADD TO POOL</button>
                    <button class="detail-btn pool-add-cancel" data-region="${regionCode}">CANCEL</button>
                </div>
                <div class="pool-add-result" data-region="${regionCode}"></div>
            </div>

            <div class="proxy-table">
                ${rows || '<div class="empty">no slots yet</div>'}
            </div>
        </div>
    `;
}

function renderInstancesSection(regionCode, instances) {
    if (!instances || instances.length === 0) {
        return `
            <div class="detail-section">
                <div class="detail-section-head">
                    <span class="detail-section-title">INSTANCES</span>
                    <span class="detail-section-meta">0</span>
                </div>
                <div class="empty">no instances on this region</div>
            </div>
        `;
    }

    const rows = instances.map((inst) => {
        const p = inst.proxy || {};
        const proxyLabel = p.host
            ? `<code>${p.host}:${p.port}</code>`
            : '<em>direct</em>';
        const srcClass = `proxy-src-${p.source || 'none'}`;

        // Anti-ban v2 row (omitted entirely if v2 not deployed on this region)
        const v2 = inst.antibanV2;
        const v2Row = v2
            ? renderAntibanV2Row(regionCode, inst.id, v2)
            : '';

        return `
            <div class="instance-row" data-instance-id="${escapeAttr(inst.id)}">
                <div class="instance-row-main">
                    <div class="instance-row-id">
                        <span class="instance-status-dot status-${instStatusClass(inst.status)}"></span>
                        <span class="instance-name">${escapeHtml(inst.name || inst.id)}</span>
                        <span class="instance-id-sub">${escapeHtml(inst.id)}</span>
                    </div>
                    <button class="detail-btn verify-btn"
                            data-region="${regionCode}"
                            data-instance="${escapeAttr(inst.id)}">VERIFY</button>
                </div>
                <div class="instance-row-proxy">
                    <span class="proxy-source-chip ${srcClass}">${(p.source || 'none').toUpperCase()}</span>
                    <span class="proxy-endpoint">${proxyLabel}</span>
                </div>
                ${v2Row}
                <div class="instance-row-verify" data-verify-slot hidden></div>
            </div>
        `;
    }).join('');

    return `
        <div class="detail-section">
            <div class="detail-section-head">
                <span class="detail-section-title">INSTANCES</span>
                <span class="detail-section-meta">${instances.length}</span>
            </div>
            <div class="instance-table">
                ${rows}
            </div>
        </div>
    `;
}

function wireDetailPanelButtons(regionCode) {
    // -- VERIFY buttons on instance rows --
    document.querySelectorAll('.verify-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const instanceId = btn.dataset.instance;
            const region = btn.dataset.region;
            const row = btn.closest('.instance-row');
            const slot = row.querySelector('[data-verify-slot]');
            btn.disabled = true;
            btn.textContent = 'CHECKING...';
            slot.hidden = false;
            slot.className = 'instance-row-verify pending';
            slot.textContent = 'Probing egress IP through proxy...';
            try {
                const resp = await fetch(`/api/regions/${region}/instances/${encodeURIComponent(instanceId)}/verify`, {
                    method: 'POST',
                });
                const body = await resp.json();
                if (!resp.ok || body.error) {
                    slot.className = 'instance-row-verify error';
                    slot.textContent = `ERROR: ${body.error || body.message || 'HTTP ' + resp.status}`;
                } else {
                    const verdict = body.verdict || 'UNKNOWN';
                    const cls = verdict === 'MATCH' ? 'match' : (verdict === 'MISMATCH' ? 'mismatch' : 'neutral');
                    slot.className = 'instance-row-verify ' + cls;
                    const egressLine = body.egressIp
                        ? `egress <code>${body.egressIp}</code>`
                        : 'egress unknown';
                    const proxyLine = body.proxy && body.proxy.host
                        ? `proxy <code>${body.proxy.host}:${body.proxy.port}</code>`
                        : 'no proxy';
                    slot.innerHTML = `
                        <span class="verdict verdict-${cls}">${verdict}</span>
                        <span class="verify-meta">${egressLine} via ${proxyLine}</span>
                        <span class="verify-meta">${body.elapsedMs}ms</span>
                    `;
                }
            } catch (err) {
                slot.className = 'instance-row-verify error';
                slot.textContent = 'ERROR: ' + err.message;
            } finally {
                btn.disabled = false;
                btn.textContent = 'VERIFY';
            }
        });
    });

    // -- Toggle the ADD PROXY form --
    const toggleBtn = document.querySelector('.pool-add-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const form = document.querySelector('.pool-add-form');
            if (!form) return;
            const willShow = form.hidden;
            form.hidden = !willShow;
            if (willShow) {
                form.querySelector('[data-field="shorthand"]').focus();
            }
        });
    }

    // -- Cancel button on the add form --
    const cancelBtn = document.querySelector('.pool-add-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearAddForm();
            document.querySelector('.pool-add-form').hidden = true;
        });
    }

    // -- Submit the add form --
    const submitBtn = document.querySelector('.pool-add-submit');
    if (submitBtn) {
        submitBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const region = submitBtn.dataset.region;
            const form = document.querySelector('.pool-add-form');
            const resultEl = form.querySelector('.pool-add-result');
            const shorthand = form.querySelector('[data-field="shorthand"]').value.trim();
            const host = form.querySelector('[data-field="host"]').value.trim();
            const port = form.querySelector('[data-field="port"]').value.trim();
            const username = form.querySelector('[data-field="username"]').value.trim();
            const password = form.querySelector('[data-field="password"]').value;

            let payload = {};
            if (shorthand) {
                payload = { shorthand };
            } else if (host && port) {
                payload = { host, port: Number(port), username: username || undefined, password: password || undefined };
            } else {
                resultEl.className = 'pool-add-result error';
                resultEl.textContent = 'Provide either shorthand or host + port.';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'ADDING...';
            resultEl.className = 'pool-add-result pending';
            resultEl.textContent = 'Adding to pool...';

            try {
                const resp = await fetch(`/api/regions/${region}/pool/entries`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const body = await resp.json();
                if (!resp.ok || body.error) {
                    resultEl.className = 'pool-add-result error';
                    resultEl.textContent = `ERROR: ${body.error || 'HTTP ' + resp.status}`;
                } else {
                    const r = (body.results && body.results[0]) || {};
                    const added = !!r.added;
                    const slot = r.slot;
                    resultEl.className = 'pool-add-result success';
                    resultEl.innerHTML = added
                        ? `<b>ADDED</b> <code>${slot.host}:${slot.port}</code> - pool is now ${body.pool.used}/${body.pool.total} used`
                        : `<b>ALREADY IN POOL</b> <code>${(slot && slot.host)}:${(slot && slot.port)}</code> - no change`;
                    clearAddForm();
                    // Ask server to repoll now, then refresh UI
                    await pollFleet();
                }
            } catch (err) {
                resultEl.className = 'pool-add-result error';
                resultEl.textContent = 'ERROR: ' + err.message;
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'ADD TO POOL';
            }
        });
    }

    // -- Anti-ban v2 action buttons (pause / resume / reset) --
    document.querySelectorAll('.ab-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const region = btn.dataset.region;
            const instance = btn.dataset.instance;

            if (action === 'reset') {
                const ok = window.confirm(
                    'NUCLEAR RESET on instance ' + instance + ':\n\n' +
                    '• Warmup state wiped (next session starts fresh)\n' +
                    '• Rate-limit history wiped\n' +
                    '• Health score wiped\n' +
                    '• LID mappings KEPT\n' +
                    '• Stealth fingerprint KEPT\n\n' +
                    'Use only after a real ban. Continue?'
                );
                if (!ok) return;
            }

            const originalLabel = btn.textContent;
            btn.disabled = true;
            btn.textContent = '...';
            try {
                const resp = await fetch(`/api/regions/${region}/instances/${encodeURIComponent(instance)}/antiban-v2/${action}`, {
                    method: 'POST',
                });
                const body = await resp.json().catch(() => null);
                if (!resp.ok || (body && body.error)) {
                    alert('Action failed: ' + ((body && body.error) || 'HTTP ' + resp.status));
                } else {
                    await pollFleet();
                }
            } catch (err) {
                alert('Action failed: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = originalLabel;
            }
        });
    });

    // -- Remove a proxy slot --
    document.querySelectorAll('.proxy-remove-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const region = btn.dataset.region;
            const slotId = btn.dataset.slotId;
            const assigned = btn.dataset.assigned === '1';

            let confirmQ = '';
            if (assigned) {
                const ok = window.confirm(
                    `Slot ${slotId} is currently in use by an instance.\n\n` +
                    `Removing will cause that instance to reconnect (possibly direct or with a different pool proxy).\n\n` +
                    `Proceed?`
                );
                if (!ok) return;
                confirmQ = '?confirm=true';
            }

            btn.disabled = true;
            btn.textContent = '...';
            try {
                const resp = await fetch(
                    `/api/regions/${region}/pool/entries/${encodeURIComponent(slotId)}${confirmQ}`,
                    { method: 'DELETE' }
                );
                const body = await resp.json();
                if (!resp.ok || body.error) {
                    alert(`Failed to remove: ${body.error || body.message || 'HTTP ' + resp.status}`);
                    btn.disabled = false;
                    btn.textContent = '✕';
                    return;
                }
                await pollFleet();
            } catch (err) {
                alert('Remove failed: ' + err.message);
                btn.disabled = false;
                btn.textContent = '✕';
            }
        });
    });
}

function clearAddForm() {
    const form = document.querySelector('.pool-add-form');
    if (!form) return;
    form.querySelectorAll('input').forEach((i) => { i.value = ''; });
}

function instStatusClass(status) {
    if (status === 'connected') return 'healthy';
    if (status === 'connecting') return 'degraded';
    return 'offline';
}

/**
 * Render the anti-ban v2 status row for a single instance.
 *  - Risk badge (low/medium/high/critical) with colour
 *  - Warmup day chip (only if not complete)
 *  - Retry-spiral / bad-MAC badges if non-zero
 *  - PAUSE / RESUME / RESET buttons
 */
function renderAntibanV2Row(regionCode, instanceId, v2) {
    if (!v2) return '';
    const running = v2.running !== false;
    const enabled = v2.enabled !== false;

    if (!enabled) {
        return `
            <div class="instance-row-antiban">
                <span class="antiban-chip antiban-disabled">ANTI-BAN OFF</span>
            </div>
        `;
    }

    const risk = (v2.health && v2.health.risk) || (running ? 'low' : 'unknown');
    const riskScore = (v2.health && v2.health.score) || 0;
    const riskClass = `risk-${risk}`;

    const warmup = v2.warmup;
    const warmupChip = warmup && warmup.complete === false
        ? `<span class="antiban-chip warm-active">WARM ${warmup.day}/${warmup.totalDays} • ${warmup.todaySent}/${warmup.todayLimit}</span>`
        : `<span class="antiban-chip warm-done">WARM ✓</span>`;

    const retryChip = (v2.retryTracker && v2.retryTracker.spiralsDetected)
        ? `<span class="antiban-chip retry-warning">SPIRALS ${v2.retryTracker.spiralsDetected}</span>`
        : '';

    const badMacChip = (v2.sessionStability && v2.sessionStability.badMacCount > 0)
        ? `<span class="antiban-chip badmac">BAD MAC ${v2.sessionStability.badMacCount}</span>`
        : '';

    const pausedChip = v2.isPaused
        ? `<span class="antiban-chip paused">PAUSED</span>`
        : '';

    const presetLabel = v2.preset ? v2.preset.toUpperCase() : '';

    const buttons = running
        ? `
            <button class="ab-btn ab-pause" data-region="${regionCode}" data-instance="${escapeAttr(instanceId)}" data-action="${v2.isPaused ? 'resume' : 'pause'}">${v2.isPaused ? 'RESUME' : 'PAUSE'}</button>
            <button class="ab-btn ab-reset" data-region="${regionCode}" data-instance="${escapeAttr(instanceId)}" data-action="reset" title="Wipe state (use after a real ban)">RESET</button>
        `
        : `<span class="antiban-chip antiban-stale">offline</span>`;

    return `
        <div class="instance-row-antiban">
            <span class="risk-badge ${riskClass}">RISK ${risk.toUpperCase()}${riskScore ? ' (' + riskScore + ')' : ''}</span>
            ${presetLabel ? `<span class="antiban-chip preset-chip">${presetLabel}</span>` : ''}
            ${warmupChip}
            ${retryChip}
            ${badMacChip}
            ${pausedChip}
            <span class="antiban-counters">→ ${v2.messagesAllowed || 0} sent / ${v2.messagesBlocked || 0} blocked</span>
            <span class="antiban-actions">${buttons}</span>
        </div>
    `;
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function escapeAttr(s) {
    return escapeHtml(s);
}

// ---------------------------------------------------------------------------
// Fleet polling
// ---------------------------------------------------------------------------
async function pollFleet() {
    try {
        const resp = await fetch('/api/fleet');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const next = {};
        for (const r of data.regions) next[r.code] = r;
        next._polledAt = data.polledAt;
        state.fleet = next;

        for (const region of state.regions) {
            const s = state.fleet[region.code]?.status || 'unknown';
            updateMarkerStatus(region.code, s);
        }
        updateCountryStatus();
        updateSidebar();
        updateTopStats();
        if (state.selectedCode) selectRegion(state.selectedCode);
        document.getElementById('foot-link-status').textContent = 'ONLINE';
    } catch (err) {
        console.error('poll failed', err);
        document.getElementById('foot-link-status').textContent = 'LINK LOST';
    }
}

async function forcePoll() {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    btn.textContent = 'POLLING...';
    try {
        await fetch('/api/fleet/refresh', { method: 'POST' });
        await pollFleet();
    } finally {
        btn.disabled = false;
        btn.textContent = 'FORCE POLL';
    }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function formatUptime(seconds) {
    if (!seconds) return '-';
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d${h}h`;
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
}

function tickClock() {
    const now = new Date();
    const s = now.toISOString().slice(11, 19);
    document.getElementById('foot-clock').textContent = `${s} UTC`;
}

// ---------------------------------------------------------------------------
// Keys Vault — reveal/copy region API keys + bulk exports
// ---------------------------------------------------------------------------
const vaultState = {
    keys: null,        // { regions: [...], bashEnv, battlespaceToken }
    revealedAll: false,
};

async function initKeysVault() {
    try {
        const data = await fetch('/api/keys').then((r) => r.json());
        vaultState.keys = data;
        renderVaultList();
    } catch (err) {
        const list = document.getElementById('vault-list');
        if (list) list.innerHTML = '<div class="vault-empty">Failed to load keys</div>';
    }

    document.getElementById('vault-toggle-btn')?.addEventListener('click', () => {
        vaultState.revealedAll = !vaultState.revealedAll;
        const btn = document.getElementById('vault-toggle-btn');
        if (btn) btn.textContent = vaultState.revealedAll ? 'HIDE ALL' : 'REVEAL ALL';
        renderVaultList();
    });

    document.getElementById('vault-copy-bash')?.addEventListener('click', async () => {
        if (!vaultState.keys?.bashEnv) return;
        await navigator.clipboard.writeText(vaultState.keys.bashEnv);
        showVaultToast(`Copied ${vaultState.keys.regions.filter((r) => r.hasApiKey).length} regions as bash env`);
    });

    document.getElementById('vault-copy-json')?.addEventListener('click', async () => {
        if (!vaultState.keys) return;
        const safe = {
            regions: vaultState.keys.regions.map((r) => ({
                code: r.code,
                url: r.url,
                envKey: r.envKey,
                apiKey: r.apiKey,
            })),
        };
        await navigator.clipboard.writeText(JSON.stringify(safe, null, 2));
        showVaultToast('Copied JSON');
    });
}

function renderVaultList() {
    const list = document.getElementById('vault-list');
    if (!list || !vaultState.keys) return;
    list.innerHTML = '';

    for (const r of vaultState.keys.regions) {
        const row = document.createElement('div');
        row.className = `vault-row ${r.hasApiKey ? '' : 'no-key'}`;
        const masked = r.apiKey
            ? (vaultState.revealedAll ? r.apiKey : `${r.apiKey.slice(0, 6)}…${r.apiKey.slice(-4)}`)
            : 'NOT SET';
        const display = r.hasApiKey
            ? `<code class="vault-key" data-revealed="${vaultState.revealedAll}">${escapeHtml(masked)}</code>`
            : `<span class="vault-no-key">NOT SET</span>`;

        row.innerHTML = `
            <div class="vault-row-top">
                <span class="vault-region">${r.code.toUpperCase()}</span>
                <span class="vault-host">${escapeHtml(r.url.replace('https://', ''))}</span>
            </div>
            <div class="vault-row-bottom">
                ${display}
                ${r.hasApiKey ? `
                    <button class="vault-mini-btn" data-vault-action="copy" data-key="${escapeAttr(r.apiKey)}" title="Copy API key">COPY</button>
                    <button class="vault-mini-btn" data-vault-action="curl" data-region="${r.code}" data-key="${escapeAttr(r.apiKey)}" data-url="${escapeAttr(r.url)}" title="Copy curl preamble">CURL</button>
                ` : ''}
            </div>
        `;
        list.appendChild(row);
    }

    // Wire row-level actions
    list.querySelectorAll('button[data-vault-action="copy"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(btn.dataset.key);
            showVaultToast(`Copied API key`);
        });
    });
    list.querySelectorAll('button[data-vault-action="curl"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const preamble = `# ${btn.dataset.region.toUpperCase()}\nexport URL=${btn.dataset.url}\nexport KEY="${btn.dataset.key}"\ncurl -s "$URL/api/instances" -H "X-API-Key: $KEY" | jq`;
            await navigator.clipboard.writeText(preamble);
            showVaultToast('Copied curl preamble');
        });
    });
}

function showVaultToast(msg) {
    const toast = document.getElementById('vault-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.hidden = true; }, 1500);
}
