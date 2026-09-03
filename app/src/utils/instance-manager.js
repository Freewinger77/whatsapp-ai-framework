/**
 * WhatsApp Instance Manager
 * 
 * Manages multiple WhatsApp connections with:
 * - Independent auth storage per instance
 * - Separate QR codes and connection states
 * - Per-instance webhook URLs and anti-ban settings
 * - Global default webhook URL fallback
 * - Full API control for external platform integration
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import NodeCache from 'node-cache';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, extensionForMediaMessage, fetchLatestBaileysVersion, Browsers } from 'baileys';
import baileysHelper from 'baileys_helper';
import { AntiBanManager, safeSendMessage, delay } from './anti-ban.js';
import { sendInteractiveViaHelper } from './interactive-sender.js';
import { storeMediaBuffer } from './media-storage.js';
import { isGroupJid, resolveSenderJid } from './message-sender-context.js';
import {
    createProxyAgent,
    getDeploymentDefaultProxy,
    parseProxyConfig,
    redactProxy,
    resolveEffectiveProxy,
} from './proxy.js';
import { ProxyPoolManager } from './proxy-pool.js';
import {
    buildAntibanContext,
    legacyToV2Config,
    legacyPresetToV2,
    applyLiveAntibanConfig,
    graduateWarmupLive,
    pickOrLoadFingerprint,
    planReconnect,
    rampPresence,
    DEFAULT_V2_MODULES,
    ANTIBAN_LIBRARY_VERSION,
    isEnhancedAntibanMode,
    isModuleOn,
    mergeModules,
    applyEnhancedModePack,
    applyContentVariation,
    startHumanEntropy,
    getModuleCatalogPayload,
} from './antiban-v2.js';
import {
    CONTACT_463_CIRCUIT_MS,
    circuitKeyForJid,
    createPrivacyTokenMetrics,
    lookupPrivacyToken,
    mirrorPrivacyTokenToJid,
    shouldBlockColdWithoutToken,
    storeTcTokenFromMessageNode,
    summarizeAuthTokenFiles,
} from './privacy-token-hardening.js';
import { normalizeMessageStatus, shouldAdvanceMessageStatus } from './message-status.js';
import {
    isTyrejobsColdOptInExclusive,
    normalizeJobReplyName,
    parseJobReplyAllowFile,
} from './tyrejobs-cold-opt-in.js';
import {
    applyTyrejobsWorkerCreateDefaults,
    isTyrejobsDedicatedWorker,
    TYREJOBS_TRIAL_ANTIBAN_SETTINGS,
} from './tyrejobs-worker-defaults.js';
import {
    armAfterConnect,
    isCtaBlockedByPostLimit,
    isPostLinkOutboundQuiet,
    isTyrejobsPostLimitLine,
    markLimited,
    noteRegisteredAt,
    parsePostLimitQuiet,
    resetRegisteredAt,
    serializePostLimitQuiet,
    POST_REGISTERED_QUIET_MS,
} from './tyrejobs-post-limit-quiet.js';
import {
    parseOptInCtaState,
    randomOptInCtaGapMs,
    serializeOptInCtaState,
} from './atk2-opt-in-cta.js';
import {
    interpretOnWhatsAppResult,
    isOnWhatsAppPreflightEnabled,
    isOutboundHardeningEnabled,
    ONWHATSAPP_CACHE_TTL_MS,
    ONWHATSAPP_TIMEOUT_MS,
    onWhatsAppCacheKey,
    parseOnWhatsAppCache,
    serializeOnWhatsAppCache,
} from './outbound-preflight.js';

const { sendButtons, sendInteractiveMessage } = baileysHelper;
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Bracketed error tag from the anti-ban transport guard (do not expose vendor names to API clients). */
function isAntibanTransportGuardMessage(msg) {
    return typeof msg === 'string' && /^\[[^\]]*-antiban[^\]]*\]/i.test(msg.trim());
}

/** Strip third-party library names from strings returned to API clients or shown in operator-facing logs. */
function redactTechVendorNames(s) {
    if (typeof s !== 'string') return s;
    return s
        .replace(/baileys-antiban/gi, 'Wasup anti-ban')
        .replace(/baileys_helper/gi, 'Wasup interactive helper')
        .replace(/\bBaileys\b/gi, 'WhatsApp transport');
}

/** Client-safe reason when the anti-ban transport guard blocks a send. */
const API_ANTIBAN_BLOCK_REASON = 'Wasup anti-ban policy blocked this send.';

function sanitizeClientReason(r) {
    if (typeof r !== 'string') return r;
    if (isAntibanTransportGuardMessage(r)) return API_ANTIBAN_BLOCK_REASON;
    return redactTechVendorNames(r);
}

function isProtocolMismatchDisconnect(plan = {}) {
    const haystack = [
        plan.message,
        plan.category,
        plan.raw?.message,
        plan.raw?.category,
        plan.raw?.reason,
    ].filter(Boolean).join(' ');

    return /client\s+too\s+old|protocol\s+mismatch|restart\s+required/i.test(haystack);
}

// Silent socket logger (reduces noise, improves stealth)
const logger = pino({ level: 'silent' });

let cachedBaileysVersion = null;
let cachedBaileysVersionAt = 0;
const BAILEYS_VERSION_CACHE_MS = 6 * 60 * 60 * 1000;
const BAILEYS_VERSION_TIMEOUT_MS = 5000;
const STALE_PROTOCOL_PAIRING_RETRY_LIMIT = 2;
const PAIRING_RECONNECT_DELAY_MS = 1500;
const POST_SCAN_LINK_GRACE_MS = 90 * 1000;
const CONNECT_REPLACED_RETRY_DELAY_MS = 10_000;
const CONFLICT_RECONNECT_MAX_ATTEMPTS = Math.max(
    1,
    Number.parseInt(process.env.WA_CONFLICT_RECONNECT_MAX_ATTEMPTS || '8', 10) || 8,
);
/**
 * Shared-devices stand-down: don't fight staff Web, but quietly retry later
 * so clinic bots don't stay offline forever after a 428.
 */
const SHARED_DEVICE_RESUME_BASE_MS = Math.max(
    60_000,
    Number.parseInt(process.env.WA_SHARED_DEVICE_RESUME_BASE_MS || '120000', 10) || 120_000,
);
const SHARED_DEVICE_RESUME_MAX_MS = Math.max(
    SHARED_DEVICE_RESUME_BASE_MS,
    Number.parseInt(process.env.WA_SHARED_DEVICE_RESUME_MAX_MS || '1800000', 10) || 1_800_000,
);
const SHARED_DEVICE_RESUME_MAX_ATTEMPTS = Math.max(
    1,
    Number.parseInt(process.env.WA_SHARED_DEVICE_RESUME_MAX_ATTEMPTS || '24', 10) || 24,
);
/** Demo + TyreJobs (trial/ATK/ATK2) 428: 20–50s, then 1–5m, then 30m, then stop. */
const DEMO_RESUME_MAX_ATTEMPTS = 3;
/** Cap generic auto-reconnect (405/503/etc) so we don't hammer WhatsApp forever. */
const GENERIC_RECONNECT_MAX_ATTEMPTS = Math.max(
    1,
    Number.parseInt(process.env.WA_RECONNECT_MAX_ATTEMPTS || '8', 10) || 8,
);
const GENERIC_RECONNECT_MAX_DELAY_MS = Math.max(
    15_000,
    Number.parseInt(process.env.WA_RECONNECT_MAX_DELAY_MS || '300000', 10) || 300_000,
);
/** Space startup auto-reconnects so a worker bounce does not mass re-auth. */
const STARTUP_RECONNECT_STAGGER_MS = Math.max(
    1_000,
    Number.parseInt(process.env.WA_STARTUP_RECONNECT_STAGGER_MS || '8000', 10) || 8_000,
);
const STARTUP_RECONNECT_JITTER_MS = Math.max(
    0,
    Number.parseInt(process.env.WA_STARTUP_RECONNECT_JITTER_MS || '3000', 10) || 3_000,
);
/** Extra cross-instance offset on runtime reconnects (conflict / recoverable). */
const RUNTIME_RECONNECT_STAGGER_MS = Math.max(
    0,
    Number.parseInt(process.env.WA_RUNTIME_RECONNECT_STAGGER_MS || '5000', 10) || 5_000,
);
const QR_CODE_TTL_MS = 110_000;
/** Hold /api/send until SERVER_ACK/NACK. Timeout with a real WA id is sent, not failed. */
const OUTBOUND_ACK_WAIT_MS = 60_000;
/** How often to re-check ack maps while the HTTP request is held. */
const OUTBOUND_ACK_POLL_MS = 2_000;

/**
 * Stable egress fingerprint for risk scoring.
 * Direct (no proxy) instances share one fingerprint on this worker — Meta sees one Azure egress.
 */
function proxyFingerprintKeyFromResolved(resolved) {
    if (!resolved || resolved.source === 'disabled' || resolved.source === 'none' || !resolved.config) {
        return 'direct';
    }
    const host = resolved.config.host || null;
    const port = resolved.config.port || null;
    if (host && port) return `${host}:${port}`;
    if (host) return String(host);
    return 'direct';
}

function classifyFingerprintRisk(sharedWith) {
    const n = Math.max(0, Number(sharedWith) || 0);
    // sharedWith = number of OTHER instances on the same fingerprint
    if (n <= 2) return 'low';
    if (n <= 4) return 'amber';
    return 'high';
}

function stableInstanceSlot(instanceId, modulo) {
    const mod = Math.max(1, modulo | 0);
    const s = String(instanceId || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % mod;
}

async function getCurrentBaileysVersion() {
    const now = Date.now();
    if (cachedBaileysVersion && now - cachedBaileysVersionAt < BAILEYS_VERSION_CACHE_MS) {
        return cachedBaileysVersion;
    }

    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Baileys version lookup timed out')), BAILEYS_VERSION_TIMEOUT_MS);
    });
    const result = await Promise.race([fetchLatestBaileysVersion(), timeout]);
    if (!Array.isArray(result?.version)) {
        throw new Error('Baileys version lookup returned no version');
    }
    cachedBaileysVersion = result.version;
    cachedBaileysVersionAt = now;
    return cachedBaileysVersion;
}

function summarizeConnectionUpdate(update = {}) {
    const boom = update.lastDisconnect?.error;
    const output = boom?.output || {};
    const payload = output.payload || {};
    return {
        connection: update.connection || null,
        hasQr: !!update.qr,
        receivedPendingNotifications: update.receivedPendingNotifications,
        isNewLogin: update.isNewLogin,
        statusCode: output.statusCode || null,
        error: boom?.message || payload.message || null,
        reason: payload.reason || null,
        boom: boom ? {
            name: boom.name || null,
            isBoom: !!boom.isBoom,
            statusCode: output.statusCode || null,
            error: payload.error || null,
            message: payload.message || null,
            reason: payload.reason || null,
        } : null,
    };
}

function summarizeCredsUpdate(creds = {}) {
    return {
        keys: Object.keys(creds).sort(),
        registered: !!creds.registered,
        hasMe: !!creds.me,
        hasAccount: !!creds.account,
        hasSignalIdentities: Array.isArray(creds.signalIdentities) && creds.signalIdentities.length > 0,
        hasProcessedHistoryMessages: Array.isArray(creds.processedHistoryMessages) && creds.processedHistoryMessages.length > 0,
        hasPlatform: !!creds.platform,
        hasAccountSyncCounter: creds.accountSyncCounter !== undefined,
        hasAdvSecretKey: !!creds.advSecretKey,
        hasNoiseKey: !!creds.noiseKey,
    };
}

/**
 * Generate a UUID v4
 */
function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Normalize phone number - remove leading + and non-digit characters
 */
function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
}

function normalizeConnectedPhoneIdentity(identity) {
    if (!identity || typeof identity !== 'string' || /@lid\b/i.test(identity)) return null;
    const localPart = identity.trim().split('@')[0].split(':')[0];
    const digits = normalizePhone(localPart).replace(/[^\d]/g, '');
    return digits.length >= 6 && digits.length <= 20 ? digits : null;
}

// Base paths
const INSTANCES_FOLDER = path.join(__dirname, '../../instances');
const INSTANCES_DB_FILE = path.join(INSTANCES_FOLDER, 'instances.json');
const PROXY_POOL_FILE = path.join(INSTANCES_FOLDER, 'proxy-pool.json');

// Global default webhook URL (from environment)
const DEFAULT_WEBHOOK_URL = process.env.DEFAULT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';

const BEHAVIOR_PROFILES = {
    BOT_NATIVE: 'bot-native',
    NOTIFICATION_BALANCED: 'notification-balanced',
    NOTIFICATION_MAX: 'notification-max',
};

const DEFAULT_NOTIFICATION_GRACE_MS = 12_000;
const MAX_NOTIFICATION_GRACE_MS = 120_000;

function clampNotificationGraceMs(value, fallback = DEFAULT_NOTIFICATION_GRACE_MS) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(MAX_NOTIFICATION_GRACE_MS, Math.round(n)));
}

function normalizeBehaviorProfile(settings = {}, previous = {}) {
    const requested = settings.behaviorProfile || settings.profile;
    if (Object.values(BEHAVIOR_PROFILES).includes(requested)) return requested;

    // Phone-push toggle alone must not rewrite the behaviour profile.
    if (
        settings.phoneNotificationsEnabled !== undefined
        && settings.behaviorProfile === undefined
        && settings.profile === undefined
        && Object.values(BEHAVIOR_PROFILES).includes(previous.behaviorProfile)
    ) {
        return previous.behaviorProfile;
    }

    if (
        settings.phoneNotificationsEnabled === undefined
        && settings.typingSimulation === undefined
        && Object.values(BEHAVIOR_PROFILES).includes(previous.behaviorProfile)
    ) {
        return previous.behaviorProfile;
    }

    // Backward compatibility: older clients only knew phoneNotificationsEnabled.
    const phoneNotificationsEnabled = settings.phoneNotificationsEnabled !== undefined
        ? !!settings.phoneNotificationsEnabled
        : !!previous.phoneNotificationsEnabled;
    const typingSimulation = settings.typingSimulation !== undefined
        ? !!settings.typingSimulation
        : previous.typingSimulation;

    if (phoneNotificationsEnabled) {
        return typingSimulation === false
            ? BEHAVIOR_PROFILES.NOTIFICATION_MAX
            : BEHAVIOR_PROFILES.NOTIFICATION_BALANCED;
    }
    return BEHAVIOR_PROFILES.BOT_NATIVE;
}

function normalizeBehaviorSettings(settings = {}, previous = {}) {
    const behaviorProfile = normalizeBehaviorProfile(settings, previous);
    const profileDefaults = {
        [BEHAVIOR_PROFILES.BOT_NATIVE]: {
            typingSimulation: true,
            delayEnabled: false,
            phoneNotificationsEnabled: false,
            notificationGraceMs: 0,
        },
        [BEHAVIOR_PROFILES.NOTIFICATION_BALANCED]: {
            typingSimulation: true,
            delayEnabled: true,
            phoneNotificationsEnabled: true,
            notificationGraceMs: DEFAULT_NOTIFICATION_GRACE_MS,
        },
        [BEHAVIOR_PROFILES.NOTIFICATION_MAX]: {
            typingSimulation: false,
            delayEnabled: true,
            phoneNotificationsEnabled: true,
            notificationGraceMs: DEFAULT_NOTIFICATION_GRACE_MS,
        },
    }[behaviorProfile];

    const merged = {
        ...profileDefaults,
        ...previous,
        ...settings,
        behaviorProfile,
    };

    const profileChanged = previous.behaviorProfile && previous.behaviorProfile !== behaviorProfile;
    merged.typingSimulation = settings.typingSimulation !== undefined
        ? !!settings.typingSimulation
        : (profileChanged || previous.typingSimulation === undefined ? !!profileDefaults.typingSimulation : !!previous.typingSimulation);
    merged.delayEnabled = settings.delayEnabled !== undefined
        ? !!settings.delayEnabled
        : (profileChanged || previous.delayEnabled === undefined ? !!profileDefaults.delayEnabled : !!previous.delayEnabled);
    // Phone push / stay-offline can be toggled independently of the profile
    // (e.g. bot-native + keep phone push). Notification profiles still default it on.
    if (settings.phoneNotificationsEnabled !== undefined) {
        merged.phoneNotificationsEnabled = !!settings.phoneNotificationsEnabled;
    } else if (profileChanged) {
        merged.phoneNotificationsEnabled = behaviorProfile !== BEHAVIOR_PROFILES.BOT_NATIVE;
    } else if (previous.phoneNotificationsEnabled !== undefined) {
        merged.phoneNotificationsEnabled = !!previous.phoneNotificationsEnabled;
    } else {
        merged.phoneNotificationsEnabled = behaviorProfile !== BEHAVIOR_PROFILES.BOT_NATIVE;
    }
    // Selecting a notification profile always implies phone push.
    if (
        (settings.behaviorProfile !== undefined || settings.profile !== undefined)
        && behaviorProfile !== BEHAVIOR_PROFILES.BOT_NATIVE
    ) {
        merged.phoneNotificationsEnabled = true;
    }
    merged.notificationGraceMs = clampNotificationGraceMs(
        settings.notificationGraceMs !== undefined ? settings.notificationGraceMs : merged.notificationGraceMs,
        profileDefaults.notificationGraceMs
    );

    if (behaviorProfile === BEHAVIOR_PROFILES.NOTIFICATION_MAX) {
        merged.typingSimulation = false;
    }

    // Orthogonal to behavior profiles: clinic/staff Web coexistence (default off).
    merged.multiDeviceCoexist = settings.multiDeviceCoexist !== undefined
        ? !!settings.multiDeviceCoexist
        : (previous.multiDeviceCoexist !== undefined ? !!previous.multiDeviceCoexist : false);

    // Forward Baileys presence/typing updates to the instance webhook (default off).
    merged.webhookTypingEvents = settings.webhookTypingEvents !== undefined
        ? !!settings.webhookTypingEvents
        : (previous.webhookTypingEvents !== undefined ? !!previous.webhookTypingEvents : false);

    // Group alert mode (default off): keep inbound webhooks flowing for groups /
    // handoff maps — for tyrejobs-style numbers that sit in many groups.
    merged.groupAlertMode = settings.groupAlertMode !== undefined
        ? !!settings.groupAlertMode
        : (previous.groupAlertMode !== undefined ? !!previous.groupAlertMode : false);

    // Orthogonal: capture inbound `<tctoken>` on message stanzas (Baileys PR #2752 / #2698).
    // Default ON fleet-wide so a reply stores a token for later outbound.
    // Does not mint tokens for cold outbound.
    merged.proactiveTcTokenCapture = settings.proactiveTcTokenCapture !== undefined
        ? !!settings.proactiveTcTokenCapture
        : (previous.proactiveTcTokenCapture !== undefined ? !!previous.proactiveTcTokenCapture : true);

    // TyreJobs-only on shared workers. On wasup-tyrejobs default ON (token hold).
    const dedicated = isTyrejobsDedicatedWorker();
    merged.coldOptInGate = settings.coldOptInGate !== undefined
        ? !!settings.coldOptInGate
        : (previous.coldOptInGate !== undefined ? !!previous.coldOptInGate : dedicated);

    // Default OFF elsewhere. On wasup-tyrejobs: never send without a tctoken.
    merged.blockColdWithoutToken = settings.blockColdWithoutToken !== undefined
        ? !!settings.blockColdWithoutToken
        : (previous.blockColdWithoutToken !== undefined ? !!previous.blockColdWithoutToken : dedicated);

    // Hard-off. Trial / ATK / ATK2 never send CTA buttons, even if a client asks.
    merged.optInCtaOnce = false;

    // Default OFF. On = return /send as soon as Baileys mints an id (no 60s SERVER_ACK wait).
    // Still one-shot: doNotRetry. Companion sockets often never ACK (Samantha / dental / Content Crew).
    merged.skipOutboundAckWait = settings.skipOutboundAckWait !== undefined
        ? !!settings.skipOutboundAckWait
        : (previous.skipOutboundAckWait !== undefined ? !!previous.skipOutboundAckWait : false);

    return merged;
}

/**
 * Single WhatsApp Instance
 */
class WhatsAppInstance {
    constructor(config) {
        this.id = config.id;
        this.name = config.name || `Instance ${config.id}`;
        this.webhookUrl = config.webhookUrl || '';
        this.webhookSigningSecret = String(config.webhookSigningSecret || '').trim();
        this.createdAt = config.createdAt || new Date().toISOString();

        // Per-instance proxy override (null = inherit deployment default from env vars)
        // Shape: { enabled: boolean, type, host, port, username?, password? }
        //   - enabled=false  -> explicitly disable (ignore deployment default)
        //   - enabled=true   -> use this instance-specific proxy
        //   - null/undefined -> fall back to deployment default (DEFAULT_PROXY_URL env var)
        this.proxy = this._normalizeProxy(config.proxy);
        /** Set by InstanceManager so reconnects can stagger across the fleet. */
        this.manager = null;

        // Anti-ban v2 (Wasup transport anti-ban pipeline)
        // Per-instance config block. If absent, derived from legacy antiBanSettings
        // on first connect. See docs/ANTIBAN_V2_DESIGN.md.
        this.antibanV2 = config.antibanV2 || null;
        // Runtime context (built per-connect, destroyed on disconnect)
        this.antibanCtx = null;
        /** When false, config is saved but wrapped socket must not intercept sends. */
        this._antibanV2Enforcing = config.antibanV2?.enabled !== false;
        // AbortController for stealth presence ramp (cancelled on disconnect)
        this.presenceRampAbort = null;
        
        // Connection state
        this.socket = null;
        this.rawSocket = null;
        this.status = 'disconnected'; // disconnected | connecting | connected
        this.qrCode = null;
        this.qrContent = null;
        this.qrCodeUpdatedAt = null;
        this.qrVersion = 0;
        this.qrRefreshRestartCount = 0;
        this.staleProtocolResetCount = 0;
        this.pairingRestartTimer = null;
        this.conflictReconnectTimer = null;
        this.conflictReconnectAttempts = 0;
        this.sharedDeviceResumeTimer = null;
        this.sharedDeviceResumeAttempts = 0;
        this.genericReconnectAttempts = 0;
        this.activeConnectGeneration = 0;
        this.connectInFlight = false;
        this._logoutFreshQrAttempted = false;
        this.qrScanReceivedAt = null;
        this.linkingGraceUntil = null;
        this.lastPairingUpdateAt = null;
        this.lastCredsUpdateAt = null;
        this.lastCredsUpdateSummary = null;
        this.pairingCode = null; // For pairing code login (alternative to QR)
        this.connectedPhone = null;
        this.connectedAt = null;
        this.connectionIssue = null;
        
        // Message deduplication (prevent processing same message multiple times)
        this.processedMessages = new Set();
        this.maxProcessedMessages = 1000; // Keep last 1000 message IDs
        
        // LID to PN mapping cache (persistent fallback) - initialized after authFolder is set
        this.lidCache = new Map();
        
        // Saved contacts cache (to avoid re-saving contacts we've already saved)
        this.savedContacts = new Set();
        
        // Behavior profiles control how much the linked device acts like an
        // active reader versus preserving handset notifications.
        this.behaviorSettings = normalizeBehaviorSettings(config.behaviorSettings || {});
        this._clampColdOptInGate();
        
        // Anti-ban settings
        this.antiBanSettings = config.antiBanSettings || (isTyrejobsDedicatedWorker()
            ? { ...TYREJOBS_TRIAL_ANTIBAN_SETTINGS }
            : {
                preset: 'balanced',
                messagesPerHour: 200,
                messagesPerDay: 5000,
                uniqueChatsPerHour: 50,
                uniqueChatsPerDay: 500
            });
        this.antiBanManager = new AntiBanManager(this.antiBanSettings);
        
        // Paths
        this.authFolder = path.join(INSTANCES_FOLDER, this.id, 'auth');
        this.logsFolder = path.join(INSTANCES_FOLDER, this.id, 'logs');
        this.lidCacheFile = path.join(this.authFolder, 'lid-mapping.json');
        this.savedContactsFile = path.join(this.authFolder, 'saved-contacts.json');
        this.jobReplyAllowFile = path.join(INSTANCES_FOLDER, this.id, 'job-reply-allow.json');
        this.jobReplyAllowByPhone = new Map(); // phone digits -> { name, phone, repliedAt }
        this.optInCtaFile = path.join(INSTANCES_FOLDER, this.id, 'opt-in-cta.json');
        this.optInCtaByPhone = new Map();
        this.optInCtaLastSentAt = 0;
        this.optInCtaNextAllowedAt = 0;
        this.optInCtaLastVariant = null;
        this.postLimitQuietFile = path.join(INSTANCES_FOLDER, this.id, 'post-limit-quiet.json');
        this.postLimitQuiet = parsePostLimitQuiet(null);
        this.onWhatsAppCacheFile = path.join(INSTANCES_FOLDER, this.id, 'onwhatsapp-cache.json');
        this.onWhatsAppCache = new Map();
        this._onWhatsAppChain = Promise.resolve();
        
        // Activity log (in-memory, capped)
        this.activityLog = [];
        
        // Message history (in-memory, capped) for inbound/outbound tracking
        this.messageHistory = [];
        this.maxMessageHistory = 1000;
        
        // ========================================
        // ANTI-BAN: transport-recommended caches
        // ========================================
        
        // Group metadata cache - CRITICAL: Prevents rate limits when sending to groups
        // From transport docs: unbounded caches cause ratelimits and risk flags
        this.groupMetadataCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 min TTL
        
        // User devices cache - Reduces device list API calls
        this.userDevicesCache = new NodeCache({ stdTTL: 600, checkperiod: 120 }); // 10 min TTL
        
        // Message retry counter cache - Prevents retry storms
        this.msgRetryCounterCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 }); // 30 min TTL
        
        // Media cache - Prevents repeated uploads
        this.mediaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // 1 hour TTL
        
        // Message store - For getMessage function (retry handling)
        this.messageStore = new Map();
        this.maxStoredMessages = 1000;

        // Outbound ACK errors (e.g. WA 463 account restriction) keyed by message id
        this.outboundAckErrors = new Map();
        this.outboundAckStatus = new Map();
        // Final delivery labels for GET .../messages/:id/status (+ late ACK watch)
        this.outboundDeliveryById = new Map();
        this._ackWatchTimers = new Map();
        // WA MEX reachout timelock / new-chat cap (Baileys connection.update)
        this.reachoutTimeLock = null;
        this.newChatMessageCap = null;
        this._lastReachoutFetchAt = 0;
        this._lastReachoutFailLogAt = 0;
        // Fleet metrics + per-contact 463 circuit (never retry cold to a 463'd contact)
        this.privacyTokenMetrics = createPrivacyTokenMetrics();
        this.contact463Circuit = new Map(); // circuitKey -> untilMs
        this._proactiveTcTokenHandler = null; // CB:message listener when capture enabled
        
        // Presence cycling interval (for stealth mode)
        this.presenceCycleInterval = null;
        // presenceSubscribe throttling + last presence webhook fingerprint (chatJid -> ms / fingerprint)
        this._presenceSubscribedAt = new Map();
        this._lastPresenceWebhookAt = new Map();
        
        // Human handoff settings (per-instance configurable)
        this.handoffSettings = Object.assign({
            resumeKeywords: ['#ai', '#assistant', '#bot', '#resume'],
            resumeMessage: '',   // optional auto-reply when bot resumes (empty = silent)
            // When true (default), /api/send and sendMessage refuse chats in human mode
            // unless options.forceDespiteHandoff is set. Stops n8n/AI bleed during handoff.
            blockApiSendsDuringHandoff: true,
        }, config.handoffSettings || {});

        // Human handoff: JID -> { taggedAt, taggedBy, autoResumeAt? }
        this.humanModeChats = new Map();
        // IDs of messages we sent via the bot, so we can distinguish manual sends
        this.botSentMessageIds = new Set();
        // JIDs we are actively sending to — ignore fromMe handoff echoes during the race
        // between sendMessage resolve and messages.upsert (ack wait widens that window).
        this._botOutboundJidUntil = new Map();
        
        // Event callbacks
        this.onStatusChange = null;
        this.onMessage = null;
        this.onLog = null;
    }
    
    /**
     * Initialize instance folders
     */
    async init() {
        await fs.mkdir(this.authFolder, { recursive: true });
        await fs.mkdir(this.logsFolder, { recursive: true });
        // Load LID cache from disk
        await this._loadLidCache();
        // Load saved contacts cache from disk
        await this._loadSavedContacts();
        await this._loadJobReplyAllowState();
        await this._loadOptInCtaState();
        await this._loadPostLimitQuietState();
        await this._loadOnWhatsAppCache();
        return this;
    }

    _cancelPairingRestartTimer() {
        if (this.pairingRestartTimer) {
            clearTimeout(this.pairingRestartTimer);
            this.pairingRestartTimer = null;
        }
    }

    _cancelConflictReconnectTimer() {
        if (this.conflictReconnectTimer) {
            clearTimeout(this.conflictReconnectTimer);
            this.conflictReconnectTimer = null;
        }
    }

    _cancelSharedDeviceResumeTimer() {
        if (this.sharedDeviceResumeTimer) {
            clearTimeout(this.sharedDeviceResumeTimer);
            this.sharedDeviceResumeTimer = null;
        }
    }

    _sharedDeviceResumeDelayMs(attempt) {
        const exp = Math.min(8, Math.max(0, attempt - 1));
        const raw = SHARED_DEVICE_RESUME_BASE_MS * (2 ** exp);
        const capped = Math.min(SHARED_DEVICE_RESUME_MAX_MS, raw);
        const jitter = Math.floor(Math.random() * Math.min(30_000, Math.max(1_000, capped * 0.08)));
        return capped + jitter;
    }

    _demoResumeDelayMs(attempt) {
        const randMs = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
        if (attempt <= 1) return randMs(20_000, 50_000);
        if (attempt === 2) return randMs(60_000, 5 * 60_000);
        return 30 * 60_000;
    }

    _quietResumeMaxAttempts() {
        return this._usesDemoResumeCurve() ? DEMO_RESUME_MAX_ATTEMPTS : SHARED_DEVICE_RESUME_MAX_ATTEMPTS;
    }

    _quietResumeDelayMs(attempt) {
        if (this._usesDemoResumeCurve()) return this._demoResumeDelayMs(attempt);
        return this._sharedDeviceResumeDelayMs(attempt);
    }

    _quietResumeLabel() {
        if (this._isTyrejobsProtectedLine()) return 'TyreJobs';
        if (this._isDemoQuietConflictLine()) return 'Demo';
        return 'Shared-devices';
    }

    /**
     * After 428 in shared-devices / demo / TyreJobs: stand down, then progressive resume.
     * Demo + trial/ATK/ATK2: 20–50s → 1–5m → 30m → stop. Clinics: slower exponential.
     */
    _scheduleSharedDeviceResume({ statusCode, detail } = {}) {
        this._cancelConflictReconnectTimer();
        this._cancelSharedDeviceResumeTimer();
        this.conflictReconnectAttempts = 0;

        const maxAttempts = this._quietResumeMaxAttempts();
        const label = this._quietResumeLabel();
        if (this.sharedDeviceResumeAttempts >= maxAttempts) {
            this.connectionIssue = {
                message: this._usesDemoResumeCurve()
                    ? `${label} stand-down exhausted after ${this.sharedDeviceResumeAttempts} quiet resumes. Auth preserved — press Connect.`
                    : `Paused after ${this.sharedDeviceResumeAttempts} quiet resume tries (shared-devices). `
                      + `Auth preserved — press Connect when staff Web/Desktop is idle.`,
                category: 'shared_device_stand_down_exhausted',
                requiresAuthClear: false,
                at: new Date().toISOString(),
                statusCode: statusCode || null,
                detail: detail || null,
            };
            this._log(this.connectionIssue.message, 'warning');
            this._emitStatusChange();
            return;
        }

        this.sharedDeviceResumeAttempts += 1;
        const attempt = this.sharedDeviceResumeAttempts;
        const delayMs = this._quietResumeDelayMs(attempt);
        const waitMin = Math.round(delayMs / 60_000);
        const waitSec = Math.round(delayMs / 1000);
        this.connectionIssue = {
            message:
                this._usesDemoResumeCurve()
                    ? `${label} stand-down: WhatsApp replaced this socket (${statusCode || 428}). `
                      + `Quiet resume ${attempt}/${maxAttempts} in ~${waitMin > 0 ? `${waitMin}m` : `${waitSec}s`} `
                      + `(or press Connect). Auth preserved.`
                    : `Paused: another linked device was active (shared-devices). `
                      + `Quiet auto-resume ${attempt}/${maxAttempts} in ~${waitMin > 0 ? `${waitMin}m` : `${waitSec}s`} `
                      + `(or press Connect now if staff Web is idle).`,
            category: 'shared_device_stand_down',
            requiresAuthClear: false,
            at: new Date().toISOString(),
            statusCode: statusCode || null,
            detail: detail || null,
            retryAfterMs: delayMs,
            sharedDeviceResumeAttempt: attempt,
            sharedDeviceResumeMaxAttempts: maxAttempts,
        };
        this._log(this.connectionIssue.message, 'warning');
        this._emitStatusChange();

        const generation = this.activeConnectGeneration;
        this.sharedDeviceResumeTimer = setTimeout(() => {
            this.sharedDeviceResumeTimer = null;
            if (generation !== this.activeConnectGeneration) return;
            if (this.status === 'connected' || this.status === 'connecting') return;
            this._log(
                `${label} quiet resume attempt ${attempt}/${maxAttempts}…`,
                'info',
            );
            this.connect({ _pairingRecovery: true }).catch((err) => {
                this.connectionIssue = {
                    message: `Shared-device resume failed: ${err.message}`,
                    category: 'shared_device_resume_failed',
                    requiresAuthClear: false,
                    at: new Date().toISOString(),
                };
                this._log(`Shared-device resume failed: ${err.message}`, 'error');
                this._emitStatusChange();
                // Close handler usually re-schedules on 428; only retry here if nothing pending.
                if (
                    !this.sharedDeviceResumeTimer
                    && this.status !== 'connected'
                    && this.status !== 'connecting'
                ) {
                    this._scheduleSharedDeviceResume({
                        statusCode,
                        detail: err.message,
                    });
                }
            });
        }, delayMs);
    }

    _scheduleConflictReconnect({ statusCode, detail, delayMs = CONNECT_REPLACED_RETRY_DELAY_MS } = {}) {
        this._cancelConflictReconnectTimer();
        this._cancelSharedDeviceResumeTimer();
        if (this.conflictReconnectAttempts >= CONFLICT_RECONNECT_MAX_ATTEMPTS) {
            this.connectionIssue = {
                message: `WhatsApp replaced this socket repeatedly (${statusCode || 428}). Auto-reconnect stopped after ${this.conflictReconnectAttempts} attempts — press Reconnect; auth is preserved.`,
                category: 'connection_replaced_exhausted',
                requiresAuthClear: false,
                at: new Date().toISOString(),
                statusCode: statusCode || null,
                detail: detail || null,
            };
            this._log(this.connectionIssue.message, 'error');
            this._emitStatusChange();
            return;
        }

        this.conflictReconnectAttempts += 1;
        const attempt = this.conflictReconnectAttempts;
        const staggerMs = this.manager?.getRuntimeReconnectStaggerMs?.(this.id) || 0;
        const totalDelayMs = delayMs + staggerMs;
        const waitSec = Math.round(totalDelayMs / 1000);
        this.connectionIssue = {
            message: `WhatsApp replaced this socket (${statusCode || 428}). Auto-reconnect ${attempt}/${CONFLICT_RECONNECT_MAX_ATTEMPTS} in ${waitSec}s…`,
            category: 'connection_replaced',
            requiresAuthClear: false,
            at: new Date().toISOString(),
            statusCode: statusCode || null,
            detail: detail || null,
            retryAfterMs: totalDelayMs,
            conflictReconnectAttempt: attempt,
            conflictReconnectMaxAttempts: CONFLICT_RECONNECT_MAX_ATTEMPTS,
        };
        this._log(
            `Connection replaced/conflict (${statusCode}: ${detail || 'Connection Terminated'}); scheduling auto-reconnect ${attempt}/${CONFLICT_RECONNECT_MAX_ATTEMPTS} in ${waitSec}s` +
                (staggerMs ? ` (fleet stagger +${Math.round(staggerMs / 1000)}s)` : ''),
            'warning',
        );
        this._emitStatusChange();

        const generation = this.activeConnectGeneration;
        this.conflictReconnectTimer = setTimeout(() => {
            this.conflictReconnectTimer = null;
            if (generation !== this.activeConnectGeneration) return;
            if (this.status === 'connected') return;
            this.connect({ _pairingRecovery: true }).catch((err) => {
                this.connectionIssue = {
                    message: `Conflict auto-reconnect failed: ${err.message}`,
                    category: 'reconnect_failed',
                    requiresAuthClear: false,
                    at: new Date().toISOString(),
                };
                this._log(`Conflict auto-reconnect failed: ${err.message}`, 'error');
                this._emitStatusChange();
            });
        }, totalDelayMs);
    }

    async _readAuthRegistrationState() {
        const credsPath = path.join(this.authFolder, 'creds.json');
        try {
            const raw = await fs.readFile(credsPath, 'utf8');
            const creds = JSON.parse(raw);
            const hasMe = Boolean(creds?.me?.id || creds?.me?.lid);
            const registeredFlag = !!creds.registered;
            // Baileys often keeps registered=false on fully paired lines; me.id is the
            // soft-reconnect signal. Do NOT treat hasMe as "fresh QR ready" — a 401
            // logout leaves me.id on disk and blocks QR until session files are cleared.
            return {
                exists: true,
                registeredFlag,
                hasMe,
                registered: registeredFlag || hasMe,
            };
        } catch {
            return { exists: false, registeredFlag: false, hasMe: false, registered: false };
        }
    }

    _connectionIssueNeedsFreshQr() {
        const issue = this.connectionIssue || {};
        if (issue.requiresAuthClear === true) return true;
        const msg = String(issue.message || '');
        if (/logged\s*out|restart with QR|QR code required/i.test(msg)) return true;
        if (issue.category === 'fatal' && /unauthorized|logged\s*out|401/i.test(msg)) return true;
        return false;
    }

    /**
     * Wipe session/creds for a fresh QR while keeping tctoken / lid / device-list.
     */
    async _resetAuthForFreshQr(reason = 'Preparing fresh QR (privacy tokens preserved)') {
        const preserved = await this._snapshotPrivacyTokenFiles();
        await this._clearLocalAuthFiles(reason);
        if (preserved.files.length) {
            await this._restorePrivacyTokenFiles(preserved.files);
            this._log(
                `Fresh QR prep — restored ${preserved.files.length} privacy/mapping files (tctoken/lid/device-list)`,
                'info'
            );
        }
    }

    async _teardownPairingSocket() {
        this._cancelPairingRestartTimer();
        this.activeConnectGeneration += 1;
        if (this.socket) {
            try {
                this.socket.ev.removeAllListeners();
                this.socket.end();
            } catch (e) {
                console.log(`[Instance ${this.id}] Teardown error:`, e.message);
            }
            this.socket = null;
            this.rawSocket = null;
        }
        this.connectInFlight = false;
        this.status = 'disconnected';
        this.qrCode = null;
        this.qrContent = null;
        this.qrCodeUpdatedAt = null;
        this.qrScanReceivedAt = null;
        this.linkingGraceUntil = null;
        this.pairingCode = null;
        this.connectionIssue = null;
        this._emitStatusChange();
    }

    /**
     * Reset stale / dead pairing state so WhatsApp accepts a fresh QR scan.
     * - Partial creds (no me) from abandoned attempts
     * - Dead logged-out sessions that still have me.id (401) — must clear or QR never appears
     * Always preserves tctoken / lid-mapping / device-list by default.
     */
    async _prepareFreshQrPairingSession() {
        const authState = await this._readAuthRegistrationState();
        const qrAgeMs = this.qrCodeUpdatedAt
            ? Date.now() - new Date(this.qrCodeUpdatedAt).getTime()
            : null;
        const qrExpired = typeof qrAgeMs === 'number' && qrAgeMs >= (QR_CODE_TTL_MS - 15_000);
        const inLinkingGrace = this._isPostScanGraceActive();
        const staleUnregisteredAuth = authState.exists
            && !authState.registeredFlag
            && !authState.hasMe
            && !inLinkingGrace;
        const staleConnectingSession = this.status === 'connecting'
            && !inLinkingGrace
            && (qrExpired || staleUnregisteredAuth || (!this.qrCode && !this.qrContent));

        // Never auto-wipe a session that still has me.id. 401 "logged out" in
        // connectionIssue used to clear creds on Reconnect (same as variset).
        if (staleUnregisteredAuth && this.status !== 'connecting') {
            this._log(
                'Auto-clearing stale unregistered auth before fresh QR pairing (keeping privacy tokens)',
                'info'
            );
            await this._teardownPairingSocket();
            await this._resetAuthForFreshQr();
            return;
        }

        if (staleConnectingSession) {
            this._log(
                `Restarting stale pairing session (${qrExpired ? 'QR expired' : staleUnregisteredAuth ? 'unregistered auth' : 'missing QR'})`,
                'info',
            );
            await this._teardownPairingSocket();
            if (staleUnregisteredAuth) {
                await this._resetAuthForFreshQr();
            }
            return;
        }

        if (this.status === 'connecting') {
            throw new Error('Connection in progress');
        }
        if (this.connectInFlight) {
            throw new Error('Connection in progress');
        }
    }

    _isQrTimeoutDisconnect(statusCode, summary = {}) {
        const detail = [summary.error, summary.reason].filter(Boolean).join(' ');
        return statusCode === DisconnectReason.timedOut || /qr refs attempts ended|qr.*timeout|timed?\s*out/i.test(detail);
    }

    _isStaleProtocolDisconnect(statusCode, reconnectPlan = {}, summary = {}) {
        const detail = [
            reconnectPlan.message,
            reconnectPlan.category,
            reconnectPlan.raw?.message,
            reconnectPlan.raw?.reason,
            summary.error,
            summary.reason,
        ].filter(Boolean).join(' ');

        return statusCode === DisconnectReason.restartRequired
            || isProtocolMismatchDisconnect(reconnectPlan)
            || /client\s+too\s+old|protocol\s+mismatch|restart\s+required/i.test(detail);
    }

    _isConflictDisconnect(statusCode, reconnectPlan = {}, summary = {}) {
        const detail = [
            reconnectPlan.message,
            reconnectPlan.category,
            reconnectPlan.raw?.message,
            reconnectPlan.raw?.reason,
            summary.error,
            summary.reason,
            summary.boom?.message,
            summary.boom?.reason,
        ].filter(Boolean).join(' ');

        return statusCode === DisconnectReason.connectionReplaced
            || /\bconflict\b|connection\s+replaced|replaced\s+by\s+another/i.test(detail);
    }

    _isPostScanGraceActive(now = Date.now()) {
        return !!this.linkingGraceUntil && now < new Date(this.linkingGraceUntil).getTime();
    }

    _markPairingLinking(source, extra = {}) {
        const now = Date.now();
        const firstSeen = !this.qrScanReceivedAt;
        this.qrScanReceivedAt = this.qrScanReceivedAt || new Date(now).toISOString();
        this.linkingGraceUntil = new Date(now + POST_SCAN_LINK_GRACE_MS).toISOString();
        this.qrCode = null;
        this.qrContent = null;
        this.qrCodeUpdatedAt = null;
        this.connectionIssue = {
            message: 'Scan received, finishing WhatsApp link...',
            category: 'pairing_linking',
            requiresAuthClear: false,
            at: new Date().toISOString(),
            source,
            linkingGraceUntil: this.linkingGraceUntil,
            ...extra,
        };
        this._emitStatusChange();
        this._log(
            `Scan received; entering linking grace until ${this.linkingGraceUntil}${firstSeen ? '' : ' (extended)'} via ${source}`,
            'info'
        );
    }

    _schedulePairingReconnect({ reason, clearAuth = false, delayMs = PAIRING_RECONNECT_DELAY_MS, recoveryMode = null } = {}) {
        this._cancelPairingRestartTimer();
        const generation = this.activeConnectGeneration;
        const mode = recoveryMode || 'qr-timeout';
        this.status = 'connecting';
        this.pairingCode = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        this.connectionIssue = reason ? {
            message: reason,
            category: mode === 'post-scan-restart'
                    ? 'pairing_restart_required'
                    : 'pairing_qr_refresh',
            requiresAuthClear: false,
            at: new Date().toISOString(),
            qrRefreshRestartCount: this.qrRefreshRestartCount,
            staleProtocolResetCount: this.staleProtocolResetCount,
            recoveryMode: mode,
        } : null;
        this._emitStatusChange();

        this.pairingRestartTimer = setTimeout(async () => {
            if (generation !== this.activeConnectGeneration) return;
            this.pairingRestartTimer = null;
            try {
                if (mode === 'qr-timeout') {
                    const authState = await this._readAuthRegistrationState();
                    if (authState.exists && !authState.registeredFlag && !authState.hasMe && !this._isPostScanGraceActive()) {
                        await this._resetAuthForFreshQr('Cleared stale unregistered auth during QR refresh (privacy tokens preserved)');
                    }
                }
                await this.connect({ _pairingRecovery: mode });
            } catch (err) {
                this.status = 'disconnected';
                this.connectionIssue = {
                    message: `Automatic pairing retry failed: ${err.message}`,
                    category: 'pairing_retry_failed',
                    requiresAuthClear: false,
                    at: new Date().toISOString(),
                    qrRefreshRestartCount: this.qrRefreshRestartCount,
                    staleProtocolResetCount: this.staleProtocolResetCount,
                };
                this._log(`Automatic pairing retry failed: ${err.message}`, 'error');
                this._emitStatusChange();
            }
        }, delayMs);
    }
    
    /**
     * Start WhatsApp connection (QR code mode by default, or pairing code if phone provided)
     * @param {Object} options - Connection options
     * @param {string} options.pairingPhone - Phone number for pairing code login (alternative to QR)
     */
    async connect(options = {}) {
        const usePairingCode = !!options.pairingPhone;
        const isPairingRecovery = !!options._pairingRecovery;
        console.log(`[Instance ${this.id}] connect() called, mode: ${usePairingCode ? 'pairing' : 'qr'}, status: ${this.status}`);
        
        if (this.status === 'connected') {
            throw new Error('Already connected');
        }
        if (!isPairingRecovery && !usePairingCode) {
            await this._prepareFreshQrPairingSession();
        } else if (this.status === 'connecting' && !isPairingRecovery) {
            throw new Error('Connection in progress');
        } else if (this.connectInFlight && !isPairingRecovery) {
            throw new Error('Connection in progress');
        }
        this.connectInFlight = true;

        this._cancelPairingRestartTimer();
        this._cancelConflictReconnectTimer();
        this._cancelSharedDeviceResumeTimer();
        if (!isPairingRecovery) {
            this.qrRefreshRestartCount = 0;
            this.staleProtocolResetCount = 0;
            this.qrScanReceivedAt = null;
            this.linkingGraceUntil = null;
            this.lastCredsUpdateAt = null;
            this.lastCredsUpdateSummary = null;
        }
        const connectGeneration = ++this.activeConnectGeneration;
        
        // Clean up existing socket if any
        if (this.socket) {
            console.log(`[Instance ${this.id}] Cleaning up old socket before reconnect`);
            try {
                this.socket.ev.removeAllListeners();
                this.socket.end();
            } catch (e) {
                console.log(`[Instance ${this.id}] Cleanup error:`, e.message);
            }
            this.socket = null;
            this.rawSocket = null;
        }
        
        this.status = 'connecting';
        this.connectionIssue = null;
        this.pairingCode = null;
        this._emitStatusChange();
        this._log(`Starting ${usePairingCode ? 'pairing code' : 'QR code'} connection...`, 'info');
        
        try {
            await fs.mkdir(this.authFolder, { recursive: true });
            console.log(`[Instance ${this.id}] Auth folder ready: ${this.authFolder}`);
            
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            console.log(`[Instance ${this.id}] Auth state loaded`);

            // Resolve proxy (instance override > deployment default > none) and build agent
            const resolved = resolveEffectiveProxy(this.proxy);
            this._activeProxy = resolved;                  // remember for diagnostics / status
            this._activeProxyAgent = null;                 // reset; may be set below
            this._activeProxyAt = null;
            let proxyAgent = null;
            if (resolved.config) {
                try {
                    proxyAgent = createProxyAgent(resolved.config);
                    this._activeProxyAgent = proxyAgent;
                    this._activeProxyAt = new Date().toISOString();
                    const r = redactProxy(resolved.config);
                    this._log(
                        `Using ${resolved.source} proxy: ${r.type}://${r.username ? r.username + '@' : ''}${r.host}:${r.port}`,
                        'info'
                    );
                } catch (err) {
                    this._log(`Proxy agent creation failed, connecting direct: ${err.message}`, 'error');
                    proxyAgent = null;
                }
            } else {
                console.log(`[Instance ${this.id}] No proxy configured, direct connection`);
                this._activeProxyAt = new Date().toISOString();
            }

            // Baileys often leaves creds.registered=false after a successful QR link.
            // me.id is the reliable "already paired" signal — same as getAuthStateSummary().
            // Treating paired reconnects as "initial registration" disables syncFullHistory,
            // so tctokens from chats on other linked devices never arrive → WA NACK 463.
            let isInitialRegistration = !state.creds.registered && !state.creds.me?.id;
            // ATK2 2026-08-28: pairing sets me.id, then 515 restart wrapped antiban +
            // syncFullHistory on a companion that was not finished registering. TyreJobs
            // only: keep the registration-safe socket until WhatsApp actually finishes.
            if (
                this._isTyrejobsProtectedLine()
                && !state.creds.registered
                && (this._isPostScanGraceActive() || options._pairingRecovery || options.pairingPhone)
            ) {
                isInitialRegistration = true;
                this._log(
                    'TyreJobs: post-pair socket stays registration-safe until link finishes (no antiban wrap, no full history)',
                    'warning'
                );
            }

            // ─── Anti-ban v2 integration ──────────────────────────────────
            // 1) Lazy-init the v2 config from legacy on first connect
            if (!this.antibanV2) {
                this.antibanV2 = legacyToV2Config(this.antiBanSettings);
                // If this instance was already connected before v2 launch, skip warmup
                if (this.connectedPhone || this.createdAt < new Date('2026-04-30').toISOString()) {
                    this.antibanV2._skipWarmup = true;
                }
                this._log('Anti-ban v2 config seeded from legacy settings', 'info');
            }

            // 2) Build the v2 context for already-registered sessions only.
            // Registration is the most protocol-sensitive phase; use the transport
            // defaults until WhatsApp accepts the new linked device, then wrap.
            // When anti-ban is toggled OFF, skip the pipeline entirely.
            let fingerprint = null;
            const antibanEnforcementOn = this.antibanV2?.enabled !== false;
            this._antibanV2Enforcing = antibanEnforcementOn;
            if (!isInitialRegistration && antibanEnforcementOn) {
                fingerprint = await pickOrLoadFingerprint(path.join(INSTANCES_FOLDER, this.id));
                try {
                    this.antibanCtx = await buildAntibanContext({
                        instanceId: this.id,
                        instanceFolder: path.join(INSTANCES_FOLDER, this.id),
                        v2config: this.antibanV2,
                        onLog: (msg, level) => this._log(`[v2] ${msg}`, level),
                        onRiskChange: (change) => this._onRiskChange(change),
                    });
                } catch (err) {
                    this._log(`Failed to build anti-ban v2 context: ${err.message}. Falling back to legacy.`, 'error');
                    this.antibanCtx = null;
                }
            } else {
                this.antibanCtx = null;
                if (isInitialRegistration) {
                    this._log('Using registration-safe socket profile until device is linked', 'info');
                } else if (!antibanEnforcementOn) {
                    this._log('Anti-ban v2 disabled — connecting without send limits', 'info');
                }
            }

            // 3) Build the raw socket; apply the sticky fingerprint only after registration
            let baileysVersion = null;
            try {
                baileysVersion = await getCurrentBaileysVersion();
                this._log(`Using WhatsApp transport version ${baileysVersion.join('.')}`, 'info');
            } catch (err) {
                this._log(`Could not refresh WhatsApp transport version, using bundled default: ${err.message}`, 'warning');
            }

            const rawSocket = makeWASocket({
                auth: state,
                logger: logger,
                ...(baileysVersion ? { version: baileysVersion } : {}),
                browser: fingerprint ? fingerprint.browser : Browsers.macOS('Chrome'),
                printQRInTerminal: false,
                cachedGroupMetadata: async (jid) => this.groupMetadataCache.get(jid),
                userDevicesCache: this.userDevicesCache,
                msgRetryCounterCache: this.msgRetryCounterCache,
                mediaCache: this.mediaCache,
                markOnlineOnConnect: false,
                mobile: false,
                connectTimeoutMs: 60_000,
                keepAliveIntervalMs: 15_000,
                defaultQueryTimeoutMs: 120_000,
                retryRequestDelayMs: 500,
                qrTimeout: QR_CODE_TTL_MS,
                syncFullHistory: !isInitialRegistration,
                shouldSyncHistoryMessage: () => !isInitialRegistration,
                generateHighQualityLinkPreview: false,
                getMessage: async (key) => {
                    const msg = this.messageStore.get(key.id);
                    return msg?.message || undefined;
                },
                enableAutoSessionRecreation: true,
                enableRecentMessageCache: true,
                ...(proxyAgent && { agent: proxyAgent, fetchAgent: proxyAgent }),
            });
            this.rawSocket = rawSocket;

            // 4) Wrap with anti-ban v2 (sendMessage now intercepted with full pipeline)
            if (this.antibanCtx?.wrap && this._antibanV2Enforcing) {
                try {
                    this.socket = this.antibanCtx.wrap(rawSocket);
                    this._log(`Socket wrapped with anti-ban v2 (browser: ${fingerprint.browser.join('/')})`, 'success');
                } catch (err) {
                    this._log(`Wrap failed, using raw socket: ${err.message}`, 'error');
                    this.socket = rawSocket;
                }
            } else {
                this.socket = rawSocket;
            }
            console.log(`[Instance ${this.id}] Socket created${proxyAgent ? ' (via proxy)' : ''}${this.antibanCtx ? ' [antiban-v2]' : ''}`);

            const socketConfigSummary = {
                browser: fingerprint ? fingerprint.browser : Browsers.macOS('Chrome'),
                mobile: false,
                markOnlineOnConnect: false,
                syncFullHistory: !isInitialRegistration,
                connectTimeoutMs: 60_000,
                keepAliveIntervalMs: 15_000,
                defaultQueryTimeoutMs: 120_000,
                qrTimeout: QR_CODE_TTL_MS,
                proxy: !!proxyAgent,
            };
            this._log(`Pairing socket config: ${JSON.stringify(socketConfigSummary)}`, 'info');

            rawSocket.ws?.on?.('close', (code, reason) => {
                this._log(`WhatsApp websocket closed: ${JSON.stringify({
                    code,
                    reason: reason?.toString?.() || null,
                    sinceScanMs: this.qrScanReceivedAt ? Date.now() - new Date(this.qrScanReceivedAt).getTime() : null,
                })}`, 'warning');
            });
            rawSocket.ws?.on?.('error', (err) => {
                this._log(`WhatsApp websocket error: ${err?.message || String(err)}`, 'warning');
            });

            // Optional PR #2752-style inbound <tctoken> capture (behavior switch, default off).
            this._syncProactiveTcTokenCapture();
            
            // Save credentials when updated
            this.socket.ev.on('creds.update', async (creds) => {
                const summary = summarizeCredsUpdate(creds);
                this.lastCredsUpdateAt = new Date().toISOString();
                this.lastCredsUpdateSummary = summary;
                this._log(`Credentials update during pairing: ${JSON.stringify({
                    ...summary,
                    sinceQrMs: this.qrCodeUpdatedAt ? Date.now() - new Date(this.qrCodeUpdatedAt).getTime() : null,
                    linkingGraceActive: this._isPostScanGraceActive(),
                })}`, 'info');

                if (this.status === 'connecting' && !this.connectedAt && (this.qrCode || this.qrContent || this.qrScanReceivedAt)) {
                    this._markPairingLinking('creds.update', { creds: summary });
                }

                await saveCreds();
                this._noteTyrejobsRegistered('creds.update');
            });

            const enableAntibanAfterRegistration = async () => {
                if (!isInitialRegistration || this.antibanCtx || !this.rawSocket) return;
                if (this.antibanV2?.enabled === false) return;

                try {
                    const postLinkFingerprint = await pickOrLoadFingerprint(path.join(INSTANCES_FOLDER, this.id));
                    this.antibanCtx = await buildAntibanContext({
                        instanceId: this.id,
                        instanceFolder: path.join(INSTANCES_FOLDER, this.id),
                        v2config: this.antibanV2,
                        onLog: (msg, level) => this._log(`[v2] ${msg}`, level),
                        onRiskChange: (change) => this._onRiskChange(change),
                    });
                    if (this.antibanCtx?.wrap) {
                        this.socket = this.antibanCtx.wrap(this.rawSocket);
                        this._antibanV2Enforcing = true;
                    }
                    this._log(`Anti-ban v2 enabled after link (fingerprint ready: ${postLinkFingerprint.browser.join('/')})`, 'success');
                } catch (err) {
                    this._log(`Failed to enable anti-ban v2 after link: ${err.message}`, 'warning');
                    this.socket = this.rawSocket;
                }
            };
            
            // If using pairing code and not yet registered, request the code
            if (usePairingCode && !state.creds.registered) {
                const cleanNumber = options.pairingPhone.replace(/[^\d]/g, '');
                console.log(`[Instance ${this.id}] Requesting pairing code for: ${cleanNumber}`);
                
                // Small delay to let socket establish WebSocket connection
                await delay(2000);
                
                const code = await this.socket.requestPairingCode(cleanNumber);
                this.pairingCode = code;
                console.log(`[Instance ${this.id}] Pairing code: ${code}`);
                this._log(`Pairing code: ${code} - Enter in WhatsApp > Linked Devices > Link a Device`, 'info');
                this._emitStatusChange();
            }
            
            // Handle connection updates
            this.socket.ev.on('connection.update', async (update) => {
                if (connectGeneration !== this.activeConnectGeneration) {
                    return;
                }
                const { connection, qr, lastDisconnect } = update;
                if (update.reachoutTimeLock) {
                    this._applyReachoutTimeLock(update.reachoutTimeLock, 'connection.update');
                }
                const updateSummary = summarizeConnectionUpdate(update);
                this.lastPairingUpdateAt = new Date().toISOString();

                if (connection || lastDisconnect) {
                    this._log(`Pairing update: ${JSON.stringify({
                        ...updateSummary,
                        sinceQrMs: this.qrCodeUpdatedAt ? Date.now() - new Date(this.qrCodeUpdatedAt).getTime() : null,
                        sinceScanMs: this.qrScanReceivedAt ? Date.now() - new Date(this.qrScanReceivedAt).getTime() : null,
                        linkingGraceUntil: this.linkingGraceUntil,
                    })}`, lastDisconnect ? 'warning' : 'info');
                }

                if (update.isNewLogin && this.status === 'connecting' && !this.connectedAt) {
                    this._markPairingLinking('new-login', { isNewLogin: true });
                }

                if (connection === 'connecting' && !qr && this.lastCredsUpdateAt && this.qrScanReceivedAt && !this.connectedAt) {
                    this._markPairingLinking('connection.update', { connection });
                }
                
                // QR Code received (only show if NOT in pairing code mode)
                if (qr && !usePairingCode) {
                    if (this._isPostScanGraceActive()) {
                        this._log(`Suppressing QR update while scan is in linking grace (until ${this.linkingGraceUntil})`, 'warning');
                        return;
                    }
                    console.log(`[Instance ${this.id}] QR code received`);
                    try {
                        const qrChanged = this.qrContent !== qr;
                        this.qrContent = qr;
                        this.qrCode = await QRCode.toDataURL(qr);
                        this.qrCodeUpdatedAt = new Date().toISOString();
                        this.qrVersion += 1;
                        this.connectionIssue = null;
                        this.status = 'connecting';
                        this._emitStatusChange();
                        this._log(`QR code ${qrChanged ? 'generated' : 'refreshed'} - scan with WhatsApp (version ${this.qrVersion})`, 'info');
                    } catch (err) {
                        console.error(`[Instance ${this.id}] QR generation error:`, err);
                    }
                }
                
                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    // Use the anti-ban pipeline's typed disconnect classifier for backoff
                    const reconnectPlan = planReconnect(statusCode, 5000);
                    let isConflict = this._isConflictDisconnect(statusCode, reconnectPlan, updateSummary);
                    // Library treats 428 as fatal. Wasup recover is opt-out via conflict428Recover module.
                    if (isConflict && this.antibanV2 && !isModuleOn(this.antibanV2, 'conflict428Recover')) {
                        this._log('428 conflict recover OFF — following library fatal semantics (no Wasup reclaim)', 'warning');
                        isConflict = false;
                        reconnectPlan.shouldReconnect = false;
                        reconnectPlan.category = 'fatal';
                    }
                    // A 401 with "conflict" is a replaced socket, not an auth wipe signal.
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut && !isConflict;
                    // 403 forbidden = WA rejected companion (ban/temp block). Never reconnect-loop.
                    const isForbidden = statusCode === DisconnectReason.forbidden
                        || statusCode === 403
                        || reconnectPlan.category === 'forbidden';
                    if (isForbidden || isLoggedOut) {
                        this._markTyrejobsLimited(isForbidden ? '403' : '401');
                    }
                    const shouldReconnect = !isLoggedOut && !isForbidden && !isConflict && reconnectPlan.shouldReconnect !== false;
                    const wasPairing = this.status === 'connecting' && !this.connectedAt;
                    const isQrTimeout = this._isQrTimeoutDisconnect(statusCode, updateSummary);
                    const isStaleProtocol = this._isStaleProtocolDisconnect(statusCode, reconnectPlan, updateSummary);
                    const postScanGraceActive = this._isPostScanGraceActive();

                    console.log(`[Instance ${this.id}] Connection closed. Status:`, statusCode, '→', reconnectPlan.message, updateSummary);
                    this.status = 'disconnected';
                    this.socket = null;
                    this.rawSocket = null;
                    if (!wasPairing || (!isQrTimeout && !isStaleProtocol)) {
                        this.qrCode = null;
                        this.qrContent = null;
                        this.qrCodeUpdatedAt = null;
                    }
                    this.pairingCode = null;
                    this.connectedPhone = null;
                    this.connectedAt = null;

                    // Cancel any pending stealth presence ramp
                    if (this.presenceRampAbort) {
                        try { this.presenceRampAbort.abort(); } catch (_) {}
                        this.presenceRampAbort = null;
                    }

                    // Tear down the v2 context (flushes state + stops timers)
                    if (this._humanEntropy) {
                        try { this._humanEntropy.stop(); } catch (_) {}
                        this._humanEntropy = null;
                    }
                    if (this.antibanCtx) {
                        const ctx = this.antibanCtx;
                        this.antibanCtx = null;
                        ctx.destroy().catch((err) => console.warn(`[Instance ${this.id}] antiban ctx destroy failed:`, err.message));
                    }

                    if (wasPairing && postScanGraceActive && statusCode === DisconnectReason.restartRequired) {
                        this._log(
                            `Post-scan restart required (${statusCode}: ${updateSummary.error || reconnectPlan.message}); preserving auth and restarting socket in ${Math.round(PAIRING_RECONNECT_DELAY_MS / 1000)}s`,
                            'warning'
                        );
                        this._schedulePairingReconnect({
                            reason: 'Scan received; restarting WhatsApp socket with preserved auth.',
                            clearAuth: false,
                            delayMs: PAIRING_RECONNECT_DELAY_MS,
                            recoveryMode: 'post-scan-restart',
                        });
                    } else if (wasPairing && postScanGraceActive && isQrTimeout) {
                        this._log(
                            `Post-scan timeout (${statusCode}: ${updateSummary.error || reconnectPlan.message}); preserving auth and restarting socket in ${Math.round(PAIRING_RECONNECT_DELAY_MS / 1000)}s`,
                            'warning'
                        );
                        this._schedulePairingReconnect({
                            reason: 'Scan received; restarting after pairing timeout with preserved auth.',
                            clearAuth: false,
                            delayMs: PAIRING_RECONNECT_DELAY_MS,
                            recoveryMode: 'post-scan-timeout',
                        });
                    } else if (wasPairing && isQrTimeout && !usePairingCode) {
                        this.qrRefreshRestartCount += 1;
                        this._log(`QR expired before scan (${updateSummary.error || reconnectPlan.message}); restarting pairing socket for a fresh QR`, 'warning');
                        this._schedulePairingReconnect({
                            reason: 'QR expired before scan; generating a fresh QR automatically.',
                            clearAuth: false,
                            delayMs: 1000,
                        });
                    } else if (wasPairing && isStaleProtocol) {
                        if (this.staleProtocolResetCount < STALE_PROTOCOL_PAIRING_RETRY_LIMIT) {
                            this.staleProtocolResetCount += 1;
                            this.qrCode = null;
                            this.qrContent = null;
                            this.qrCodeUpdatedAt = null;
                            this._log(
                                `WhatsApp requested a pairing socket restart (${updateSummary.error || reconnectPlan.message}); preserving auth and retrying (${this.staleProtocolResetCount}/${STALE_PROTOCOL_PAIRING_RETRY_LIMIT})`,
                                'warning'
                            );
                            this._schedulePairingReconnect({
                                reason: `WhatsApp requested a pairing socket restart; retrying with preserved auth (${this.staleProtocolResetCount}/${STALE_PROTOCOL_PAIRING_RETRY_LIMIT}).`,
                                clearAuth: false,
                                recoveryMode: 'restart-required',
                            });
                        } else {
                            this.qrCode = null;
                            this.qrContent = null;
                            this.qrCodeUpdatedAt = null;
                            this.connectionIssue = {
                                message: 'WhatsApp still requested pairing restarts after retries. Press QR code again to start a fresh pairing attempt.',
                                category: reconnectPlan.category || 'restart_required',
                                requiresAuthClear: false,
                                at: new Date().toISOString(),
                                statusCode,
                                detail: updateSummary.error || reconnectPlan.message,
                                staleProtocolResetCount: this.staleProtocolResetCount,
                            };
                            this._log(`Pairing protocol retries exhausted after ${this.staleProtocolResetCount} attempt(s): ${updateSummary.error || reconnectPlan.message}`, 'error');
                            this._emitStatusChange();
                        }
                    } else if (wasPairing && isLoggedOut && !usePairingCode) {
                        // NEVER auto-wipe auth here. A 401 during connect/QR used to clear
                        // creds.json for "fresh QR" and that nuked live sessions after a
                        // conflict/reconnect (variset 2026-08-22). Auth stays on disk;
                        // clear only when the user explicitly presses QR / clear-auth.
                        this._cancelConflictReconnectTimer();
                        this._cancelPairingRestartTimer();
                        this.connectionIssue = {
                            message:
                                reconnectPlan.message
                                || 'Logged out (401) — auth preserved. Press Reconnect; use QR / Clear Auth only if that fails.',
                            category: 'fatal',
                            requiresAuthClear: true,
                            at: new Date().toISOString(),
                            statusCode,
                        };
                        this._log(
                            `Disconnect is fatal (${reconnectPlan.message}) — auth preserved (no auto-wipe); press Reconnect or QR manually`,
                            'error'
                        );
                        this._emitStatusChange();
                    } else if (isConflict) {
                        if (this._usesQuietConflictResume()) {
                            // Demo + trial/ATK/ATK2 + clinic coexist: stand down, then
                            // progressive quiet resume. Do not fight 428 with 10s×8 reclaim.
                            // 401 conflict still stands down (fatal branch above).
                            this._scheduleSharedDeviceResume({
                                statusCode,
                                detail: updateSummary.error || reconnectPlan.message,
                            });
                        } else if (this._isMultiDeviceCoexist() && this._groupAlertModeEnabled()) {
                            // Alert numbers: reclaim fast. Jobs hit 24/7 — a long stand-down
                            // drops group traffic with no local queue to drain later.
                            const alertConflictDelayMs = CONNECT_REPLACED_RETRY_DELAY_MS; // 10s
                            this._log(
                                `Shared-devices + group alert mode: conflict (${statusCode}) — auto-reclaim in ${Math.round(alertConflictDelayMs / 1000)}s`,
                                'warning'
                            );
                            this._scheduleConflictReconnect({
                                statusCode,
                                detail: updateSummary.error || reconnectPlan.message,
                                delayMs: alertConflictDelayMs,
                            });
                        } else {
                            this._scheduleConflictReconnect({
                                statusCode,
                                detail: updateSummary.error || reconnectPlan.message,
                                delayMs: CONNECT_REPLACED_RETRY_DELAY_MS,
                            });
                        }
                    } else if (shouldReconnect) {
                        this.genericReconnectAttempts = (this.genericReconnectAttempts || 0) + 1;
                        const attempt = this.genericReconnectAttempts;
                        if (attempt > GENERIC_RECONNECT_MAX_ATTEMPTS) {
                            this.connectionIssue = {
                                message: `Auto-reconnect stopped after ${GENERIC_RECONNECT_MAX_ATTEMPTS} attempts (${reconnectPlan.message}). Press Reconnect; auth is preserved.`,
                                category: reconnectPlan.category || 'reconnect_exhausted',
                                requiresAuthClear: false,
                                at: new Date().toISOString(),
                                statusCode: statusCode || null,
                            };
                            this._log(this.connectionIssue.message, 'error');
                            this._emitStatusChange();
                        } else {
                            const baseMs = Math.max(2000, reconnectPlan.backoffMs || 5000);
                            // Exponential backoff so 405/503 loops don't hammer WhatsApp every 15s.
                            const backoffMs = Math.min(
                                GENERIC_RECONNECT_MAX_DELAY_MS,
                                baseMs * (2 ** Math.max(0, attempt - 1)),
                            );
                            const staggerMs = this.manager?.getRuntimeReconnectStaggerMs?.(this.id) || 0;
                            const totalDelayMs = backoffMs + staggerMs;
                            const generation = this.activeConnectGeneration;
                            this._log(
                                `Connection lost (${reconnectPlan.category}: ${reconnectPlan.message}) — reconnecting ${attempt}/${GENERIC_RECONNECT_MAX_ATTEMPTS} in ${Math.round(totalDelayMs / 1000)}s` +
                                    (staggerMs ? ` (fleet stagger +${Math.round(staggerMs / 1000)}s)` : ''),
                                'warning',
                            );
                            this.connectionIssue = {
                                message: `Reconnecting ${attempt}/${GENERIC_RECONNECT_MAX_ATTEMPTS} in ${Math.round(totalDelayMs / 1000)}s…`,
                                category: reconnectPlan.category || 'recoverable',
                                requiresAuthClear: false,
                                at: new Date().toISOString(),
                                statusCode: statusCode || null,
                            };
                            this._emitStatusChange();
                            setTimeout(() => {
                                if (generation !== this.activeConnectGeneration) return;
                                this.connect({ _pairingRecovery: true }).catch((err) => {
                                    this.connectionIssue = {
                                        message: `Reconnect failed: ${err.message}`,
                                        category: 'reconnect_failed',
                                        requiresAuthClear: false,
                                        at: new Date().toISOString()
                                    };
                                    this._log(`Reconnect failed: ${err.message}`, 'error');
                                    this._emitStatusChange();
                                });
                            }, totalDelayMs);
                        }
                    } else {
                        const isProtocolMismatch = isProtocolMismatchDisconnect(reconnectPlan);
                        this.connectionIssue = {
                            message: isProtocolMismatch
                                ? 'WhatsApp requested a pairing restart. Press QR Code again to start a fresh pairing attempt; saved auth was preserved.'
                                : reconnectPlan.message,
                            category: reconnectPlan.category,
                            requiresAuthClear: !!isLoggedOut,
                            at: new Date().toISOString()
                        };
                        this._log(
                            isLoggedOut
                                ? `Disconnect is fatal (${reconnectPlan.message}) — auth preserved; press Reconnect, or QR / Clear Auth only if needed`
                                : `Disconnect is fatal (${reconnectPlan.message}) — auth preserved; manual re-pair may be required`,
                            'error'
                        );
                        this._emitStatusChange();
                    }
                }

                if (connection === 'open') {
                    console.log(`[Instance ${this.id}] Connected!`);
                    this.conflictReconnectAttempts = 0;
                    this.genericReconnectAttempts = 0;
                    this.sharedDeviceResumeAttempts = 0;
                    this._cancelConflictReconnectTimer();
                    this._cancelSharedDeviceResumeTimer();
                    await enableAntibanAfterRegistration();
                    this.status = 'connected';
                    this.qrCode = null;
                    this.qrContent = null;
                    this.qrCodeUpdatedAt = null;
                    this.qrRefreshRestartCount = 0;
                    this.staleProtocolResetCount = 0;
                    this._logoutFreshQrAttempted = false;
                    this.qrScanReceivedAt = null;
                    this.linkingGraceUntil = null;
                    this.pairingCode = null;
                    this.connectionIssue = null;
                    this.connectedPhone = normalizeConnectedPhoneIdentity(this.socket.user?.id)
                        || normalizeConnectedPhoneIdentity(this.socket.user?.jid)
                        || normalizeConnectedPhoneIdentity(this.socket.user?.phone)
                        || null;
                    this.connectedAt = new Date().toISOString();
                    this._emitStatusChange();
                    this._log(`Connected as ${this.connectedPhone || 'unknown phone'}`, 'success');
                    this._armTyrejobsPostLimitCtaQuiet();
                    this._noteTyrejobsRegistered('connect');
                    this._logWaAbProps('connect');

                    // Probe WA reachout timelock / new-chat cap (read-only MEX). Critical for 463 diagnosis.
                    setTimeout(() => {
                        this.refreshReachoutDiagnostics('connect').catch(() => {});
                    }, 2500);

                    try { this._syncHumanEntropy(); } catch (_) {}

                    const stayPassive = this._shouldStayPresencePassive();

                    if (stayPassive) {
                        // Force the linked-device presence to 'unavailable' so WhatsApp's
                        // server keeps delivering push notifications / staff Web stays primary.
                        try {
                            await this.socket.sendPresenceUpdate('unavailable');
                            this._log(
                                this._preservesPhoneNotifications()
                                    ? 'Phone push mode: forced presence=unavailable on connect'
                                    : this._isMultiDeviceCoexist()
                                        ? 'Shared-devices mode: forced presence=unavailable on connect'
                                        : 'Passive presence: forced unavailable on connect',
                                'info'
                            );
                        } catch (err) {
                            this._log(`Failed to force unavailable presence: ${err.message}`, 'warning');
                        }
                    } else {
                        // Stealth presence ramp: wait 45-120s before broadcasting `available`.
                        // Bots that snap online instantly look suspicious to WhatsApp's classifier.
                        if (this.antibanV2?.modules?.stealthConnect?.enabled !== false) {
                            this.presenceRampAbort = new AbortController();
                            const minMs = this.antibanV2?.modules?.stealthConnect?.presenceRampMinMs || 45_000;
                            const maxMs = this.antibanV2?.modules?.stealthConnect?.presenceRampMaxMs || 120_000;
                            rampPresence(this.socket, this.presenceRampAbort.signal, { minDelayMs: minMs, maxDelayMs: maxMs })
                                .then((res) => {
                                    if (!res?.aborted) {
                                        this._log(`Stealth presence ramp completed at ${res?.rampedAt}`, 'info');
                                    }
                                })
                                .catch((err) => this._log(`Presence ramp error: ${err.message}`, 'warning'));
                        }

                        // Continue our existing background presence cycling (now ON TOP of v2's
                        // PresenceChoreographer which fires per-message). The cycling here keeps
                        // the global online/offline rhythm; the choreographer adjusts per-message.
                        this._startPresenceCycling();
                    }
                }
            });
            
            // Handle incoming messages
            // Baileys: `notify` = typical realtime DM; `append` is common for groups /
            // catch-up after reconnect. Ignoring append drops many group alerts.
            this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify' && type !== 'append') return;

                const now = Math.floor(Date.now() / 1000);
                // 15 min — group bursts + slow webhooks used to exceed the old 60s gate
                // while earlier messages were still awaiting webhook replies.
                const MAX_AGE_SEC = 15 * 60;
                const tasks = [];
                for (const msg of messages) {
                    // fromMe echo often carries SERVER_ACK; capture it before handoff
                    // short-circuit so /api/send does not 60s-timeout as failed.
                    if (msg?.key?.fromMe && msg?.key?.id) {
                        this._noteOutboundAck(msg.key.id, msg.status, msg.key.remoteJid || null);
                    }
                    const msgTimestamp = Number(msg.messageTimestamp) || now;
                    if (now - msgTimestamp > MAX_AGE_SEC) continue;
                    tasks.push(
                        this._handleMessage(msg).catch((err) => {
                            console.error(`[Instance ${this.id}] Message handling error:`, err);
                        })
                    );
                }
                if (tasks.length) await Promise.allSettled(tasks);
            });

            // Delivery/read receipts on companion sockets often skip messages.update.
            this.socket.ev.on('message-receipt.update', (updates) => {
                for (const item of updates || []) {
                    const id = item?.key?.id;
                    if (!id) continue;
                    const receipt = item.receipt || {};
                    let status = 0;
                    if (receipt.playedTimestamp) status = 5;
                    else if (receipt.readTimestamp) status = 4;
                    else if (receipt.receiptTimestamp) status = 3;
                    if (status >= 2) {
                        this._noteOutboundAck(id, status, item.key?.remoteJid || null);
                    }
                }
            });

            // Capture WA server NACKs (463) and positive status ACKs (SERVER_ACK+).
            this.socket.ev.on('messages.update', (updates) => {
                for (const { key, update } of updates || []) {
                    const id = key?.id;
                    if (!id || !update) continue;
                    const stub = update.messageStubParameters;
                    const errCode = Array.isArray(stub) ? stub[0] : null;
                    if (typeof update.status === 'number' && update.status >= 2) {
                        this._noteOutboundAck(id, update.status, key.remoteJid || null);
                    }
                    if (update.status === 0 || errCode === '463' || errCode === 463 || String(errCode) === '463') {
                        this.outboundAckErrors.set(id, {
                            code: String(errCode || 'error'),
                            at: new Date().toISOString(),
                            remoteJid: key.remoteJid || null,
                        });
                        if (this.outboundAckErrors.size > 500) {
                            const first = this.outboundAckErrors.keys().next().value;
                            this.outboundAckErrors.delete(first);
                        }
                        this._log(
                            `Outbound NACK ${id}: WhatsApp rejected send (${errCode || 'error'})` +
                            (String(errCode) === '463' ? ' — account restricted or missing tctoken for this contact' : ''),
                            'error'
                        );
                        this._recordOutboundDelivery(id, {
                            status: 'failed',
                            reason: String(errCode || 'error'),
                            remoteJid: key.remoteJid || null,
                            doNotRetry: String(errCode) === '463',
                        });
                        this._cancelOutboundAckWatch(id);
                        if (String(errCode) === '463') {
                            this._tripContact463Circuit(key.remoteJid, 'messages.update');
                            this.refreshReachoutDiagnostics('463').catch(() => {});
                        }
                    }
                }
            });

            // Observability only — Baileys rc13 already harvests chat.tcToken into auth
            // keys before emitting this event (see process-message storeTcTokensFromHistorySync).
            this.socket.ev.on('messaging-history.set', ({ chats } = {}) => {
                const list = Array.isArray(chats) ? chats : [];
                let withToken = 0;
                for (const chat of list) {
                    if (chat?.tcToken?.length) withToken += 1;
                }
                this.privacyTokenMetrics.historyHarvestEvents += 1;
                this.privacyTokenMetrics.historyChatsWithToken += withToken;
                this.privacyTokenMetrics.lastHistoryHarvestAt = new Date().toISOString();
                if (list.length || withToken) {
                    this._log(
                        `History sync observed: ${list.length} chats, ${withToken} with tcToken (Baileys persists tokens to auth)`,
                        'info'
                    );
                }
            });

            // Inbound typing / recording / online presence → optional webhook events
            this.socket.ev.on('presence.update', (update) => {
                this._handlePresenceUpdate(update).catch((err) => {
                    console.warn(`[Instance ${this.id}] presence.update handler failed:`, err?.message || err);
                });
            });
            
            // Store messages for retry handling
            this.socket.ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    if (msg.key.id) {
                        if (msg.key.fromMe) {
                            this._noteOutboundAck(msg.key.id, msg.status, msg.key.remoteJid || null);
                        }
                        this.messageStore.set(msg.key.id, msg);
                        if (this.messageStore.size > this.maxStoredMessages) {
                            const firstKey = this.messageStore.keys().next().value;
                            this.messageStore.delete(firstKey);
                        }
                    }
                }
            });
            
            // Cache group metadata on updates
            this.socket.ev.on('groups.update', (updates) => {
                for (const update of updates) {
                    if (update.id) {
                        const existing = this.groupMetadataCache.get(update.id);
                        if (existing) {
                            this.groupMetadataCache.set(update.id, { ...existing, ...update });
                        }
                    }
                }
            });
            
            // Listen for LID–PN mapping updates (current transport)
            this.socket.ev.on('lid-mapping.update', async (mappings) => {
                console.log(`[Instance ${this.id}] Received LID-PN mappings:`, Object.keys(mappings).length);
                for (const [lid, pn] of Object.entries(mappings)) {
                    await this._storeLidMapping(lid, pn);
                }
            });

            this.socket.ev.on('message-capping.update', (cap) => {
                if (!cap || typeof cap !== 'object') return;
                this.newChatMessageCap = {
                    ...cap,
                    checkedAt: new Date().toISOString(),
                    source: 'message-capping.update',
                };
                this._log(`New-chat message cap (event): ${JSON.stringify(this.newChatMessageCap)}`, 'info');
                this._emitStatusChange();
            });

            this.connectInFlight = false;
            
        } catch (error) {
            this.connectInFlight = false;
            console.error(`[Instance ${this.id}] Connection error:`, error);
            this.status = 'disconnected';
            this.connectionIssue = {
                message: error.message,
                category: 'connect_error',
                requiresAuthClear: false,
                at: new Date().toISOString()
            };
            this._emitStatusChange();
            this._log(`Connection error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Disconnect WhatsApp socket.
     * @param {{ revokeSession?: boolean }} [options]
     *   revokeSession=false (default) — close the transport only; credentials on disk stay valid (PM2 restarts, “Disconnect” in UI).
     *   revokeSession=true — full server-side logout (same as clearing session remotely); prefer clear-auth for wiping local files too.
     */
    async disconnect(options = {}) {
        const revokeSession = !!options.revokeSession;
        this._cancelPairingRestartTimer();
        this._cancelConflictReconnectTimer();
        this._cancelSharedDeviceResumeTimer();
        this.activeConnectGeneration += 1;
        this.genericReconnectAttempts = 0;
        // Stop presence cycling
        this._stopPresenceCycling();
        
        if (this.socket) {
            try {
                this.socket.ev?.removeAllListeners?.();
                if (revokeSession) {
                    await this.socket.logout();
                    this._log('Disconnected (session revoked on server)', 'info');
                } else if (typeof this.socket.end === 'function') {
                    this.socket.end(undefined);
                    this._log('Disconnected (socket closed; auth preserved on disk)', 'info');
                } else {
                    await this.socket.logout();
                    this._log('Disconnected from WhatsApp', 'info');
                }
            } catch (error) {
                console.error(`[Instance ${this.id}] Disconnect error:`, error);
            }
            this.socket = null;
            this.rawSocket = null;
        }
        this.status = 'disconnected';
        this.qrCode = null;
        this.qrContent = null;
        this.qrCodeUpdatedAt = null;
        this.qrScanReceivedAt = null;
        this.linkingGraceUntil = null;
        this.pairingCode = null;
        this.connectionIssue = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        this._emitStatusChange();
    }

    _behaviorProfile() {
        return normalizeBehaviorProfile(this.behaviorSettings || {});
    }

    _preservesPhoneNotifications() {
        const profile = this._behaviorProfile();
        return !!this.behaviorSettings?.phoneNotificationsEnabled
            || profile === BEHAVIOR_PROFILES.NOTIFICATION_BALANCED
            || profile === BEHAVIOR_PROFILES.NOTIFICATION_MAX;
    }

    /** Staff Web/Desktop coexistence: stand down on conflict, stay presence-passive. */
    _isMultiDeviceCoexist() {
        return !!this.behaviorSettings?.multiDeviceCoexist;
    }

    /** Demo / trial-style lines: 428 stand-down then progressive quiet resume, not a fight. */
    _isDemoQuietConflictLine() {
        return /\bdemo\b/i.test(String(this.name || ''));
    }

    /** Demo names + trial/ATK/ATK2: 20–50s → 1–5m → 30m → stop. */
    _usesDemoResumeCurve() {
        return this._isDemoQuietConflictLine() || this._isTyrejobsProtectedLine();
    }

    _usesQuietConflictResume() {
        if (this._usesDemoResumeCurve()) return true;
        return this._isMultiDeviceCoexist() && !this._groupAlertModeEnabled();
    }

    /** Passive companion presence so phone/staff Web keep push + don't fight Wasup. */
    _shouldStayPresencePassive() {
        return this._preservesPhoneNotifications() || this._isMultiDeviceCoexist();
    }

    /** Baileys tip: re-assert unavailable so WA keeps delivering phone push. */
    async _reassertPassivePresence() {
        if (!this._shouldStayPresencePassive() || !this.socket) return;
        try {
            await this.socket.sendPresenceUpdate('unavailable');
        } catch (_) {
            /* socket may be mid-close */
        }
    }

    _isNotificationMaxProfile() {
        return this._behaviorProfile() === BEHAVIOR_PROFILES.NOTIFICATION_MAX;
    }

    _notificationGraceMs() {
        return this._preservesPhoneNotifications()
            ? clampNotificationGraceMs(this.behaviorSettings?.notificationGraceMs)
            : 0;
    }

    async _waitForNotificationGrace(startedAtMs) {
        const graceMs = this._notificationGraceMs();
        if (!graceMs) return;
        const elapsedMs = Date.now() - (startedAtMs || Date.now());
        const remainingMs = graceMs - elapsedMs;
        if (remainingMs > 0) {
            await delay(remainingMs);
        }
    }
    
    /**
     * ANTI-BAN: Start presence cycling
     * Randomly toggles online/offline status to appear more natural
     */
    _startPresenceCycling() {
        // Clear any existing interval
        this._stopPresenceCycling();

        // Phone-notifications / shared-devices: never cycle presence.
        if (this._shouldStayPresencePassive()) return;
        // Antiban advanced toggle — presenceCycling module (default ON).
        if (this.antibanV2 && !isModuleOn(this.antibanV2, 'presenceCycling')) {
            this._log('Presence cycling skipped (antiban module off)', 'info');
            return;
        }
        
        // Cycle presence every 3-7 minutes
        const cyclePresence = async () => {
            if (!this.socket || this.status !== 'connected') return;
            if (this._shouldStayPresencePassive()) return;
            if (this.antibanV2 && !isModuleOn(this.antibanV2, 'presenceCycling')) return;
            
            try {
                const random = Math.random();
                if (random < 0.3) {
                    // 30% chance to go offline
                    await this.socket.sendPresenceUpdate('unavailable');
                    console.log(`[Instance ${this.id}] Presence: unavailable (stealth)`);
                } else {
                    // 70% chance to stay/go online
                    await this.socket.sendPresenceUpdate('available');
                    console.log(`[Instance ${this.id}] Presence: available`);
                }
            } catch (error) {
                console.error(`[Instance ${this.id}] Presence cycle error:`, error.message);
            }
        };
        
        // Random interval between 3-7 minutes
        const getRandomInterval = () => (180000 + Math.random() * 240000); // 3-7 min
        
        const scheduleNext = () => {
            this.presenceCycleInterval = setTimeout(async () => {
                await cyclePresence();
                scheduleNext();
            }, getRandomInterval());
        };
        
        // Start cycling
        scheduleNext();
        this._log('Presence cycling started (anti-ban)', 'info');
    }
    
    /**
     * ANTI-BAN: Stop presence cycling
     */
    _stopPresenceCycling() {
        if (this.presenceCycleInterval) {
            clearTimeout(this.presenceCycleInterval);
            this.presenceCycleInterval = null;
        }
    }

    /**
     * Called by antiban-v2 when the instance's risk level changes.
     * Logs locally and (optionally) fires a webhook alert.
     */
    _onRiskChange(change) {
        const { from, to, status } = change;
        const dirUp = ['low', 'medium', 'high', 'critical'].indexOf(to) > ['low', 'medium', 'high', 'critical'].indexOf(from);
        const level = to === 'critical' ? 'error' : to === 'high' ? 'warning' : to === 'medium' ? 'warning' : 'info';
        this._log(`Anti-ban risk: ${from || '?'} → ${to} (score ${status?.score ?? '?'}). ${status?.recommendation || ''}`, level);

        // Per-instance webhook alert (only on upward transitions to avoid flapping spam)
        if (dirUp && this.antibanV2?.alertsWebhook) {
            this._fireAlertWebhook(this.antibanV2.alertsWebhook, change).catch((err) => {
                this._log(`Alert webhook failed: ${err.message}`, 'warning');
            });
        }

        // Global deployment-level alert (env var) — also only on upward transitions ≥ medium
        if (dirUp && (to === 'medium' || to === 'high' || to === 'critical') && process.env.ALERT_WEBHOOK_URL) {
            this._fireAlertWebhook(process.env.ALERT_WEBHOOK_URL, change).catch((err) => {
                console.warn(`[Instance ${this.id}] Global alert webhook failed: ${err.message}`);
            });
        }
    }

    async _fireAlertWebhook(url, change) {
        const axios = (await import('axios')).default;
        await axios.post(url, {
            event: 'antiban_risk_change',
            instanceId: this.id,
            instanceName: this.name,
            region: process.env.REGION_CODE || null,
            phone: this.connectedPhone,
            old_risk: change.from,
            new_risk: change.to,
            score: change.status?.score,
            recommendation: change.status?.recommendation,
            reasons: change.status?.reasons,
            timestamp: new Date().toISOString(),
        }, { timeout: 8000, headers: { 'Content-Type': 'application/json' } });
    }
    
    /**
     * Clear auth data (logout + delete credentials).
     * By default keeps tctoken / lid-mapping / device-list files so a re-pair
     * on the same number does not throw away warm-contact privacy tokens.
     * Pass { preservePrivacyTokens: false } for a full wipe.
     */
    async clearAuth(options = {}) {
        const preservePrivacyTokens = options.preservePrivacyTokens !== false;
        console.log(
            `[Instance ${this.id}] Clearing auth...` +
            (preservePrivacyTokens ? ' (preserving privacy tokens)' : ' (full wipe)')
        );
        this._cancelPairingRestartTimer();
        this._cancelConflictReconnectTimer();
        this._cancelSharedDeviceResumeTimer();
        this.activeConnectGeneration += 1;
        this.qrRefreshRestartCount = 0;
        this.staleProtocolResetCount = 0;
        this.sharedDeviceResumeAttempts = 0;
        
        // Disconnect first if connected
        if (this.socket) {
            try {
                this.socket.ev?.removeAllListeners?.();
                await this.socket.logout();
            } catch (e) {
                console.log(`[Instance ${this.id}] Logout during clear auth:`, e.message);
            }
            this.socket = null;
            this.rawSocket = null;
        }
        
        this.status = 'disconnected';
        this.qrCode = null;
        this.qrContent = null;
        this.qrCodeUpdatedAt = null;
        this.qrScanReceivedAt = null;
        this.linkingGraceUntil = null;
        this.lastCredsUpdateAt = null;
        this.lastCredsUpdateSummary = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        if (this._isTyrejobsProtectedLine()) {
            this.postLimitQuiet = resetRegisteredAt(this.postLimitQuiet);
            void this._savePostLimitQuietState();
        }
        this.connectionIssue = null;
        this.reachoutTimeLock = null;
        this.newChatMessageCap = null;
        try { fsSync.unlinkSync(this._reachoutCachePath()); } catch (_) {}
        this._emitStatusChange();
        
        try {
            const preserved = preservePrivacyTokens
                ? await this._snapshotPrivacyTokenFiles()
                : { count: 0, files: [] };
            await this._clearLocalAuthFiles();
            if (preservePrivacyTokens && preserved.files.length) {
                await this._restorePrivacyTokenFiles(preserved.files);
                this._log(
                    `Auth cleared for re-pair — restored ${preserved.files.length} privacy/mapping files (tctoken/lid/device-list)`,
                    'info'
                );
            } else {
                this._log(
                    preservePrivacyTokens
                        ? 'Auth cleared - ready for new QR scan (no privacy tokens to preserve)'
                        : 'Auth cleared (full wipe) - ready for new QR scan',
                    'info'
                );
            }
        } catch (error) {
            console.error(`[Instance ${this.id}] Clear auth error:`, error);
            throw error;
        }
    }

    _isPrivacyTokenPreserveFile(name) {
        if (!name || name.includes('__index')) return false;
        return (
            name.startsWith('tctoken-')
            || name.startsWith('lid-mapping-')
            || name.startsWith('device-list-')
        );
    }

    async _snapshotPrivacyTokenFiles() {
        const out = [];
        try {
            if (!fsSync.existsSync(this.authFolder)) return { count: 0, files: out };
            const names = await fs.readdir(this.authFolder);
            for (const name of names) {
                if (!this._isPrivacyTokenPreserveFile(name)) continue;
                const full = path.join(this.authFolder, name);
                try {
                    const st = await fs.stat(full);
                    if (!st.isFile()) continue;
                    const data = await fs.readFile(full);
                    out.push({ name, data });
                } catch (_) { /* skip unreadable */ }
            }
        } catch (_) { /* empty auth */ }
        return { count: out.length, files: out };
    }

    async _restorePrivacyTokenFiles(files = []) {
        await fs.mkdir(this.authFolder, { recursive: true });
        for (const file of files) {
            if (!file?.name || !this._isPrivacyTokenPreserveFile(file.name)) continue;
            await fs.writeFile(path.join(this.authFolder, file.name), file.data);
        }
    }

    async _clearLocalAuthFiles(reason) {
        console.log(`[Instance ${this.id}] Deleting auth folder: ${this.authFolder}`);
        await fs.rm(this.authFolder, { recursive: true, force: true });
        await fs.mkdir(this.authFolder, { recursive: true });
        console.log(`[Instance ${this.id}] Auth folder cleared and recreated`);
        if (reason) this._log(reason, 'warning');
    }
    
    /**
     * Update the WhatsApp profile display name (push name visible to everyone)
     * @param {string} name - The display name
     */
    async updateProfileName(name) {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        await this.socket.updateProfileName(name);
        this._log(`Profile name updated to "${name}"`, 'success');
    }
    
    /**
     * Update the WhatsApp profile picture
     * @param {string} imageUrl - URL or local path to the image
     */
    async updateProfilePicture(imageUrl) {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        await this.socket.updateProfilePicture(this.socket.user.id, { url: imageUrl });
        this._log('Profile picture updated', 'success');
    }
    
    /**
     * Remove the WhatsApp profile picture
     */
    async removeProfilePicture() {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        await this.socket.removeProfilePicture(this.socket.user.id);
        this._log('Profile picture removed', 'success');
    }
    
    /**
     * Update the WhatsApp profile "About" / status text
     * @param {string} status - The about text
     */
    async updateProfileStatus(status) {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        await this.socket.updateProfileStatus(status);
        this._log(`Profile status updated to "${status}"`, 'success');
    }
    
    /**
     * Build a transport-native message object from rich message parameters.
     * @param {Object} params - Message parameters
     * @param {string} params.messageType - text|image|video|document|audio|buttons|list|location|contact
     * @param {string} params.text - Text body / caption
     * @param {string} params.mediaUrl - URL for image/video/document/audio
     * @param {string} params.mimeType - MIME type for document/audio
     * @param {string} params.fileName - File name for documents
     * @param {boolean} params.ptt - Push-to-talk (voice note) flag for audio
     * @param {string} params.footer - Footer text for buttons/lists
     * @param {Array} params.buttons - Array of { id, text } for button messages
     * @param {string} params.buttonText - Button label for list messages (e.g. "Menu")
     * @param {string} params.title - Title for list messages
     * @param {Array} params.sections - Array of { title, rows: [{ title, id, description }] }
     * @param {number} params.latitude - Latitude for location messages
     * @param {number} params.longitude - Longitude for location messages
     * @param {string} params.locationName - Name of the location
     * @param {string} params.locationAddress - Address of the location
     * @param {Object} params.contactCard - { displayName, phoneNumber } for contact messages
     * @returns {Object} Outbound message object for sendMessage
     */
    _buildMessageObject(params) {
        const type = (params.messageType || 'text').toLowerCase();

        switch (type) {
            case 'image':
                return {
                    image: { url: params.mediaUrl },
                    caption: params.text || ''
                };

            case 'video':
                return {
                    video: { url: params.mediaUrl },
                    caption: params.text || ''
                };

            case 'document':
                return {
                    document: { url: params.mediaUrl },
                    mimetype: params.mimeType || 'application/octet-stream',
                    fileName: params.fileName || 'document'
                };

            case 'audio':
                return {
                    audio: { url: params.mediaUrl },
                    mimetype: params.mimeType || 'audio/mp4',
                    ptt: params.ptt !== false
                };

            // Buttons & lists use the interactive helper to inject the required binary
            // nodes (biz, interactive, native_flow, bot) so they render on iOS/Android
            case 'buttons':
            case 'list':
                return { _useHelper: true, _params: params, _type: type };

            case 'location':
                return {
                    location: {
                        degreesLatitude: params.latitude || 0,
                        degreesLongitude: params.longitude || 0,
                        name: params.locationName || '',
                        address: params.locationAddress || ''
                    }
                };

            case 'contact': {
                const c = params.contactCard || {};
                const name = c.displayName || 'Unknown';
                const phone = c.phoneNumber || '';
                const vcard = [
                    'BEGIN:VCARD',
                    'VERSION:3.0',
                    `FN:${name}`,
                    `TEL;type=CELL;type=VOICE;waid=${phone.replace(/[^\d]/g, '')}:${phone}`,
                    'END:VCARD'
                ].join('\n');
                return {
                    contacts: {
                        displayName: name,
                        contacts: [{ vcard }]
                    }
                };
            }

            case 'text':
            default:
                return { text: params.text || '' };
        }
    }

    /**
     * Send interactive buttons/list via helper (injects biz/bot binary nodes)
     */
    async _sendWithHelper(jid, params, type) {
        if (type === 'buttons') {
            const helperButtons = (params.buttons || []).map(b => ({
                id: b.id || `btn_${Math.random().toString(36).slice(2, 6)}`,
                text: b.text || 'Button'
            }));
            await sendButtons(this.socket, jid, {
                text: params.text || '',
                footer: params.footer || '',
                buttons: helperButtons
            });
        } else if (type === 'list') {
            const listButton = {
                name: 'single_select',
                buttonParamsJson: JSON.stringify({
                    title: params.buttonText || 'Menu',
                    sections: (params.sections || []).map(s => ({
                        title: s.title || 'Options',
                        rows: (s.rows || []).map((r, i) => ({
                            title: r.title || `Option ${i + 1}`,
                            id: r.id || `row_${i}`,
                            description: r.description || ''
                        }))
                    }))
                })
            };
            await sendInteractiveMessage(this.socket, jid, {
                text: params.text || '',
                footer: params.footer || '',
                interactiveButtons: [listButton]
            });
        }
        this.antiBanManager.recordMessage(jid);
        return { sent: true };
    }

    async _sendNativeInteractive(jid, interactiveContent, behaviorOptions = {}) {
        if (behaviorOptions.typingSimulation) {
            try { await this.socket.sendPresenceUpdate('composing', jid); } catch (_) {}
            await delay(1000 + Math.random() * 2000);
            try { await this.socket.sendPresenceUpdate('paused', jid); } catch (_) {}
        }

        await sendInteractiveViaHelper(this.socket, jid, interactiveContent);
        this.antiBanManager.recordMessage(jid);
        return { sent: true, via: 'interactive-native' };
    }

    /**
     * Send an emoji reaction to a message
     * @param {string} to - Phone number or JID of the chat
     * @param {string} messageId - ID of the message to react to
     * @param {string} emoji - Emoji to react with (empty string to remove)
     * @param {boolean} fromMe - Whether the target message was sent by us
     */
    async sendReaction(to, messageId, emoji, fromMe = false) {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        const normalizedTo = to.includes('@') ? to : to.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
        const jid = normalizedTo.includes('@') ? normalizedTo : `${normalizedTo}@s.whatsapp.net`;

        await this.socket.sendMessage(jid, {
            react: {
                text: emoji || '',
                key: {
                    remoteJid: jid,
                    id: messageId,
                    fromMe: !!fromMe
                }
            }
        });
        this._log(`Reacted ${emoji || '(removed)'} to message ${messageId}`, 'success');
        return { sent: true, emoji, messageId };
    }

    /**
     * Send a message (text, media, buttons, list, location, contact)
     * @param {string} to - Phone number or JID
     * @param {string|Object} textOrParams - Plain text string OR rich message params object
     * @param {Object} options - Override behavior settings for this message
     * @param {string} options.contactName - Optional name for saving the contact
     * @param {boolean} options.skipContactSave - Skip saving contact (default: false)
     */
    async sendMessage(to, textOrParams, options = {}) {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        
        // Normalize phone number - remove +, spaces, dashes, etc.
        const normalizedTo = to.includes('@') ? to : to.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
        
        // Prefer PN JID for 1:1 (tctoken attaches to PN when lidTrustedTokenIssueToLid=false).
        const jid = await this._resolveOutboundJid(normalizedTo);

        // Optional: block API/AI sends while this chat is in human handoff (PN+LID aware).
        // Override with options.forceDespiteHandoff / allowDuringHandoff, or turn off
        // handoffSettings.blockApiSendsDuringHandoff.
        if (
            this.handoffSettings.blockApiSendsDuringHandoff !== false
            && !options.forceDespiteHandoff
            && !options.allowDuringHandoff
        ) {
            const handoff = this._findHandoffEntry(jid) || this._findHandoffEntry(normalizedTo);
            if (handoff) {
                throw new Error(
                    `Human handoff active for ${handoff.key} — API/AI sends blocked. `
                    + `Pass forceDespiteHandoff=true to override, or disable blockApiSendsDuringHandoff.`
                );
            }
        }

        // After 6h quiet: live tctoken → send job (text or buttons).
        // No token / expired → hold. Never invent a CTA for a cold contact.
        if (this._isTyrejobsProtectedLine() || this._isColdOptInGateActive()) {
            options.skipContactSave = true;
        }
        if (this._isTyrejobsProtectedLine() && this._isTyrejobsPostLinkSendHold()) {
            const held = this._maybeHoldJobUntilHumanReply(jid, normalizedTo);
            if (held) return held;
            return this._policyBlock(
                'post-link-hold',
                'TyreJobs hold — waiting 6 hours after connect/status sync before any outbound'
            );
        }
        if (this._isTokenOnlyOutbound()) {
            const warm = await this._tyrejobsHasUsablePrivacyToken(jid);
            if (!warm) {
                const held = this._maybeHoldJobUntilHumanReply(jid, normalizedTo);
                if (held) return held;
                return this._policyBlock(
                    'cold-blocked',
                    'No usable tctoken — nothing sent (token-only worker)'
                );
            }
        }

        // Hard stop before any WA IQ (onWhatsApp / save-contact / send).
        // Companion cold during lock extends the restriction.
        this._expireReachoutTimeLockIfNeeded('send:expiry');
        if (this._isReachoutTimeLockBlocking() && !options.forceDespiteTimelock) {
            const until = this.reachoutTimeLock.timeEnforcementEnds || 'unknown';
            const type = this.reachoutTimeLock.enforcementType || 'DEFAULT';
            return this._policyBlock(
                'reachout-timelock',
                `Reachout timelock active (${type}) until ${until} — companion cold sends are blocked by WhatsApp`
            );
        }

        if (!options.skipOnWhatsApp) {
            const unknown = await this._maybeBlockUnknownWhatsApp(jid, normalizedTo, options);
            if (unknown) return unknown;
        }

        // Content variation (global module and/or per-send contentVariation for marketing blasts).
        textOrParams = this._applyOutboundContentVariation(textOrParams, options);

        // Mark before send so fromMe upserts during ack wait are not treated as manual handoff.
        this._markBotOutbound(jid);
        
        // Check rate limits (skip when anti-ban v2 is explicitly turned off)
        if (this._isAntibanV2Enforcing()) {
            const canSend = this.antiBanManager.canSendMessage(jid);
            if (!canSend.allowed) {
                throw new Error(`Rate limited: ${canSend.reason}`);
            }
        }
        
        // Anti-ban: Save contact before sending (Unknown User {last4})
        if (!options.skipContactSave) {
            await this._saveContactBeforeMessage(jid, options.contactName);
        }

        // Per-contact 463 circuit — never retry a contact that just NACK'd (extends lock).
        const circuitKey = circuitKeyForJid(jid);
        const circuitUntil = circuitKey ? this.contact463Circuit.get(circuitKey) : null;
        if (circuitUntil && Date.now() < circuitUntil && !options.forceDespiteTimelock) {
            return this._policyBlock(
                '463-circuit',
                `Contact ${circuitKey} is on a 463 circuit until ${new Date(circuitUntil).toISOString()} — do not retry cold sends`
            );
        }

        // Warm/cold classification via persisted tctoken (Baileys attaches on send when present).
        let tokenProbe = null;
        if (!options.skipPrivacyToken) {
            try {
                const sendOptions = {
                    ...options,
                    blockColdWithoutToken:
                        options.blockColdWithoutToken === true
                        || (this.behaviorSettings?.blockColdWithoutToken === true && options.allowColdWithoutToken !== true),
                };
                tokenProbe = await this._ensurePrivacyTokenBeforeSend(jid, sendOptions);
            } catch (err) {
                if (/Cold send blocked/i.test(err.message || '')) {
                    return this._policyBlock('cold-blocked', err.message);
                }
                throw err;
            }
        }
        
        // Build the outbound message object
        let messageObj;
        let logText;
        let interactiveContent = null;
        if (typeof textOrParams === 'string') {
            messageObj = { text: textOrParams };
            logText = textOrParams;
        } else if (typeof textOrParams === 'object' && textOrParams !== null) {
            if (textOrParams.__wasupInteractiveContent) {
                interactiveContent = textOrParams.__wasupInteractiveContent;
                messageObj = textOrParams;
                logText = textOrParams.__wasupMessageText || textOrParams.text || '[interactive]';
            } else {
                messageObj = this._buildMessageObject(textOrParams);
                logText = textOrParams.text || `[${textOrParams.messageType || 'rich'}]`;
            }
        } else {
            messageObj = { text: String(textOrParams) };
            logText = String(textOrParams);
        }
        
        // Merge instance behavior settings with per-message overrides.
        const phoneNotifsOn = this._preservesPhoneNotifications();
        const behaviorOptions = {
            typingSimulation: options.typingSimulation !== undefined
                ? options.typingSimulation
                : (this._isNotificationMaxProfile() ? false : this.behaviorSettings.typingSimulation),
            delayEnabled: options.delayEnabled !== undefined 
                ? options.delayEnabled 
                : this.behaviorSettings.delayEnabled
        };
        
        let result;

        // Native CTA / mixed interactive messages use baileys_helpers hydratedTemplate
        if (interactiveContent) {
            result = await this._sendNativeInteractive(jid, interactiveContent, behaviorOptions);
        // Interactive messages (buttons/lists) go through the interactive helper
        } else if (messageObj._useHelper) {
            if (behaviorOptions.typingSimulation) {
                try { await this.socket.sendPresenceUpdate('composing', jid); } catch (_) {}
                await delay(1000 + Math.random() * 2000);
                try { await this.socket.sendPresenceUpdate('paused', jid); } catch (_) {}
            }
            result = await this._sendWithHelper(jid, messageObj._params, messageObj._type);
        } else if (this._isAntibanV2Enforcing()) {
            // Anti-ban v2 path: the wrapped socket already runs the full pipeline
            // (rate limiting, warmup, presence choreographer, JID canonicalization,
            // post-reconnect throttle, etc.). We just call sendMessage directly.
            try {
                // Always pass send opts object — baileys-antiban 4.x crashes on undefined
                // when it reads options.circuitBreaker inside the wrapped sendMessage.
                const sentMsg = await this.socket.sendMessage(jid, messageObj, {});
                this.antiBanManager.recordMessage(jid); // also tick legacy stats
                result = { sent: true, key: sentMsg?.key, status: sentMsg?.status, via: 'antiban-v2' };
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                if (isAntibanTransportGuardMessage(errMsg)) {
                    result = { sent: false, reason: errMsg, via: 'antiban-v2-blocked' };
                } else {
                    throw err;
                }
            }
        } else if (this._isAntibanOff()) {
            // Switch OFF = zero anti-ban. Raw send, no rate limits / antiban delays.
            const sock = this.rawSocket || this.socket;
            if (behaviorOptions.typingSimulation) {
                try { await sock.sendPresenceUpdate('composing', jid); } catch (_) {}
                await delay(400 + Math.random() * 600);
                try { await sock.sendPresenceUpdate('paused', jid); } catch (_) {}
            }
            const sentMsg = await sock.sendMessage(jid, messageObj);
            result = { sent: true, key: sentMsg?.key, status: sentMsg?.status, via: 'raw-no-antiban' };
        } else {
            // Anti-ban enabled but pipeline not live yet — still skip hard rate blocks.
            result = await safeSendMessage(this.socket, jid, messageObj, '', this.antiBanManager, {
                ...behaviorOptions,
                skipRateLimits: true,
            });
        }

        // Baileys resolves sendMessage before WA server ACK. Error 463 (account
        // restricted / missing tctoken) arrives as messages.update shortly after.
        // Track bot-sent IDs BEFORE ack wait — fromMe echo often arrives during the wait
        // and used to falsely arm human handoff (TyreFlow leads → bashir/owner numbers).
        if (result?.sent && result?.key?.id) {
            this._markBotOutbound(jid, result.key.id);
            if (typeof result.status === 'number' && result.status >= 2) {
                this._noteOutboundAck(result.key.id, result.status, result.key.remoteJid || jid);
            }
            if (this.behaviorSettings?.skipOutboundAckWait) {
                this._log(
                    `ACK wait skipped (fire-and-forget) ${result.key.id} — marked sent, doNotRetry`,
                    'info'
                );
                this._recordOutboundDelivery(result.key.id, {
                    status: 'sent',
                    remoteJid: result.key.remoteJid || jid,
                    doNotRetry: true,
                    ackWaitSkipped: true,
                });
                result = {
                    ...result,
                    sent: true,
                    doNotRetry: true,
                    ackWaitSkipped: true,
                    via: result.via ? `${result.via}+fire-and-forget` : 'fire-and-forget',
                };
            } else {
                result = await this._awaitOutboundServerAck(result);
            }
        }
        
        if (result.sent) {
            // Ensure tracking even if key arrived late / ack path mutated result
            this._markBotOutbound(jid, result.key?.id || null);
            
            this._log(`Sent to ${to}: ${logText.substring(0, 50)}...`, 'success');
            this._logMessage('outbound', this.connectedPhone || this.id, normalizedTo, logText, result.key?.id);

            if (result.key?.id) {
                this._recordOutboundDelivery(result.key.id, {
                    toPhone: normalizedTo,
                    preview: String(logText || '').substring(0, 120),
                    status: normalizeMessageStatus(result.status) || 'sent',
                    doNotRetry: true,
                });
            }

            // Re-assert 'unavailable' after send (phone-push and/or shared-devices).
            // Without this, composing/send can leave the companion "online" and silence the phone.
            await this._reassertPassivePresence();
        }

        if (result?.reason) {
            result = { ...result, reason: sanitizeClientReason(result.reason) };
        }

        if (tokenProbe) {
            result = {
                ...result,
                privacyToken: {
                    present: !!tokenProbe.present,
                    expired: !!tokenProbe.expired,
                    cold: !!tokenProbe.cold,
                    storageJid: tokenProbe.storageJid || null,
                },
            };
        }

        if (result?.sent && options._atk2OptInCtaPhone) {
            this._markAtk2OptInCtaSent(options._atk2OptInCtaPhone, options._atk2OptInCtaVariant);
            result = {
                ...result,
                skippedJob: true,
                doNotRetry: true,
                via: 'opt-in-cta',
                reason: `Opt-in CTA sent to ${options._atk2OptInCtaPhone} — job held until a tctoken exists`,
            };
        }

        return result;
    }

    /**
     * Hold the send until WA SERVER_ACK / NACK, polling every 2s for up to 1 minute.
     * ACK early → return as soon as status lands. Real NACK (463 / status 0) → failed.
     * After 1m with no NACK but a real WA id → sent (not failed). Companion sockets
     * often never emit SERVER_ACK while WhatsApp still delivered (Samantha / dental).
     * Returning failed here made n8n cron unlock-and-resend the same opener.
     */
    async _awaitOutboundServerAck(result, waitMs = OUTBOUND_ACK_WAIT_MS) {
        const id = result?.key?.id;
        if (!id) return result;

        this._recordOutboundDelivery(id, {
            status: 'pending',
            remoteJid: result?.key?.remoteJid || null,
            sentAt: new Date().toISOString(),
            doNotRetry: true,
        });

        const deadline = Date.now() + waitMs;
        while (true) {
            const nack = this.outboundAckErrors.get(id);
            if (nack) {
                this.outboundAckErrors.delete(id);
                this.outboundAckStatus.delete(id);
                const code = String(nack.code || 'error');
                const reason = code === '463'
                    ? 'WhatsApp 463: missing privacy token (tctoken) for this contact — new-chat gate (other linked devices may still work for established chats)'
                    : `WhatsApp rejected message (ack error ${code})`;
                if (code === '463') {
                    this._tripContact463Circuit(nack.remoteJid || result?.key?.remoteJid, 'server-nack');
                }
                this._recordOutboundDelivery(id, {
                    status: 'failed',
                    reason,
                    remoteJid: nack.remoteJid || result?.key?.remoteJid || null,
                    doNotRetry: code === '463',
                });
                this._cancelOutboundAckWatch(id);
                const out = {
                    ...result,
                    sent: false,
                    status: 0,
                    reason,
                    ackError: code,
                    doNotRetry: code === '463',
                    via: result.via || 'server-nack'
                };
                if (code === '463' && this.reachoutTimeLock) {
                    out.reachoutTimeLock = this.reachoutTimeLock;
                }
                return out;
            }

            const ack = this.outboundAckStatus.get(id);
            if (ack && ack.status >= 2) {
                this.outboundAckStatus.delete(id);
                this._recordOutboundDelivery(id, {
                    status: normalizeMessageStatus(ack.status) || 'sent',
                    remoteJid: ack.remoteJid || result?.key?.remoteJid || null,
                });
                this._cancelOutboundAckWatch(id);
                return {
                    ...result,
                    sent: true,
                    status: ack.status,
                    via: result.via || 'server-ack'
                };
            }

            if (Date.now() >= deadline) break;
            const sleepMs = Math.min(OUTBOUND_ACK_POLL_MS, Math.max(0, deadline - Date.now()));
            if (sleepMs <= 0) break;
            await delay(sleepMs);
        }

        // No NACK, real WA id already minted — message left the socket. Companion ACK
        // never showed up. Treat as sent so /api/send returns status:sent, not failed.
        this._log(
            `Server ACK not received within ${Math.round(waitMs / 1000)}s for ${id} — treating as sent (doNotRetry; message likely already delivered)`,
            'warning'
        );
        this._recordOutboundDelivery(id, {
            status: 'sent',
            remoteJid: result?.key?.remoteJid || null,
            doNotRetry: true,
            ackWatchTimedOut: true,
        });
        this._cancelOutboundAckWatch(id);
        return {
            ...result,
            sent: true,
            status: 2,
            ackPending: false,
            ackTimedOut: true,
            doNotRetry: true,
            via: 'server-ack-timeout-assumed'
        };
    }

    _noteOutboundAck(messageId, status, remoteJid = null) {
        if (!messageId) return;
        const numeric = typeof status === 'number' ? status : Number.parseInt(String(status), 10);
        if (!Number.isFinite(numeric) || numeric < 2) return;
        const prev = this.outboundAckStatus.get(messageId);
        if (prev && prev.status >= numeric) return;
        this.outboundAckStatus.set(messageId, {
            status: numeric,
            at: new Date().toISOString(),
            remoteJid: remoteJid || prev?.remoteJid || null,
        });
        if (this.outboundAckStatus.size > 500) {
            const first = this.outboundAckStatus.keys().next().value;
            this.outboundAckStatus.delete(first);
        }
        this._recordOutboundDelivery(messageId, {
            status: normalizeMessageStatus(numeric) || 'sent',
            remoteJid: remoteJid || prev?.remoteJid || null,
        });
        this._cancelOutboundAckWatch(messageId);
    }

    _cancelOutboundAckWatch(messageId) {
        const t = this._ackWatchTimers?.get(messageId);
        if (t) {
            clearTimeout(t);
            this._ackWatchTimers.delete(messageId);
        }
    }

    /** @deprecated kept as no-op cancel helper for older call sites */
    _scheduleOutboundAckWatch() {
        // HTTP now waits up to 1 minute synchronously; no post-response watch needed.
    }

    _recordOutboundDelivery(messageId, patch = {}) {
        if (!messageId) return;
        const prev = this.outboundDeliveryById.get(messageId) || {
            messageId,
            status: 'pending',
            statusAt: null,
            sentAt: new Date().toISOString(),
            fromPhone: this.connectedPhone || null,
            toPhone: null,
            preview: null,
            updates: [],
            doNotRetry: true,
        };

        const nextStatus = patch.status || prev.status;
        if (patch.status && !shouldAdvanceMessageStatus(prev.status, nextStatus) && nextStatus !== 'failed') {
            return;
        }

        const updates = Array.isArray(prev.updates) ? [...prev.updates] : [];
        if (patch.status && patch.status !== prev.status) {
            updates.push({
                status: patch.status,
                at: new Date().toISOString(),
                reason: patch.reason || null,
            });
            if (updates.length > 20) updates.splice(0, updates.length - 20);
        }

        const toPhone = patch.toPhone
            || prev.toPhone
            || (patch.remoteJid ? String(patch.remoteJid).split('@')[0].split(':')[0] : null);

        const entry = {
            ...prev,
            ...patch,
            messageId,
            status: nextStatus,
            statusAt: new Date().toISOString(),
            sentAt: patch.sentAt || prev.sentAt || new Date().toISOString(),
            toPhone,
            fromPhone: prev.fromPhone || this.connectedPhone || null,
            updates,
            doNotRetry: patch.doNotRetry !== undefined ? !!patch.doNotRetry : (prev.doNotRetry !== false),
        };
        this.outboundDeliveryById.set(messageId, entry);
        if (this.outboundDeliveryById.size > 2000) {
            const first = this.outboundDeliveryById.keys().next().value;
            this.outboundDeliveryById.delete(first);
        }
    }

    getMessageStatus(messageId) {
        if (!messageId) return null;
        const tracked = this.outboundDeliveryById.get(messageId);
        if (tracked) return { ...tracked };

        const ack = this.outboundAckStatus.get(messageId);
        if (ack) {
            return {
                messageId,
                status: normalizeMessageStatus(ack.status) || 'sent',
                statusAt: ack.at,
                sentAt: ack.at,
                fromPhone: this.connectedPhone || null,
                toPhone: ack.remoteJid ? String(ack.remoteJid).split('@')[0].split(':')[0] : null,
                preview: null,
                updates: [],
                doNotRetry: true,
            };
        }
        const nack = this.outboundAckErrors.get(messageId);
        if (nack) {
            return {
                messageId,
                status: 'failed',
                statusAt: nack.at,
                sentAt: nack.at,
                fromPhone: this.connectedPhone || null,
                toPhone: nack.remoteJid ? String(nack.remoteJid).split('@')[0].split(':')[0] : null,
                preview: null,
                updates: [],
                doNotRetry: String(nack.code) === '463',
                reason: `ack error ${nack.code}`,
            };
        }
        return null;
    }
    
    /**
     * Load LID cache from file
     */
    async _loadLidCache() {
        try {
            const merged = new Map();

            const ingestPair = (lid, pn) => {
                const cleanLid = String(lid || '').replace('@lid', '').replace('@s.whatsapp.net', '').trim();
                const cleanPn = String(pn || '').replace('@lid', '').replace('@s.whatsapp.net', '').trim();
                if (!cleanLid || !cleanPn || cleanLid === cleanPn) return;
                if (!/^\d+$/.test(cleanLid) || !/^\d+$/.test(cleanPn)) return;
                merged.set(cleanLid, cleanPn);
            };

            if (fsSync.existsSync(this.lidCacheFile)) {
                const entries = JSON.parse(await fs.readFile(this.lidCacheFile, 'utf8'));
                for (const [lid, pn] of Object.entries(entries || {})) {
                    ingestPair(lid, pn);
                }
            }

            if (fsSync.existsSync(this.authFolder)) {
                for (const name of fsSync.readdirSync(this.authFolder)) {
                    if (!name.startsWith('lid-mapping-') || !name.endsWith('.json')) continue;
                    const stem = name.slice('lid-mapping-'.length, -'.json'.length);
                    try {
                        const raw = JSON.parse(fsSync.readFileSync(path.join(this.authFolder, name), 'utf8'));
                        if (name.includes('_reverse')) {
                            ingestPair(stem.replace(/_reverse$/, ''), raw);
                        } else {
                            ingestPair(raw, stem);
                        }
                    } catch (_) { /* skip malformed mapping files */ }
                }
            }

            this.lidCache = merged;
            if (merged.size > 0) {
                console.log(`[Instance ${this.id}] Loaded ${merged.size} LID mappings from cache`);
            }
        } catch (e) {
            console.log(`[Instance ${this.id}] Could not load LID cache:`, e.message);
        }
    }

    /**
     * Resolve the best outbound JID for sendMessage.
     * Prefer PN (@s.whatsapp.net) for 1:1 sends. WA issues privacy tokens (tctoken)
     * to PN when lidTrustedTokenIssueToLid=false (current server default). Sending
     * to @lid first caused 463 NACKs on fresh contacts even when other linked
     * devices on the same phone could message fine.
     * @param {string} to - Phone number or JID
     * @returns {Promise<string>}
     */
    async _resolveOutboundJid(to) {
        if (to.includes('@g.us')) return to;
        if (to.includes('@s.whatsapp.net')) return to;

        // Explicit @lid input: map back to PN when we can
        if (to.includes('@lid')) {
            const lidId = to.replace('@lid', '').split(':')[0];
            const pn = await this._resolveLidToPhone(lidId);
            if (pn) return `${pn}@s.whatsapp.net`;
            return to;
        }

        const pn = to.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
        return `${pn}@s.whatsapp.net`;
    }
    
    /**
     * Save LID cache to file
     */
    async _saveLidCache() {
        try {
            const entries = Object.fromEntries(this.lidCache);
            await fs.writeFile(this.lidCacheFile, JSON.stringify(entries, null, 2));
        } catch (e) {
            console.log(`[Instance ${this.id}] Could not save LID cache:`, e.message);
        }
    }
    
    /**
     * Load saved contacts from file
     */
    async _loadSavedContacts() {
        try {
            if (fsSync.existsSync(this.savedContactsFile)) {
                const data = await fs.readFile(this.savedContactsFile, 'utf8');
                const contacts = JSON.parse(data);
                this.savedContacts = new Set(contacts);
                console.log(`[Instance ${this.id}] Loaded ${this.savedContacts.size} saved contacts from cache`);
            }
        } catch (e) {
            console.log(`[Instance ${this.id}] Could not load saved contacts:`, e.message);
        }
    }
    
    /**
     * Save saved contacts to file
     */
    async _saveSavedContacts() {
        try {
            const contacts = Array.from(this.savedContacts);
            await fs.writeFile(this.savedContactsFile, JSON.stringify(contacts, null, 2));
        } catch (e) {
            console.log(`[Instance ${this.id}] Could not save contacts cache:`, e.message);
        }
    }
    
    /**
     * Save a contact to WhatsApp before messaging (anti-ban measure)
     * @param {string} jid - The JID to save as contact
     * @param {string} contactName - Optional name for the contact
     * @returns {boolean} - True if saved successfully
     */
    async _saveContactBeforeMessage(jid, contactName = null) {
        // Skip group chats
        if (jid.includes('@g.us')) {
            return true;
        }

        // Always address-book against PN, named "Unknown User {last4}" like wasup2.
        let contactJid = jid;
        let phoneNumber = jid.replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0];
        if (jid.includes('@lid')) {
            const mappedPn = this.lidCache.get(phoneNumber);
            if (!mappedPn) {
                // Don't poison the address book with raw LID digits
                return false;
            }
            phoneNumber = mappedPn;
            contactJid = `${mappedPn}@s.whatsapp.net`;
        }

        if (this.savedContacts.has(contactJid) || this.savedContacts.has(jid)) {
            return true;
        }
        
        try {
            const name = contactName || `Unknown User ${String(phoneNumber).slice(-4)}`;
            
            console.log(`[Instance ${this.id}] Saving contact before message: ${phoneNumber} as "${name}"`);
            
            await Promise.race([
                this.socket.addOrEditContact(contactJid, {
                    fullName: name,
                    firstName: name,
                    saveOnPrimaryAddressbook: true
                }),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Contact save timed out')), 5000);
                })
            ]);
            
            this.savedContacts.add(contactJid);
            await this._saveSavedContacts();
            
            this._log(`Saved new contact: ${phoneNumber} as "${name}"`, 'info');
            return true;
        } catch (error) {
            console.error(`[Instance ${this.id}] Could not save contact:`, error.message);
            return false;
        }
    }

    /**
     * Ensure a usable privacy token exists before cold 1:1 send when possible.
     * Baileys/WA Web: 463 when outbound 1:1 has no <tctoken>.
     * Real tokens come from history sync or inbound privacy_token notifications
     * (Baileys rc13 persists both into useMultiFileAuthState `tctoken` keys).
     * Do NOT invent tokens; fake ones can skip the 463 NACK and still never deliver.
     */
    async _ensurePrivacyTokenBeforeSend(jid, options = {}) {
        if (!jid || jid.includes('@g.us')) {
            return { present: false, expired: false, cold: false };
        }
        const sock = this.rawSocket || this.socket;
        const probe = await lookupPrivacyToken(sock, this.lidCache, jid, this._privacyLookupExtraKeys(jid));

        if (probe.present && !probe.expired) {
            this.privacyTokenMetrics.tokenHits += 1;
            const mirrored = await mirrorPrivacyTokenToJid(sock, probe, jid);
            if (mirrored.mirroredTo) {
                this._log(
                    `Mirrored tctoken ${probe.storageJid} → ${mirrored.mirroredTo} so PN send carries the LID token`,
                    'info'
                );
            }
            return { ...mirrored, cold: false };
        }

        if (probe.present && probe.expired) {
            this.privacyTokenMetrics.tokenExpired += 1;
        } else {
            this.privacyTokenMetrics.tokenMisses += 1;
        }

        this.privacyTokenMetrics.coldSends += 1;
        const pnUser = jid.split('@')[0].split(':')[0];
        this._log(
            `No usable privacy token for ${pnUser}` +
            (probe.expired ? ' (expired ~28d window)' : ' yet') +
            ' — classified as COLD send (history sync / inbound token required)',
            'warning'
        );

        if (shouldBlockColdWithoutToken(options)) {
            this.privacyTokenMetrics.coldBlocked += 1;
            throw new Error(
                `Cold send blocked: no usable tctoken for ${pnUser}. ` +
                'Wait for history sync or an inbound message from this contact, or set allowColdWithoutToken=true / WASUP_BLOCK_COLD_WITHOUT_TOKEN=false'
            );
        }

        return { ...probe, cold: true };
    }

    _isTyrejobsColdOptInAllowlisted() {
        return isTyrejobsColdOptInExclusive({
            id: this.id,
            phone: this.connectedPhone || '',
        });
    }

    _clampColdOptInGate() {
        if (this.behaviorSettings) this.behaviorSettings.optInCtaOnce = false;
        if (isTyrejobsDedicatedWorker() || this._isTyrejobsColdOptInAllowlisted()) {
            if (this.behaviorSettings) {
                this.behaviorSettings.coldOptInGate = true;
                this.behaviorSettings.blockColdWithoutToken = true;
                this.behaviorSettings.optInCtaOnce = false;
            }
            return;
        }
        if (!this.behaviorSettings?.coldOptInGate) return;
        this.behaviorSettings.coldOptInGate = false;
        this._log(
            'coldOptInGate forced OFF — exclusive to trial-Tyrejobs / TyreJobs-ATK / ATK2',
            'warning'
        );
    }

    _isColdOptInGateActive() {
        if (isTyrejobsDedicatedWorker()) return this.behaviorSettings?.coldOptInGate !== false;
        return !!this.behaviorSettings?.coldOptInGate && this._isTyrejobsColdOptInAllowlisted();
    }

    /** Trial / ATK / ATK2 never send a job/media/CTA without a live tctoken. */
    _isTokenOnlyOutbound() {
        if (isTyrejobsDedicatedWorker()) return true;
        if (this._isTyrejobsColdOptInAllowlisted()) return true;
        return this._isColdOptInGateActive();
    }

    /** Hard-off. Dashboard / API cannot turn CTA back on for these lines. */
    _isOptInCtaOnceEnabled() {
        return false;
    }

    _isTyrejobsProtectedLine() {
        return isTyrejobsPostLimitLine({
            id: this.id,
            phone: this.connectedPhone || '',
        });
    }

    _isTyrejobsPostLinkSendHold() {
        return isPostLinkOutboundQuiet({
            status: this.status,
            connectedAt: this.connectedAt,
            registeredAt: this.postLimitQuiet?.registeredAt,
        });
    }

    _noteTyrejobsRegistered(source = 'unknown') {
        if (!this._isTyrejobsProtectedLine()) return;
        const creds = (this.rawSocket || this.socket)?.authState?.creds;
        if (!creds?.registered) return;
        const at = source === 'connect' && this.connectedAt
            ? this.connectedAt
            : new Date().toISOString();
        const next = noteRegisteredAt(this.postLimitQuiet, at);
        this.postLimitQuiet = next;
        if (!next.changed) return;
        void this._savePostLimitQuietState();
        const until = new Date(new Date(next.registeredAt).getTime() + POST_REGISTERED_QUIET_MS).toISOString();
        this._log(
            `TyreJobs registered=true (${source}) — no outbound until ${until} (6 hours after registered / status sync)`,
            'warning'
        );
    }

    async _loadJobReplyAllowState() {
        this.jobReplyAllowByPhone = new Map();
        try {
            const raw = await fs.readFile(this.jobReplyAllowFile, 'utf8');
            this.jobReplyAllowByPhone = parseJobReplyAllowFile(JSON.parse(raw));
        } catch (_) {
            /* first run */
        }
    }

    async _saveJobReplyAllowState() {
        try {
            await fs.mkdir(path.dirname(this.jobReplyAllowFile), { recursive: true });
            const obj = {};
            for (const [phone, entry] of this.jobReplyAllowByPhone.entries()) obj[phone] = entry;
            await fs.writeFile(this.jobReplyAllowFile, JSON.stringify(obj, null, 2));
        } catch (err) {
            this._log(`Failed to persist job reply allowlist: ${err.message}`, 'warning');
        }
    }

    _jobReplyPhoneKey(jidOrPhone) {
        const digits = String(jidOrPhone || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
        return digits.length >= 6 ? digits : null;
    }

    _noteTyrejobsHumanReply(phone, name) {
        if (!this._isColdOptInGateActive()) return false;
        const key = this._jobReplyPhoneKey(phone);
        if (!key) return false;
        const cleanName = normalizeJobReplyName(name);
        const prev = this.jobReplyAllowByPhone.get(key);
        if (prev && (!cleanName || prev.name === cleanName)) return false;
        const entry = {
            name: cleanName || prev?.name || null,
            phone: key,
            repliedAt: prev?.repliedAt || new Date().toISOString(),
        };
        this.jobReplyAllowByPhone.set(key, entry);
        if (this.jobReplyAllowByPhone.size > 5000) {
            const first = this.jobReplyAllowByPhone.keys().next().value;
            this.jobReplyAllowByPhone.delete(first);
        }
        const label = entry.name || 'unknown';
        this._log(
            prev
                ? `Job allowlist updated: ${label} (${key})`
                : `Job allowlist: ${label} (${key}) replied — jobs can send to this chat`,
            'success'
        );
        void this._saveJobReplyAllowState();
        return true;
    }

    async _tyrejobsHasUsablePrivacyToken(jid) {
        if (!jid || String(jid).includes('@g.us')) return false;
        try {
            const sock = this.rawSocket || this.socket;
            const probe = await lookupPrivacyToken(
                sock,
                this.lidCache,
                jid,
                this._privacyLookupExtraKeys(jid)
            );
            return !!(probe.present && !probe.expired);
        } catch (_) {
            return false;
        }
    }

    async _loadOptInCtaState() {
        this.optInCtaByPhone = new Map();
        this.optInCtaLastSentAt = 0;
        this.optInCtaNextAllowedAt = 0;
        this.optInCtaLastVariant = null;
        try {
            const raw = await fs.readFile(this.optInCtaFile, 'utf8');
            const parsed = parseOptInCtaState(JSON.parse(raw));
            this.optInCtaByPhone = parsed.byPhone;
            this.optInCtaLastSentAt = parsed.lastSentAt;
            this.optInCtaNextAllowedAt = parsed.nextAllowedAt;
            this.optInCtaLastVariant = parsed.lastVariant;
        } catch (_) {
            /* first run */
        }
    }

    async _saveOptInCtaState() {
        try {
            await fs.mkdir(path.dirname(this.optInCtaFile), { recursive: true });
            await fs.writeFile(
                this.optInCtaFile,
                JSON.stringify(serializeOptInCtaState({
                    lastSentAt: this.optInCtaLastSentAt,
                    nextAllowedAt: this.optInCtaNextAllowedAt,
                    lastVariant: this.optInCtaLastVariant,
                    byPhone: this.optInCtaByPhone,
                }), null, 2)
            );
        } catch (err) {
            this._log(`Failed to persist opt-in CTA state: ${err.message}`, 'warning');
        }
    }

    _claimAtk2OptInCtaSlot(phone, variant) {
        const key = this._jobReplyPhoneKey(phone);
        if (!key) return 0;
        const now = Date.now();
        const gapMs = randomOptInCtaGapMs();
        this.optInCtaLastSentAt = now;
        this.optInCtaNextAllowedAt = now + gapMs;
        this.optInCtaLastVariant = variant || null;
        this.optInCtaByPhone.set(key, {
            phone: key,
            sentAt: new Date(now).toISOString(),
            variant: variant || null,
            source: 'opt-in-cta',
        });
        void this._saveOptInCtaState();
        return gapMs;
    }

    _markAtk2OptInCtaSent(phone, variant) {
        const key = this._jobReplyPhoneKey(phone);
        if (!key) return;
        const prev = this.optInCtaByPhone.get(key);
        this.optInCtaByPhone.set(key, {
            phone: key,
            sentAt: prev?.sentAt || new Date().toISOString(),
            variant: variant || prev?.variant || null,
            source: 'opt-in-cta',
        });
        const waitMin = Math.round(Math.max(0, this.optInCtaNextAllowedAt - Date.now()) / 60000);
        this._log(
            `TyreJobs opt-in CTA sent to ${key} — this number will not get another CTA; next new fitter in ~${waitMin}m`,
            'success'
        );
        void this._saveOptInCtaState();
    }

    async _planAtk2OptInCta(_jid, _normalizedTo) {
        return null;
    }

    async _loadPostLimitQuietState() {
        this.postLimitQuiet = parsePostLimitQuiet(null);
        try {
            const raw = await fs.readFile(this.postLimitQuietFile, 'utf8');
            this.postLimitQuiet = parsePostLimitQuiet(JSON.parse(raw));
        } catch (_) {
            /* first run */
        }
        if (isCtaBlockedByPostLimit(this.postLimitQuiet)) {
            const until = this.postLimitQuiet.noCtaUntil;
            this.optInCtaNextAllowedAt = Math.max(this.optInCtaNextAllowedAt || 0, until);
            this._log(
                `TyreJobs CTA blackout until ${new Date(until).toISOString()} (5d after reconnect post-limit)`,
                'warning'
            );
        }
    }

    async _savePostLimitQuietState() {
        try {
            await fs.mkdir(path.dirname(this.postLimitQuietFile), { recursive: true });
            await fs.writeFile(
                this.postLimitQuietFile,
                JSON.stringify(serializePostLimitQuiet(this.postLimitQuiet), null, 2)
            );
        } catch (err) {
            this._log(`Failed to persist post-limit quiet: ${err.message}`, 'warning');
        }
    }

    _markTyrejobsLimited(reason) {
        if (!isTyrejobsPostLimitLine({ id: this.id, phone: this.connectedPhone || '' })) return;
        this.postLimitQuiet = markLimited(this.postLimitQuiet, reason);
        this.postLimitQuiet = resetRegisteredAt(this.postLimitQuiet);
        void this._savePostLimitQuietState();
        this._log(`TyreJobs marked limited (${reason}) — next connect starts a 5-day CTA blackout`, 'error');
    }

    _armTyrejobsPostLimitCtaQuiet() {
        if (!isTyrejobsPostLimitLine({ id: this.id, phone: this.connectedPhone || '' })) return;
        const armed = armAfterConnect(this.postLimitQuiet, this.connectedAt);
        this.postLimitQuiet = armed;
        if (!armed.changed) return;
        this.optInCtaNextAllowedAt = Math.max(this.optInCtaNextAllowedAt || 0, armed.noCtaUntil);
        void this._savePostLimitQuietState();
        void this._saveOptInCtaState();
        this._log(
            `TyreJobs CTA BLACKOUT until ${new Date(armed.noCtaUntil).toISOString()} — 5 days after this connect (was limited: ${armed.limitedReason})`,
            'error'
        );
    }

    _maybeHoldJobUntilHumanReply(jid, normalizedTo) {
        if (!this._isTokenOnlyOutbound() && !this._isColdOptInGateActive()) return null;
        if (!jid || String(jid).includes('@g.us')) return null;
        const phone = this._jobReplyPhoneKey(jid) || this._jobReplyPhoneKey(normalizedTo);
        if (!phone) return null;
        const fresh = this._isTyrejobsPostLinkSendHold();
        this._log(
            fresh
                ? `Job held for ${phone} — waiting for registered=true + 6h after status sync (nothing sent)`
                : `Job held for ${phone} — no usable tctoken yet (nothing sent)`,
            fresh ? 'error' : 'warning'
        );
        return {
            sent: true,
            skippedJob: true,
            doNotRetry: true,
            status: 2,
            via: 'job-reply-held',
            reason: fresh
                ? `Fresh companion — held ${phone} (nothing sent)`
                : `Waiting for a tctoken for ${phone} before sending jobs`,
        };
    }

    _policyBlock(via, reason) {
        this._log(reason, 'warning');
        return {
            sent: false,
            doNotRetry: true,
            status: 0,
            via,
            reason,
        };
    }

    _logWaAbProps(source = 'unknown') {
        const sock = this.rawSocket || this.socket;
        const props = sock?.serverProps;
        if (!props) {
            this._log(`WA AB props unavailable (${source})`, 'info');
            return;
        }
        const oneToOne = props.privacyTokenOn1to1 !== false;
        this._log(
            `WA AB props (${source}): 10518/privacyTokenOn1to1=${props.privacyTokenOn1to1 !== false}` +
            ` 9666/profilePic=${props.profilePicPrivacyToken !== false}` +
            ` 14303/issueToLid=${!!props.lidTrustedTokenIssueToLid}`,
            oneToOne ? 'info' : 'warning'
        );
        if (!oneToOne) {
            this._log('AB prop 10518 is OFF — 1:1 sends may go out without tctoken (463 risk)', 'error');
        }
    }

    async _loadOnWhatsAppCache() {
        this.onWhatsAppCache = new Map();
        try {
            const raw = await fs.readFile(this.onWhatsAppCacheFile, 'utf8');
            this.onWhatsAppCache = parseOnWhatsAppCache(JSON.parse(raw));
        } catch (_) {
            /* first run */
        }
    }

    async _saveOnWhatsAppCache() {
        try {
            await fs.mkdir(path.dirname(this.onWhatsAppCacheFile), { recursive: true });
            await fs.writeFile(
                this.onWhatsAppCacheFile,
                JSON.stringify(serializeOnWhatsAppCache(this.onWhatsAppCache))
            );
        } catch (err) {
            this._log(`Failed to persist onWhatsApp cache: ${err.message}`, 'warning');
        }
    }

    async _maybeBlockUnknownWhatsApp(jid, normalizedTo, options = {}) {
        if (!isOnWhatsAppPreflightEnabled()) return null;
        if (!jid || String(jid).includes('@g.us') || String(jid).includes('@lid')) return null;
        const phone = onWhatsAppCacheKey(jid) || onWhatsAppCacheKey(normalizedTo);
        if (!phone) return null;

        try {
            const sockProbe = this.rawSocket || this.socket;
            const warm = await lookupPrivacyToken(sockProbe, this.lidCache, jid, this._privacyLookupExtraKeys(jid));
            if (warm.present && !warm.expired) return null;
        } catch (_) {
            /* lookup is best-effort */
        }

        const cached = this.onWhatsAppCache.get(phone);
        if (cached && Date.now() - cached.checkedAt < ONWHATSAPP_CACHE_TTL_MS) {
            if (cached.exists === false) {
                return this._policyBlock(
                    'onwhatsapp-missing',
                    `onWhatsApp cache: ${phone} is not on WhatsApp — not spending reach-out budget`
                );
            }
            return null;
        }

        const queued = (this._onWhatsAppChain || Promise.resolve())
            .catch(() => null)
            .then(() => this._runOnWhatsAppUsync(phone));
        this._onWhatsAppChain = queued.then(() => null, () => null);
        return queued;
    }

    async _runOnWhatsAppUsync(phone) {
        const cached = this.onWhatsAppCache.get(phone);
        if (cached && Date.now() - cached.checkedAt < ONWHATSAPP_CACHE_TTL_MS) {
            if (cached.exists === false) {
                return this._policyBlock(
                    'onwhatsapp-missing',
                    `onWhatsApp cache: ${phone} is not on WhatsApp — not spending reach-out budget`
                );
            }
            return null;
        }

        const sock = this.rawSocket || this.socket;
        if (typeof sock?.onWhatsApp !== 'function') return null;

        try {
            const results = await Promise.race([
                sock.onWhatsApp(phone),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('onWhatsApp timeout')), ONWHATSAPP_TIMEOUT_MS);
                }),
            ]);
            const parsed = interpretOnWhatsAppResult(results, phone);
            if (!parsed.known) return null;
            this.onWhatsAppCache.set(phone, {
                exists: parsed.exists,
                jid: parsed.jid,
                lid: parsed.lid || null,
                checkedAt: Date.now(),
            });
            if (parsed.exists && parsed.lid) {
                const lidId = String(parsed.lid).replace('@lid', '').split(':')[0];
                if (lidId && lidId !== phone) {
                    await this._storeLidMapping(lidId, phone);
                }
            }
            if (this.onWhatsAppCache.size > 5000) {
                const first = this.onWhatsAppCache.keys().next().value;
                this.onWhatsAppCache.delete(first);
            }
            void this._saveOnWhatsAppCache();
            if (parsed.exists === false) {
                return this._policyBlock(
                    'onwhatsapp-missing',
                    `onWhatsApp: ${phone} is not on WhatsApp — not spending reach-out budget`
                );
            }
        } catch (err) {
            this._log(`onWhatsApp preflight failed for ${phone}: ${err.message} — continuing`, 'warning');
        }
        return null;
    }

    /**
     * Trip a per-contact circuit after 463. Retries count as more reach-outs.
     */
    _tripContact463Circuit(jid, source = 'unknown') {
        const key = circuitKeyForJid(jid);
        this.privacyTokenMetrics.nack463 += 1;
        this.privacyTokenMetrics.last463At = new Date().toISOString();
        this.privacyTokenMetrics.last463Jid = key || jid || null;
        if (!key) return;
        const until = Date.now() + CONTACT_463_CIRCUIT_MS;
        this.contact463Circuit.set(key, until);
        if (this.contact463Circuit.size > 2000) {
            const first = this.contact463Circuit.keys().next().value;
            this.contact463Circuit.delete(first);
        }
        this._log(
            `463 circuit OPEN for ${key} until ${new Date(until).toISOString()} (source=${source}) — do not retry`,
            'error'
        );
    }
    
    /**
     * Store a LID to PN mapping
     * @param {string} lid - LID (without @lid suffix)
     * @param {string} pn - Phone number
     */
    async _storeLidMapping(lid, pn) {
        if (!lid || !pn || lid === pn) return;
        
        // Clean up the values
        const cleanLid = lid.replace('@lid', '').replace('@s.whatsapp.net', '');
        const cleanPn = pn.replace('@lid', '').replace('@s.whatsapp.net', '');
        
        if (cleanLid === cleanPn) return;
        
        if (!this.lidCache.has(cleanLid)) {
            console.log(`[Instance ${this.id}] Caching LID mapping: ${cleanLid} -> ${cleanPn}`);
            this.lidCache.set(cleanLid, cleanPn);
            await this._saveLidCache();
        }
    }

    _privacyLookupExtraKeys(jid) {
        const extras = [];
        const user = String(jid || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
        if (!user || !this.authFolder) return extras;
        const files = [
            path.join(this.authFolder, `lid-mapping-${user}.json`),
            path.join(this.authFolder, `lid-mapping-${user}@s.whatsapp.net.json`),
            path.join(this.authFolder, `lid-mapping-${user}_reverse.json`),
        ];
        for (const file of files) {
            if (!fsSync.existsSync(file)) continue;
            try {
                const raw = JSON.parse(fsSync.readFileSync(file, 'utf8'));
                const other = String(raw || '').replace(/"/g, '').split('@')[0].replace(/[^\d]/g, '');
                if (!other) continue;
                if (String(jid).includes('@lid')) extras.push(`${other}@s.whatsapp.net`);
                else extras.push(`${other}@lid`);
            } catch (_) { /* skip */ }
        }
        return extras;
    }

    async inspectPrivacyForPhone(phoneOrJid) {
        const raw = String(phoneOrJid || '').trim();
        if (!raw) return { error: 'missing phone' };
        const jid = raw.includes('@') ? raw : `${raw.replace(/[^\d]/g, '')}@s.whatsapp.net`;
        const extra = this._privacyLookupExtraKeys(jid);
        const sock = this.rawSocket || this.socket;
        const probe = await lookupPrivacyToken(sock, this.lidCache, jid, extra);
        const user = jid.split('@')[0].split(':')[0];
        let mappedLid = null;
        for (const [lid, pn] of this.lidCache.entries()) {
            if (String(pn) === user) mappedLid = `${lid}@lid`;
        }
        return {
            phone: user,
            sendJid: jid,
            mappedLid,
            extraKeys: extra,
            lookupKeys: probe.lookupKeys || [],
            token: {
                present: !!probe.present,
                expired: !!probe.expired,
                storageJid: probe.storageJid || null,
                wouldMirrorTo: probe.present && !probe.expired && probe.storageJid !== jid ? jid : null,
            },
            blockColdWithoutToken: shouldBlockColdWithoutToken({
                blockColdWithoutToken: this.behaviorSettings?.blockColdWithoutToken === true,
            }),
        };
    }
    
    /**
     * Resolve phone number from JID (handles LID to PN mapping)
     * @param {Object} msg - Message object
     * @param {string} jid - JID (could be LID or PN format)
     * @returns {string} Phone number
     */
    async _resolvePhoneNumber(msg, jid) {
        // Check if it's a LID (@lid suffix)
        const isLID = jid.includes('@lid');
        
        if (!isLID) {
            // Regular phone number JID - just extract the number
            return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
        }
        
        const lidId = jid.replace('@lid', '').split(':')[0];
        console.log(`[Instance ${this.id}] Detected LID: ${lidId}`);
        
        // 1. Try to get PN from message alternate JID fields
        // remoteJidAlt is for DMs, participantAlt is for groups
        const altJid = msg?.key?.remoteJidAlt || msg?.key?.participantAlt;
        if (altJid && !altJid.includes('@lid')) {
            const pn = altJid.replace('@s.whatsapp.net', '').split(':')[0];
            console.log(`[Instance ${this.id}] Found PN from alt JID: ${pn}`);
            // Cache this mapping for future use
            await this._storeLidMapping(lidId, pn);
            return pn;
        }
        
        // 2–4. Shared LID→PN resolution (transport store + disk cache)
        const resolved = await this._resolveLidToPhone(lidId);
        if (resolved) return resolved;

        // Last resort: return the LID number (will show as LID)
        console.log(`[Instance ${this.id}] Could not resolve LID, using raw: ${lidId}`);
        return lidId;
    }

    /**
     * Resolve a LID id (no suffix) to a phone number using Baileys store + disk cache.
     * Used by message webhooks and presence webhooks so both key on the same phone.
     */
    async _resolveLidToPhone(lidId) {
        const cleanLid = String(lidId || '').replace('@lid', '').replace('@s.whatsapp.net', '').split(':')[0].trim();
        if (!cleanLid) return null;

        if (this.socket?.signalRepository?.lidMapping) {
            try {
                // Baileys expects a full @lid JID
                const pn = await this.socket.signalRepository.lidMapping.getPNForLID(`${cleanLid}@lid`);
                if (pn) {
                    const cleanPn = String(pn).replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0];
                    if (cleanPn && cleanPn !== cleanLid) {
                        await this._storeLidMapping(cleanLid, cleanPn);
                        return cleanPn;
                    }
                }
            } catch (_) {
                // try cache next
            }
        }

        if (this.lidCache.has(cleanLid)) {
            return this.lidCache.get(cleanLid);
        }
        return null;
    }

    /**
     * Normalize a chat/participant JID into phone + PN jid for webhooks.
     * Presence often arrives as @lid while messages use @s.whatsapp.net — n8n must key on phone.
     */
    async _resolveWebhookIdentity(jid) {
        const raw = String(jid || '');
        if (!raw || raw.endsWith('@g.us') || raw.endsWith('@broadcast')) {
            return {
                rawJid: raw || null,
                from_phone: null,
                from_jid: raw || null,
                from_lid: null,
                phoneResolved: false,
            };
        }

        const isLid = raw.includes('@lid');
        if (!isLid) {
            const phone = raw.replace('@s.whatsapp.net', '').split(':')[0];
            return {
                rawJid: raw,
                from_phone: normalizePhone(phone),
                from_jid: raw.includes('@') ? raw : `${phone}@s.whatsapp.net`,
                from_lid: null,
                phoneResolved: true,
            };
        }

        const lidId = raw.replace('@lid', '').split(':')[0];
        const pn = await this._resolveLidToPhone(lidId);
        if (pn) {
            return {
                rawJid: raw,
                from_phone: normalizePhone(pn),
                from_jid: `${pn}@s.whatsapp.net`,
                from_lid: `${lidId}@lid`,
                phoneResolved: true,
            };
        }

        // Unresolved — do not pretend LID digits are a phone number
        return {
            rawJid: raw,
            from_phone: null,
            from_jid: raw,
            from_lid: `${lidId}@lid`,
            phoneResolved: false,
        };
    }

    /**
     * Simulate reading a message before replying (sends read receipt with human-like delay).
     * This is a key anti-ban measure: real humans read before they reply.
     * Uses sock.readMessages() which sends the blue tick read receipt.
     */
    async _simulateReadReceipt(msg, messageText, options = {}) {
        const { force = false, showAvailable = true, waitAfterRead = true, socket = this.socket } = options;
        // Notification profiles keep handset alerts intact for an initial grace
        // window. Balanced mode may force a delayed read near reply time; max
        // mode never sends an automated read receipt.
        if (!force && this._preservesPhoneNotifications()) {
            return;
        }
        try {
            const wordCount = (messageText || '').split(/\s+/).length;
            // ~200-300ms per word reading speed, min 1s, max 5s
            const readingDelay = Math.min(5000, Math.max(1000, wordCount * 250 + Math.random() * 500));
            
            if (showAvailable) {
                await socket.sendPresenceUpdate('available', msg.key.remoteJid);
            }
            
            // Wait a moment (simulating opening the chat)
            await delay(showAvailable ? (300 + Math.random() * 700) : (150 + Math.random() * 350));
            
            // Send read receipt (blue ticks)
            await socket.readMessages([msg.key]);
            
            // Wait the reading duration (simulating actually reading the message)
            if (waitAfterRead) {
                await delay(readingDelay);
            }
            
            console.log(`[Instance ${this.id}] Read receipt sent after ${Math.round(readingDelay)}ms`);
        } catch (error) {
            console.error(`[Instance ${this.id}] Read receipt error:`, error.message);
        }
    }
    
    /**
     * Handle incoming message
     */
    async _handleMessage(msg) {
        try {
            const receivedAtMs = Date.now();
            const from = msg.key.remoteJid;
            if (from === 'status@broadcast') return;
            
            // ============================
            // HUMAN HANDOFF DETECTION
            // ============================
            // If this is a message FROM US (fromMe), check if it was sent
            // manually from the phone (not via the bot API)
            if (msg.key.fromMe) {
                const msgId = msg.key.id;
                // Bot API send (by id) or in-flight outbound to this jid — not a human handoff.
                if (this._isBotOutboundEcho(from, msgId)) return;
                
                const messageContent = this._extractMessageContent(msg.message);
                if (!messageContent.text) return;
                
                const text = messageContent.text.trim();
                
                const keywords = this.handoffSettings.resumeKeywords || ['#ai', '#assistant', '#bot', '#resume'];
                const matched = keywords.find(kw => text.toLowerCase().startsWith(kw.toLowerCase()));
                if (matched) {
                    if (this._findHandoffEntry(from)) {
                        this._clearHandoff(from);
                        this._log(`Human handoff ENDED for ${from} (keyword: ${matched})`, 'success');
                        this._emitStatusChange();

                        if (this.handoffSettings.resumeMessage) {
                            try {
                                await this.sendMessage(from, this.handoffSettings.resumeMessage, {
                                    delayEnabled: false,
                                    forceDespiteHandoff: true,
                                });
                            } catch (e) {
                                this._log(`Failed to send resume message: ${e.message}`, 'error');
                            }
                        }
                    }
                    return;
                }

                // Group alert / broadcast numbers: never auto-arm handoff from fromMe
                // (API broadcasts to ops phones were falsely tagged as "manual").
                if (this._groupAlertModeEnabled()) {
                    this._logMessage('outbound', this.connectedPhone || this.id, from.split('@')[0], text, msg.key.id);
                    return;
                }
                
                // Manual send detected -> tag this chat for human mode (PN + LID aliases).
                if (!this._findHandoffEntry(from)) {
                    this._log(`Human handoff ACTIVATED for ${from} (manual message detected)`, 'warning');
                }
                this._armHandoff(from, { taggedBy: 'manual_send' });
                this._logMessage('outbound', this.connectedPhone || this.id, from.split('@')[0], text, msg.key.id);
                this._emitStatusChange();
                return;
            }
            
            // ============================
            // INBOUND MESSAGE HANDLING
            // ============================
            
            // Deduplication: Skip if we've already processed this message
            const msgId = msg.key.id;
            if (this.processedMessages.has(msgId)) {
                console.log(`[Instance ${this.id}] Skipping duplicate message: ${msgId}`);
                return;
            }
            
            // Add to processed set
            this.processedMessages.add(msgId);
            
            // Cleanup old message IDs to prevent memory leak
            if (this.processedMessages.size > this.maxProcessedMessages) {
                const idsArray = Array.from(this.processedMessages);
                this.processedMessages = new Set(idsArray.slice(-500));
            }
            
            const messageContent = this._extractMessageContent(msg.message);
            const hasInteractiveReply = !!(
                msg.message?.buttonsResponseMessage
                || msg.message?.templateButtonReplyMessage
                || msg.message?.listResponseMessage
                || msg.message?.interactiveResponseMessage
            );
            const hasUserInbound = !!(messageContent.text || messageContent.hasMedia || hasInteractiveReply);
            if (!hasUserInbound) return;

            try { this._humanEntropy?.trackInbound?.(msg); } catch (_) {}
            
            // Handle LID (Local Identifier) to PN (Phone Number) mapping
            let phoneNumber = await this._resolvePhoneNumber(msg, from);
            const isGroup = isGroupJid(from);
            if (!isGroup) {
                this._noteTyrejobsHumanReply(phoneNumber, msg.pushName);
            }
            const senderJid = resolveSenderJid(msg);
            let senderPhone = senderJid
                ? await this._resolvePhoneNumber(msg, senderJid)
                : null;
            const groupId = isGroup ? normalizePhone(from.replace('@g.us', '')) : null;
            const senderContext = {
                isGroup,
                groupId,
                senderPhone: senderPhone ? normalizePhone(senderPhone) : null,
                senderJid,
            };
            const logFrom = isGroup && senderContext.senderPhone
                ? `${senderContext.senderPhone} (group ${groupId})`
                : phoneNumber;
            
            this._log(`Received from ${logFrom}: ${(messageContent.text || '[media]').substring(0, 50)}...`, 'info');
            
            // Download + store media on worker disk (Azure public URL optional)
            let mediaInfo = null;
            if (messageContent.hasMedia) {
                mediaInfo = await this._downloadAndStoreMedia(msg, messageContent);
            }
            const mediaUrl = mediaInfo?.publicUrl || null;
            
            this._logMessage('inbound', phoneNumber, this.connectedPhone || this.id, messageContent.text, msg.key.id, {
                mediaUrl: mediaUrl || undefined,
                mediaId: mediaInfo?.mediaId || undefined,
                downloadUrl: mediaInfo?.downloadUrl || undefined,
                mediaType: messageContent.hasMedia ? messageContent.messageType : undefined,
                mimeType: messageContent.mimeType || undefined,
                fileName: messageContent.fileName || undefined
            });
            
            // Bot-native mode behaves like an active linked device. Notification
            // profiles defer any read/typing/reply until after the grace window.
            // Skip auto-reads on groups — they slow alert bursts and mark whole chats read.
            if (!this._preservesPhoneNotifications() && !isGroup) {
                await this._simulateReadReceipt(msg, messageContent.text || '[media]');
            }

            const groupAlertMode = this._groupAlertModeEnabled();
            const handoffEntry = this._findHandoffEntry(from);
            const humanMode = !!handoffEntry;

            // Default (groupAlertMode OFF): classic handoff — skip webhook entirely.
            if (humanMode && !groupAlertMode) {
                handoffEntry.data.lastActivity = new Date().toISOString();
                this._expandHandoffAliases(from, handoffEntry.data);
                this._log(`[Handoff] Skipping bot for ${phoneNumber} - human mode active since ${handoffEntry.data.taggedAt}`, 'warning');

                if (this.onMessage) {
                    this.onMessage({
                        instanceId: this.id,
                        from: phoneNumber,
                        fromJid: from,
                        isGroup,
                        groupId,
                        senderPhone: senderContext.senderPhone,
                        senderJid,
                        message: messageContent.text,
                        messageType: messageContent.messageType,
                        isReply: messageContent.isReply,
                        quotedMessage: messageContent.quotedText,
                        mediaUrl,
                        mediaId: mediaInfo?.mediaId || null,
                        downloadUrl: mediaInfo?.downloadUrl || null,
                        mimeType: messageContent.mimeType,
                        fileName: messageContent.fileName,
                        timestamp: new Date().toISOString(),
                        messageId: msg.key.id,
                        humanMode: true,
                    });
                }
                return;
            }

            if (humanMode && groupAlertMode) {
                handoffEntry.data.lastActivity = new Date().toISOString();
                this._expandHandoffAliases(from, handoffEntry.data);
                this._log(`[Handoff] human mode active for ${phoneNumber} since ${handoffEntry.data.taggedAt} — groupAlertMode: webhook still forwarded, auto-reply suppressed`, 'warning');
            }
            
            // Legacy unique-chat caps only apply when anti-ban v2 is enforcing.
            // (API sends already skip them when v2 is off — inbound must match.)
            const antibanEnforcing = this._isAntibanV2Enforcing();
            const canSend = antibanEnforcing
                ? this.antiBanManager.canSendMessage(from)
                : { allowed: true };
            const rateLimited = !canSend.allowed;
            if (rateLimited && !groupAlertMode) {
                this._log(`Rate limited: ${canSend.reason}`, 'warning');
                return;
            }
            if (rateLimited && groupAlertMode) {
                this._log(`Rate limited (inbound webhook still sent): ${canSend.reason}`, 'warning');
            }
            
            // Emit message event for external handling
            if (this.onMessage) {
                this.onMessage({
                    instanceId: this.id,
                    from: phoneNumber,
                    fromJid: from,
                    isGroup,
                    groupId,
                    senderPhone: senderContext.senderPhone,
                    senderJid,
                    message: messageContent.text,
                    messageType: messageContent.messageType,
                    isReply: messageContent.isReply,
                    quotedMessage: messageContent.quotedText,
                    mediaUrl,
                    mediaId: mediaInfo?.mediaId || null,
                    downloadUrl: mediaInfo?.downloadUrl || null,
                    mimeType: messageContent.mimeType,
                    fileName: messageContent.fileName,
                    timestamp: new Date().toISOString(),
                    messageId: msg.key.id,
                    humanMode,
                });
            }
            
            // Only use instance-specific webhook (no global fallback)
            console.log(`[Instance ${this.id}] Webhook check: ${this.webhookUrl || '(none)'}`);
            
            // Only forward if this instance has its own webhook configured
            if (this.webhookUrl) {
                this._log(`Forwarding to webhook: ${this.webhookUrl.substring(0, 50)}...`, 'info');
                // Subscribe so subsequent composing/recording events reach us for this chat.
                this._ensurePresenceSubscription(from).catch(() => {});
                await this._forwardToWebhook(
                    msg,
                    messageContent,
                    from,
                    phoneNumber,
                    this.webhookUrl,
                    mediaInfo,
                    receivedAtMs,
                    senderContext,
                    {
                        // Alert numbers: never block the inbound pipeline waiting on n8n replies.
                        suppressReply: groupAlertMode && (humanMode || rateLimited || isGroup),
                        humanMode,
                        fireAndForget: groupAlertMode && isGroup,
                    }
                );
            } else {
                this._log('No instance webhook configured - message logged only', 'info');
            }
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Message handling error:`, error);
            this._log(`Error: ${error.message}`, 'error');
        }
    }

    _webhookTypingEventsEnabled() {
        return !!this.behaviorSettings?.webhookTypingEvents && !!this.webhookUrl;
    }

    _groupAlertModeEnabled() {
        return !!this.behaviorSettings?.groupAlertMode;
    }

    /** Drop any @g.us entries from the in-memory handoff map (used when enabling groupAlertMode). */
    _clearGroupHandoffs() {
        let cleared = 0;
        for (const jid of [...this.humanModeChats.keys()]) {
            if (isGroupJid(jid)) {
                this.humanModeChats.delete(jid);
                cleared += 1;
            }
        }
        return cleared;
    }

    _markBotOutbound(jid, messageId = null) {
        const until = Date.now() + 30_000;
        if (jid) {
            for (const alias of this._handoffAliasJids(jid)) {
                this._botOutboundJidUntil.set(alias, until);
            }
        }
        if (messageId) {
            this.botSentMessageIds.add(messageId);
            if (this.botSentMessageIds.size > 2000) {
                const arr = Array.from(this.botSentMessageIds);
                this.botSentMessageIds = new Set(arr.slice(-1000));
            }
        }
        // Bound map
        if (this._botOutboundJidUntil.size > 2000) {
            const now = Date.now();
            for (const [k, exp] of this._botOutboundJidUntil) {
                if (exp < now) this._botOutboundJidUntil.delete(k);
            }
        }
    }

    _isBotOutboundEcho(jid, messageId = null) {
        if (messageId && this.botSentMessageIds.has(messageId)) return true;
        for (const alias of this._handoffAliasJids(jid)) {
            const until = this._botOutboundJidUntil.get(alias);
            if (until && until > Date.now()) return true;
        }
        return false;
    }

    /**
     * Baileys only emits composing/recording for chats we have subscribed to.
     * Throttle re-subscribes so we don't spam WA on every inbound message.
     * Subscribe to both PN and LID forms when mapped — WA may emit presence on either.
     */
    async _ensurePresenceSubscription(chatJid) {
        if (!this._webhookTypingEventsEnabled() || !this.socket || !chatJid) return;
        if (String(chatJid).endsWith('@g.us') || String(chatJid).endsWith('@broadcast')) return;

        const targets = new Set([String(chatJid)]);
        try {
            const identity = await this._resolveWebhookIdentity(chatJid);
            if (identity.from_jid) targets.add(identity.from_jid);
            if (identity.from_lid) targets.add(identity.from_lid);

            // Reverse: if we subscribed on PN, also try LID from Baileys store
            if (identity.phoneResolved && identity.from_jid && this.socket?.signalRepository?.lidMapping?.getLIDForPN) {
                try {
                    const lid = await this.socket.signalRepository.lidMapping.getLIDForPN(identity.from_jid);
                    if (lid) {
                        const lidJid = String(lid).includes('@') ? String(lid) : `${String(lid).split(':')[0]}@lid`;
                        targets.add(lidJid);
                    }
                } catch (_) {}
            }
        } catch (_) {}

        const now = Date.now();
        for (const jid of targets) {
            const last = this._presenceSubscribedAt.get(jid) || 0;
            if (now - last < 5 * 60 * 1000) continue;
            try {
                await this.socket.presenceSubscribe(jid);
                this._presenceSubscribedAt.set(jid, now);
            } catch (err) {
                console.warn(`[Instance ${this.id}] presenceSubscribe failed for ${jid}:`, err?.message || err);
            }
        }
    }

    /**
     * Handle inbound Baileys presence.update → optional webhook event for n8n.
     * Only forwards typing-relevant states (composing / recording / paused).
     */
    async _handlePresenceUpdate(update) {
        if (!this._webhookTypingEventsEnabled()) return;

        const chatId = update?.id;
        if (!chatId || String(chatId).endsWith('@g.us') || String(chatId).endsWith('@broadcast')) return;

        const presences = update?.presences && typeof update.presences === 'object'
            ? update.presences
            : null;
        if (!presences) return;

        const TYPING_STATES = new Set(['composing', 'recording', 'paused']);
        const DEBOUNCE_MS = 1500;

        for (const [participantJid, presenceObj] of Object.entries(presences)) {
            const presence = presenceObj?.lastKnownPresence || presenceObj?.presence || null;
            if (!presence || !TYPING_STATES.has(presence)) continue;

            // Resolve before debounce so LID and PN forms share one fingerprint key
            const identity = await this._resolveWebhookIdentity(participantJid || chatId);
            const chatIdentity = await this._resolveWebhookIdentity(chatId);
            const sessionKey = identity.from_phone
                || chatIdentity.from_phone
                || identity.from_lid
                || chatId;
            const fingerprint = `${sessionKey}|${presence}`;
            const now = Date.now();
            const last = this._lastPresenceWebhookAt.get(fingerprint) || 0;
            if (now - last < DEBOUNCE_MS) continue;
            this._lastPresenceWebhookAt.set(fingerprint, now);

            // Bound map growth
            if (this._lastPresenceWebhookAt.size > 5000) {
                const cutoff = now - 60_000;
                for (const [k, ts] of this._lastPresenceWebhookAt) {
                    if (ts < cutoff) this._lastPresenceWebhookAt.delete(k);
                }
            }

            await this._forwardPresenceWebhook({
                chatId,
                participantJid,
                presence,
                lastSeen: presenceObj?.lastSeen ?? null,
                identity,
                chatIdentity,
            });
        }
    }

    async _forwardPresenceWebhook({ chatId, participantJid, presence, lastSeen, identity, chatIdentity }) {
        const webhookUrl = this.webhookUrl;
        if (!webhookUrl) return;

        const axios = (await import('axios')).default;
        const resolved = identity || await this._resolveWebhookIdentity(participantJid || chatId);
        const chatResolved = chatIdentity || await this._resolveWebhookIdentity(chatId);

        // Prefer PN so n8n typing-hold keys match message webhooks (from_phone).
        const fromPhone = resolved.from_phone || chatResolved.from_phone || null;
        const fromJid = resolved.from_jid || chatResolved.from_jid || participantJid || chatId;
        const fromLid = resolved.from_lid || chatResolved.from_lid || null;
        const stableChatId = (fromPhone ? `${fromPhone}@s.whatsapp.net` : null)
            || chatResolved.from_jid
            || chatId;

        const payload = {
            event: 'presence.update',
            created_at: new Date().toISOString(),
            webhook_id: this.id,
            instanceId: this.id,
            chatId: stableChatId,
            from_jid: fromJid,
            from_lid: fromLid,
            from_phone: fromPhone,
            to_phone: normalizePhone(this.connectedPhone),
            presence,
            lastSeen: lastSeen ?? null,
            status: 'presence',
            phone_resolved: !!(resolved.phoneResolved || chatResolved.phoneResolved),
        };

        if (!fromPhone) {
            this._log(
                `Presence ${presence} on unresolved LID ${fromLid || chatId} — webhook sent without from_phone (n8n cannot match message session yet)`,
                'warning'
            );
        }

        try {
            const webhookBody = JSON.stringify(payload);
            const headers = {};
            if (this.webhookSigningSecret) {
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const signature = crypto
                    .createHmac('sha256', this.webhookSigningSecret)
                    .update(`${timestamp}.${webhookBody}`)
                    .digest('hex');
                headers['X-Wasup-Signature-Timestamp'] = timestamp;
                headers['X-Wasup-Signature-256'] = `sha256=${signature}`;
            }

            await axios.post(webhookUrl, payload, { timeout: 10000, headers });
            this._log(
                `Presence webhook: ${presence} from ${fromPhone || fromLid || chatId}${fromLid && fromPhone ? ` (lid ${fromLid})` : ''}`,
                'info'
            );
        } catch (err) {
            console.warn(
                `[Instance ${this.id}] Presence webhook failed:`,
                err?.response?.status || err?.message || err
            );
        }
    }
    
    /**
     * Forward message to webhook
     * @param {Object} msg - Original message object
     * @param {Object} messageContent - Extracted message content
     * @param {string} from - Sender JID
     * @param {string} phoneNumber - Sender phone number
     * @param {string} webhookUrl - Webhook URL to forward to
     */
    async _forwardToWebhook(
        msg,
        messageContent,
        from,
        phoneNumber,
        webhookUrl,
        mediaInfo = null,
        receivedAtMs = Date.now(),
        senderContext = {},
        options = {}
    ) {
        const axios = (await import('axios')).default;
        const phoneNotifsOn = this._preservesPhoneNotifications();
        const notificationMax = this._isNotificationMaxProfile();
        const typingOn = this.behaviorSettings?.typingSimulation !== false && !notificationMax;
        const behaviorSocket = phoneNotifsOn ? (this.rawSocket || this.socket) : this.socket;
        const suppressReply = !!options.suppressReply;
        const humanMode = !!options.humanMode;
        const fireAndForget = !!options.fireAndForget
            || (this._groupAlertModeEnabled() && !!senderContext.isGroup);
        
        console.log(`[Instance ${this.id}] Calling webhook: ${webhookUrl}`);
        
        try {
            // While the webhook runs, show typing only on the v2 path — legacy
            // safeSendMessage already runs its own typing/read pipeline after the reply.
            // Skip typing in groups / when we won't reply.
            if (!fireAndForget && !suppressReply && !senderContext.isGroup && !phoneNotifsOn && typingOn && this._isAntibanV2Enforcing()) {
                try {
                    await this.socket.sendPresenceUpdate('composing', from);
                } catch (e) {}
            }
            
            // Map messageType to media_type
            const mediaTypeMap = {
                'text': 'text',
                'image': 'image',
                'video': 'video',
                'audio': 'audio',
                'document': 'document',
                'sticker': 'sticker',
                'location': 'location',
                'contact': 'contact',
                'unknown': 'text'
            };
            
            const payload = {
                message_id: generateUUID(),
                created_at: new Date().toISOString(),
                from_phone: normalizePhone(phoneNumber),
                is_group: !!senderContext.isGroup,
                group_id: senderContext.groupId || null,
                sender_phone: senderContext.senderPhone || null,
                from_jid: from || null,
                sender_jid: senderContext.senderJid || null,
                to_phone: normalizePhone(this.connectedPhone),
                message: messageContent.text,
                media_type: mediaTypeMap[messageContent.messageType] || 'text',
                media_url: mediaInfo?.publicUrl || null,
                media_id: mediaInfo?.mediaId || null,
                whatsapp_message_id: msg?.key?.id || null,
                mime_type: messageContent.mimeType || null,
                file_name: messageContent.fileName || null,
                status: 'received',
                webhook_id: this.id,
                event: 'message',
                quoted_message: messageContent.quotedText || null,
                human_mode: humanMode,
                media: mediaInfo
                    ? {
                        id: mediaInfo.mediaId,
                        downloadUrl: mediaInfo.downloadUrl,
                        mimeType: mediaInfo.mimeType || messageContent.mimeType || null,
                        fileName: mediaInfo.fileName || messageContent.fileName || null,
                        publicUrl: mediaInfo.publicUrl || null,
                    }
                    : null,
            };
            
            console.log(`[Instance ${this.id}] Webhook payload:`, JSON.stringify(payload, null, 2));
            
            const webhookBody = JSON.stringify(payload);
            const headers = {};
            if (this.webhookSigningSecret) {
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const signature = crypto
                    .createHmac('sha256', this.webhookSigningSecret)
                    .update(`${timestamp}.${webhookBody}`)
                    .digest('hex');
                headers['X-Wasup-Signature-Timestamp'] = timestamp;
                headers['X-Wasup-Signature-256'] = `sha256=${signature}`;
            }

            // Group-alert path: POST and move on. Never wait 30s on n8n / never send replies.
            // One quick retry on transient TLS/timeouts so bursts still land.
            if (fireAndForget) {
                const postAlert = async () => {
                    const attempts = 2;
                    let lastErr = null;
                    for (let i = 0; i < attempts; i++) {
                        try {
                            const response = await axios.post(webhookUrl, payload, {
                                timeout: 8000,
                                headers,
                            });
                            this._log(
                                `Alert webhook ${response.status} → ${phoneNumber || senderContext.groupId || from}`
                                + (i > 0 ? ` (retry ${i})` : ''),
                                'info'
                            );
                            return;
                        } catch (err) {
                            lastErr = err;
                            if (i + 1 < attempts) await delay(250 + Math.random() * 400);
                        }
                    }
                    console.error(`[Instance ${this.id}] Alert webhook failed:`, lastErr?.message || lastErr);
                    this._log(`Alert webhook failed: ${lastErr?.message || lastErr}`, 'error');
                };
                void postAlert();
                return;
            }

            const response = await axios.post(webhookUrl, payload, { timeout: 30000, headers });
            
            console.log(`[Instance ${this.id}] Webhook response:`, response.status, response.data);
            
            // Handle response
            if (response.data?.skip) {
                this._log(`Webhook requested skip for ${phoneNumber}`, 'info');
                if (this._shouldStayPresencePassive()) {
                    await this._reassertPassivePresence();
                } else {
                    try {
                        await this.socket.sendPresenceUpdate('paused', from);
                    } catch (e) {}
                }
                return;
            }
            
            if (suppressReply) {
                this._log(
                    `Webhook delivered for ${phoneNumber}; auto-reply suppressed (${humanMode ? 'human_mode' : 'rate_limit'})`,
                    'info'
                );
                return;
            }

            const reply = response.data?.reply || response.data?.message || response.data?.text;
            
            if (reply) {
                if (phoneNotifsOn) {
                    await this._waitForNotificationGrace(receivedAtMs);
                    if (!notificationMax) {
                        await this._simulateReadReceipt(msg, messageContent.text || '[media]', {
                            force: true,
                            showAvailable: false,
                            waitAfterRead: false,
                            socket: behaviorSocket,
                        });
                    }
                }

                let result;
                if (this._isAntibanV2Enforcing() && !phoneNotifsOn) {
                    // v2 path: wrapped socket runs the full pipeline
                    try {
                        if (typingOn) {
                            try { await this.socket.sendPresenceUpdate('paused', from); } catch (_) {}
                            await delay(400 + Math.random() * 600);
                            try { await this.socket.sendPresenceUpdate('composing', from); } catch (_) {}
                            await delay(1000 + Math.random() * 1500);
                            try { await this.socket.sendPresenceUpdate('paused', from); } catch (_) {}
                        }
                        const sent = await this.socket.sendMessage(from, { text: reply });
                        this._markBotOutbound(from, sent?.key?.id);
                        this.antiBanManager.recordMessage(from);
                        result = { sent: true, key: sent?.key, via: 'antiban-v2' };
                    } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        result = isAntibanTransportGuardMessage(m)
                            ? { sent: false, reason: m, via: 'antiban-v2-blocked' }
                            : { sent: false, reason: m };
                        if (!isAntibanTransportGuardMessage(m)) throw err;
                    }
                } else if (this._isAntibanV2Enforcing() && phoneNotifsOn) {
                    // Notification profiles bypass the wrapped v2 sender for replies
                    // so no hidden typing/presence choreographer runs before the phone
                    // has had its notification window.
                    try {
                        if (typingOn) {
                            try { await behaviorSocket.sendPresenceUpdate('composing', from); } catch (_) {}
                            await delay(1000 + Math.random() * 1500);
                            try { await behaviorSocket.sendPresenceUpdate('paused', from); } catch (_) {}
                        }
                        const sent = await behaviorSocket.sendMessage(from, { text: reply });
                        this._markBotOutbound(from, sent?.key?.id);
                        this.antiBanManager.recordMessage(from);
                        result = { sent: true, key: sent?.key, via: 'notification-profile' };
                    } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        result = { sent: false, reason: m };
                        throw err;
                    }
                } else if (this._isAntibanOff()) {
                    // Switch OFF = zero anti-ban on webhook replies too.
                    const sock = this.rawSocket || behaviorSocket;
                    const sent = await sock.sendMessage(from, { text: reply });
                    this._markBotOutbound(from, sent?.key?.id);
                    result = { sent: true, key: sent?.key, via: 'raw-no-antiban' };
                } else {
                    // Anti-ban on but v2 path not live — soft behavior only, no hard rate blocks.
                    result = await safeSendMessage(
                        behaviorSocket,
                        from,
                        reply,
                        messageContent.text,
                        this.antiBanManager,
                        {
                            ...this.behaviorSettings,
                            messageKey: msg.key,
                            simulateReading: !phoneNotifsOn,
                            skipRateLimits: true,
                        }
                    );
                }
                if (result.sent) {
                    this._log(`Replied to ${phoneNumber}: ${reply.substring(0, 50)}...`, 'success');
                    await this._reassertPassivePresence();
                } else if (result.reason) {
                    this._log(`Reply blocked: ${sanitizeClientReason(result.reason)}`, 'warning');
                }
            } else if (this._shouldStayPresencePassive()) {
                await this._reassertPassivePresence();
            } else {
                try {
                    await this.socket.sendPresenceUpdate('paused', from);
                } catch (e) {}
            }
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Webhook error:`, error.message);
            if (error.response) {
                console.error(`[Instance ${this.id}] Webhook response error:`, error.response.status, error.response.data);
            }
            this._log(`Webhook error: ${error.message}`, 'error');
            try {
                if (this._shouldStayPresencePassive()) {
                    await this._reassertPassivePresence();
                } else {
                    await this.socket.sendPresenceUpdate('paused', from);
                }
            } catch (e) {}
        }
    }
    
    /**
     * Extract message content from any message type
     */
    _extractMessageContent(message) {
        if (!message) {
            return { text: '', quotedText: null, isReply: false, messageType: 'unknown', hasMedia: false, mimeType: null, fileName: null };
        }

        let text = '';
        let quotedText = null;
        let messageType = 'unknown';
        let hasMedia = false;
        let mimeType = null;
        let fileName = null;

        if (message.conversation) {
            text = message.conversation;
            messageType = 'conversation';
        } else if (message.extendedTextMessage) {
            text = message.extendedTextMessage.text || '';
            messageType = 'extendedText';
            const contextInfo = message.extendedTextMessage.contextInfo;
            if (contextInfo?.quotedMessage) {
                quotedText = contextInfo.quotedMessage.conversation ||
                    contextInfo.quotedMessage.extendedTextMessage?.text ||
                    contextInfo.quotedMessage.imageMessage?.caption ||
                    '[media]';
            }
        } else if (message.imageMessage) {
            text = message.imageMessage.caption || '[Image]';
            messageType = 'image';
            hasMedia = true;
            mimeType = message.imageMessage.mimetype;
        } else if (message.videoMessage) {
            text = message.videoMessage.caption || '[Video]';
            messageType = 'video';
            hasMedia = true;
            mimeType = message.videoMessage.mimetype;
        } else if (message.documentMessage) {
            text = message.documentMessage.caption || message.documentMessage.fileName || '[Document]';
            messageType = 'document';
            hasMedia = true;
            mimeType = message.documentMessage.mimetype;
            fileName = message.documentMessage.fileName;
        } else if (message.audioMessage) {
            text = '[Voice Note]';
            messageType = 'audio';
            hasMedia = true;
            mimeType = message.audioMessage.mimetype;
        } else if (message.stickerMessage) {
            text = '[Sticker]';
            messageType = 'sticker';
            hasMedia = true;
            mimeType = message.stickerMessage.mimetype;
        } else if (message.buttonsResponseMessage) {
            text = message.buttonsResponseMessage.selectedDisplayText || '';
            messageType = 'buttonResponse';
        } else if (message.listResponseMessage) {
            text = message.listResponseMessage.title || '';
            messageType = 'listResponse';
        }

        return {
            text: text.trim(),
            quotedText,
            isReply: !!quotedText,
            messageType,
            hasMedia,
            mimeType,
            fileName
        };
    }
    
    /**
     * Download media from WhatsApp and persist on worker disk.
     * Returns media_id + downloadUrl for webhooks; publicUrl when Azure is configured.
     */
    async _downloadAndStoreMedia(msg, messageContent) {
        if (!messageContent.hasMedia) return null;

        try {
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: this.socket?.updateMediaMessage,
                }
            );
            if (!buffer || buffer.length === 0) return null;

            let ext;
            try { ext = extensionForMediaMessage(msg.message); } catch (_) {}
            if (!ext) {
                const mimeMap = {
                    'image/jpeg': 'jpg',
                    'image/png': 'png',
                    'image/webp': 'webp',
                    'video/mp4': 'mp4',
                    'audio/ogg; codecs=opus': 'ogg',
                    'audio/ogg': 'ogg',
                    'audio/mpeg': 'mp3',
                    'audio/mp4': 'm4a',
                    'application/pdf': 'pdf',
                };
                ext = mimeMap[messageContent.mimeType]
                    || messageContent.mimeType?.split('/')[1]?.split(';')[0]
                    || 'bin';
            }

            const entry = await storeMediaBuffer(this.id, buffer, {
                mimeType: messageContent.mimeType || 'application/octet-stream',
                fileName: messageContent.fileName,
                mediaType: messageContent.messageType,
                direction: 'inbound',
                sourceMessageId: msg.key?.id || null,
            });

            const downloadUrl = `/api/instances/${encodeURIComponent(this.id)}/media/${encodeURIComponent(entry.id)}`;
            this._log(
                `Media stored: ${messageContent.messageType} → ${entry.id} (${buffer.length} bytes)`,
                'success'
            );

            return {
                mediaId: entry.id,
                downloadUrl,
                publicUrl: entry.publicUrl || null,
                mimeType: entry.mimeType || messageContent.mimeType || null,
                fileName: entry.fileName || messageContent.fileName || null,
            };
        } catch (err) {
            this._log(`Media download/store failed: ${err.message}`, 'error');
            return null;
        }
    }

    /**
     * Update legacy anti-ban settings. Mirrors the change into v2 overrides
     * so the new pipeline picks up the same caps on next reconnect.
     */
    updateAntiBanSettings(settings) {
        this.antiBanSettings = { ...this.antiBanSettings, ...settings };
        this.antiBanManager.updateLimits(this.antiBanSettings);

        // Mirror to v2 if active
        if (this.antibanV2) {
            const v2overrides = { ...(this.antibanV2.overrides || {}) };
            if (settings.messagesPerHour) v2overrides.maxPerHour = settings.messagesPerHour;
            if (settings.messagesPerDay) v2overrides.maxPerDay = settings.messagesPerDay;
            this.antibanV2 = { ...this.antibanV2, overrides: v2overrides };
            // Hot-reload if running
            if (this.antibanCtx?.antiban?.rateLimiter?.updateConfig) {
                try {
                    this.antibanCtx.antiban.rateLimiter.updateConfig({
                        maxPerHour: v2overrides.maxPerHour,
                        maxPerDay: v2overrides.maxPerDay,
                    });
                } catch (_) { /* falls through to next reconnect */ }
            }
        }
    }
    
    /**
     * Update behavior settings (profile, typing simulation, delays, shared-devices)
     */
    updateBehaviorSettings(settings) {
        const previousPassive = this._shouldStayPresencePassive();
        const previousGroupAlert = this._groupAlertModeEnabled();
        const previousColdGate = this._isColdOptInGateActive();
        const previousCtaOnce = this._isOptInCtaOnceEnabled();
        const previousSkipAck = !!this.behaviorSettings?.skipOutboundAckWait;
        this.behaviorSettings = normalizeBehaviorSettings(settings || {}, this.behaviorSettings || {});
        this._clampColdOptInGate();
        const nextPassive = this._shouldStayPresencePassive();
        const nextGroupAlert = this._groupAlertModeEnabled();
        if (this._isColdOptInGateActive() !== previousColdGate) {
            this._log(
                this._isColdOptInGateActive()
                    ? 'Token-only ON — jobs send only with a live tctoken (nothing cold)'
                    : 'Cold opt-in gate OFF',
                this._isColdOptInGateActive() ? 'success' : 'info'
            );
        }
        if (this._isOptInCtaOnceEnabled() !== previousCtaOnce) {
            this._log(
                this._isOptInCtaOnceEnabled()
                    ? 'One-shot opt-in CTA ON — one staggered variation per new fitter, then hold'
                    : 'One-shot opt-in CTA OFF — no CTAs, token-only',
                this._isOptInCtaOnceEnabled() ? 'warning' : 'success'
            );
        }
        if (!!this.behaviorSettings?.skipOutboundAckWait !== previousSkipAck) {
            this._log(
                this.behaviorSettings.skipOutboundAckWait
                    ? 'ACK wait OFF — fire-and-forget (sent + doNotRetry as soon as Baileys mints an id)'
                    : 'ACK wait ON — /send holds up to 60s for SERVER_ACK',
                'info'
            );
        }

        // Turning group-alert mode on: clear any stuck @g.us handoff entries immediately.
        if (nextGroupAlert && !previousGroupAlert) {
            const cleared = this._clearGroupHandoffs();
            if (cleared > 0) {
                this._log(`Group alert mode ON — cleared ${cleared} group handoff map entries`, 'success');
                this._emitStatusChange();
            } else {
                this._log('Group alert mode ON — groups will not arm handoff; webhooks keep flowing during DM handoff', 'success');
            }
        } else if (!nextGroupAlert && previousGroupAlert) {
            this._log('Group alert mode OFF — classic handoff (webhook skipped while human mode active)', 'info');
        }

        if (nextPassive !== previousPassive && this.socket && this.status === 'connected') {
            if (nextPassive) {
                // Stop the cycler that randomly flips presence to 'available'
                // and cancel any pending stealth-presence ramp.
                try { this._stopPresenceCycling(); } catch (_) {}
                if (this.presenceRampAbort) {
                    try { this.presenceRampAbort.abort(); } catch (_) {}
                    this.presenceRampAbort = null;
                }
                this.socket.sendPresenceUpdate('unavailable')
                    .then(() => this._log(
                        this._preservesPhoneNotifications()
                            ? 'Phone push mode: presence forced unavailable'
                            : this._isMultiDeviceCoexist()
                                ? 'Shared-devices mode: presence forced unavailable'
                                : 'Passive presence: forced unavailable',
                        'success'
                    ))
                    .catch((e) => this._log(`Failed to push unavailable: ${e.message}`, 'warning'));
            } else {
                // Returning to bot-native behaviour - resume background cycling.
                try { this._startPresenceCycling(); } catch (_) {}
                this._log('Bot-native behaviour enabled - resumed presence cycling', 'info');
            }
        } else if (nextPassive && this.socket && this.status === 'connected') {
            this.socket.sendPresenceUpdate('unavailable')
                .catch((e) => this._log(`Failed to push unavailable: ${e.message}`, 'warning'));
        }

        this._syncProactiveTcTokenCapture();
    }

    /**
     * Attach/detach CB:message listener for inbound <tctoken> capture (Baileys PR #2752).
     * On by default; toggled via behaviorSettings.proactiveTcTokenCapture.
     */
    _syncProactiveTcTokenCapture() {
        const ws = this.rawSocket?.ws;
        const prev = this._proactiveTcTokenHandler;
        if (prev && ws) {
            try {
                if (typeof ws.off === 'function') ws.off('CB:message', prev);
                else if (typeof ws.removeListener === 'function') ws.removeListener('CB:message', prev);
            } catch (_) { /* ignore */ }
            this._proactiveTcTokenHandler = null;
        }

        if (!this.behaviorSettings?.proactiveTcTokenCapture) return;
        if (!ws || typeof ws.on !== 'function') return;

        const handler = (node) => {
            const sock = this.rawSocket;
            if (!sock) return;
            void storeTcTokenFromMessageNode(sock, node)
                .then((storageJid) => {
                    if (!storageJid) return;
                    if (this.privacyTokenMetrics) {
                        this.privacyTokenMetrics.proactiveCaptures =
                            (this.privacyTokenMetrics.proactiveCaptures || 0) + 1;
                        this.privacyTokenMetrics.lastProactiveCaptureAt = new Date().toISOString();
                        this.privacyTokenMetrics.lastProactiveCaptureJid = storageJid;
                    }
                    this._log(`Proactive tctoken capture stored for ${storageJid}`, 'info');
                })
                .catch((err) => {
                    this._log(`Proactive tctoken capture error: ${err?.message || err}`, 'warning');
                });
        };

        this._proactiveTcTokenHandler = handler;
        ws.on('CB:message', handler);
        this._log('Proactive tctoken capture ON (inbound message stanza)', 'success');
    }
    
    /**
     * Digits / stable id used to match PN and LID forms of the same chat.
     * For @lid, resolves via lidCache when known; otherwise returns null for PN matching.
     */
    _handoffPhoneKey(jidOrPhone) {
        if (!jidOrPhone) return null;
        let raw = String(jidOrPhone).trim();
        if (!raw.includes('@')) {
            raw = `${raw.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '')}@s.whatsapp.net`;
        }
        if (raw.endsWith('@g.us') || raw.endsWith('@broadcast')) {
            return raw;
        }
        const user = raw.split('@')[0].split(':')[0].replace(/^\+/, '');
        if (raw.includes('@lid')) {
            const pn = this.lidCache.get(user);
            return pn ? String(pn).replace(/^\+/, '') : null;
        }
        return user;
    }

    /**
     * All JID/phone forms that should share one handoff state (PN + LID + bare PN).
     * Bare LID digits are never stored without @lid — they collide with PN shape.
     */
    _handoffAliasJids(jidOrPhone) {
        const aliases = new Set();
        if (!jidOrPhone) return aliases;

        let raw = String(jidOrPhone).trim();
        if (!raw.includes('@')) {
            const digits = raw.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
            // Bare id that is a known LID key → treat as @lid, not PN
            if (this.lidCache.has(digits)) {
                raw = `${digits}@lid`;
            } else {
                raw = `${digits}@s.whatsapp.net`;
            }
        }

        if (raw.endsWith('@g.us') || raw.endsWith('@broadcast')) {
            aliases.add(raw);
            return aliases;
        }

        const user = raw.split('@')[0].split(':')[0].replace(/^\+/, '');

        if (raw.includes('@lid')) {
            aliases.add(`${user}@lid`);
            const pn = this.lidCache.get(user);
            if (pn) {
                const cleanPn = String(pn).replace(/^\+/, '');
                aliases.add(cleanPn);
                aliases.add(`${cleanPn}@s.whatsapp.net`);
            }
        } else {
            aliases.add(user);
            aliases.add(`${user}@s.whatsapp.net`);
            for (const [lid, pn] of this.lidCache.entries()) {
                if (String(pn).replace(/^\+/, '') === user) {
                    aliases.add(`${lid}@lid`);
                }
            }
        }

        return aliases;
    }

    _findHandoffEntry(jidOrPhone) {
        if (!jidOrPhone) return null;

        for (const alias of this._handoffAliasJids(jidOrPhone)) {
            if (this.humanModeChats.has(alias)) {
                return { key: alias, data: this.humanModeChats.get(alias) };
            }
        }

        const targetPn = this._handoffPhoneKey(jidOrPhone);
        const targetUser = String(jidOrPhone).split('@')[0].split(':')[0].replace(/^\+/, '');
        const targetIsLid = String(jidOrPhone).includes('@lid')
            || (!String(jidOrPhone).includes('@') && /^\d{10,}$/.test(targetUser) === false && this.lidCache.has(targetUser));

        for (const [key, data] of this.humanModeChats) {
            const keyPn = this._handoffPhoneKey(key);
            if (targetPn && keyPn && targetPn === keyPn) {
                return { key, data };
            }
            const keyUser = String(key).split('@')[0].split(':')[0];
            if (String(key).includes('@lid') && keyUser === targetUser) {
                return { key, data };
            }
            if (targetIsLid && keyUser === targetUser) {
                return { key, data };
            }
            // Inbound PN, stored LID whose cache maps to that PN
            if (targetPn && String(key).includes('@lid')) {
                if (this.lidCache.get(keyUser) === targetPn) return { key, data };
            }
        }
        return null;
    }

    _expandHandoffAliases(jidOrPhone, data) {
        if (!data) return;
        for (const alias of this._handoffAliasJids(jidOrPhone)) {
            this.humanModeChats.set(alias, data);
        }
        // Also expand from the found entry key so PN↔LID both land when only one was known at arm.
        const entry = this._findHandoffEntry(jidOrPhone);
        if (entry && entry.key !== jidOrPhone) {
            for (const alias of this._handoffAliasJids(entry.key)) {
                this.humanModeChats.set(alias, data);
            }
        }
    }

    _armHandoff(jidOrPhone, meta = {}) {
        const now = new Date().toISOString();
        const existing = this._findHandoffEntry(jidOrPhone);
        const data = existing?.data || {
            taggedAt: now,
            taggedBy: meta.taggedBy || 'manual_send',
            lastActivity: now,
        };
        data.lastActivity = now;
        if (!existing && meta.taggedBy) data.taggedBy = meta.taggedBy;
        this._expandHandoffAliases(jidOrPhone, data);
        return data;
    }

    _clearHandoff(jidOrPhone) {
        const entry = this._findHandoffEntry(jidOrPhone);
        const keys = new Set(this._handoffAliasJids(jidOrPhone));
        if (entry) {
            keys.add(entry.key);
            for (const a of this._handoffAliasJids(entry.key)) keys.add(a);
        }
        // Also drop any map keys that share the same phone key
        const targetPn = this._handoffPhoneKey(jidOrPhone) || (entry && this._handoffPhoneKey(entry.key));
        if (targetPn) {
            for (const key of this.humanModeChats.keys()) {
                const keyPn = this._handoffPhoneKey(key);
                if (keyPn && keyPn === targetPn) keys.add(key);
            }
        }
        for (const key of keys) this.humanModeChats.delete(key);
    }

    _canonicalHandoffJid(jid) {
        const raw = String(jid || '');
        if (raw.endsWith('@g.us') || raw.endsWith('@broadcast')) return raw;
        const user = raw.split('@')[0].split(':')[0].replace(/^\+/, '');
        // Prefer PN when this id is known as a LID
        if (raw.includes('@lid') || this.lidCache.has(user)) {
            const pn = this.lidCache.get(user);
            if (pn) return `${String(pn).replace(/^\+/, '')}@s.whatsapp.net`;
            return `${user}@lid`;
        }
        const phone = this._handoffPhoneKey(jid);
        if (phone && !String(phone).includes('@')) return `${phone}@s.whatsapp.net`;
        if (!raw.includes('@')) return `${user}@s.whatsapp.net`;
        return raw.includes('@') ? raw : `${user}@s.whatsapp.net`;
    }

    /**
     * Get all chats currently in human handoff mode
     */
    getHandoffChats() {
        const seen = new Set();
        const chats = [];
        for (const [jid, data] of this.humanModeChats) {
            const canon = this._canonicalHandoffJid(jid);
            if (seen.has(canon)) continue;
            seen.add(canon);
            const aliases = [...this._handoffAliasJids(jid)].filter((a) => a !== canon);
            chats.push({
                jid: canon,
                phone: canon.split('@')[0],
                aliases,
                ...data,
            });
        }
        return chats;
    }

    /**
     * Manually tag a chat for human handoff (skip bot responses)
     */
    setHandoff(jid, active) {
        const normalizedJid = jid.includes('@') ? jid : `${String(jid).replace(/^\+/, '')}@s.whatsapp.net`;
        if (active) {
            this._armHandoff(normalizedJid, { taggedBy: 'api' });
            this._log(`Human handoff ACTIVATED for ${normalizedJid} (via API)`, 'warning');
        } else {
            this._clearHandoff(normalizedJid);
            this._log(`Human handoff ENDED for ${normalizedJid} (via API)`, 'success');
        }
        this._emitStatusChange();
    }

    /**
     * Count persisted tctoken files (excludes Baileys __index sentinel).
     */
    _countStoredPrivacyTokens() {
        return summarizeAuthTokenFiles(this.authFolder, fsSync).tctokenFiles;
    }

    getPrivacyTokenHardeningStatus() {
        const authFiles = summarizeAuthTokenFiles(this.authFolder, fsSync);
        const hits = this.privacyTokenMetrics.tokenHits || 0;
        const misses = this.privacyTokenMetrics.tokenMisses || 0;
        const expired = this.privacyTokenMetrics.tokenExpired || 0;
        const attempts = hits + misses + expired;
        return {
            metrics: { ...this.privacyTokenMetrics },
            authFiles,
            tokenHitRate: attempts > 0 ? Number((hits / attempts).toFixed(4)) : null,
            open463Circuits: this.contact463Circuit.size,
            blockColdWithoutToken: shouldBlockColdWithoutToken({
                blockColdWithoutToken: this.behaviorSettings?.blockColdWithoutToken === true,
            }),
            blockColdWithoutTokenSwitch: this.behaviorSettings?.blockColdWithoutToken === true,
            outboundHardening: isOutboundHardeningEnabled(),
            onWhatsAppPreflight: isOnWhatsAppPreflightEnabled(),
            onWhatsAppCacheSize: this.onWhatsAppCache?.size || 0,
            baileysNote:
                'Baileys 7.0.0-rc13 harvests history tcToken + privacy_token into useMultiFileAuthState; Wasup adds circuit breaker + metrics',
        };
    }

    _reachoutCachePath() {
        return path.join(INSTANCES_FOLDER, this.id, 'reachout-cache.json');
    }

    _persistReachoutCache(lock) {
        if (!lock?.isActive || !lock.timeEnforcementEnds) return;
        if (new Date(lock.timeEnforcementEnds).getTime() <= Date.now()) return;
        try {
            fsSync.writeFileSync(this._reachoutCachePath(), JSON.stringify({
                isActive: true,
                timeEnforcementEnds: lock.timeEnforcementEnds,
                enforcementType: lock.enforcementType || 'DEFAULT',
                savedAt: new Date().toISOString(),
            }));
        } catch (_) {}
    }

    _loadReachoutCache() {
        try {
            const raw = fsSync.readFileSync(this._reachoutCachePath(), 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed?.isActive || !parsed.timeEnforcementEnds) return null;
            if (new Date(parsed.timeEnforcementEnds).getTime() <= Date.now()) return null;
            return {
                isActive: true,
                timeEnforcementEnds: parsed.timeEnforcementEnds,
                enforcementType: parsed.enforcementType || 'DEFAULT',
                checkedAt: new Date().toISOString(),
                source: 'disk-cache',
            };
        } catch (_) {
            return null;
        }
    }

    _reachoutEndMs(lock = this.reachoutTimeLock) {
        const ends = lock?.timeEnforcementEnds || lock?.time_enforcement_ends || null;
        if (!ends) return null;
        const ms = new Date(ends).getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    /** True only while WA lock is active AND end time is still in the future (or unknown). */
    _isReachoutTimeLockBlocking(lock = this.reachoutTimeLock) {
        if (!lock?.isActive && !lock?.is_active) return false;
        const endMs = this._reachoutEndMs(lock);
        if (endMs !== null && endMs <= Date.now()) return false;
        return true;
    }

    /** Drop stale in-memory locks whose end time already passed. */
    _expireReachoutTimeLockIfNeeded(source = 'expiry') {
        const lock = this.reachoutTimeLock;
        if (!lock?.isActive) return false;
        const endMs = this._reachoutEndMs(lock);
        if (endMs === null || endMs > Date.now()) return false;
        return this._applyReachoutTimeLock(
            {
                isActive: false,
                timeEnforcementEnds: lock.timeEnforcementEnds,
                enforcementType: lock.enforcementType || 'DEFAULT',
            },
            source
        );
    }

    _applyReachoutTimeLock(lock, source = 'unknown') {
        if (!lock || typeof lock !== 'object') return false;
        const prev = this.reachoutTimeLock || this._loadReachoutCache();
        let timeEnforcementEnds = lock.timeEnforcementEnds
            ? new Date(lock.timeEnforcementEnds).toISOString()
            : null;
        // Argo compact payloads sometimes omit the end timestamp. Keep a still-future
        // previous end so the dashboard countdown does not disappear mid-lock.
        if (
            !!lock.isActive
            && !timeEnforcementEnds
            && prev?.isActive
            && prev.timeEnforcementEnds
            && new Date(prev.timeEnforcementEnds).getTime() > Date.now()
        ) {
            timeEnforcementEnds = prev.timeEnforcementEnds;
        }
        let isActive = !!lock.isActive;
        // Never keep isActive=true past the reported end — WA/Argo can leave a sticky flag.
        if (isActive && timeEnforcementEnds && new Date(timeEnforcementEnds).getTime() <= Date.now()) {
            isActive = false;
        }
        const normalized = {
            isActive,
            timeEnforcementEnds,
            enforcementType: lock.enforcementType || prev?.enforcementType || 'DEFAULT',
            checkedAt: new Date().toISOString(),
            source,
        };
        const changed = !prev
            || prev.isActive !== normalized.isActive
            || prev.timeEnforcementEnds !== normalized.timeEnforcementEnds
            || prev.enforcementType !== normalized.enforcementType;
        this.reachoutTimeLock = normalized;
        if (normalized.isActive) this._persistReachoutCache(normalized);
        else {
            try { fsSync.unlinkSync(this._reachoutCachePath()); } catch (_) {}
        }
        // Polling every 20–30s used to re-log + WS-broadcast the same lock and freeze the admin UI.
        if (!changed) return false;
        if (normalized.isActive) {
            this._markTyrejobsLimited(`reachout-${normalized.enforcementType || 'lock'}`);
            this._log(
                `Reachout timelock ACTIVE until ${normalized.timeEnforcementEnds || 'unknown'} (${normalized.enforcementType})`,
                'error'
            );
        } else {
            this._log(
                `Reachout timelock inactive (${normalized.enforcementType})${source === 'expiry' || /expir/i.test(source) ? ' — end time passed' : ''}`,
                'info'
            );
        }
        this._emitStatusChange();
        return true;
    }

    /**
     * Read-only MEX probes: account reachout timelock + new-chat message cap.
     * Does not send messages. Safe to call on connect / after 463.
     * UI polls are throttled hard — do not hammer WhatsApp MEX.
     */
    async refreshReachoutDiagnostics(source = 'manual', { force = false } = {}) {
        this._expireReachoutTimeLockIfNeeded(`${source}:expiry`);
        const cached = {
            reachoutTimeLock: this.reachoutTimeLock,
            newChatMessageCap: this.newChatMessageCap,
            privacyTokenCount: this._countStoredPrivacyTokens(),
            privacyTokenHardening: this.getPrivacyTokenHardeningStatus(),
        };
        const sock = this.rawSocket || this.socket;
        if (!sock || this.status !== 'connected') {
            return cached;
        }
        const now = Date.now();
        // connect/463: allow a quick recheck. UI/poll: at most every 15m unless force.
        const throttleMs = (source === 'connect' || source === '463')
            ? 5_000
            : (source === 'poll' || source === 'manual' ? 15 * 60_000 : 15 * 60_000);
        if (!force && now - (this._lastReachoutFetchAt || 0) < throttleMs) {
            return cached;
        }
        this._lastReachoutFetchAt = now;

        if (typeof sock.fetchAccountReachoutTimelock === 'function') {
            try {
                const lock = await sock.fetchAccountReachoutTimelock();
                this._applyReachoutTimeLock(lock, source);
            } catch (err) {
                const ambiguous = !!(err?.data?._wasupAmbiguous || /argo reachout payload ambiguous/i.test(err?.message || ''));
                const prev = this.reachoutTimeLock || this._loadReachoutCache();
                const prevStillActive = this._isReachoutTimeLockBlocking(prev);
                if (ambiguous && prevStillActive) {
                    this.reachoutTimeLock = {
                        ...prev,
                        checkedAt: new Date().toISOString(),
                        source: `${source}:argo-ambiguous`,
                    };
                    this._persistReachoutCache(this.reachoutTimeLock);
                    this._emitStatusChange();
                } else {
                    // Probe failed and lock is expired/missing — clear sticky active flag.
                    if (prev?.isActive && !prevStillActive) {
                        this._expireReachoutTimeLockIfNeeded(`${source}:probe-expired`);
                    }
                    // Ambiguous empty Argo is common and harmless — don't spam activity log.
                    const failLogGapMs = 30 * 60_000;
                    if (now - (this._lastReachoutFailLogAt || 0) >= failLogGapMs) {
                        this._lastReachoutFailLogAt = now;
                        this._log(
                            ambiguous
                                ? `Reachout timelock probe inconclusive (Argo) — will retry later; not blocking sends`
                                : `Reachout timelock probe failed: ${err.message}`,
                            'warning'
                        );
                    }
                }
            }
        }

        if (typeof sock.fetchNewChatMessageCap === 'function') {
            try {
                const cap = await sock.fetchNewChatMessageCap();
                const nextCap = {
                    ...((cap && typeof cap === 'object') ? cap : { raw: cap }),
                    checkedAt: new Date().toISOString(),
                    source,
                };
                const prevCap = this.newChatMessageCap;
                const capChanged = !prevCap
                    || prevCap.capping_status !== nextCap.capping_status
                    || String(prevCap.used_quota) !== String(nextCap.used_quota)
                    || String(prevCap.total_quota) !== String(nextCap.total_quota);
                this.newChatMessageCap = nextCap;
                if (capChanged) {
                    this._log(`New-chat message cap: ${JSON.stringify(this.newChatMessageCap)}`, 'info');
                }
            } catch (err) {
                const failLogGapMs = 30 * 60_000;
                if (now - (this._lastReachoutFailLogAt || 0) >= failLogGapMs) {
                    this._lastReachoutFailLogAt = now;
                    this._log(`New-chat cap probe failed: ${err.message}`, 'warning');
                }
            }
        }

        return {
            reachoutTimeLock: this.reachoutTimeLock,
            newChatMessageCap: this.newChatMessageCap,
            privacyTokenCount: this._countStoredPrivacyTokens(),
            privacyTokenHardening: this.getPrivacyTokenHardeningStatus(),
        };
    }

    /**
     * Get instance status
     */
    getStatus() {
        this._expireReachoutTimeLockIfNeeded('status:expiry');
        return {
            id: this.id,
            name: this.name,
            status: this.status,
            qrCode: this.qrCode,
            qrCodeUpdatedAt: this.qrCodeUpdatedAt,
            qrVersion: this.qrVersion,
            qrAgeMs: this.qrCodeUpdatedAt ? Date.now() - new Date(this.qrCodeUpdatedAt).getTime() : null,
            qrTtlMs: QR_CODE_TTL_MS,
            qrExpiresInMs: this.qrCodeUpdatedAt
                ? Math.max(0, QR_CODE_TTL_MS - (Date.now() - new Date(this.qrCodeUpdatedAt).getTime()))
                : null,
            qrRefreshRestartCount: this.qrRefreshRestartCount,
            staleProtocolResetCount: this.staleProtocolResetCount,
            qrScanReceivedAt: this.qrScanReceivedAt,
            linkingGraceUntil: this.linkingGraceUntil,
            linkingGraceActive: this._isPostScanGraceActive(),
            lastPairingUpdateAt: this.lastPairingUpdateAt,
            lastCredsUpdateAt: this.lastCredsUpdateAt,
            lastCredsUpdateSummary: this.lastCredsUpdateSummary,
            pairingCode: this.pairingCode,
            phone: this.connectedPhone,
            connectedPhone: this.connectedPhone,
            connectedAt: this.connectedAt,
            connectionIssue: this.connectionIssue,
            webhookUrl: this.webhookUrl || null,
            behaviorSettings: this.behaviorSettings,
            antiBanSettings: this.antiBanSettings,
            antiBanHealth: this.antiBanManager.getHealth(),
            antibanV2: this.getAntibanV2Status(),
            reachoutTimeLock: this.reachoutTimeLock,
            newChatMessageCap: this.newChatMessageCap,
            privacyTokenCount: this._countStoredPrivacyTokens(),
            privacyTokenHardening: this.getPrivacyTokenHardeningStatus(),
            handoffSettings: this.handoffSettings,
            humanModeChats: this.getHandoffChats(),
            proxy: this.getProxyStatus(),
            fingerprintRisk: this.manager?.getFingerprintRiskForInstance?.(this.id) || null,
            hasSavedCredentials: null, // filled by list enrichment when available
            createdAt: this.createdAt
        };
    }

    /**
     * Apply global and/or per-send content variation (marketing blasts).
     * Per-send: options.contentVariation = true | { zeroWidthChars, punctuationVariation, synonyms }
     * Global: antibanV2.modules.contentVariator.enabled
     */
    _applyOutboundContentVariation(textOrParams, options = {}) {
        const perSend = options.contentVariation;
        const globalOn = this.antibanV2 && isModuleOn(this.antibanV2, 'contentVariator');
        if (!perSend && !globalOn) return textOrParams;

        const variation = perSend || true;
        const mod = mergeModules(this.antibanV2?.modules).contentVariator || {};

        if (typeof textOrParams === 'string') {
            return applyContentVariation(textOrParams, variation, mod);
        }
        if (textOrParams && typeof textOrParams === 'object' && typeof textOrParams.text === 'string') {
            return {
                ...textOrParams,
                text: applyContentVariation(textOrParams.text, variation, mod),
            };
        }
        return textOrParams;
    }

    _syncHumanEntropy() {
        const want = !!(
            this.antibanV2?.enabled
            && isModuleOn(this.antibanV2, 'humanEntropy')
            && this.status === 'connected'
            && !this._shouldStayPresencePassive()
        );
        if (!want) {
            if (this._humanEntropy) {
                try { this._humanEntropy.stop(); } catch (_) {}
                this._humanEntropy = null;
                this._log('Human entropy stopped', 'info');
            }
            return;
        }
        if (this._humanEntropy) return;
        try {
            const mod = mergeModules(this.antibanV2.modules).humanEntropy || {};
            this._humanEntropy = startHumanEntropy({
                getSocket: () => this.rawSocket || this.socket,
                instanceId: this.id,
                moduleConfig: mod,
                onLog: (msg, level) => this._log(`[entropy] ${msg}`, level),
            });
        } catch (err) {
            this._log(`Human entropy failed to start: ${err.message}`, 'warning');
        }
    }

    /**
     * True when the live wrapped socket should intercept outbound sends.
     */
    _isAntibanV2Enforcing() {
        return !!(this.antibanCtx && this.antibanV2?.enabled !== false && this._antibanV2Enforcing !== false);
    }

    /** Anti-ban master switch is explicitly OFF — zero rate limits / antiban pipeline. */
    _isAntibanOff() {
        return this.antibanV2?.enabled === false;
    }

    /**
     * Swap between raw and wrapped socket when anti-ban is toggled live.
     * @param {object} v2config
     * @param {{ rebuildWrap?: boolean }} [opts] - rebuildWrap forces destroy+rewrap (enhancedMode changes)
     */
    async _syncAntibanV2SocketState(v2config, opts = {}) {
        const enforce = v2config?.enabled !== false;
        this._antibanV2Enforcing = enforce;

        if (!enforce) {
            if (this.rawSocket && this.socket !== this.rawSocket) {
                this.socket = this.rawSocket;
                this._log('Anti-ban v2 OFF — sends bypass rate limits (raw socket)', 'success');
            }
            return;
        }

        if (this.status !== 'connected' || !this.rawSocket) {
            this._log('Anti-ban v2 enabled in config (applies on reconnect)', 'info');
            return;
        }

        if (opts.rebuildWrap && this.antibanCtx) {
            try { await this.antibanCtx.destroy?.(); } catch (_) {}
            this.antibanCtx = null;
            this.socket = this.rawSocket;
        }

        if (!this.antibanCtx) {
            try {
                this.antibanCtx = await buildAntibanContext({
                    instanceId: this.id,
                    instanceFolder: path.join(INSTANCES_FOLDER, this.id),
                    v2config: this.antibanV2,
                    onLog: (msg, level) => this._log(`[v2] ${msg}`, level),
                    onRiskChange: (change) => this._onRiskChange(change),
                });
            } catch (err) {
                this._log(`Failed to build anti-ban v2 context: ${err.message}`, 'error');
                return;
            }
        }

        if (this.antibanCtx?.wrap && (this.socket === this.rawSocket || opts.rebuildWrap)) {
            try {
                this.socket = this.antibanCtx.wrap(this.rawSocket);
                const mode = isEnhancedAntibanMode(this.antibanV2) ? 'enhanced' : 'classic';
                this._log(`Anti-ban v2 ON (${mode}, lib ${ANTIBAN_LIBRARY_VERSION}) — socket wrapped`, 'success');
            } catch (err) {
                this._log(`Anti-ban v2 wrap failed: ${err.message}`, 'error');
            }
        }
    }

    /**
     * Compact v2 status block surfaced in instance status responses.
     * Returns null if v2 isn't running on this instance.
     */
    getAntibanV2Status() {
        if (!this.antibanV2) return null;
        const ctx = this.antibanCtx;
        if (!ctx) {
            // Configured but not currently running (instance disconnected)
            return {
                enabled: !!this.antibanV2.enabled,
                enhancedMode: !!this.antibanV2.enhancedMode,
                libraryVersion: ANTIBAN_LIBRARY_VERSION,
                enforcing: false,
                running: false,
                preset: this.antibanV2.preset,
                modules: Object.fromEntries(
                    Object.entries(mergeModules(this.antibanV2.modules)).map(([k, v]) => [k, !!v?.enabled])
                ),
                moduleCatalog: getModuleCatalogPayload(this.antibanV2),
            };
        }
        let stats = {};
        try { stats = ctx.antiban.getStats(); } catch (_) {}
        return {
            enabled: !!this.antibanV2.enabled,
            enhancedMode: !!this.antibanV2.enhancedMode,
            libraryVersion: ctx.libraryVersion || ANTIBAN_LIBRARY_VERSION,
            enforcing: this._isAntibanV2Enforcing(),
            running: !!ctx && this._isAntibanV2Enforcing(),
            preset: this.antibanV2.preset,
            modules: Object.fromEntries(
                Object.entries(mergeModules(this.antibanV2.modules)).map(([k, v]) => [k, !!v?.enabled])
            ),
            moduleCatalog: getModuleCatalogPayload(this.antibanV2),
            health: stats.health ? {
                risk: stats.health.risk,
                score: stats.health.score,
                recommendation: stats.health.recommendation,
                reasons: stats.health.reasons,
                isPaused: !!stats.health.isPaused,
            } : null,
            warmup: stats.warmUp ? {
                phase: stats.warmUp.phase,
                day: stats.warmUp.day,
                totalDays: stats.warmUp.totalDays,
                todayLimit: stats.warmUp.todayLimit,
                todaySent: stats.warmUp.todaySent,
                progress: stats.warmUp.progress,
                // Warmup state uses 'graduated' for completed warmup
                complete: stats.warmUp.phase === 'graduated' || stats.warmUp.phase === 'complete' || stats.warmUp.progress >= 100,
            } : null,
            rateLimiter: stats.rateLimiter ? {
                lastMinute: stats.rateLimiter.lastMinute,
                lastHour: stats.rateLimiter.lastHour,
                lastDay: stats.rateLimiter.lastDay,
                limits: stats.rateLimiter.limits,
            } : null,
            retryTracker: stats.retryTracker ? {
                totalRetries: stats.retryTracker.totalRetries,
                spiralsDetected: stats.retryTracker.spiralsDetected,
                activeRetries: stats.retryTracker.activeRetries,
            } : null,
            sessionStability: stats.sessionStability ? {
                badMacCount: stats.sessionStability.badMacCount,
                isDegraded: stats.sessionStability.isDegraded,
            } : null,
            deliveryTracker: stats.deliveryTracker || null,
            banRecovery: stats.banRecovery || null,
            instanceCoordinator: stats.instanceCoordinator || null,
            messagesAllowed: stats.messagesAllowed ?? 0,
            messagesBlocked: stats.messagesBlocked ?? 0,
            totalDelayMs: stats.totalDelayMs ?? 0,
        };
    }

    /**
     * Get the full v2 stats blob (for the dedicated /antiban-v2 endpoint).
     * Returns null if v2 isn't running.
     */
    getAntibanV2Full() {
        if (!this.antibanV2) return null;
        const compact = this.getAntibanV2Status();
        let fullStats = null;
        if (this.antibanCtx?.antiban?.getStats) {
            try { fullStats = this.antibanCtx.antiban.getStats(); } catch (_) {}
        }
        return {
            ...compact,
            config: this.antibanV2,
            stats: fullStats,
        };
    }

    /**
     * Update v2 anti-ban config. Most fields take effect on next reconnect; for
     * "live" fields like rate limits we hot-update the running RateLimiter.
     */
    async updateAntibanV2(updates) {
        if (!updates || typeof updates !== 'object') {
            throw new Error('updates must be an object');
        }
        const before = this.antibanV2 || legacyToV2Config(this.antiBanSettings);
        const explicitModuleUpdates = updates.modules || {};
        let mergedModules = mergeModules({ ...(before.modules || {}), ...Object.fromEntries(
            Object.entries(explicitModuleUpdates).map(([key, val]) => [
                key,
                { ...(before.modules?.[key] || {}), ...(val || {}) },
            ])
        ) });

        if (updates.enhancedMode !== undefined) {
            mergedModules = applyEnhancedModePack(mergedModules, !!updates.enhancedMode, explicitModuleUpdates);
        }

        const next = {
            ...before,
            ...updates,
            modules: mergedModules,
            overrides: { ...(before.overrides || {}), ...(updates.overrides || {}) },
        };
        if (updates.preset) {
            next.preset = legacyPresetToV2(updates.preset);
        }
        if (updates.enhancedMode !== undefined) {
            next.enhancedMode = !!updates.enhancedMode;
        }
        if (next.enhancedMode === undefined) next.enhancedMode = false;

        const wrapAffecting = [
            'groupOpGuard', 'deafSession', 'legitimacySignals',
            'topologyThrottler', 'instanceCoordinator', 'deliveryAdaptive',
        ];
        const modulesChangedWrap = wrapAffecting.some((id) => {
            const a = !!before.modules?.[id]?.enabled;
            const b = !!next.modules?.[id]?.enabled;
            // treat undefined via defaults
            return isModuleOn(before, id) !== isModuleOn(next, id) || a !== b;
        });
        const enhancedChanged = !!before.enhancedMode !== !!next.enhancedMode;
        this.antibanV2 = next;

        await this._syncAntibanV2SocketState(next, {
            rebuildWrap: enhancedChanged || modulesChangedWrap,
        });

        // Presence cycling / entropy react immediately to module toggles.
        try {
            if (isModuleOn(next, 'presenceCycling') && !this._shouldStayPresencePassive() && this.status === 'connected') {
                this._startPresenceCycling();
            } else {
                this._stopPresenceCycling();
            }
        } catch (_) {}
        try { this._syncHumanEntropy(); } catch (_) {}

        // Keep legacy anti-ban settings in sync for dashboard preset buttons / health display.
        if (updates.preset || updates.overrides) {
            const legacyPreset = updates.preset || this.antiBanSettings?.preset || 'balanced';
            const patch = { preset: legacyPreset === 'moderate' ? 'balanced' : legacyPreset };
            if (next.overrides?.maxPerHour || next.overrides?.messagesPerHour) {
                patch.messagesPerHour = next.overrides.maxPerHour ?? next.overrides.messagesPerHour;
            }
            if (next.overrides?.maxPerDay || next.overrides?.messagesPerDay) {
                patch.messagesPerDay = next.overrides.maxPerDay ?? next.overrides.messagesPerDay;
            }
            this.updateAntiBanSettings({ ...this.antiBanSettings, ...patch });
        }

        const live = applyLiveAntibanConfig(this.antibanCtx, next);
        if (live.applied) {
            this._log(`Anti-ban v2 live update: ${live.fields.join(', ')}`, 'success');
            try { await this.antibanCtx?.saveAll?.(); } catch (_) {}
        } else if (enhancedChanged || modulesChangedWrap) {
            this._log(
                `Anti-ban modules updated (enhanced=${next.enhancedMode ? 'ON' : 'OFF'}, lib ${ANTIBAN_LIBRARY_VERSION})`,
                'success'
            );
        } else {
            this._log('Anti-ban v2 config saved (applies on next connect if instance is offline)', 'info');
        }
        return this.getAntibanV2Status();
    }

    /**
     * Graduate warm-up on a live instance — removes the day-1 ~20 message cap immediately.
     */
    async graduateWarmupAntiban() {
        if (!this.antibanV2) {
            this.antibanV2 = legacyToV2Config(this.antiBanSettings);
        }
        this.antibanV2.modules = {
            ...(this.antibanV2.modules || {}),
            warmup: { ...(this.antibanV2.modules?.warmup || {}), enabled: false },
        };
        const graduated = graduateWarmupLive(this.antibanCtx);
        if (graduated) {
            this._log('Anti-ban v2 warm-up graduated (daily cap lifted)', 'success');
            try { await this.antibanCtx?.saveAll?.(); } catch (_) {}
        } else {
            this._log('Anti-ban v2 warm-up marked graduated in config (applies on next connect)', 'info');
        }
        return this.getAntibanV2Status();
    }

    /**
     * Manual emergency pause of the v2 pipeline.
     */
    pauseAntibanV2() {
        if (!this.antibanCtx?.antiban) throw new Error('Anti-ban v2 not running');
        this.antibanCtx.antiban.pause();
        this._log('Anti-ban v2 PAUSED (no messages will be sent)', 'warning');
        return this.getAntibanV2Status();
    }

    /**
     * Resume after a manual pause.
     */
    resumeAntibanV2() {
        if (!this.antibanCtx?.antiban) throw new Error('Anti-ban v2 not running');
        this.antibanCtx.antiban.resume();
        this._log('Anti-ban v2 RESUMED', 'success');
        return this.getAntibanV2Status();
    }

    /**
     * Nuclear reset — clears warmup, rate-limiter, and health state.
     * Use after serving a real ban period.
     */
    async resetAntibanV2() {
        if (this.antibanCtx?.antiban) {
            this.antibanCtx.antiban.reset();
        }
        // Wipe persisted state too
        try {
            const stateDir = path.join(INSTANCES_FOLDER, this.id, 'antiban');
            if (fsSync.existsSync(stateDir)) {
                const files = await fs.readdir(stateDir);
                for (const f of files) {
                    if (f === 'fingerprint.json') continue; // keep fingerprint sticky
                    await fs.unlink(path.join(stateDir, f)).catch(() => {});
                }
            }
        } catch (_) { /* ignore */ }
        this._log('Anti-ban v2 RESET (state wiped, fingerprint kept)', 'warning');
        return this.getAntibanV2Status();
    }

    /**
     * Lid mappings cache (for diagnostics).
     */
    getLidMappings() {
        if (!this.antibanCtx?.lidResolver) return { enabled: false, count: 0, sample: [] };
        try {
            const stats = this.antibanCtx.lidResolver.getStats?.();
            return { enabled: true, ...stats };
        } catch (_) {
            return { enabled: true, count: 0, sample: [] };
        }
    }

    /**
     * Get the proxy state for API responses (password redacted, includes source).
     *
     * Fields:
     *   override  - raw instance-level config (null = inheriting deployment default or using pool)
     *   effective - what would be used on next connect (same shape as override.config)
     *   source    - which tier produced `effective`: api|pool|deployment|disabled|none
     *   active    - snapshot of what the CURRENTLY OPEN socket is tunneling through
     *               (null if the instance is disconnected). Useful for polling to
     *               confirm the live connection matches the configured proxy.
     */
    getProxyStatus() {
        const resolved = resolveEffectiveProxy(this.proxy);
        let override = null;
        if (this.proxy) {
            if (this.proxy.enabled === false) {
                override = { enabled: false };
            } else {
                override = {
                    enabled: true,
                    origin: this.proxy.source || 'api', // 'api' | 'pool'
                    ...redactProxy(this.proxy),
                };
            }
        }

        let active = null;
        if (this._activeProxy && (this.status === 'connected' || this.status === 'connecting')) {
            active = {
                source: this._activeProxy.source,
                proxy: redactProxy(this._activeProxy.config),
                boundAt: this._activeProxyAt,
            };
        }

        return {
            override,
            effective: redactProxy(resolved.config),
            source: resolved.source,
            active,
        };
    }

    /**
     * Probe the outbound egress IP of this instance by sending an HTTPS request
     * through the same agent as the WhatsApp socket. If the proxy is working,
     * the echoed IP should be one of the pool proxies' upstream IPs, NOT the
     * Azure App Service outbound IP.
     *
     * This is the definitive confirmation that traffic is actually flowing
     * through the configured proxy.
     */
    async verifyProxy(target = 'https://api.ipify.org?format=json') {
        const axios = (await import('axios')).default;
        const resolved = resolveEffectiveProxy(this.proxy);
        const agent = resolved.config ? createProxyAgent(resolved.config) : null;

        const start = Date.now();
        try {
            const response = await axios.get(target, {
                httpAgent: agent || undefined,
                httpsAgent: agent || undefined,
                timeout: 15000,
                validateStatus: () => true,
            });
            const elapsedMs = Date.now() - start;
            let egressIp = null;
            if (response.data && typeof response.data === 'object' && response.data.ip) {
                egressIp = response.data.ip;
            } else if (typeof response.data === 'string') {
                egressIp = response.data.trim();
            }
            return {
                success: response.status >= 200 && response.status < 300,
                target,
                elapsedMs,
                httpStatus: response.status,
                egressIp,
                proxySource: resolved.source,
                proxy: redactProxy(resolved.config),
                // Live socket snapshot so callers can compare configured vs bound
                active: (this._activeProxy && (this.status === 'connected' || this.status === 'connecting'))
                    ? {
                        source: this._activeProxy.source,
                        proxy: redactProxy(this._activeProxy.config),
                        boundAt: this._activeProxyAt,
                    }
                    : null,
            };
        } catch (error) {
            return {
                success: false,
                target,
                elapsedMs: Date.now() - start,
                error: error.message,
                code: error.code || null,
                proxySource: resolved.source,
                proxy: redactProxy(resolved.config),
            };
        }
    }

    /**
     * Normalize any accepted proxy input shape into the canonical persisted form.
     * Returns null if no config (inherit deployment default).
     *
     * @param {Object|string|null} input
     * @param {string} [defaultSource] - source tag to stamp when input doesn't already have one
     */
    _normalizeProxy(input, defaultSource = 'api') {
        if (!input) return null;
        if (input.enabled === false) return { enabled: false };
        try {
            const cfg = parseProxyConfig(input.url || input);
            if (!cfg) return null;
            return {
                enabled: true,
                source: input.source || defaultSource, // 'api' | 'pool'
                type: cfg.type,
                host: cfg.host,
                port: cfg.port,
                username: cfg.username,
                password: cfg.password,
            };
        } catch (err) {
            console.warn(`[Instance ${this.id}] Dropping invalid persisted proxy config: ${err.message}`);
            return null;
        }
    }

    /**
     * Update the per-instance proxy override.
     *
     * @param {Object|null} newProxy
     *   null                                 -> clear override, fall back to deployment default
     *   { enabled: false }                   -> explicitly disable proxy for this instance
     *   { enabled: true, url: "http://..." } -> use this URL
     *   { enabled: true, type, host, port, username?, password? } -> structured form
     */
    async updateProxy(newProxy, opts = {}) {
        const source = opts.source || 'api'; // 'api' | 'pool'

        if (newProxy === null || newProxy === undefined) {
            this.proxy = null;
            this._log('Proxy override cleared (inheriting deployment default or pool)', 'info');
        } else if (newProxy.enabled === false) {
            this.proxy = { enabled: false };
            this._log('Proxy explicitly disabled for this instance', 'info');
        } else {
            const cfg = parseProxyConfig(newProxy.url || newProxy);
            if (!cfg) {
                throw new Error('Invalid proxy config: need url or {type,host,port}');
            }
            this.proxy = {
                enabled: true,
                source,
                type: cfg.type,
                host: cfg.host,
                port: cfg.port,
                username: cfg.username,
                password: cfg.password,
                ...(newProxy.label ? { label: newProxy.label } : {}),
                ...(newProxy.country ? { country: newProxy.country } : {}),
            };
            const originLabel = source === 'pool' ? 'pool-assigned' : 'override';
            const tag = this.proxy.label ? ` [${this.proxy.label}]` : '';
            this._log(
                `Proxy ${originLabel}${tag}: ${cfg.type}://${cfg.username ? cfg.username + '@' : ''}${cfg.host}:${cfg.port}`,
                'info'
            );
        }

        // If connected/connecting, bounce the socket so the new agent is applied
        if (opts.skipReconnect) return this.getProxyStatus();
        if (this.status === 'connected' || this.status === 'connecting') {
            this._log('Reconnecting to apply new proxy config...', 'warning');
            try {
                if (this.socket) {
                    try { this.socket.ev.removeAllListeners(); } catch (_) {}
                    try { this.socket.end(); } catch (_) {}
                    this.socket = null;
                }
                this.status = 'disconnected';
                this._emitStatusChange();
                // Reconnect in the background so the API call returns quickly
                setTimeout(() => {
                    this.connect({ _pairingRecovery: true }).catch(err => {
                        this._log(`Reconnect after proxy change failed: ${err.message}`, 'error');
                    });
                }, 500);
            } catch (err) {
                this._log(`Failed to bounce socket for proxy change: ${err.message}`, 'error');
            }
        }

        return this.getProxyStatus();
    }

    /**
     * Get serializable config (for persistence)
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            webhookUrl: this.webhookUrl,
            webhookSigningSecret: this.webhookSigningSecret,
            behaviorSettings: this.behaviorSettings,
            antiBanSettings: this.antiBanSettings,
            antibanV2: this.antibanV2,
            handoffSettings: this.handoffSettings,
            proxy: this.proxy,
            createdAt: this.createdAt
        };
    }
    
    /**
     * Log activity
     */
    _log(message, level = 'info') {
        const entry = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            message,
            level
        };
        
        this.activityLog.unshift(entry);
        if (this.activityLog.length > 500) {
            this.activityLog = this.activityLog.slice(0, 500);
        }
        
        if (this.onLog) {
            this.onLog(this.id, entry);
        }
        
        const emoji = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        console.log(`${emoji[level] || ''} [${this.id}] ${message}`);
    }
    
    _logMessage(direction, from, to, text, messageId, extra = {}) {
        const entry = {
            id: messageId || Date.now().toString(),
            direction,
            from,
            to,
            text: text || '',
            timestamp: new Date().toISOString(),
            status: 'delivered',
            ...extra
        };
        
        this.messageHistory.unshift(entry);
        if (this.messageHistory.length > this.maxMessageHistory) {
            this.messageHistory = this.messageHistory.slice(0, this.maxMessageHistory);
        }
        
        return entry;
    }
    
    getMessages(filters = {}) {
        let messages = this.messageHistory;
        
        if (filters.direction) {
            messages = messages.filter(m => m.direction === filters.direction);
        }
        
        if (filters.since) {
            const sinceDate = new Date(filters.since);
            messages = messages.filter(m => new Date(m.timestamp) >= sinceDate);
        }
        
        const limit = Math.min(filters.limit || 50, 200);
        return messages.slice(0, limit);
    }
    
    /**
     * Emit status change
     */
    _emitStatusChange() {
        if (this.onStatusChange) {
            this.onStatusChange(this.id, this.getStatus());
        }
    }
}

/**
 * Instance Manager - Manages all WhatsApp instances
 */
class InstanceManager {
    constructor() {
        this.instances = new Map();
        this.onStatusChange = null;
        this.onMessage = null;
        this.onLog = null;

        // Proxy pool is constructed empty here; actual entries are loaded from
        // instances/proxy-pool.json (source of truth) or bootstrapped from the
        // PROXY_POOL env var on first boot. See init().
        this.proxyPool = new ProxyPoolManager(null);
    }

    /**
     * Initialize the manager
     */
    async init() {
        // Ensure instances folder exists
        await fs.mkdir(INSTANCES_FOLDER, { recursive: true });

        // Load pool: prefer the JSON file (source of truth, runtime-mutable)
        // over the PROXY_POOL env var (bootstrap seed). If the file is missing
        // and the env is set, seed the file from env and use that henceforth.
        await this._loadOrSeedProxyPool();

        // Load existing instances from DB
        await this._loadInstances();

        // Reconcile pool assignments against the loaded instances.
        if (this.proxyPool.isEnabled()) {
            await this._reconcileProxyPool({ emit: false });
            console.log(
                `[InstanceManager] Proxy pool ready: ${this.proxyPool.getStatus().used}/${this.proxyPool.size()} slots in use`
            );
        }

        console.log(`[InstanceManager] Initialized with ${this.instances.size} instances`);
        return this;
    }

    /**
     * Load the proxy pool from instances/proxy-pool.json.
     * If the file doesn't exist but the PROXY_POOL env var is set, seed the
     * file from it so subsequent edits can be made via the API without losing
     * the original bootstrap on restart.
     */
    async _loadOrSeedProxyPool() {
        try {
            if (fsSync.existsSync(PROXY_POOL_FILE)) {
                const raw = await fs.readFile(PROXY_POOL_FILE, 'utf8');
                const data = JSON.parse(raw);
                const entries = Array.isArray(data) ? data : (data.entries || []);
                this.proxyPool = new ProxyPoolManager(entries);
                console.log(`[InstanceManager] Loaded ${this.proxyPool.size()} proxy-pool entries from disk`);
                return;
            }
        } catch (err) {
            console.warn(`[InstanceManager] Failed to read proxy-pool.json: ${err.message}`);
        }

        const envValue = process.env.PROXY_POOL || '';
        if (envValue) {
            this.proxyPool = new ProxyPoolManager(envValue);
            if (this.proxyPool.size() > 0) {
                await this._saveProxyPool();
                console.log(`[InstanceManager] Seeded proxy-pool.json from PROXY_POOL env (${this.proxyPool.size()} entries)`);
            }
        }
    }

    /**
     * Persist the current pool to disk atomically.
     */
    async _saveProxyPool() {
        try {
            const data = { entries: this.proxyPool.serialize(), savedAt: new Date().toISOString() };
            await fs.writeFile(PROXY_POOL_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[InstanceManager] Failed to save proxy-pool.json:', err);
            throw err;
        }
    }

    /**
     * Runtime: add a proxy to the pool (live, no restart).
     * Accepts URL string, webshare shorthand "host:port:user:pass", or an object.
     *
     * Returns { added, slot, pool }. If the pool had empty slots and there are
     * direct-connection instances that could use the new slot, the caller can
     * follow up with reconcileProxyPool() to hand it out retroactively.
     */
    async addProxyToPool(input) {
        const result = this.proxyPool.addEntry(input);
        // Persist metadata updates even when host:port already existed (label/country).
        await this._saveProxyPool();
        if (result.added) {
            console.log(`[InstanceManager] Added pool slot: ${result.slot.id}` +
                (result.slot.label ? ` (${result.slot.label})` : ''));
        }
        return {
            ...result,
            pool: this.proxyPool.getStatus(),
        };
    }

    getProxyCatalog() {
        return this.proxyPool.getCatalog({
            instanceLookup: (id) => {
                const inst = this.instances.get(id);
                if (!inst) return null;
                return { name: inst.name, status: inst.status };
            },
        });
    }

    /**
     * Light latency (+ optional egress IP) probe for a labeled catalog slot.
     */
    async probeCatalogLabel(label) {
        const slot = this.proxyPool.findByLabel(label);
        if (!slot) throw new Error(`Catalog label ${label} not found`);
        const axios = (await import('axios')).default;
        const agent = createProxyAgent(slot.config);
        const start = Date.now();
        // Single light request: latency + egress IP in one hop
        const ipRes = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: agent,
            httpAgent: agent,
            timeout: 12000,
        });
        const elapsedMs = Date.now() - start;
        return {
            success: true,
            label: slot.label,
            country: slot.country,
            host: slot.config.host,
            port: slot.config.port,
            responseStatus: ipRes.status,
            elapsedMs,
            egressIp: ipRes.data?.ip || null,
        };
    }

    /**
     * Find other instances already using this host:port (sticky api/pool override).
     */
    findSharedProxyUsers(host, port, { excludeId = null, connectedOnly = true } = {}) {
        if (!host || !port) return [];
        const hits = [];
        for (const inst of this.instances.values()) {
            if (excludeId && inst.id === excludeId) continue;
            const p = inst.proxy;
            if (!p || p.enabled === false) continue;
            if (String(p.host) !== String(host) || Number(p.port) !== Number(port)) continue;
            if (connectedOnly && inst.status !== 'connected' && inst.status !== 'connecting') continue;
            hits.push({ id: inst.id, name: inst.name, status: inst.status });
        }
        return hits;
    }

    /**
     * Attach a labeled catalog/pool slot as a sticky API override (unique egress).
     */
    async attachCatalogProxy(id, label, { forceShared = false } = {}) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        const slot = this.proxyPool.findByLabel(label);
        if (!slot) throw new Error(`Catalog label ${label} not found on this worker`);

        const shared = this.findSharedProxyUsers(slot.config.host, slot.config.port, { excludeId: id });
        if (shared.length && !forceShared) {
            const err = new Error(
                `Proxy ${slot.label || slot.id} is already used by connected instance(s): ` +
                shared.map(s => s.name).join(', ') +
                '. Pass forceShared=true to override (bad WhatsApp signal).'
            );
            err.code = 'PROXY_SHARED_EGRESS';
            err.sharedWith = shared;
            throw err;
        }

        // Fleet-wide guard (other workers / org VMs)
        if (!forceShared) {
            try {
                const { fetchFleetProxyOccupancy } = await import('./fleet-proxy-occupancy.js');
                const occupancy = await fetchFleetProxyOccupancy({ force: true });
                const hp = `${slot.config.host}:${slot.config.port}`;
                const wantLabel = String(slot.label || label).toUpperCase();
                const users = [
                    ...((occupancy?.byHost || {})[hp] || []),
                    ...((occupancy?.byLabel || {})[wantLabel] || []),
                ];
                const seen = new Set();
                const conflicts = [];
                for (const u of users) {
                    if (u.instanceId === id) continue;
                    if (!u.connected) continue;
                    const key = `${u.workerId}:${u.instanceId}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    conflicts.push(u);
                }
                if (conflicts.length) {
                    const err = new Error(
                        `Proxy ${wantLabel} (${hp}) already used fleet-wide by connected: ` +
                        conflicts.map((u) => `${u.instanceName}@${u.workerLabel}`).join(', ') +
                        '. Pass forceShared=true to override (bad WhatsApp signal).'
                    );
                    err.code = 'PROXY_SHARED_EGRESS';
                    err.sharedWith = conflicts.map((u) => ({
                        id: u.instanceId,
                        name: `${u.instanceName}@${u.workerLabel}`,
                        status: u.status,
                    }));
                    throw err;
                }
            } catch (fleetErr) {
                if (fleetErr.code === 'PROXY_SHARED_EGRESS') throw fleetErr;
                console.warn('[attachCatalogProxy] fleet occupancy check skipped:', fleetErr.message);
            }
        }

        this.proxyPool.releaseSlot(id);
        this.proxyPool.markAssigned(id, slot.config.host, slot.config.port);
        await this._saveProxyPool();

        const result = await instance.updateProxy(
            {
                enabled: true,
                type: slot.config.type,
                host: slot.config.host,
                port: slot.config.port,
                username: slot.config.username,
                password: slot.config.password,
                label: slot.label,
                country: slot.country,
            },
            { source: 'api' }
        );
        await this._saveInstances();
        return {
            ...result,
            label: slot.label,
            country: slot.country,
            catalog: this.getProxyCatalog(),
        };
    }

    /**
     * Runtime: remove a proxy from the pool (live, no restart).
     * If the slot was assigned to an instance, that instance's proxy is
     * orphaned — we clear it and, via reconcile, try to give the instance a
     * different free slot or let it fall through to direct. The instance will
     * bounce its socket to apply the change.
     */
    async removeProxyFromPool(slotId) {
        const result = this.proxyPool.removeEntry(slotId);
        if (!result.removed) {
            return { removed: false, pool: this.proxyPool.getStatus() };
        }
        await this._saveProxyPool();
        console.log(`[InstanceManager] Removed pool slot: ${slotId}` +
            (result.wasAssignedTo ? ` (was held by ${result.wasAssignedTo})` : ''));

        // If an instance was holding this slot, clear + reconcile so it
        // picks up a new one or falls through to direct.
        if (result.wasAssignedTo) {
            await this._reconcileProxyPool({ emit: true });
        }

        return {
            removed: true,
            wasAssignedTo: result.wasAssignedTo,
            pool: this.proxyPool.getStatus(),
        };
    }

    /**
     * Rebuild pool assignments from current instances. Any retroactively
     * assigned instance gets its proxy field updated (and bounced if online).
     *
     * @param {{emit?: boolean}} [opts]
     */
    async _reconcileProxyPool({ emit = true } = {}) {
        const instanceList = Array.from(this.instances.values()).map(i => ({
            id: i.id,
            proxy: i.proxy,
            createdAt: i.createdAt,
        }));

        const { reassigned, orphaned } = this.proxyPool.reconcile(instanceList);

        // Clear proxies on orphaned instances (their pool slot no longer exists)
        for (const orphanId of orphaned) {
            const inst = this.instances.get(orphanId);
            if (!inst) continue;
            inst._log('Proxy slot no longer in pool — clearing', 'warning');
            await inst.updateProxy(null, { skipReconnect: false });
        }

        // Apply new pool assignments to instances that got one
        for (const { instanceId, slot } of reassigned) {
            const inst = this.instances.get(instanceId);
            if (!inst) continue;
            await inst.updateProxy(
                {
                    enabled: true,
                    type: slot.type,
                    host: slot.host,
                    port: slot.port,
                    username: slot.username,
                    password: slot.password,
                },
                { source: 'pool' }
            );
        }

        if (orphaned.length || reassigned.length) {
            await this._saveInstances();
        }

        return {
            reassigned: reassigned.map(r => r.instanceId),
            orphaned,
            pool: this.proxyPool.getStatus(),
        };
    }
    
    /**
     * Create a new instance
     */
    async createInstance(config = {}) {
        const id = config.id || this._generateId();

        console.log(`[InstanceManager] Creating instance: ${id}`);

        if (this.instances.has(id)) {
            throw new Error(`Instance ${id} already exists`);
        }

        // Auto-assign a proxy from the pool if (a) no explicit proxy was passed,
        // and (b) the pool has a free slot. Tagged with source:'pool' so it can
        // be distinguished from an API-set override.
        let proxyConfig = config.proxy || null;
        if (!proxyConfig && this.proxyPool.isEnabled()) {
            const slot = this.proxyPool.claimSlot(id);
            if (slot) {
                proxyConfig = {
                    enabled: true,
                    source: 'pool',
                    type: slot.type,
                    host: slot.host,
                    port: slot.port,
                    username: slot.username,
                    password: slot.password,
                };
                console.log(`[InstanceManager] Assigned pool slot ${slot.host}:${slot.port} to ${id}`);
            } else {
                console.log(`[InstanceManager] Pool exhausted — ${id} will connect direct`);
            }
        }

        const created = applyTyrejobsWorkerCreateDefaults(config);
        const instance = new WhatsAppInstance({
            id,
            name: created.name || `Instance ${id}`,
            webhookUrl: created.webhookUrl || '',
            webhookSigningSecret: created.webhookSigningSecret || '',
            behaviorSettings: created.behaviorSettings,
            antiBanSettings: created.antiBanSettings,
            antibanV2: created.antibanV2 || legacyToV2Config(created.antiBanSettings || {}),
            proxy: proxyConfig,
        });
        instance.manager = this;
        
        console.log(`[InstanceManager] Instance object created, auth folder: ${instance.authFolder}`);
        
        // Set up event handlers
        instance.onStatusChange = (id, status) => {
            if (this.onStatusChange) this.onStatusChange(id, status);
        };
        instance.onMessage = (data) => {
            if (this.onMessage) this.onMessage(data);
        };
        instance.onLog = (id, entry) => {
            if (this.onLog) this.onLog(id, entry);
        };
        
        await instance.init();
        console.log(`[InstanceManager] Instance initialized`);
        
        this.instances.set(id, instance);
        console.log(`[InstanceManager] Instance added to map, total instances: ${this.instances.size}`);
        
        await this._saveInstances();
        console.log(`[InstanceManager] Instances saved to disk`);
        
        return instance.getStatus();
    }
    
    /**
     * Get instance by ID
     */
    getInstance(id) {
        return this.instances.get(id);
    }
    
    /**
     * Get all instances (enriched with shared-fingerprint risk across this worker)
     */
    getAllInstances() {
        const riskMap = this.buildFingerprintRiskMap();
        const list = [];
        for (const [id, instance] of this.instances) {
            const status = instance.getStatus();
            status.fingerprintRisk = riskMap.get(id) || status.fingerprintRisk || null;
            list.push(status);
        }
        return list;
    }

    /**
     * Egress fingerprint key for an instance on this worker.
     * `direct` = no proxy (shared Azure outbound IP risk).
     */
    getInstanceFingerprintKey(instance) {
        try {
            const resolved = resolveEffectiveProxy(instance?.proxy);
            return proxyFingerprintKeyFromResolved(resolved);
        } catch {
            return 'direct';
        }
    }

    /**
     * @returns {Map<string, object>} instanceId -> fingerprintRisk profile
     */
    buildFingerprintRiskMap() {
        const groups = new Map(); // fingerprint -> [instanceId]
        for (const [id, instance] of this.instances) {
            const key = this.getInstanceFingerprintKey(instance);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(id);
        }

        const out = new Map();
        for (const [fingerprint, ids] of groups) {
            const sharedWith = Math.max(0, ids.length - 1);
            const risk = classifyFingerprintRisk(sharedWith);
            for (const id of ids) {
                const peers = ids.filter((x) => x !== id).map((peerId) => {
                    const peer = this.instances.get(peerId);
                    return { id: peerId, name: peer?.name || peerId };
                });
                out.set(id, {
                    risk,
                    sharedWith,
                    fingerprint,
                    label: fingerprint === 'direct'
                        ? 'Direct egress (no proxy) — shares worker outbound IP'
                        : `Proxy ${fingerprint}`,
                    peers,
                    thresholds: { lowMax: 2, amberMax: 4 },
                });
            }
        }
        return out;
    }

    getFingerprintRiskForInstance(instanceId) {
        return this.buildFingerprintRiskMap().get(instanceId) || null;
    }

    /**
     * Deterministic per-instance offset so conflict/recoverable reconnects don't align.
     */
    getRuntimeReconnectStaggerMs(instanceId) {
        if (!RUNTIME_RECONNECT_STAGGER_MS) return 0;
        const n = Math.max(1, this.instances.size);
        const slot = stableInstanceSlot(instanceId, n);
        return slot * RUNTIME_RECONNECT_STAGGER_MS;
    }

    /**
     * Startup auto-reconnect with fleet stagger + jitter (prevents mass companion re-auth).
     */
    scheduleStartupReconnect(instance, index = 0) {
        const jitter = STARTUP_RECONNECT_JITTER_MS
            ? Math.floor(Math.random() * (STARTUP_RECONNECT_JITTER_MS + 1))
            : 0;
        const delayMs = (index * STARTUP_RECONNECT_STAGGER_MS) + jitter;
        console.log(
            `[InstanceManager] Scheduling startup auto-reconnect for ${instance.id} in ${Math.round(delayMs / 1000)}s (slot ${index})`,
        );
        setTimeout(() => {
            if (!this.instances.has(instance.id)) return;
            if (instance.status === 'connected' || instance.status === 'connecting') return;
            instance.connect().catch((err) => {
                console.error(`[InstanceManager] Startup auto-reconnect failed for ${instance.id}:`, err.message);
            });
        }, delayMs);
        return delayMs;
    }
    
    /**
     * Delete an instance
     */
    async deleteInstance(id) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }

        // Release any held pool slot BEFORE we forget about the instance
        const released = this.proxyPool.releaseSlot(id);
        if (released) {
            console.log(`[InstanceManager] Returned pool slot held by ${id} to the pool`);
        }

        // Disconnect first
        await instance.disconnect();

        // Delete instance folder
        const instanceFolder = path.join(INSTANCES_FOLDER, id);
        await fs.rm(instanceFolder, { recursive: true, force: true });

        // Remove from map
        this.instances.delete(id);
        await this._saveInstances();

        console.log(`[InstanceManager] Deleted instance: ${id}`);
        return { success: true, id, poolSlotReleased: released };
    }
    
    /**
     * Update instance settings
     */
    async updateInstance(id, updates) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        
        if (updates.name) instance.name = updates.name;
        if (updates.webhookUrl !== undefined) instance.webhookUrl = updates.webhookUrl;
        if (updates.webhookSigningSecret !== undefined) {
            instance.webhookSigningSecret = String(updates.webhookSigningSecret || '').trim();
        }
        if (updates.behaviorSettings) {
            instance.updateBehaviorSettings(updates.behaviorSettings);
        }
        if (updates.antiBanSettings) {
            instance.updateAntiBanSettings(updates.antiBanSettings);
        }
        if (updates.handoffSettings) {
            instance.handoffSettings = Object.assign(instance.handoffSettings, updates.handoffSettings);
        }
        if (updates.proxy !== undefined) {
            await instance.updateProxy(updates.proxy);
        }
        if (updates.antibanV2 !== undefined) {
            await instance.updateAntibanV2(updates.antibanV2);
        }

        await this._saveInstances();
        return instance.getStatus();
    }

    /**
     * Set/update per-instance proxy via API.
     *
     *   proxy === null          -> clear override. If the pool has a free slot,
     *                              auto-claim it; otherwise fall through.
     *   proxy.enabled === false -> explicit disable (releases any pool slot).
     *   otherwise               -> user-supplied override with source='api'
     *                              (releases any held pool slot).
     */
    async setInstanceProxy(id, proxy, opts = {}) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }

        // null / undefined / { direct: true } => FORCE DIRECT (do not re-claim pool).
        // Legacy "fall back to pool" is opt-in via { inheritPool: true }.
        if (proxy === null || proxy === undefined || proxy?.direct === true) {
            this.proxyPool.releaseSlot(id);
            await this._saveProxyPool();

            if (opts.inheritPool || proxy?.inheritPool) {
                const slot = this.proxyPool.isEnabled() ? this.proxyPool.claimSlot(id) : null;
                if (slot) {
                    const result = await instance.updateProxy(
                        {
                            enabled: true,
                            type: slot.type,
                            host: slot.host,
                            port: slot.port,
                            username: slot.username,
                            password: slot.password,
                            label: slot.label,
                            country: slot.country,
                        },
                        { source: 'pool' }
                    );
                    await this._saveInstances();
                    await this._saveProxyPool();
                    return result;
                }
            }

            const result = await instance.updateProxy({ enabled: false });
            await this._saveInstances();
            return result;
        }

        if (proxy.enabled === false) {
            this.proxyPool.releaseSlot(id);
            await this._saveProxyPool();
            const result = await instance.updateProxy({ enabled: false });
            await this._saveInstances();
            return result;
        }

        // Shared-egress guard for sticky attaches
        const cfg = parseProxyConfig(proxy.url || proxy);
        if (cfg && !opts.forceShared && !proxy.forceShared) {
            const shared = this.findSharedProxyUsers(cfg.host, cfg.port, { excludeId: id });
            if (shared.length) {
                const err = new Error(
                    `Proxy ${cfg.host}:${cfg.port} already used by connected: ` +
                    shared.map(s => s.name).join(', ') +
                    '. Pass forceShared=true to override.'
                );
                err.code = 'PROXY_SHARED_EGRESS';
                err.sharedWith = shared;
                throw err;
            }
        }

        // API-set override: free any prior pool assignment, mark catalog slot if known.
        this.proxyPool.releaseSlot(id);
        if (cfg) this.proxyPool.markAssigned(id, cfg.host, cfg.port);
        await this._saveProxyPool();
        const result = await instance.updateProxy(proxy, { source: 'api' });
        await this._saveInstances();
        return result;
    }

    /**
     * Public hook: rebuild pool assignments (useful after changing PROXY_POOL
     * at runtime or if you want to retroactively hand slots to existing
     * direct-connection instances).
     */
    async reconcileProxyPool() {
        return this._reconcileProxyPool({ emit: true });
    }

    /**
     * Public: get the current pool status.
     */
    getProxyPoolStatus() {
        return this.proxyPool.getStatus();
    }

    /**
     * Verify the egress IP for an instance by probing through its effective
     * proxy agent. Returns { egressIp, proxy, active, ... }.
     */
    async verifyInstanceProxy(id, target) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        return await instance.verifyProxy(target);
    }

    // ─── Anti-ban v2 manager-level helpers ────────────────────────────────

    getAntibanV2(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        return instance.getAntibanV2Full();
    }

    async updateAntibanV2(id, updates) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        const result = await instance.updateAntibanV2(updates);
        await this._saveInstances();
        return result;
    }

    pauseAntibanV2(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        return instance.pauseAntibanV2();
    }

    resumeAntibanV2(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        return instance.resumeAntibanV2();
    }

    async resetAntibanV2(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        const result = await instance.resetAntibanV2();
        await this._saveInstances();
        return result;
    }

    async graduateWarmupAntiban(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        const result = await instance.graduateWarmupAntiban();
        await this._saveInstances();
        return result;
    }

    getLidMappings(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        return instance.getLidMappings();
    }
    
    /**
     * Connect an instance
     * @param {string} id - Instance ID
     * @param {Object} options - Connection options
     * @param {string} options.pairingPhone - Phone number for pairing code login
     */
    async connectInstance(id, options = {}) {
        console.log(`[InstanceManager] Connecting instance: ${id}, options:`, options);
        console.log(`[InstanceManager] Available instances:`, Array.from(this.instances.keys()));
        
        const instance = this.instances.get(id);
        if (!instance) {
            console.error(`[InstanceManager] Instance ${id} not found in map`);
            throw new Error(`Instance ${id} not found`);
        }
        
        console.log(`[InstanceManager] Instance found, current status: ${instance.status}`);
        
        await instance.connect(options);
        return instance.getStatus();
    }
    
    /**
     * Disconnect an instance
     */
    async disconnectInstance(id, disconnectOptions = {}) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        await instance.disconnect(disconnectOptions);
        return instance.getStatus();
    }

    /**
     * Re-apply behaviorSettings from instances.json onto already-loaded instances
     * without restarting the process (no code reload). Use after hand-editing the
     * file on disk or rsync from another writer. Unknown instance ids in the file are skipped.
     */
    async reloadBehaviorSettingsFromDisk() {
        if (!fsSync.existsSync(INSTANCES_DB_FILE)) {
            return { success: false, error: 'instances.json not found', results: [] };
        }
        const raw = await fs.readFile(INSTANCES_DB_FILE, 'utf8');
        const rows = JSON.parse(raw);
        if (!Array.isArray(rows)) {
            return { success: false, error: 'instances.json must be a JSON array', results: [] };
        }
        const results = [];
        for (const row of rows) {
            if (!row || typeof row.id !== 'string') continue;
            const inst = this.instances.get(row.id);
            if (!inst) {
                results.push({ id: row.id, ok: false, reason: 'not_loaded_in_memory' });
                continue;
            }
            if (row.behaviorSettings && typeof row.behaviorSettings === 'object') {
                inst.updateBehaviorSettings(row.behaviorSettings);
                results.push({
                    id: row.id,
                    ok: true,
                    appliedKeys: Object.keys(row.behaviorSettings),
                    behaviorSettings: { ...inst.behaviorSettings },
                });
            } else {
                results.push({ id: row.id, ok: true, appliedKeys: [], note: 'no behaviorSettings in file row' });
            }
        }
        return { success: true, count: results.length, results };
    }
    
    /**
     * Clear instance auth
     */
    async clearInstanceAuth(id, options = {}) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        await instance.clearAuth(options);
        return instance.getStatus();
    }
    
    /**
     * Send message via instance
     * @param {string} instanceId - Instance ID
     * @param {string} to - Phone number or JID
     * @param {string|Object} textOrParams - Plain text or rich message params
     * @param {Object} options - Behavior options (typingSimulation, delayEnabled)
     */
    async sendMessage(instanceId, to, textOrParams, options = {}) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            throw new Error(`Instance ${instanceId} not found`);
        }
        return await instance.sendMessage(to, textOrParams, options);
    }

    async sendReaction(instanceId, to, messageId, emoji, fromMe = false) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            throw new Error(`Instance ${instanceId} not found`);
        }
        return await instance.sendReaction(to, messageId, emoji, fromMe);
    }
    
    /**
     * Load instances from DB file with retry (for Railway volume mount timing)
     */
    async _loadInstances() {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 2000;
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`[InstanceManager] Looking for instances at: ${INSTANCES_DB_FILE} (attempt ${attempt}/${MAX_RETRIES})`);
                console.log(`[InstanceManager] Instances folder exists: ${fsSync.existsSync(INSTANCES_FOLDER)}`);
                console.log(`[InstanceManager] Instances file exists: ${fsSync.existsSync(INSTANCES_DB_FILE)}`);
                
                if (fsSync.existsSync(INSTANCES_DB_FILE)) {
                    await this._loadInstancesFromFile();
                    return; // Success, exit retry loop
                } else if (attempt < MAX_RETRIES) {
                    console.log(`[InstanceManager] File not found, waiting ${RETRY_DELAY_MS}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                } else {
                    console.log(`[InstanceManager] No instances file found after ${MAX_RETRIES} attempts`);
                }
            } catch (error) {
                console.error(`[InstanceManager] Error loading instances (attempt ${attempt}):`, error.message);
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                }
            }
        }
    }
    
    /**
     * Actually load instances from the file
     */
    async _loadInstancesFromFile() {
        try {
            if (fsSync.existsSync(INSTANCES_DB_FILE)) {
                const data = await fs.readFile(INSTANCES_DB_FILE, 'utf8');
                console.log(`[InstanceManager] Read ${data.length} bytes from instances file`);
                const instanceConfigs = JSON.parse(data);
                console.log(`[InstanceManager] Parsed ${instanceConfigs.length} instance configs`);
                
                for (const config of instanceConfigs) {
                    const instance = new WhatsAppInstance(config);
                    instance.manager = this;
                    
                    instance.onStatusChange = (id, status) => {
                        if (this.onStatusChange) this.onStatusChange(id, status);
                    };
                    instance.onMessage = (data) => {
                        if (this.onMessage) this.onMessage(data);
                    };
                    instance.onLog = (id, entry) => {
                        if (this.onLog) this.onLog(id, entry);
                    };
                    
                    await instance.init();
                    this.instances.set(instance.id, instance);
                    console.log(`[InstanceManager] Loaded instance: ${instance.id} (${instance.name})`);
                }

                // Second pass: staggered startup reconnect (never fire all companion sessions at once)
                let startupSlot = 0;
                for (const [id, instance] of this.instances) {
                    const credsFile = path.join(instance.authFolder, 'creds.json');
                    if (!fsSync.existsSync(credsFile)) continue;
                    const authState = await instance._readAuthRegistrationState();
                    if (authState.registered) {
                        this.scheduleStartupReconnect(instance, startupSlot);
                        startupSlot += 1;
                    } else if (authState.exists && !authState.hasMe) {
                        console.log(`[InstanceManager] Clearing abandoned unpaired auth for ${id} on startup (privacy tokens preserved)`);
                        await instance._resetAuthForFreshQr('Cleared abandoned unpaired auth on startup');
                    }
                }
                console.log(`[InstanceManager] Finished loading ${this.instances.size} instances (${startupSlot} staggered startup reconnects)`);
            } else {
                console.log(`[InstanceManager] No instances file found at ${INSTANCES_DB_FILE}`);
            }
        } catch (error) {
            console.error('[InstanceManager] Error loading instances:', error);
            console.error('[InstanceManager] Error stack:', error.stack);
        }
    }
    
    /**
     * Save instances to DB file
     */
    async _saveInstances() {
        try {
            const configs = [];
            for (const [id, instance] of this.instances) {
                configs.push(instance.toJSON());
            }
            await fs.writeFile(INSTANCES_DB_FILE, JSON.stringify(configs, null, 2));
        } catch (error) {
            console.error('[InstanceManager] Error saving instances:', error);
        }
    }
    
    /**
     * Generate unique instance ID
     */
    _generateId() {
        return `wa_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    }
    
    /**
     * Graceful shutdown
     */
    async shutdown() {
        console.log('[InstanceManager] Shutting down all instances...');
        for (const [id, instance] of this.instances) {
            try {
                await instance.disconnect();
            } catch (error) {
                console.error(`[InstanceManager] Error disconnecting ${id}:`, error);
            }
        }
    }
}

export { InstanceManager, WhatsAppInstance };
