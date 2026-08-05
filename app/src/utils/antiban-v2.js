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
 * Enhanced mode (opt-in, default OFF — existing instances unchanged):
 *   - GroupOperationGuard, DeafSessionDetector
 *   - TopologyThrottler, InstanceCoordinator (shared worker pool file)
 *   - DeliveryTracker / ban-recovery already present in 4.x AntiBan core
 *
 * State is persisted per-instance under instances/<id>/antiban/ via FileStateAdapter.
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { createRequire } from 'module';

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
    InstanceCoordinator,
    ContentVariator,
    HumanEntropyService,
} from 'baileys-antiban';

import {
    ANTIBAN_MODULE_CATALOG,
    ENHANCED_PACK_MODULE_IDS,
    buildDefaultModules,
    mergeModules,
    isModuleOn,
    applyEnhancedModePack,
    getModuleCatalogPayload,
} from './antiban-modules.js';

export {
    ANTIBAN_MODULE_CATALOG,
    ENHANCED_PACK_MODULE_IDS,
    mergeModules,
    isModuleOn,
    getModuleCatalogPayload,
    applyEnhancedModePack,
};
const require = createRequire(import.meta.url);
let ANTIBAN_LIBRARY_VERSION = 'unknown';
try {
    const resolved = require.resolve('baileys-antiban');
    // dist/cjs/index.js → ../../package.json
    const pkgPath = path.join(path.dirname(resolved), '..', '..', 'package.json');
    ANTIBAN_LIBRARY_VERSION = JSON.parse(fsSync.readFileSync(pkgPath, 'utf8')).version;
} catch (_) { /* ignore */ }

export { ANTIBAN_LIBRARY_VERSION };
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
 * Source of truth: antiban-modules.js catalog.
 */
export const DEFAULT_V2_MODULES = buildDefaultModules();

/**
 * Map a legacy `antiBanSettings` object to a v2 config.
 * Existing connected instances keep their hourly/daily caps but get all the new
 * goodies (presence choreographer, LID resolver, etc.).
 */
export function legacyToV2Config(legacy = {}) {
    const preset = LEGACY_PRESET_MAP[legacy.preset] || 'moderate';
    return {
        // Match wasup2 production defaults for new/demo instances (Ayaz etc.):
        // antiban OFF until an operator explicitly enables it.
        enabled: false,
        // Convenience pack for advanced modules — OFF by default.
        enhancedMode: false,
        preset,
        overrides: {
            ...(legacy.messagesPerHour ? { maxPerHour: legacy.messagesPerHour } : {}),
            ...(legacy.messagesPerDay ? { maxPerDay: legacy.messagesPerDay } : {}),
        },
        modules: buildDefaultModules(),
        alertsWebhook: null,
        createdAt: new Date().toISOString(),
    };
}

/** True when operator opted into the enhanced convenience pack (or any advanced module). */
export function isEnhancedAntibanMode(v2config) {
    if (v2config?.enhancedMode) return true;
    return ENHANCED_PACK_MODULE_IDS.some((id) => isModuleOn(v2config, id));
}

/**
 * Shared worker-level token-bucket file for InstanceCoordinator (enhanced mode).
 * One pool per VM so multiple instances on wasup3/etc. share an IP-level budget.
 */
export function sharedInstanceCoordinatorPath(instancesFolder) {
    return path.join(instancesFolder, '_shared', 'antiban-instance-pool.json');
}

/**
 * wrapSocket 4.x options — driven by individual module toggles.
 * 4.x defaults groupOpGuard + legitimacySignals to ON; we pass false unless enabled.
 */
export function buildWrapOptions(v2config) {
    const modules = mergeModules(v2config?.modules);
    const opts = {
        groupOpGuard: isModuleOn(v2config, 'groupOpGuard')
            ? (modules.groupOpGuard || {})
            : false,
        legitimacySignals: isModuleOn(v2config, 'legitimacySignals')
            ? (modules.legitimacySignals || {})
            : false,
    };
    if (isModuleOn(v2config, 'deafSession')) {
        opts.deafSession = {
            timeoutMs: modules.deafSession?.timeoutMs ?? 5 * 60_000,
            minUptimeMs: modules.deafSession?.minUptimeMs ?? 2 * 60_000,
            autoReconnect: modules.deafSession?.autoReconnect !== false,
        };
    }
    return opts;
}

/**
 * Build legacy nested config for wrapSocket/AntiBan from our v2 shape.
 * Module flags in v2config.modules are actually enforced (flat-only config ignored them).
 */
export function buildLegacyAntibanInput(v2config, { instancesFolder } = {}) {
    if (!v2config || !v2config.enabled) return undefined;

    const preset = v2config.preset || 'moderate';
    const overrides = v2config.overrides || {};
    const modules = mergeModules(v2config.modules);
    const base = V2_PRESET_LIMITS[preset] || V2_PRESET_LIMITS.moderate;
    const modOn = (name) => isModuleOn(v2config, name);

    const input = {
        logging: false,
        rateLimiter: {
            maxPerMinute: overrides.maxPerMinute ?? base.maxPerMinute,
            maxPerHour: overrides.maxPerHour ?? overrides.messagesPerHour ?? base.maxPerHour,
            maxPerDay: overrides.maxPerDay ?? overrides.messagesPerDay ?? base.maxPerDay,
            ...(overrides.minDelayMs != null ? { minDelayMs: overrides.minDelayMs } : {}),
            ...(overrides.maxDelayMs != null ? { maxDelayMs: overrides.maxDelayMs } : {}),
        },
        warmUp: {
            warmUpDays: modules.warmup?.warmupDays ?? 7,
            day1Limit: modules.warmup?.day1Limit ?? 20,
            growthFactor: modules.warmup?.growthFactor ?? 1.8,
        },
        replyRatio: {
            enabled: modOn('replyRatio'),
            minRatio: modules.replyRatio?.minRatio ?? 0.10,
            minMessagesBeforeEnforce: modules.replyRatio?.minMessagesBeforeEnforce ?? 5,
            cooldownHoursOnViolation: modules.replyRatio?.cooldownHoursOnViolation ?? 24,
        },
        contactGraph: {
            enabled: modOn('contactGraph'),
            requireHandshakeBeforeGroupSend: modules.contactGraph?.requireHandshakeBeforeGroupSend !== false,
            handshakeMinDelayMs: modules.contactGraph?.handshakeMinDelayMs ?? 3600000,
            groupLurkPeriodMs: modules.contactGraph?.groupLurkPeriodMs ?? 43200000,
            maxStrangerMessagesPerDay: modules.contactGraph?.maxStrangerMessagesPerDay ?? 5,
        },
        reconnectThrottle: {
            enabled: modOn('reconnectThrottle'),
            rampDurationMs: modules.reconnectThrottle?.rampDurationMs ?? 60_000,
            initialRateMultiplier: modules.reconnectThrottle?.initialRateMultiplier ?? 0.1,
            rampSteps: modules.reconnectThrottle?.rampSteps ?? 6,
        },
        presence: {
            enabled: modOn('presence'),
            enableCircadianRhythm: modules.presence?.enableCircadianRhythm !== false,
            circadianProfile: modules.presence?.circadianProfile || 'default',
            timezone: modules.presence?.timezone || 'Europe/London',
            enableTypingModel: modules.presence?.enableTypingModel !== false,
            typingWPM: modules.presence?.typingWPM ?? 45,
            typingWPMStdDev: modules.presence?.typingWPMStdDev ?? 15,
        },
        retryTracker: {
            enabled: modOn('retryTracker'),
            maxRetries: modules.retryTracker?.maxRetries ?? 5,
            spiralThreshold: modules.retryTracker?.spiralThreshold ?? 3,
        },
        sessionStability: {
            enabled: modOn('sessionStability'),
            badMacThreshold: modules.sessionStability?.badMacThreshold ?? 3,
            badMacWindowMs: modules.sessionStability?.badMacWindowMs ?? 60_000,
        },
    };

    if (modOn('topologyThrottler')) {
        input.topologyThrottler = {
            maxNewContactsPerHour: modules.topologyThrottler?.maxNewContactsPerHour ?? 5,
            maxNewContactsPerDay: modules.topologyThrottler?.maxNewContactsPerDay ?? 20,
            minReplyRatioForNewContacts: modules.topologyThrottler?.minReplyRatioForNewContacts ?? 0.3,
            maxSameGroupContacts: modules.topologyThrottler?.maxSameGroupContacts ?? 10,
        };
    }
    if (modOn('instanceCoordinator') && instancesFolder) {
        input.instanceCoordinator = modules.instanceCoordinator?.sharedFilePath
            || sharedInstanceCoordinatorPath(instancesFolder);
        input.instancePoolMaxPerMinute = modules.instanceCoordinator?.maxPerMinute
            ?? overrides.maxPerMinute
            ?? base.maxPerMinute;
        input.instancePoolMaxPerHour = modules.instanceCoordinator?.maxPerHour
            ?? overrides.maxPerHour
            ?? overrides.messagesPerHour
            ?? base.maxPerHour;
    }

    return input;
}

/**
 * Apply content variation to outbound text.
 * @param {string} text
 * @param {boolean|object} variation - true = use defaults; object = ContentVariator config
 * @param {object} [globalMod] - modules.contentVariator for defaults
 */
export function applyContentVariation(text, variation, globalMod = {}) {
    if (!text || typeof text !== 'string') return text;
    if (!variation) return text;
    const cfg = variation === true
        ? {
            zeroWidthChars: globalMod.zeroWidthChars !== false,
            punctuationVariation: globalMod.punctuationVariation !== false,
            synonyms: !!globalMod.synonyms,
            emojiPadding: !!globalMod.emojiPadding,
        }
        : {
            zeroWidthChars: variation.zeroWidthChars !== false,
            punctuationVariation: variation.punctuationVariation !== false,
            synonyms: !!variation.synonyms,
            emojiPadding: !!variation.emojiPadding,
        };
    try {
        return new ContentVariator(cfg).vary(text);
    } catch (_) {
        return text;
    }
}

/**
 * WaSP-shaped bridge so library HumanEntropyService can drive a Baileys socket.
 */
export function createBaileysEntropyBridge(getSocket) {
    const handlers = new Map();
    return {
        on(event, cb) {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(cb);
        },
        emit(event, payload) {
            for (const cb of handlers.get(event) || []) {
                try { cb(payload); } catch (_) { /* ignore */ }
            }
        },
        getProvider() {
            return { socket: typeof getSocket === 'function' ? getSocket() : getSocket };
        },
    };
}

export function startHumanEntropy({ getSocket, instanceId, moduleConfig = {}, onLog = () => {} }) {
    const bridge = createBaileysEntropyBridge(getSocket);
    const svc = new HumanEntropyService(bridge, instanceId, {
        enabled: true,
        minIntervalMs: moduleConfig.minIntervalMs,
        maxIntervalMs: moduleConfig.maxIntervalMs,
    });
    svc.start();
    onLog('Human entropy started', 'info');
    return {
        service: svc,
        bridge,
        stop() {
            try { svc.stop(); } catch (_) {}
        },
        trackInbound(msg) {
            try {
                bridge.emit('MESSAGE_RECEIVED', {
                    sessionId: instanceId,
                    data: {
                        fromMe: !!msg?.key?.fromMe,
                        from: msg?.key?.remoteJid,
                        chatId: msg?.key?.remoteJid,
                        id: msg?.key?.id,
                        key: msg?.key,
                        isGroup: String(msg?.key?.remoteJid || '').endsWith('@g.us'),
                    },
                });
            } catch (_) { /* ignore */ }
        },
    };
}

/** @deprecated alias — use buildLegacyAntibanInput */
function buildAntiBanInput(v2config, opts) {
    return buildLegacyAntibanInput(v2config, opts);
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

    if (v2config?.enabled === false) {
        onLog('Anti-ban v2 disabled — pipeline not built', 'info');
        return null;
    }

    const instancesFolder = path.dirname(instanceFolder);
    const stateDir = antibanStatePath(instanceFolder);
    await fs.mkdir(stateDir, { recursive: true });
    if (isModuleOn(v2config, 'instanceCoordinator')) {
        await fs.mkdir(path.join(instancesFolder, '_shared'), { recursive: true }).catch(() => {});
    }
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

    // --- Build a seed AntiBan for pre-wrap status; wrapSocket creates the live one.
    const antibanInput = buildAntiBanInput(v2config, { instancesFolder });
    const wrapOptions = buildWrapOptions(v2config);
    let liveAntiban = new AntiBan(antibanInput, savedWarmup);
    attachInstanceCoordinator(liveAntiban, antibanInput, v2config, onLog);

    // --- Wire health risk change callback ---
    let lastRisk = liveAntiban.getStats().health?.risk;
    const checkRisk = () => {
        try {
            const stats = liveAntiban.getStats();
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
            const warmupState = liveAntiban.exportWarmUpState?.();
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
        try { liveAntiban.destroy?.(); } catch (_) {}
    };

    // --- wrap() takes the raw socket and returns the wrapped one ---
    const wrap = (rawSock) => {
        // 4th arg is WrapSocketOptions (baileys-antiban 4.x). When enhancedMode is off
        // we explicitly disable groupOpGuard + legitimacySignals (4.x defaults them ON).
        const wrapped = wrapSocket(rawSock, antibanInput, savedWarmup, wrapOptions);
        // wrapSocket constructs its own AntiBan — that is the one that enforces sends.
        liveAntiban = wrapped.antiban;
        attachInstanceCoordinator(liveAntiban, antibanInput, v2config, onLog);
        // baileys-antiban 4.x bug: wrapped sendMessage(jid, content) with no 3rd arg
        // throws "Cannot read properties of undefined (reading 'circuitBreaker')" because
        // the library shadows wrapOptions with the Baileys send opts parameter.
        const libSend = wrapped.sendMessage.bind(wrapped);
        wrapped.sendMessage = (jid, content, opts) => libSend(jid, content, opts ?? {});
        return wrapped;
    };

    const enhanced = isEnhancedAntibanMode(v2config);
    onLog(
        `Anti-ban v2 ready (lib ${ANTIBAN_LIBRARY_VERSION}): preset=${antibanInput?.preset || 'default'}, `
        + `enhancedMode=${enhanced ? 'ON' : 'OFF'}, `
        + `modules=${Object.keys(v2config?.modules || {}).filter(k => v2config.modules[k]?.enabled !== false).join(',')}`,
        'info'
    );

    return {
        get antiban() { return liveAntiban; },
        lidResolver,
        jidCanonicalizer,
        adapter,
        wrap,
        wrapOptions,
        enhancedMode: enhanced,
        libraryVersion: ANTIBAN_LIBRARY_VERSION,
        saveAll,
        destroy,
        // Surface the chosen config for status endpoints
        config: v2config,
    };
}

function attachInstanceCoordinator(antiban, antibanInput, v2config, onLog) {
    if (
        !isModuleOn(v2config, 'instanceCoordinator')
        || !antibanInput?.instanceCoordinator
        || !antiban
        || antiban.instanceCoordinator
    ) {
        return;
    }
    try {
        antiban.instanceCoordinator = new InstanceCoordinator({
            sharedFilePath: antibanInput.instanceCoordinator,
            poolMaxPerMinute: antibanInput.instancePoolMaxPerMinute,
            poolMaxPerHour: antibanInput.instancePoolMaxPerHour,
        });
        onLog(`Instance coordinator attached: ${antibanInput.instanceCoordinator}`, 'info');
    } catch (err) {
        onLog(`Instance coordinator failed: ${err.message}`, 'warning');
    }
}

// ----------------------------------------------------------------------------
// Disconnect classification helper (re-export with our log integration)
// ----------------------------------------------------------------------------

/**
 * Classify a disconnect status code and return our reconnect plan.
 * Returns { shouldReconnect, backoffMs, message, category }.
 */
export function planReconnect(statusCode, fallbackBackoffMs = 5000) {
    // Baileys DisconnectReason.forbidden — WA rejected this companion. Never hammer reconnect.
    if (statusCode === 403) {
        return {
            shouldReconnect: false,
            backoffMs: fallbackBackoffMs,
            message: 'Forbidden (403) — WhatsApp rejected this companion session; stop auto-reconnect and wait before re-pairing',
            category: 'forbidden',
            raw: null,
        };
    }
    // 405 Method Not Allowed — baileys-antiban marks this fatal, but in practice it often
    // follows a 503/stream blip with auth intact. Manual reconnect works; auto-retry too.
    if (statusCode === 405) {
        return {
            shouldReconnect: true,
            backoffMs: Math.max(fallbackBackoffMs, 15_000),
            message: 'Method not allowed (405) — transient connection rejection; retrying with saved auth',
            category: 'recoverable',
            raw: null,
        };
    }
    try {
        const c = classifyDisconnect(statusCode);
        const category = c.category || 'unknown';
        const forbidden = statusCode === 403 || category === 'forbidden';
        return {
            shouldReconnect: forbidden ? false : !!c.shouldReconnect,
            backoffMs: c.backoffMs ?? fallbackBackoffMs,
            message: forbidden
                ? (c.message || 'Forbidden — WhatsApp rejected this companion session')
                : (c.message || 'Unknown disconnect'),
            category: forbidden ? 'forbidden' : category,
            raw: c,
        };
    } catch (_) {
        return {
            shouldReconnect: statusCode !== 403 && statusCode !== 401,
            backoffMs: fallbackBackoffMs,
            message: `Disconnect ${statusCode}`,
            category: statusCode === 403 ? 'forbidden' : 'unknown',
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

/** Resolve the limits that are actually in effect (saved config + live rate limiter). */
export function resolveEffectiveAntibanLimits(v2config, liveRateLimiterConfig = null) {
    if (!v2config) return null;
    const preset = v2config.preset || 'moderate';
    const base = V2_PRESET_LIMITS[preset] || V2_PRESET_LIMITS.moderate;
    const overrides = v2config.overrides || {};
    const live = liveRateLimiterConfig && typeof liveRateLimiterConfig === 'object'
        ? liveRateLimiterConfig
        : {};
    return {
        maxPerMinute: live.maxPerMinute ?? overrides.maxPerMinute ?? base.maxPerMinute,
        maxPerHour: live.maxPerHour ?? overrides.maxPerHour ?? overrides.messagesPerHour ?? base.maxPerHour,
        maxPerDay: live.maxPerDay ?? overrides.maxPerDay ?? overrides.messagesPerDay ?? base.maxPerDay,
    };
}

/** Normalize baileys-antiban limit keys for API/dashboard consumers. */
export function normalizeRateLimiterLimits(rawLimits, effectiveLimits = null) {
    if (!rawLimits && !effectiveLimits) return null;
    const src = rawLimits || {};
    const eff = effectiveLimits || {};
    const perHour = src.perHour ?? src.maxPerHour ?? eff.maxPerHour;
    const perDay = src.perDay ?? src.maxPerDay ?? eff.maxPerDay;
    const perMinute = src.perMinute ?? src.maxPerMinute ?? eff.maxPerMinute;
    return {
        perMinute,
        perHour,
        perDay,
        maxPerMinute: perMinute,
        maxPerHour: perHour,
        maxPerDay: perDay,
    };
}

/**
 * Apply config changes to a running AntiBan instance without reconnecting.
 * Returns which fields were hot-applied.
 */
export function applyLiveAntibanConfig(antibanCtx, v2config) {
    if (v2config?.enabled === false) {
        return { applied: true, fields: ['disabled'], bypassEnforcement: true };
    }

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
