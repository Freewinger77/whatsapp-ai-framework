/**
 * Anti-Ban v2 — Wasup integration layer for the multi-module anti-ban transport package
 *
 * Wraps the WhatsApp socket with the multi-module anti-ban pipeline:
 *   - RateLimiter with Gaussian jitter
 *   - WarmUp (7-day ramp for new numbers)
 *   - HealthMonitor (auto-pause on risk)
 *   - TimelockGuard (463 reachout-timelock detection)
 *   - ReplyRatioGuard (block low-engagement contacts)
 *   - ContactGraphWarmer (handshake before bulk/group)
 *   - PresenceChoreographer (WPM typing model + circadian)
 *   - RetryReasonTracker (retry spirals)
 *   - PostReconnectThrottle (10% → 100% ramp post-reconnect)
 *   - LidResolver + JidCanonicalizer (LID↔PN race fix)
 *   - SessionHealthMonitor (Bad MAC detection)
 *
 * State is persisted per-instance under instances/<id>/antiban/ via FileStateAdapter.
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';

import {
    AntiBan,
    LidResolver,
    JidCanonicalizer,
    FileStateAdapter,
    classifyDisconnect,
    getStealthSocketConfig,
    rampPresenceAfterConnect,
    AbortError,
    wrapSocket,
    STEALTH_BROWSER_POOL,
} from 'baileys-antiban';

// ----------------------------------------------------------------------------
// Defaults & preset mapping
// ----------------------------------------------------------------------------

/**
 * Map our legacy preset name (conservative/balanced/aggressive) to v2 preset.
 */
const LEGACY_PRESET_MAP = {
    conservative: 'conservative',
    balanced: 'moderate',
    aggressive: 'aggressive',
};

/**
 * Default v2 module flags. Every module can be flipped off per-instance.
 */
export const DEFAULT_V2_MODULES = {
    warmup:            { enabled: true, warmupDays: 7, day1Limit: 20, growthFactor: 1.8 },
    replyRatio:        { enabled: true, minRatio: 0.10, minMessagesBeforeEnforce: 5, cooldownHoursOnViolation: 24 },
    contactGraph:      { enabled: true, requireHandshakeBeforeGroupSend: true, handshakeMinDelayMs: 3600000, groupLurkPeriodMs: 43200000, maxStrangerMessagesPerDay: 5 },
    presence:          { enabled: true, enableCircadianRhythm: true, circadianProfile: 'default', timezone: 'Europe/London', enableTypingModel: true, typingWPM: 45, typingWPMStdDev: 15 },
    retryTracker:      { enabled: true, maxRetries: 5, spiralThreshold: 3 },
    reconnectThrottle: { enabled: true, rampDurationMs: 60000, initialRateMultiplier: 0.1, rampSteps: 6 },
    lidResolver:       { enabled: true, canonical: 'pn' },
    sessionStability:  { enabled: true, badMacThreshold: 3, badMacWindowMs: 60000 },
    stealthConnect:    { enabled: true, presenceRampMinMs: 45000, presenceRampMaxMs: 120000 },
};

/**
 * Map a legacy `antiBanSettings` object to a v2 config.
 * Existing connected instances keep their hourly/daily caps but get all the new
 * goodies (presence choreographer, LID resolver, etc.).
 */
export function legacyToV2Config(legacy = {}) {
    const preset = LEGACY_PRESET_MAP[legacy.preset] || 'moderate';
    return {
        enabled: true,
        preset,
        overrides: {
            ...(legacy.messagesPerHour ? { maxPerHour: legacy.messagesPerHour } : {}),
            ...(legacy.messagesPerDay ? { maxPerDay: legacy.messagesPerDay } : {}),
        },
        modules: { ...DEFAULT_V2_MODULES },
        alertsWebhook: null,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Build a flat config object accepted by `new AntiBan(...)` from our v2 shape.
 */
function buildAntiBanInput(v2config) {
    if (!v2config || !v2config.enabled) return undefined;
    return {
        preset: v2config.preset || 'moderate',
        ...(v2config.overrides || {}),
        logging: false, // we route through our own _log
    };
}

// ----------------------------------------------------------------------------
// Per-instance state directories
// ----------------------------------------------------------------------------

/**
 * Path to the antiban state folder for a given instance.
 */
export function antibanStatePath(instanceFolder) {
    return path.join(instanceFolder, 'antiban');
}

/**
 * Pick (or load) a sticky stealth fingerprint for an instance. Persisted so
 * the same instance reuses the same fingerprint across reconnects/restarts —
 * preventing fingerprint churn that itself looks suspicious.
 */
export async function pickOrLoadFingerprint(instanceFolder) {
    const file = path.join(antibanStatePath(instanceFolder), 'fingerprint.json');
    try {
        if (fsSync.existsSync(file)) {
            const data = JSON.parse(await fs.readFile(file, 'utf8'));
            if (Array.isArray(data.browser) && data.browser.length === 3) return data;
        }
    } catch (_) { /* fall through to fresh pick */ }

    // Pick a fresh fingerprint and persist it.
    const cfg = getStealthSocketConfig({ os: 'WhatsApp Multi' });
    const data = {
        browser: cfg.browser,
        markOnlineOnConnect: cfg.markOnlineOnConnect,
        chosenAt: new Date().toISOString(),
    };
    try {
        await fs.mkdir(antibanStatePath(instanceFolder), { recursive: true });
        await fs.writeFile(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.warn(`[antiban-v2] Could not persist fingerprint: ${err.message}`);
    }
    return data;
}

// ----------------------------------------------------------------------------
// Builder
// ----------------------------------------------------------------------------

/**
 * Build the v2 anti-ban context for an instance.
 *
 * Returns a long-lived object with all state needed for the lifecycle of a
 * single connect()→disconnect() cycle: the AntiBan instance, LidResolver,
 * JidCanonicalizer, state adapter, and a wrap() function that should be
 * called AFTER `makeWASocket` to wire up the wrappedSocket.
 *
 * @param {Object} opts
 * @param {string} opts.instanceId
 * @param {string} opts.instanceFolder      - absolute path to instances/<id>/
 * @param {Object} opts.v2config             - per-instance v2 config (see legacyToV2Config)
 * @param {Function} [opts.onLog]            - (msg, level) called for activity log
 * @param {Function} [opts.onRiskChange]     - called with healthStatus when risk changes
 */
export async function buildAntibanContext(opts) {
    const { instanceId, instanceFolder, v2config, onLog = () => {}, onRiskChange = () => {} } = opts;

    const stateDir = antibanStatePath(instanceFolder);
    await fs.mkdir(stateDir, { recursive: true });
    const adapter = new FileStateAdapter(stateDir);

    // --- Load persisted state (async, parallel) ---
    let [savedWarmup, savedLidMappings] = await Promise.all([
        adapter.load('warmup').catch(() => null),
        adapter.load('lid-mappings').catch(() => null),
    ]);

    // --- Validate warmup shape (transport WarmUpState) and drop if bogus ---
    // Expected: { startedAt: number, lastActiveAt: number, dailyCounts: number[], graduated: boolean }
    if (savedWarmup) {
        const ok = typeof savedWarmup.startedAt === 'number'
            && typeof savedWarmup.lastActiveAt === 'number'
            && Array.isArray(savedWarmup.dailyCounts)
            && typeof savedWarmup.graduated === 'boolean';
        if (!ok) {
            onLog(`Discarding malformed warmup state on disk (shape mismatch)`, 'warning');
            savedWarmup = null;
            await adapter.delete('warmup').catch(() => {});
        }
    }

    // --- One-time migration: seed v2 LID cache from legacy auth/lid-mapping.json ---
    // The legacy file stores { "lid": "pn" } (flat object); v2 stores [{ lid, pn }] (array).
    if (!savedLidMappings) {
        const legacyLidFile = path.join(instanceFolder, 'auth', 'lid-mapping.json');
        if (fsSync.existsSync(legacyLidFile)) {
            try {
                const raw = await fs.readFile(legacyLidFile, 'utf8');
                const flat = JSON.parse(raw);
                const arr = Object.entries(flat).map(([lid, pn]) => ({
                    lid: lid.includes('@') ? lid : `${lid}@lid`,
                    pn: pn.includes('@') ? pn : `${pn}@s.whatsapp.net`,
                }));
                if (arr.length > 0) {
                    savedLidMappings = arr;
                    await adapter.save('lid-mappings', arr).catch(() => {});
                    onLog(`Migrated ${arr.length} LID mappings from legacy cache`, 'info');
                }
            } catch (err) {
                console.warn(`[antiban-v2] Legacy LID migration failed: ${err.message}`);
            }
        }
    }

    // --- Migration: existing pre-v2 connected instances skip warmup ---
    // WarmUpState shape: { startedAt, lastActiveAt, dailyCounts[], graduated }.
    if (!savedWarmup && v2config?._skipWarmup) {
        const now = Date.now();
        const warmupDays = v2config?.modules?.warmup?.warmupDays || 7;
        savedWarmup = {
            startedAt: now - (warmupDays + 1) * 86_400_000, // started 8+ days ago
            lastActiveAt: now,
            dailyCounts: Array(warmupDays + 1).fill(0),
            graduated: true,
        };
        await adapter.save('warmup', savedWarmup).catch(() => {});
        onLog('Pre-v2 instance: warmup auto-marked complete (graduated)', 'info');
    }

    // --- Build the AntiBan instance ---
    const antibanInput = buildAntiBanInput(v2config);
    const antiban = new AntiBan(antibanInput, savedWarmup);

    // --- Wire health risk change callback ---
    let lastRisk = antiban.getStats().health?.risk;
    const checkRisk = () => {
        try {
            const stats = antiban.getStats();
            const risk = stats.health?.risk;
            if (risk && risk !== lastRisk) {
                onRiskChange({ from: lastRisk, to: risk, status: stats.health, full: stats });
                lastRisk = risk;
            }
        } catch (_) { /* ignore */ }
    };
    const riskInterval = setInterval(checkRisk, 10_000);

    // --- LID resolver with on-disk persistence ---
    let lidResolver = null;
    if (v2config?.modules?.lidResolver?.enabled !== false) {
        lidResolver = new LidResolver({
            canonical: v2config?.modules?.lidResolver?.canonical || 'pn',
            persistence: {
                load: async () => savedLidMappings || [],
                save: async (entries) => {
                    try {
                        await adapter.save('lid-mappings', entries);
                    } catch (err) {
                        console.warn(`[antiban-v2] LID save failed: ${err.message}`);
                    }
                },
            },
        });
    }

    // --- JID canonicalizer wired to the resolver ---
    const jidCanonicalizer = lidResolver
        ? new JidCanonicalizer({
            enabled: true,
            resolver: lidResolver,
            canonical: v2config?.modules?.lidResolver?.canonical || 'pn',
        })
        : null;

    // --- Periodic state save ---
    const saveAll = async () => {
        try {
            const warmupState = antiban.exportWarmUpState?.();
            if (warmupState) await adapter.save('warmup', warmupState);
        } catch (err) {
            console.warn(`[antiban-v2 ${instanceId}] state save failed: ${err.message}`);
        }
    };
    const saveInterval = setInterval(saveAll, 60_000);

    // --- destroy() cleans up timers + flushes state ---
    const destroy = async () => {
        clearInterval(riskInterval);
        clearInterval(saveInterval);
        try { await saveAll(); } catch (_) {}
        try { antiban.destroy?.(); } catch (_) {}
    };

    // --- wrap() takes the raw socket and returns the wrapped one ---
    const wrap = (rawSock) => {
        return wrapSocket(rawSock, antibanInput, savedWarmup);
    };

    onLog(`Anti-ban v2 ready: preset=${antibanInput?.preset || 'default'}, modules=${Object.keys(v2config?.modules || {}).filter(k => v2config.modules[k]?.enabled !== false).join(',')}`, 'info');

    return {
        antiban,
        lidResolver,
        jidCanonicalizer,
        adapter,
        wrap,
        saveAll,
        destroy,
        // Surface the chosen config for status endpoints
        config: v2config,
    };
}

// ----------------------------------------------------------------------------
// Disconnect classification helper (re-export with our log integration)
// ----------------------------------------------------------------------------

/**
 * Classify a disconnect status code and return our reconnect plan.
 * Returns { shouldReconnect, backoffMs, message, category }.
 */
export function planReconnect(statusCode, fallbackBackoffMs = 5000) {
    try {
        const c = classifyDisconnect(statusCode);
        return {
            shouldReconnect: !!c.shouldReconnect,
            backoffMs: c.backoffMs ?? fallbackBackoffMs,
            message: c.message || 'Unknown disconnect',
            category: c.category || 'unknown',
            raw: c,
        };
    } catch (_) {
        return {
            shouldReconnect: true,
            backoffMs: fallbackBackoffMs,
            message: `Disconnect ${statusCode}`,
            category: 'unknown',
            raw: null,
        };
    }
}

// ----------------------------------------------------------------------------
// Stealth presence ramp helper
// ----------------------------------------------------------------------------

/**
 * Ramp presence to 'available' after a randomized delay. Caller passes an
 * AbortController whose signal is aborted when the socket closes.
 */
export async function rampPresence(sock, abortSignal, opts = {}) {
    try {
        await rampPresenceAfterConnect(sock, {
            minDelayMs: opts.minDelayMs ?? 45_000,
            maxDelayMs: opts.maxDelayMs ?? 120_000,
            targetState: 'available',
            signal: abortSignal,
        });
        return { rampedAt: new Date().toISOString() };
    } catch (err) {
        if (err instanceof AbortError) {
            return { aborted: true };
        }
        throw err;
    }
}

// ----------------------------------------------------------------------------
// Convenience exports
// ----------------------------------------------------------------------------

export { STEALTH_BROWSER_POOL, getStealthSocketConfig, classifyDisconnect };

/** v2 preset rate-limit baselines (mirrors baileys-antiban presets). */
export const V2_PRESET_LIMITS = {
    conservative: { maxPerMinute: 5, maxPerHour: 100, maxPerDay: 800 },
    moderate: { maxPerMinute: 8, maxPerHour: 200, maxPerDay: 1500 },
    aggressive: { maxPerMinute: 12, maxPerHour: 400, maxPerDay: 4000 },
};

/** Map legacy dashboard preset names to v2 preset keys. */
export function legacyPresetToV2(preset) {
    return LEGACY_PRESET_MAP[preset] || preset || 'moderate';
}

/**
 * Apply config changes to a running AntiBan instance without reconnecting.
 * Returns which fields were hot-applied.
 */
export function applyLiveAntibanConfig(antibanCtx, v2config) {
    if (!antibanCtx?.antiban) {
        return { applied: false, reason: 'not_running' };
    }

    const ab = antibanCtx.antiban;
    const preset = v2config?.preset || 'moderate';
    const overrides = v2config?.overrides || {};
    const base = V2_PRESET_LIMITS[preset] || V2_PRESET_LIMITS.moderate;
    const applied = [];

    const rateLimiter = ab.rateLimiter || ab['rateLimiter'];
    if (rateLimiter?.config) {
        const next = {
            ...rateLimiter.config,
            maxPerMinute: overrides.maxPerMinute ?? base.maxPerMinute,
            maxPerHour: overrides.maxPerHour ?? overrides.messagesPerHour ?? base.maxPerHour,
            maxPerDay: overrides.maxPerDay ?? overrides.messagesPerDay ?? base.maxPerDay,
        };
        if (overrides.minDelayMs != null) next.minDelayMs = overrides.minDelayMs;
        if (overrides.maxDelayMs != null) next.maxDelayMs = overrides.maxDelayMs;
        rateLimiter.config = next;
        applied.push('rateLimiter');
    }

    const warmUp = ab.warmUp || ab['warmUp'];
    const warmupMod = v2config?.modules?.warmup;
    if (warmUp) {
        if (warmupMod?.enabled === false) {
            warmUp.state.graduated = true;
            warmUp.state.lastActiveAt = Date.now();
            applied.push('warmupDisabled');
        } else if (warmupMod) {
            if (warmupMod.warmupDays != null) warmUp.config.warmUpDays = warmupMod.warmupDays;
            if (warmupMod.day1Limit != null) warmUp.config.day1Limit = warmupMod.day1Limit;
            if (warmupMod.growthFactor != null) warmUp.config.growthFactor = warmupMod.growthFactor;
            applied.push('warmupConfig');
        }
    }

    return { applied: applied.length > 0, fields: applied };
}

/** Mark warm-up as graduated on a live AntiBan instance (removes day-1 ~20 msg cap). */
export function graduateWarmupLive(antibanCtx) {
    const warmUp = antibanCtx?.antiban?.warmUp || antibanCtx?.antiban?.['warmUp'];
    if (!warmUp) return false;
    warmUp.state.graduated = true;
    warmUp.state.lastActiveAt = Date.now();
    return true;
}
