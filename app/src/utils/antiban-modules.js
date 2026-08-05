/**
 * Anti-ban module catalog — single source of truth for defaults, tooltips, and API schema.
 * Master switch is antibanV2.enabled (OFF by default). Each module can be toggled via
 * PUT /api/instances/:id/antiban-v2/config { modules: { <id>: { enabled: true|false } } }.
 */

/** Advanced pack flipped by enhancedMode convenience toggle */
export const ENHANCED_PACK_MODULE_IDS = [
    'groupOpGuard',
    'deafSession',
    'topologyThrottler',
    'instanceCoordinator',
    'deliveryAdaptive',
];

/**
 * @typedef {Object} AntibanModuleMeta
 * @property {string} id
 * @property {string} label
 * @property {'core'|'advanced'|'wasup'|'send'} group
 * @property {boolean} defaultEnabled
 * @property {string} effort
 * @property {string} impact
 * @property {string} tooltip
 * @property {boolean} [wired] - false = persisted only / reserved
 * @property {boolean} [perSend] - also controllable on individual /send calls
 */

/** @type {AntibanModuleMeta[]} */
export const ANTIBAN_MODULE_CATALOG = [
    // --- Core (classic wrap when antiban master ON) ---
    {
        id: 'warmup',
        label: 'Warm-up ramp',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'New numbers ramp from a low daily cap (~20) over ~7 days to full capacity. Prevents day-1 blast bans.',
    },
    {
        id: 'replyRatio',
        label: 'Reply-ratio guard',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'Blocks further outbound to contacts who almost never reply (spam signal). Cooldown after violations.',
    },
    {
        id: 'contactGraph',
        label: 'Contact-graph warmer',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'Requires 1:1 handshake before bulk/group sends, lurk period after joining groups, caps strangers/day.',
    },
    {
        id: 'presence',
        label: 'Presence choreographer',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'Medium',
        wired: true,
        tooltip: 'WPM-based typing simulation and circadian delay multipliers on sends (slower at night).',
    },
    {
        id: 'retryTracker',
        label: 'Retry spiral tracker',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'Medium',
        wired: true,
        tooltip: 'Detects messages stuck in encrypt/retry loops and stops hammering the same failing send.',
    },
    {
        id: 'reconnectThrottle',
        label: 'Post-reconnect throttle',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'After reconnect, ramps send rate from ~10% → 100% so you do not flood WA right after a socket recovery.',
    },
    {
        id: 'lidResolver',
        label: 'LID ↔ PN resolver',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'Canonicalizes chat IDs between @lid and phone JIDs to reduce Bad MAC / wrong-chat sends.',
    },
    {
        id: 'sessionStability',
        label: 'Session health (Bad MAC)',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'Medium',
        wired: true,
        tooltip: 'Watches decrypt failures; marks session degraded when Bad MACs spike.',
    },
    {
        id: 'stealthConnect',
        label: 'Stealth connect + presence ramp',
        group: 'core',
        defaultEnabled: true,
        effort: 'S',
        impact: 'Medium',
        wired: true,
        tooltip: 'Connects without snapping online; optionally ramps to available after a delay.',
    },

    // --- Advanced (default OFF) ---
    {
        id: 'groupOpGuard',
        label: 'Group operation guard',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'Rate-limits group add/create/remove to avoid account_reachout_restricted on group ops (TyreJobs etc.).',
    },
    {
        id: 'deafSession',
        label: 'Deaf-session detector',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'S',
        impact: 'High',
        wired: true,
        tooltip: 'Detects sockets that stay “alive” but stop delivering messages; ends the socket so reconnect can recover.',
    },
    {
        id: 'topologyThrottler',
        label: 'Topology throttler',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'High',
        wired: true,
        tooltip: 'Caps how fast you expand into new contacts (graph growth), beyond simple stranger/day limits.',
    },
    {
        id: 'instanceCoordinator',
        label: 'Cross-instance IP pool',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'Critical',
        wired: true,
        tooltip: 'Shared token bucket across instances on this worker so N bots on one IP do not look like N× the rate.',
    },
    {
        id: 'deliveryAdaptive',
        label: 'Delivery-adaptive rates',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'High',
        wired: true,
        tooltip: 'Tracks double-tick delivery; low delivery rate is treated as a soft-ban signal (slow down). Wired via library DeliveryTracker when wrap is live.',
    },
    {
        id: 'legitimacySignals',
        label: 'Legitimacy signals (typos)',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'Medium',
        wired: true,
        tooltip: 'Injects rare typos/corrections and mid-type pauses. Keep OFF for clinics/AI/RAG — can corrupt text.',
    },
    {
        id: 'humanEntropy',
        label: 'Human entropy (idle noise)',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'Medium',
        wired: true,
        tooltip: 'Idle typing / delayed reads / presence toggles so listen-only sessions look less bot-perfect. Conflicts with phone-push and Shared Devices — auto-skips when presence must stay passive.',
    },
    {
        id: 'contentVariator',
        label: 'Content variator (global)',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'S',
        impact: 'Medium',
        wired: true,
        perSend: true,
        tooltip: 'When ON, all text sends get invisible uniqueness (zero-width / punctuation). Prefer per-send contentVariation for marketing blasts so AI replies stay clean.',
    },
    {
        id: 'presenceCycling',
        label: 'Presence cycling',
        group: 'wasup',
        defaultEnabled: true,
        effort: 'S',
        impact: 'Medium',
        wired: true,
        tooltip: 'Wasup background available/unavailable cycling every few minutes (bot-native). Turn OFF with Shared Devices / phone push (already suppressed when passive).',
    },
    {
        id: 'conflict428Recover',
        label: '428 conflict recover (Wasup)',
        group: 'wasup',
        defaultEnabled: true,
        effort: 'S',
        impact: 'Critical',
        wired: true,
        tooltip: 'Library treats 428 as fatal. When ON (default), Wasup stands down / quiet-resumes or reclaim-reconnects instead of giving up. Turn OFF to follow library fatal semantics.',
    },
    {
        id: 'messageRecovery',
        label: 'Message recovery on reconnect',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'High',
        wired: false,
        tooltip: 'Reserved: fetch recent history after reconnect to fill gaps. Flag is persisted for rollout; runtime hook landing next.',
    },
    {
        id: 'credsSnapshot',
        label: 'Credential snapshots',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'High',
        wired: false,
        tooltip: 'Reserved: periodic auth snapshots for safer recovery without full QR. Persisted for rollout.',
    },
    {
        id: 'messageQueue',
        label: 'Paced message queue',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'High',
        wired: false,
        tooltip: 'Reserved: priority queue with retry/backoff for blast campaigns. Persisted for rollout.',
    },
    {
        id: 'scheduler',
        label: 'Business-hours scheduler',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'M',
        impact: 'Medium',
        wired: false,
        tooltip: 'Reserved: delay sends outside business hours / weekends. Persisted for rollout.',
    },
    {
        id: 'readReceiptVariance',
        label: 'Read-receipt variance',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'S',
        impact: 'Low',
        wired: false,
        tooltip: 'Reserved: humanize read timing. Conflicts with notification-max / phone push.',
    },
    {
        id: 'prometheusMetrics',
        label: 'Prometheus metrics',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'S',
        impact: 'High',
        wired: false,
        tooltip: 'Reserved: export antiban stats to /metrics for Battlespace. Persisted for rollout.',
    },
    {
        id: 'reputationVoucher',
        label: 'Reputation voucher',
        group: 'advanced',
        defaultEnabled: false,
        effort: 'L',
        impact: 'Low',
        wired: false,
        tooltip: 'Reserved: warm new SIMs via trusted accounts. Ops-heavy — leave off unless you run a vouch workflow.',
    },
];

export function catalogById() {
    return Object.fromEntries(ANTIBAN_MODULE_CATALOG.map((m) => [m.id, m]));
}

/** Build DEFAULT_V2_MODULES from catalog + known nested defaults */
export function buildDefaultModules() {
    const defaults = {};
    for (const m of ANTIBAN_MODULE_CATALOG) {
        defaults[m.id] = { enabled: m.defaultEnabled };
    }
    // Nested knobs for core modules
    Object.assign(defaults.warmup, { warmupDays: 7, day1Limit: 20, growthFactor: 1.8 });
    Object.assign(defaults.replyRatio, { minRatio: 0.10, minMessagesBeforeEnforce: 5, cooldownHoursOnViolation: 24 });
    Object.assign(defaults.contactGraph, {
        requireHandshakeBeforeGroupSend: true,
        handshakeMinDelayMs: 3600000,
        groupLurkPeriodMs: 43200000,
        maxStrangerMessagesPerDay: 5,
    });
    Object.assign(defaults.presence, {
        enableCircadianRhythm: true,
        circadianProfile: 'default',
        timezone: 'Europe/London',
        enableTypingModel: true,
        typingWPM: 45,
        typingWPMStdDev: 15,
    });
    Object.assign(defaults.retryTracker, { maxRetries: 5, spiralThreshold: 3 });
    Object.assign(defaults.reconnectThrottle, { rampDurationMs: 60000, initialRateMultiplier: 0.1, rampSteps: 6 });
    Object.assign(defaults.lidResolver, { canonical: 'pn' });
    Object.assign(defaults.sessionStability, { badMacThreshold: 3, badMacWindowMs: 60000 });
    Object.assign(defaults.stealthConnect, { presenceRampMinMs: 45000, presenceRampMaxMs: 120000 });
    Object.assign(defaults.deafSession, { timeoutMs: 5 * 60_000, minUptimeMs: 2 * 60_000, autoReconnect: true });
    Object.assign(defaults.topologyThrottler, {
        maxNewContactsPerHour: 5,
        maxNewContactsPerDay: 20,
        minReplyRatioForNewContacts: 0.3,
        maxSameGroupContacts: 10,
    });
    Object.assign(defaults.contentVariator, {
        zeroWidthChars: true,
        punctuationVariation: true,
        synonyms: false,
        emojiPadding: false,
    });
    Object.assign(defaults.humanEntropy, {
        minIntervalMs: 2 * 60 * 60 * 1000,
        maxIntervalMs: 6 * 60 * 60 * 1000,
    });
    return defaults;
}

export function mergeModules(partial = {}) {
    const base = buildDefaultModules();
    const out = { ...base };
    for (const [key, val] of Object.entries(partial || {})) {
        out[key] = { ...(base[key] || {}), ...(val || {}) };
    }
    return out;
}

export function isModuleEnabled(v2config, moduleId) {
    const modules = mergeModules(v2config?.modules);
    return modules[moduleId]?.enabled !== false && modules[moduleId]?.enabled !== undefined
        ? !!modules[moduleId].enabled
        : !!catalogById()[moduleId]?.defaultEnabled;
}

/** Strict: enabled only when explicitly true (for advanced defaults-off modules) */
export function isModuleOn(v2config, moduleId) {
    const modules = mergeModules(v2config?.modules);
    if (modules[moduleId]?.enabled === undefined) {
        return !!catalogById()[moduleId]?.defaultEnabled;
    }
    return !!modules[moduleId].enabled;
}

/**
 * Apply enhancedMode convenience: ON enables ENHANCED_PACK; OFF disables pack
 * unless the same request also sets those modules explicitly.
 */
export function applyEnhancedModePack(modules, enhancedMode, explicitModuleUpdates = {}) {
    const next = { ...modules };
    for (const id of ENHANCED_PACK_MODULE_IDS) {
        if (explicitModuleUpdates[id]?.enabled !== undefined) continue;
        next[id] = { ...(next[id] || {}), enabled: !!enhancedMode };
    }
    return next;
}

export function getModuleCatalogPayload(v2config = null) {
    const modules = mergeModules(v2config?.modules);
    return ANTIBAN_MODULE_CATALOG.map((meta) => ({
        ...meta,
        enabled: modules[meta.id]?.enabled !== undefined
            ? !!modules[meta.id].enabled
            : meta.defaultEnabled,
        config: modules[meta.id] || { enabled: meta.defaultEnabled },
    }));
}
