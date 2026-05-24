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
import { uploadMedia, isStorageEnabled } from './azure-storage.js';
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
    pickOrLoadFingerprint,
    planReconnect,
    rampPresence,
    DEFAULT_V2_MODULES,
} from './antiban-v2.js';

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
const QR_CODE_TTL_MS = 110_000;

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
            delayEnabled: true,
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
    merged.phoneNotificationsEnabled = behaviorProfile !== BEHAVIOR_PROFILES.BOT_NATIVE;
    merged.notificationGraceMs = clampNotificationGraceMs(
        settings.notificationGraceMs !== undefined ? settings.notificationGraceMs : merged.notificationGraceMs,
        profileDefaults.notificationGraceMs
    );

    if (behaviorProfile === BEHAVIOR_PROFILES.NOTIFICATION_MAX) {
        merged.typingSimulation = false;
    }

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

        // Anti-ban v2 (Wasup transport anti-ban pipeline)
        // Per-instance config block. If absent, derived from legacy antiBanSettings
        // on first connect. See docs/ANTIBAN_V2_DESIGN.md.
        this.antibanV2 = config.antibanV2 || null;
        // Runtime context (built per-connect, destroyed on disconnect)
        this.antibanCtx = null;
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
        this.activeConnectGeneration = 0;
        this.connectInFlight = false;
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
        
        // Anti-ban settings
        this.antiBanSettings = config.antiBanSettings || {
            preset: 'balanced',
            messagesPerHour: 200,
            messagesPerDay: 5000,
            uniqueChatsPerHour: 50,
            uniqueChatsPerDay: 500
        };
        this.antiBanManager = new AntiBanManager(this.antiBanSettings);
        
        // Paths
        this.authFolder = path.join(INSTANCES_FOLDER, this.id, 'auth');
        this.logsFolder = path.join(INSTANCES_FOLDER, this.id, 'logs');
        this.lidCacheFile = path.join(this.authFolder, 'lid-mapping.json');
        this.savedContactsFile = path.join(this.authFolder, 'saved-contacts.json');
        
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
        
        // Presence cycling interval (for stealth mode)
        this.presenceCycleInterval = null;
        
        // Human handoff settings (per-instance configurable)
        this.handoffSettings = Object.assign({
            resumeKeywords: ['#ai', '#assistant', '#bot', '#resume'],
            resumeMessage: '',   // optional auto-reply when bot resumes (empty = silent)
        }, config.handoffSettings || {});

        // Human handoff: JID -> { taggedAt, taggedBy, autoResumeAt? }
        this.humanModeChats = new Map();
        // IDs of messages we sent via the bot, so we can distinguish manual sends
        this.botSentMessageIds = new Set();
        
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
        return this;
    }

    _cancelPairingRestartTimer() {
        if (this.pairingRestartTimer) {
            clearTimeout(this.pairingRestartTimer);
            this.pairingRestartTimer = null;
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
        if (this.status === 'connecting' && !isPairingRecovery) {
            throw new Error('Connection in progress');
        }
        if (this.connectInFlight) {
            throw new Error('Connection in progress');
        }
        this.connectInFlight = true;

        this._cancelPairingRestartTimer();
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

            const isInitialRegistration = !state.creds.registered;

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
            let fingerprint = null;
            if (!isInitialRegistration) {
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
                this._log('Using registration-safe socket profile until device is linked', 'info');
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
            if (this.antibanCtx?.wrap) {
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
            });

            const enableAntibanAfterRegistration = async () => {
                if (!isInitialRegistration || this.antibanCtx || !this.rawSocket) return;

                try {
                    const postLinkFingerprint = await pickOrLoadFingerprint(path.join(INSTANCES_FOLDER, this.id));
                    this.antibanCtx = await buildAntibanContext({
                        instanceId: this.id,
                        instanceFolder: path.join(INSTANCES_FOLDER, this.id),
                        v2config: this.antibanV2,
                        onLog: (msg, level) => this._log(`[v2] ${msg}`, level),
                        onRiskChange: (change) => this._onRiskChange(change),
                    });
                    this.socket = this.antibanCtx.wrap(this.rawSocket);
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
                    const isConflict = this._isConflictDisconnect(statusCode, reconnectPlan, updateSummary);
                    // A 401 with "conflict" is a replaced socket, not an auth wipe signal.
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut && !isConflict;
                    const shouldReconnect = !isLoggedOut && !isConflict && reconnectPlan.shouldReconnect !== false;
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
                    } else if (isConflict) {
                        this.connectionIssue = {
                            message: 'WhatsApp replaced this socket with another active connection. Auth is preserved; disconnect the other worker/session, then reconnect.',
                            category: 'connection_replaced',
                            requiresAuthClear: false,
                            at: new Date().toISOString(),
                            statusCode,
                            detail: updateSummary.error || reconnectPlan.message,
                            retryAfterMs: CONNECT_REPLACED_RETRY_DELAY_MS,
                        };
                        this._log(`Connection replaced/conflict (${statusCode}: ${updateSummary.error || reconnectPlan.message}); auth preserved`, 'warning');
                        this._emitStatusChange();
                    } else if (shouldReconnect) {
                        const backoffMs = Math.max(2000, reconnectPlan.backoffMs || 5000);
                        this._log(`Connection lost (${reconnectPlan.category}: ${reconnectPlan.message}) — reconnecting in ${Math.round(backoffMs / 1000)}s`, 'warning');
                        this.connectionIssue = null;
                        this._emitStatusChange();
                        setTimeout(() => this.connect().catch((err) => {
                            this.connectionIssue = {
                                message: `Reconnect failed: ${err.message}`,
                                category: 'reconnect_failed',
                                requiresAuthClear: false,
                                at: new Date().toISOString()
                            };
                            this._log(`Reconnect failed: ${err.message}`, 'error');
                            this._emitStatusChange();
                        }), backoffMs);
                    } else {
                        const isProtocolMismatch = isProtocolMismatchDisconnect(reconnectPlan);
                        this.connectionIssue = {
                            message: isProtocolMismatch
                                ? 'WhatsApp requested a pairing restart. Press QR Code again to start a fresh pairing attempt; saved auth was preserved.'
                                : reconnectPlan.message,
                            category: reconnectPlan.category,
                            requiresAuthClear: false,
                            at: new Date().toISOString()
                        };
                        this._log(`Disconnect is fatal (${reconnectPlan.message}) — auth preserved; manual re-pair may be required`, 'error');
                        this._emitStatusChange();
                    }
                }

                if (connection === 'open') {
                    console.log(`[Instance ${this.id}] Connected!`);
                    await enableAntibanAfterRegistration();
                    this.status = 'connected';
                    this.qrCode = null;
                    this.qrContent = null;
                    this.qrCodeUpdatedAt = null;
                    this.qrRefreshRestartCount = 0;
                    this.staleProtocolResetCount = 0;
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

                    const phoneNotifsOn = this._preservesPhoneNotifications();

                    if (phoneNotifsOn) {
                        // Force the linked-device presence to 'unavailable' so WhatsApp's
                        // server keeps delivering push notifications to the phone.
                        try {
                            await this.socket.sendPresenceUpdate('unavailable');
                            this._log('Phone notifications mode: forced presence=unavailable on connect', 'info');
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
            this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                
                for (const msg of messages) {
                    const msgTimestamp = msg.messageTimestamp;
                    const now = Math.floor(Date.now() / 1000);
                    if (now - msgTimestamp > 60) continue;
                    await this._handleMessage(msg);
                }
            });
            
            // Store messages for retry handling
            this.socket.ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    if (msg.key.id) {
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
        this.activeConnectGeneration += 1;
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
        return profile === BEHAVIOR_PROFILES.NOTIFICATION_BALANCED
            || profile === BEHAVIOR_PROFILES.NOTIFICATION_MAX
            || !!this.behaviorSettings?.phoneNotificationsEnabled;
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

        // Phone-notifications mode never cycles presence: any 'available' nudge
        // suppresses the phone's push notification for ~10s. Bail out early.
        if (this._preservesPhoneNotifications()) return;
        
        // Cycle presence every 3-7 minutes
        const cyclePresence = async () => {
            if (!this.socket || this.status !== 'connected') return;
            if (this._preservesPhoneNotifications()) return;
            
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
     * Clear auth data (logout + delete credentials)
     */
    async clearAuth() {
        console.log(`[Instance ${this.id}] Clearing auth...`);
        this._cancelPairingRestartTimer();
        this.activeConnectGeneration += 1;
        this.qrRefreshRestartCount = 0;
        this.staleProtocolResetCount = 0;
        
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
        this.connectionIssue = null;
        this._emitStatusChange();
        
        try {
            await this._clearLocalAuthFiles();
            this._log('Auth cleared - ready for new QR scan', 'info');
        } catch (error) {
            console.error(`[Instance ${this.id}] Clear auth error:`, error);
            throw error;
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
        
        // Format JID if needed
        const jid = normalizedTo.includes('@') ? normalizedTo : `${normalizedTo}@s.whatsapp.net`;
        
        // Check rate limits
        const canSend = this.antiBanManager.canSendMessage(jid);
        if (!canSend.allowed) {
            throw new Error(`Rate limited: ${canSend.reason}`);
        }
        
        // Anti-ban: Save contact before sending (if not already saved)
        if (!options.skipContactSave) {
            await this._saveContactBeforeMessage(jid, options.contactName);
        }
        
        // Build the outbound message object
        let messageObj;
        let logText;
        if (typeof textOrParams === 'string') {
            messageObj = { text: textOrParams };
            logText = textOrParams;
        } else if (typeof textOrParams === 'object' && textOrParams !== null) {
            messageObj = this._buildMessageObject(textOrParams);
            logText = textOrParams.text || `[${textOrParams.messageType || 'rich'}]`;
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

        // Interactive messages (buttons/lists) go through the interactive helper
        if (messageObj._useHelper) {
            if (behaviorOptions.typingSimulation) {
                try { await this.socket.sendPresenceUpdate('composing', jid); } catch (_) {}
                await delay(1000 + Math.random() * 2000);
                try { await this.socket.sendPresenceUpdate('paused', jid); } catch (_) {}
            }
            result = await this._sendWithHelper(jid, messageObj._params, messageObj._type);
        } else if (this.antibanCtx) {
            // Anti-ban v2 path: the wrapped socket already runs the full pipeline
            // (rate limiting, warmup, presence choreographer, JID canonicalization,
            // post-reconnect throttle, etc.). We just call sendMessage directly.
            try {
                const sentMsg = await this.socket.sendMessage(jid, messageObj);
                this.antiBanManager.recordMessage(jid); // also tick legacy stats
                result = { sent: true, key: sentMsg?.key, via: 'antiban-v2' };
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                if (isAntibanTransportGuardMessage(errMsg)) {
                    result = { sent: false, reason: errMsg, via: 'antiban-v2-blocked' };
                } else {
                    throw err;
                }
            }
        } else {
            // Legacy path (v2 disabled or not yet built)
            result = await safeSendMessage(this.socket, jid, messageObj, '', this.antiBanManager, behaviorOptions);
        }
        
        if (result.sent) {
            // Track this message ID as bot-sent (for human handoff detection)
            if (result.key?.id) this.botSentMessageIds.add(result.key.id);
            if (this.botSentMessageIds.size > 2000) {
                const arr = Array.from(this.botSentMessageIds);
                this.botSentMessageIds = new Set(arr.slice(-1000));
            }
            
            this._log(`Sent to ${to}: ${logText.substring(0, 50)}...`, 'success');
            this._logMessage('outbound', this.connectedPhone || this.id, normalizedTo, logText, result.key?.id);

            // Re-assert 'unavailable' so the phone keeps receiving notifications
            // for the next inbound message. Without this, the underlying socket
            // can drift back to 'available' after a send and silence the phone.
            if (phoneNotifsOn) {
                try { await this.socket.sendPresenceUpdate('unavailable'); } catch (_) {}
            }
        }

        if (result?.reason) {
            result = { ...result, reason: sanitizeClientReason(result.reason) };
        }

        return result;
    }
    
    /**
     * Load LID cache from file
     */
    async _loadLidCache() {
        try {
            if (fsSync.existsSync(this.lidCacheFile)) {
                const data = await fs.readFile(this.lidCacheFile, 'utf8');
                const entries = JSON.parse(data);
                this.lidCache = new Map(Object.entries(entries));
                console.log(`[Instance ${this.id}] Loaded ${this.lidCache.size} LID mappings from cache`);
            }
        } catch (e) {
            console.log(`[Instance ${this.id}] Could not load LID cache:`, e.message);
        }
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
        // Skip if we've already saved this contact
        if (this.savedContacts.has(jid)) {
            return true;
        }
        
        // Skip group chats
        if (jid.includes('@g.us')) {
            return true;
        }
        
        try {
            // Extract phone number for the name if not provided
            const phoneNumber = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const name = contactName || `Unknown User ${phoneNumber.slice(-4)}`;
            
            console.log(`[Instance ${this.id}] Saving contact before message: ${phoneNumber} as "${name}"`);
            
            // Use addOrEditContact on the socket when available
            await this.socket.addOrEditContact(jid, {
                fullName: name,
                firstName: name,
                saveOnPrimaryAddressbook: true
            });
            
            // Mark as saved
            this.savedContacts.add(jid);
            await this._saveSavedContacts();
            
            this._log(`Saved new contact: ${phoneNumber} as "${name}"`, 'info');
            return true;
        } catch (error) {
            console.error(`[Instance ${this.id}] Could not save contact:`, error.message);
            // Don't fail the message send if contact save fails
            return false;
        }
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
        
        const lidId = jid.replace('@lid', '');
        console.log(`[Instance ${this.id}] Detected LID: ${lidId}`);
        
        // 1. Try to get PN from message alternate JID fields
        // remoteJidAlt is for DMs, participantAlt is for groups
        const altJid = msg.key.remoteJidAlt || msg.key.participantAlt;
        if (altJid && !altJid.includes('@lid')) {
            const pn = altJid.replace('@s.whatsapp.net', '');
            console.log(`[Instance ${this.id}] Found PN from alt JID: ${pn}`);
            // Cache this mapping for future use
            await this._storeLidMapping(lidId, pn);
            return pn;
        }
        
        // 2. Try to get PN from the transport LID mapping store
        if (this.socket?.signalRepository?.lidMapping) {
            try {
                const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lidId);
                if (pn) {
                    console.log(`[Instance ${this.id}] Resolved LID via transport store: ${pn}`);
                    await this._storeLidMapping(lidId, pn);
                    return pn;
                }
            } catch (e) {
                // Silently fail, try next method
            }
        }
        
        // 3. Try our persistent cache (fallback)
        if (this.lidCache.has(lidId)) {
            const cachedPn = this.lidCache.get(lidId);
            console.log(`[Instance ${this.id}] Found PN in cache: ${cachedPn}`);
            return cachedPn;
        }
        
        // 4. Last resort: return the LID number (will show as LID)
        console.log(`[Instance ${this.id}] Could not resolve LID, using raw: ${lidId}`);
        return lidId;
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
                if (this.botSentMessageIds.has(msgId)) return; // Bot sent this, ignore
                
                const messageContent = this._extractMessageContent(msg.message);
                if (!messageContent.text) return;
                
                const text = messageContent.text.trim();
                
                const keywords = this.handoffSettings.resumeKeywords || ['#ai', '#assistant', '#bot', '#resume'];
                const matched = keywords.find(kw => text.toLowerCase().startsWith(kw.toLowerCase()));
                if (matched) {
                    if (this.humanModeChats.has(from)) {
                        this.humanModeChats.delete(from);
                        this._log(`Human handoff ENDED for ${from} (keyword: ${matched})`, 'success');
                        this._emitStatusChange();

                        if (this.handoffSettings.resumeMessage) {
                            try {
                                await this.sendMessage(from, this.handoffSettings.resumeMessage, { delayEnabled: false });
                            } catch (e) {
                                this._log(`Failed to send resume message: ${e.message}`, 'error');
                            }
                        }
                    }
                    return;
                }
                
                // Manual send detected -> tag this chat for human mode
                if (!this.humanModeChats.has(from)) {
                    this._log(`Human handoff ACTIVATED for ${from} (manual message detected)`, 'warning');
                }
                this.humanModeChats.set(from, {
                    taggedAt: new Date().toISOString(),
                    taggedBy: 'manual_send',
                    lastActivity: new Date().toISOString()
                });
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
            
            if (!messageContent.text && !messageContent.hasMedia) return;
            
            // Handle LID (Local Identifier) to PN (Phone Number) mapping
            let phoneNumber = await this._resolvePhoneNumber(msg, from);
            
            this._log(`Received from ${phoneNumber}: ${(messageContent.text || '[media]').substring(0, 50)}...`, 'info');
            
            // Download + upload media to Azure Blob Storage (non-blocking on failure)
            let mediaUrl = null;
            if (messageContent.hasMedia) {
                const upload = await this._downloadAndUploadMedia(msg, messageContent);
                if (upload) mediaUrl = upload.url;
            }
            
            this._logMessage('inbound', phoneNumber, this.connectedPhone || this.id, messageContent.text, msg.key.id, {
                mediaUrl: mediaUrl || undefined,
                mediaType: messageContent.hasMedia ? messageContent.messageType : undefined,
                mimeType: messageContent.mimeType || undefined,
                fileName: messageContent.fileName || undefined
            });
            
            // Bot-native mode behaves like an active linked device. Notification
            // profiles defer any read/typing/reply until after the grace window.
            if (!this._preservesPhoneNotifications()) {
                await this._simulateReadReceipt(msg, messageContent.text || '[media]');
            }
            
            // HUMAN HANDOFF CHECK: If this chat is tagged for human mode, skip bot processing
            if (this.humanModeChats.has(from)) {
                const handoff = this.humanModeChats.get(from);
                handoff.lastActivity = new Date().toISOString();
                this._log(`[Handoff] Skipping bot for ${phoneNumber} - human mode active since ${handoff.taggedAt}`, 'warning');
                
                if (this.onMessage) {
                    this.onMessage({
                        instanceId: this.id,
                        from: phoneNumber,
                        fromJid: from,
                        message: messageContent.text,
                        messageType: messageContent.messageType,
                        isReply: messageContent.isReply,
                        quotedMessage: messageContent.quotedText,
                        mediaUrl,
                        mimeType: messageContent.mimeType,
                        fileName: messageContent.fileName,
                        timestamp: new Date().toISOString(),
                        messageId: msg.key.id,
                        humanMode: true
                    });
                }
                return;
            }
            
            // Check rate limits
            const canSend = this.antiBanManager.canSendMessage(from);
            if (!canSend.allowed) {
                this._log(`Rate limited: ${canSend.reason}`, 'warning');
                return;
            }
            
            // Emit message event for external handling
            if (this.onMessage) {
                this.onMessage({
                    instanceId: this.id,
                    from: phoneNumber,
                    fromJid: from,
                    message: messageContent.text,
                    messageType: messageContent.messageType,
                    isReply: messageContent.isReply,
                    quotedMessage: messageContent.quotedText,
                    mediaUrl,
                    mimeType: messageContent.mimeType,
                    fileName: messageContent.fileName,
                    timestamp: new Date().toISOString(),
                    messageId: msg.key.id,
                    humanMode: false
                });
            }
            
            // Only use instance-specific webhook (no global fallback)
            console.log(`[Instance ${this.id}] Webhook check: ${this.webhookUrl || '(none)'}`);
            
            // Only forward if this instance has its own webhook configured
            if (this.webhookUrl) {
                this._log(`Forwarding to webhook: ${this.webhookUrl.substring(0, 50)}...`, 'info');
                await this._forwardToWebhook(msg, messageContent, from, phoneNumber, this.webhookUrl, mediaUrl, receivedAtMs);
            } else {
                this._log('No instance webhook configured - message logged only', 'info');
            }
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Message handling error:`, error);
            this._log(`Error: ${error.message}`, 'error');
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
    async _forwardToWebhook(msg, messageContent, from, phoneNumber, webhookUrl, mediaUrl = null, receivedAtMs = Date.now()) {
        const axios = (await import('axios')).default;
        const phoneNotifsOn = this._preservesPhoneNotifications();
        const notificationMax = this._isNotificationMaxProfile();
        const typingOn = this.behaviorSettings?.typingSimulation !== false && !notificationMax;
        const behaviorSocket = phoneNotifsOn ? (this.rawSocket || this.socket) : this.socket;
        
        console.log(`[Instance ${this.id}] Calling webhook: ${webhookUrl}`);
        
        try {
            // While the webhook runs, show typing only on the v2 path — legacy
            // safeSendMessage already runs its own typing/read pipeline after the reply.
            if (!phoneNotifsOn && typingOn && this.antibanCtx) {
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
                to_phone: normalizePhone(this.connectedPhone),
                message: messageContent.text,
                media_type: mediaTypeMap[messageContent.messageType] || 'text',
                media_url: mediaUrl || null,
                mime_type: messageContent.mimeType || null,
                file_name: messageContent.fileName || null,
                status: 'received',
                webhook_id: this.id,
                event: 'message',
                quoted_message: messageContent.quotedText || null
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

            const response = await axios.post(webhookUrl, payload, { timeout: 30000, headers });
            
            console.log(`[Instance ${this.id}] Webhook response:`, response.status, response.data);
            
            // Handle response
            if (response.data?.skip) {
                this._log(`Human handoff active for ${phoneNumber}`, 'info');
                if (!phoneNotifsOn) {
                    try {
                        await this.socket.sendPresenceUpdate('paused', from);
                    } catch (e) {}
                } else {
                    try { await this.socket.sendPresenceUpdate('unavailable'); } catch (e) {}
                }
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
                if (this.antibanCtx && !phoneNotifsOn) {
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
                        this.antiBanManager.recordMessage(from);
                        result = { sent: true, key: sent?.key, via: 'antiban-v2' };
                    } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        result = isAntibanTransportGuardMessage(m)
                            ? { sent: false, reason: m, via: 'antiban-v2-blocked' }
                            : { sent: false, reason: m };
                        if (!isAntibanTransportGuardMessage(m)) throw err;
                    }
                } else if (this.antibanCtx && phoneNotifsOn) {
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
                        this.antiBanManager.recordMessage(from);
                        result = { sent: true, key: sent?.key, via: 'notification-profile' };
                    } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        result = { sent: false, reason: m };
                        throw err;
                    }
                } else {
                    // Legacy path
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
                        }
                    );
                }
                if (result.sent) {
                    this._log(`Replied to ${phoneNumber}: ${reply.substring(0, 50)}...`, 'success');
                    if (phoneNotifsOn) {
                        // Re-assert unavailable after reply so the next inbound
                        // message still wakes the phone.
                        try { await this.socket.sendPresenceUpdate('unavailable'); } catch (_) {}
                    }
                } else if (result.reason) {
                    this._log(`Reply blocked: ${sanitizeClientReason(result.reason)}`, 'warning');
                }
            } else if (!phoneNotifsOn) {
                try {
                    await this.socket.sendPresenceUpdate('paused', from);
                } catch (e) {}
            } else {
                try { await this.socket.sendPresenceUpdate('unavailable'); } catch (e) {}
            }
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Webhook error:`, error.message);
            if (error.response) {
                console.error(`[Instance ${this.id}] Webhook response error:`, error.response.status, error.response.data);
            }
            this._log(`Webhook error: ${error.message}`, 'error');
            try {
                if (phoneNotifsOn) {
                    await this.socket.sendPresenceUpdate('unavailable');
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
     * Download media from a WhatsApp message and upload to Azure Blob Storage.
     * Returns the public URL or null if storage is disabled / download fails.
     */
    async _downloadAndUploadMedia(msg, messageContent) {
        if (!messageContent.hasMedia || !isStorageEnabled()) return null;

        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            if (!buffer || buffer.length === 0) return null;

            let ext;
            try { ext = extensionForMediaMessage(msg.message); } catch (_) {}
            if (!ext) {
                const mimeMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf' };
                ext = mimeMap[messageContent.mimeType] || messageContent.mimeType?.split('/')[1]?.split(';')[0] || 'bin';
            }

            const result = await uploadMedia(buffer, {
                extension: ext,
                mimeType: messageContent.mimeType || 'application/octet-stream',
                instanceId: this.id,
                folder: messageContent.messageType
            });

            if (result) {
                this._log(`Media uploaded: ${messageContent.messageType} → ${result.url.substring(0, 80)}...`, 'success');
            }
            return result;
        } catch (err) {
            this._log(`Media download/upload failed: ${err.message}`, 'error');
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
     * Update behavior settings (profile, typing simulation, delays)
     */
    updateBehaviorSettings(settings) {
        const previousPreservesNotifications = this._preservesPhoneNotifications();
        this.behaviorSettings = normalizeBehaviorSettings(settings || {}, this.behaviorSettings || {});
        const nextPreservesNotifications = this._preservesPhoneNotifications();

        if (nextPreservesNotifications !== previousPreservesNotifications && this.socket && this.status === 'connected') {
            if (nextPreservesNotifications) {
                // Stop the cycler that randomly flips presence to 'available'
                // and cancel any pending stealth-presence ramp.
                try { this._stopPresenceCycling(); } catch (_) {}
                if (this.presenceRampAbort) {
                    try { this.presenceRampAbort.abort(); } catch (_) {}
                    this.presenceRampAbort = null;
                }
                this.socket.sendPresenceUpdate('unavailable')
                    .then(() => this._log('Notification profile: presence forced unavailable', 'success'))
                    .catch((e) => this._log(`Failed to push unavailable: ${e.message}`, 'warning'));
            } else {
                // Returning to bot-native behaviour - resume background cycling.
                try { this._startPresenceCycling(); } catch (_) {}
                this._log('Bot-native behaviour enabled - resumed presence cycling', 'info');
            }
        } else if (nextPreservesNotifications && this.socket && this.status === 'connected') {
            this.socket.sendPresenceUpdate('unavailable')
                .catch((e) => this._log(`Failed to push unavailable: ${e.message}`, 'warning'));
        }
    }
    
    /**
     * Get all chats currently in human handoff mode
     */
    getHandoffChats() {
        const chats = [];
        for (const [jid, data] of this.humanModeChats) {
            chats.push({ jid, phone: jid.split('@')[0], ...data });
        }
        return chats;
    }

    /**
     * Manually tag a chat for human handoff (skip bot responses)
     */
    setHandoff(jid, active) {
        const normalizedJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
        if (active) {
            this.humanModeChats.set(normalizedJid, {
                taggedAt: new Date().toISOString(),
                taggedBy: 'api',
                lastActivity: new Date().toISOString()
            });
            this._log(`Human handoff ACTIVATED for ${normalizedJid} (via API)`, 'warning');
        } else {
            this.humanModeChats.delete(normalizedJid);
            this._log(`Human handoff ENDED for ${normalizedJid} (via API)`, 'success');
        }
        this._emitStatusChange();
    }

    /**
     * Get instance status
     */
    getStatus() {
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
            handoffSettings: this.handoffSettings,
            humanModeChats: this.getHandoffChats(),
            proxy: this.getProxyStatus(),
            createdAt: this.createdAt
        };
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
                running: false,
                preset: this.antibanV2.preset,
                modules: Object.fromEntries(
                    Object.entries(this.antibanV2.modules || {}).map(([k, v]) => [k, v?.enabled !== false])
                ),
            };
        }
        let stats = {};
        try { stats = ctx.antiban.getStats(); } catch (_) {}
        return {
            enabled: !!this.antibanV2.enabled,
            running: true,
            preset: this.antibanV2.preset,
            modules: Object.fromEntries(
                Object.entries(this.antibanV2.modules || {}).map(([k, v]) => [k, v?.enabled !== false])
            ),
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
        const next = {
            ...before,
            ...updates,
            modules: { ...(before.modules || {}), ...(updates.modules || {}) },
            overrides: { ...(before.overrides || {}), ...(updates.overrides || {}) },
        };
        this.antibanV2 = next;
        this._log('Anti-ban v2 config updated (full effect on next reconnect)', 'info');
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
            };
            const originLabel = source === 'pool' ? 'pool-assigned' : 'override';
            this._log(
                `Proxy ${originLabel}: ${cfg.type}://${cfg.username ? cfg.username + '@' : ''}${cfg.host}:${cfg.port}`,
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
                    this.connect().catch(err => {
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
        if (result.added) {
            await this._saveProxyPool();
            console.log(`[InstanceManager] Added pool slot: ${result.slot.id}`);
        }
        return {
            ...result,
            pool: this.proxyPool.getStatus(),
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

        const instance = new WhatsAppInstance({
            id,
            name: config.name || `Instance ${id}`,
            webhookUrl: config.webhookUrl || '',
            webhookSigningSecret: config.webhookSigningSecret || '',
            behaviorSettings: config.behaviorSettings,
            antiBanSettings: config.antiBanSettings,
            antibanV2: config.antibanV2 || null,
            proxy: proxyConfig,
        });
        
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
     * Get all instances
     */
    getAllInstances() {
        const list = [];
        for (const [id, instance] of this.instances) {
            list.push(instance.getStatus());
        }
        return list;
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
    async setInstanceProxy(id, proxy) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }

        if (proxy === null || proxy === undefined) {
            // Clearing an override: give up any held pool slot, then try to
            // claim a fresh one (same slot will usually be available since we
            // just released it — pool is FIFO by free-slot order).
            this.proxyPool.releaseSlot(id);
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
                    },
                    { source: 'pool' }
                );
                await this._saveInstances();
                return result;
            }
            const result = await instance.updateProxy(null);
            await this._saveInstances();
            return result;
        }

        if (proxy.enabled === false) {
            this.proxyPool.releaseSlot(id);
            const result = await instance.updateProxy({ enabled: false });
            await this._saveInstances();
            return result;
        }

        // API-set override: free the pool slot so another instance can use it,
        // then apply the custom proxy with source='api'.
        this.proxyPool.releaseSlot(id);
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
        return await instance.resetAntibanV2();
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
    async clearInstanceAuth(id) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        await instance.clearAuth();
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
                    
                    // Auto-connect if instance has saved credentials
                    const credsFile = path.join(instance.authFolder, 'creds.json');
                    if (fsSync.existsSync(credsFile)) {
                        console.log(`[InstanceManager] Auto-reconnecting instance: ${instance.id}`);
                        // Connect in background (don't block)
                        instance.connect().catch(err => {
                            console.error(`[InstanceManager] Auto-reconnect failed for ${instance.id}:`, err.message);
                        });
                    }
                }
                console.log(`[InstanceManager] Finished loading ${this.instances.size} instances`);
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
