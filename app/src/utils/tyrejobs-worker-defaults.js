/**
 * wasup-tyrejobs worker defaults.
 *
 * Copied from live trial-Tyrejobs (`wa_mrscw48u_xfqds` on wasup3, 2026-08-27):
 * aggressive antiban v2 + bot-native behaviour. Token-only outbound is forced
 * on this worker. Opt-in CTA is hard-off — trial lines never send buttons.
 */

import { envEnabled } from './outbound-preflight.js';

export function isTyrejobsDedicatedWorker() {
    const id = String(process.env.WASUP_WORKER_ID || '').trim().toLowerCase();
    if (id === 'wasup-tyrejobs') return true;
    return envEnabled('WASUP_TYREJOBS_DEDICATED');
}

/** Legacy caps that trial-Tyrejobs actually ran with. */
export const TYREJOBS_TRIAL_ANTIBAN_SETTINGS = Object.freeze({
    preset: 'aggressive',
    messagesPerHour: 3000,
    messagesPerDay: 48000,
    uniqueChatsPerHour: 50,
    uniqueChatsPerDay: 500,
});

function trialAntibanModules() {
    return {
        warmup: { enabled: false, warmupDays: 7, day1Limit: 20, growthFactor: 1.8 },
        replyRatio: {
            enabled: false,
            minRatio: 0.1,
            minMessagesBeforeEnforce: 5,
            cooldownHoursOnViolation: 24,
        },
        contactGraph: {
            enabled: false,
            requireHandshakeBeforeGroupSend: true,
            handshakeMinDelayMs: 3600000,
            groupLurkPeriodMs: 43200000,
            maxStrangerMessagesPerDay: 5,
        },
        presence: {
            enabled: true,
            enableCircadianRhythm: true,
            circadianProfile: 'default',
            timezone: 'Europe/London',
            enableTypingModel: true,
            typingWPM: 45,
            typingWPMStdDev: 15,
        },
        retryTracker: { enabled: true, maxRetries: 5, spiralThreshold: 3 },
        reconnectThrottle: {
            enabled: true,
            rampDurationMs: 60000,
            initialRateMultiplier: 0.1,
            rampSteps: 6,
        },
        lidResolver: { enabled: true, canonical: 'pn' },
        sessionStability: { enabled: true, badMacThreshold: 3, badMacWindowMs: 60000 },
        stealthConnect: { enabled: true, presenceRampMinMs: 45000, presenceRampMaxMs: 120000 },
        groupOpGuard: { enabled: true },
        deafSession: {
            enabled: false,
            timeoutMs: 300000,
            minUptimeMs: 120000,
            autoReconnect: true,
        },
        topologyThrottler: {
            enabled: true,
            maxNewContactsPerHour: 5,
            maxNewContactsPerDay: 20,
            minReplyRatioForNewContacts: 0.3,
            maxSameGroupContacts: 10,
        },
        instanceCoordinator: { enabled: true },
        deliveryAdaptive: { enabled: true },
        legitimacySignals: { enabled: false },
        humanEntropy: { enabled: true, minIntervalMs: 7200000, maxIntervalMs: 21600000 },
        contentVariator: {
            enabled: true,
            zeroWidthChars: true,
            punctuationVariation: true,
            synonyms: false,
            emojiPadding: false,
        },
        presenceCycling: { enabled: true },
        conflict428Recover: { enabled: true },
        messageRecovery: { enabled: true },
        credsSnapshot: { enabled: true },
        messageQueue: { enabled: true },
        scheduler: { enabled: false },
        readReceiptVariance: { enabled: true },
        prometheusMetrics: { enabled: true },
        reputationVoucher: { enabled: false },
    };
}

export function buildTyrejobsTrialAntibanV2() {
    return {
        enabled: true,
        enhancedMode: true,
        preset: 'aggressive',
        overrides: { maxPerHour: 3000, maxPerDay: 48000 },
        modules: trialAntibanModules(),
        alertsWebhook: null,
        createdAt: new Date().toISOString(),
    };
}

export function tyrejobsDedicatedBehaviorDefaults() {
    return {
        typingSimulation: true,
        delayEnabled: false,
        phoneNotificationsEnabled: false,
        notificationGraceMs: 0,
        behaviorProfile: 'bot-native',
        multiDeviceCoexist: false,
        webhookTypingEvents: false,
        groupAlertMode: false,
        proactiveTcTokenCapture: true,
        coldOptInGate: true,
        blockColdWithoutToken: true,
        optInCtaOnce: false,
    };
}

/** Merge create-instance payload with wasup-tyrejobs defaults. */
export function applyTyrejobsWorkerCreateDefaults(config = {}) {
    if (!isTyrejobsDedicatedWorker()) return config;
    return {
        ...config,
        antiBanSettings: config.antiBanSettings || { ...TYREJOBS_TRIAL_ANTIBAN_SETTINGS },
        antibanV2: config.antibanV2 || buildTyrejobsTrialAntibanV2(),
        behaviorSettings: {
            ...tyrejobsDedicatedBehaviorDefaults(),
            ...(config.behaviorSettings || {}),
        },
    };
}
