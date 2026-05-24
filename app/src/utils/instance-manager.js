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
import WebSocket from 'ws';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateWAMessageFromContent } from 'baileys';
import { AntiBanManager, safeSendMessage, delay } from './anti-ban.js';
import { buildWhatsAppMessage } from './message-builder.js';
import { buildNativeFlowRelayPlan } from './interactive-native.js';
import {
    createProxyAgent,
    parseProxyConfig,
    redactProxy,
    resolveEffectiveProxy,
} from './proxy.js';
import { ProxyPoolManager } from './proxy-pool.js';
import {
    buildApiKeyMetaFromPlaintext,
    generateInstanceApiKey,
    redactApiKeyMeta,
    verifyApiKeyForInstance,
} from './instance-api-keys.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Some Node builds do not expose WHATWG WebSocket globally. Baileys rc builds
// expect it during socket creation, so provide the already-declared ws runtime.
if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocket;
}

// Create a silent logger for Baileys (reduces noise, improves stealth)
const logger = pino({ level: 'silent' });

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

// Base paths (WASUP_DATA_DIR for Docker/K8s persistent volume)
const DATA_ROOT = process.env.WASUP_DATA_DIR
    ? path.resolve(process.env.WASUP_DATA_DIR)
    : path.join(__dirname, '../../instances');
const INSTANCES_FOLDER = DATA_ROOT;
const INSTANCES_DB_FILE = path.join(INSTANCES_FOLDER, 'instances.json');
const PROXY_POOL_FILE = path.join(INSTANCES_FOLDER, 'proxy-pool.json');

const WORKER_MODE = (process.env.WASUP_WORKER_MODE || 'multi').toLowerCase();
const FIXED_INSTANCE_ID = process.env.WASUP_INSTANCE_ID || process.env.INSTANCE_ID || null;

// Global default webhook URL (from environment)
const DEFAULT_WEBHOOK_URL = process.env.DEFAULT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';
const WA_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedWaSocketVersion = null;
let cachedWaSocketVersionAt = 0;

function parseEnvBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function parseEnvInteger(value, fallback, min = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, parsed);
}

const AUTO_RECONNECT_ENABLED = parseEnvBoolean(process.env.WA_AUTO_RECONNECT_ENABLED, true);
const AUTO_RECONNECT_MAX_ATTEMPTS = parseEnvInteger(process.env.WA_RECONNECT_MAX_ATTEMPTS, 8, 0);
const AUTO_RECONNECT_BASE_DELAY_MS = parseEnvInteger(process.env.WA_RECONNECT_BASE_DELAY_MS, 5000, 1000);
const AUTO_RECONNECT_MAX_DELAY_MS = Math.max(
    AUTO_RECONNECT_BASE_DELAY_MS,
    parseEnvInteger(process.env.WA_RECONNECT_MAX_DELAY_MS, 120000, 1000)
);
const AUTO_RECONNECT_WATCHDOG_DELAY_MS = Math.max(
    AUTO_RECONNECT_MAX_DELAY_MS,
    parseEnvInteger(process.env.WA_RECONNECT_WATCHDOG_DELAY_MS, 300000, 1000)
);
const AUTO_RECONNECT_JITTER_RATIO = 0.2;

const RECOVERABLE_DISCONNECT_CODES = new Set([
    DisconnectReason.connectionClosed,
    DisconnectReason.connectionLost,
    DisconnectReason.connectionReplaced,
    DisconnectReason.timedOut,
    DisconnectReason.restartRequired,
    408,
    428,
    440,
    503,
    515
].filter(Number.isFinite));

const NON_RECOVERABLE_DISCONNECT_CODES = new Set([
    DisconnectReason.loggedOut,
    401
].filter(Number.isFinite));

function getDisconnectInfo(lastDisconnect) {
    const error = lastDisconnect?.error;
    const rawStatusCode = error?.output?.statusCode ?? error?.statusCode ?? error?.code;
    const numericStatusCode = Number(rawStatusCode);
    const statusCode = Number.isFinite(numericStatusCode) ? numericStatusCode : undefined;
    const reasonName = Object.entries(DisconnectReason)
        .find(([, value]) => value === statusCode)?.[0] || 'unknown';
    const message = error?.message || error?.output?.payload?.message || '';

    return { statusCode, reasonName, message };
}

function isRecoverableDisconnect(info) {
    if (NON_RECOVERABLE_DISCONNECT_CODES.has(info.statusCode)) return false;
    if (/logged\s*out|invalid\s*auth|bad\s*session/i.test(info.message || '')) return false;
    if (info.statusCode === undefined) return true;
    if (info.statusCode >= 500) return true;
    return RECOVERABLE_DISCONNECT_CODES.has(info.statusCode);
}

function describeDisconnect(info) {
    if (info.statusCode === DisconnectReason.restartRequired || info.statusCode === 515) {
        return 'WhatsApp requested a socket restart';
    }
    if (
        info.statusCode === DisconnectReason.connectionReplaced ||
        info.statusCode === 440 ||
        /replaced|conflict/i.test(info.message || '')
    ) {
        return 'WhatsApp connection was replaced';
    }
    if (
        info.statusCode === DisconnectReason.timedOut ||
        info.statusCode === DisconnectReason.connectionLost ||
        info.statusCode === 408
    ) {
        return 'WhatsApp connection timed out or was lost';
    }
    if (info.statusCode === DisconnectReason.connectionClosed || info.statusCode === 428) {
        return 'WhatsApp connection closed';
    }
    if (info.statusCode >= 500) {
        return 'WhatsApp service returned a transient stream error';
    }
    return 'WhatsApp connection closed unexpectedly';
}

function calculateReconnectDelayMs(attempt) {
    const exponentialDelay = AUTO_RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
    const cappedDelay = Math.min(exponentialDelay, AUTO_RECONNECT_MAX_DELAY_MS);
    const jitter = cappedDelay * AUTO_RECONNECT_JITTER_RATIO * Math.random();
    return Math.round(cappedDelay + jitter);
}

const BEHAVIOR_PROFILE_DEFAULTS = {
    'bot-native': {
        typingSimulation: true,
        delayEnabled: true,
        phoneNotificationsEnabled: false,
        notificationGraceMs: 0,
        behaviorProfile: 'bot-native'
    },
    'notification-balanced': {
        typingSimulation: true,
        delayEnabled: true,
        phoneNotificationsEnabled: true,
        notificationGraceMs: 2500,
        behaviorProfile: 'notification-balanced'
    },
    'notification-max': {
        typingSimulation: false,
        delayEnabled: true,
        phoneNotificationsEnabled: true,
        notificationGraceMs: 5000,
        behaviorProfile: 'notification-max'
    }
};

function normalizeBehaviorSettings(settings = {}) {
    const requestedProfile = settings.behaviorProfile || 'bot-native';
    const profile = BEHAVIOR_PROFILE_DEFAULTS[requestedProfile]
        ? requestedProfile
        : 'bot-native';

    return {
        ...BEHAVIOR_PROFILE_DEFAULTS[profile],
        ...settings,
        behaviorProfile: profile,
        typingSimulation: settings.typingSimulation !== undefined
            ? !!settings.typingSimulation
            : BEHAVIOR_PROFILE_DEFAULTS[profile].typingSimulation,
        delayEnabled: settings.delayEnabled !== undefined
            ? !!settings.delayEnabled
            : BEHAVIOR_PROFILE_DEFAULTS[profile].delayEnabled,
        phoneNotificationsEnabled: settings.phoneNotificationsEnabled !== undefined
            ? !!settings.phoneNotificationsEnabled
            : BEHAVIOR_PROFILE_DEFAULTS[profile].phoneNotificationsEnabled,
        notificationGraceMs: Number.isFinite(Number(settings.notificationGraceMs))
            ? Math.max(0, Number(settings.notificationGraceMs))
            : BEHAVIOR_PROFILE_DEFAULTS[profile].notificationGraceMs
    };
}

async function getLatestWaSocketVersion(instanceId) {
    const now = Date.now();
    if (cachedWaSocketVersion && now - cachedWaSocketVersionAt < WA_VERSION_CACHE_TTL_MS) {
        return cachedWaSocketVersion;
    }

    try {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        cachedWaSocketVersion = version;
        cachedWaSocketVersionAt = now;
        console.log(`[Instance ${instanceId}] WhatsApp Web version: ${version.join('.')} (latest: ${isLatest})`);
        return version;
    } catch (error) {
        console.log(`[Instance ${instanceId}] Could not fetch latest WhatsApp Web version: ${error.message}`);
        return cachedWaSocketVersion;
    }
}

function truncateForLog(value, maxLength = 500) {
    if (value === undefined || value === null) return '';
    let text;
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch (error) {
            text = String(value);
        }
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatErrorForLog(error) {
    const parts = [];
    if (error?.message) parts.push(error.message);
    if (error?.code) parts.push(`code=${error.code}`);
    if (error?.output?.statusCode) parts.push(`statusCode=${error.output.statusCode}`);
    if (error?.response?.status) parts.push(`httpStatus=${error.response.status}`);
    if (error?.response?.data) parts.push(`response=${truncateForLog(error.response.data)}`);
    return parts.join(' | ') || String(error);
}

/**
 * Single WhatsApp Instance
 */
class WhatsAppInstance {
    constructor(config) {
        this.id = config.id;
        this.name = config.name || `Instance ${config.id}`;
        this.webhookUrl = config.webhookUrl || '';
        this.createdAt = config.createdAt || new Date().toISOString();

        // Per-instance proxy (null = inherit deployment default or pool)
        this.proxy = this._normalizeProxy(config.proxy);
        this.apiKeyMeta = config.apiKeyMeta || null;
        this._activeProxy = null;
        this._activeProxyAgent = null;
        this._activeProxyAt = null;
        
        // Connection state
        this.socket = null;
        this.status = 'disconnected'; // disconnected | connecting | connected
        this.qrCode = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.reconnectInFlight = false;
        this.nextReconnectAt = null;
        this.intentionalDisconnect = false;
        
        // Message deduplication (prevent processing same message multiple times)
        this.processedMessages = new Set();
        this.maxProcessedMessages = 1000; // Keep last 1000 message IDs
        
        // LID to PN mapping cache (persistent fallback) - initialized after authFolder is set
        this.lidCache = new Map();
        
        // Saved contacts cache (to avoid re-saving contacts we've already saved)
        this.savedContacts = new Set();
        
        // Behavior settings (typing simulation, delays, phone notification profiles)
        this.behaviorSettings = normalizeBehaviorSettings(config.behaviorSettings);
        
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
        
        // ========================================
        // ANTI-BAN: Baileys-recommended caches
        // ========================================
        
        // Group metadata cache - CRITICAL: Prevents rate limits when sending to groups
        // From Baileys docs: "This is a problem and causes a ratelimit and potential bans"
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
    
    /**
     * Start WhatsApp connection
     */
    async connect(options = {}) {
        const { autoReconnect = false } = options;
        console.log(`[Instance ${this.id}] connect() called, current status: ${this.status}`);
        
        if (this.status === 'connected') {
            throw new Error('Already connected');
        }
        if (this.status === 'connecting') {
            throw new Error('Connection in progress');
        }
        
        // Clean up existing socket if any (prevents duplicate event listeners on reconnect)
        if (this.socket) {
            console.log(`[Instance ${this.id}] Cleaning up old socket before reconnect`);
            try {
                this.socket.ev.removeAllListeners();
                this.socket.end();
            } catch (e) {
                console.log(`[Instance ${this.id}] Cleanup error:`, e.message);
            }
            this.socket = null;
        }
        if (autoReconnect) {
            this._clearReconnectTimer();
        } else {
            this._resetReconnectState();
        }
        this.intentionalDisconnect = false;
        
        this.status = 'connecting';
        this._emitStatusChange();
        this._log('Starting connection...', 'info');
        
        try {
            // Ensure auth folder exists
            await fs.mkdir(this.authFolder, { recursive: true });
            console.log(`[Instance ${this.id}] Auth folder ready: ${this.authFolder}`);
            
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            console.log(`[Instance ${this.id}] Auth state loaded`);
            const waSocketVersion = await getLatestWaSocketVersion(this.id);

            const resolved = resolveEffectiveProxy(this.proxy);
            this._activeProxy = resolved;
            this._activeProxyAgent = null;
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
            
            // ========================================
            // ANTI-BAN: Baileys-recommended socket configuration
            // Based on https://baileys.wiki/docs/socket/configuration/
            // ========================================
            const socket = makeWASocket({
                auth: state,
                logger: logger,
                ...(waSocketVersion ? { version: waSocketVersion } : {}),
                
                // CRITICAL: Group metadata cache prevents rate limits and bans
                // "This is a problem and causes a ratelimit and potential bans from WhatsApp"
                cachedGroupMetadata: async (jid) => this.groupMetadataCache.get(jid),
                
                // User devices cache - reduces device list API calls
                userDevicesCache: this.userDevicesCache,
                
                // Message retry counter - prevents retry storms
                msgRetryCounterCache: this.msgRetryCounterCache,
                
                // Media cache - prevents repeated uploads
                mediaCache: this.mediaCache,
                
                // STEALTH: Don't auto-mark as online on connect
                // Makes the bot appear offline until explicitly set online
                markOnlineOnConnect: false,
                
                // Message store for retry handling (prevents "this message can take a while" errors)
                getMessage: async (key) => {
                    const msg = this.messageStore.get(key.id);
                    return msg?.message || undefined;
                },
                
                // Session health options
                enableAutoSessionRecreation: true,
                enableRecentMessageCache: true,
                
                // Don't print QR in terminal (we handle it via API)
                printQRInTerminal: false,

                ...(proxyAgent && { agent: proxyAgent, fetchAgent: proxyAgent })
            });
            this.socket = socket;
            console.log(`[Instance ${this.id}] Socket created with anti-ban config${proxyAgent ? ' (via proxy)' : ''}`);
            
            // Save credentials when updated
            socket.ev.on('creds.update', saveCreds);
            
            // Handle connection updates
            socket.ev.on('connection.update', async (update) => {
                if (this.socket !== socket) return;
                const { connection, qr, lastDisconnect } = update;
                
                // QR Code received
                if (qr) {
                    console.log(`[Instance ${this.id}] QR code received`);
                    try {
                        this.qrCode = await QRCode.toDataURL(qr);
                        this.status = 'connecting';
                        this._emitStatusChange();
                        this._log('QR code generated - scan with WhatsApp', 'info');
                    } catch (err) {
                        console.error(`[Instance ${this.id}] QR generation error:`, err);
                    }
                }
                
                // Connection closed
                if (connection === 'close') {
                    this._handleConnectionClose(lastDisconnect, {
                        relinkMessage: 'Logged out - scan QR code to reconnect'
                    });
                }
                
                // Connected successfully
                if (connection === 'open') {
                    console.log(`[Instance ${this.id}] Connected!`);
                    this._resetReconnectState();
                    this.status = 'connected';
                    this.qrCode = null;
                    this.connectedPhone = this.socket.user?.id?.split(':')[0] || 'Unknown';
                    this.connectedAt = new Date().toISOString();
                    this._emitStatusChange();
                    this._log(`Connected as ${this.connectedPhone}`, 'success');
                    
                    // ========================================
                    // ANTI-BAN: Start presence cycling
                    // Avoids "always online" pattern which looks suspicious
                    // ========================================
                    this._startPresenceCycling();
                }
            });
            
            // Handle incoming messages
            socket.ev.on('messages.upsert', async ({ messages, type }) => {
                // Only process real-time notifications, not history sync
                if (type !== 'notify') {
                    console.log(`[Instance ${this.id}] Ignoring messages.upsert type: ${type}`);
                    return;
                }
                
                for (const msg of messages) {
                    // Skip old messages (more than 60 seconds old) - likely from history sync
                    const msgTimestamp = msg.messageTimestamp;
                    const now = Math.floor(Date.now() / 1000);
                    const age = now - msgTimestamp;
                    
                    if (age > 60) {
                        console.log(`[Instance ${this.id}] Skipping old message (${age}s old): ${msg.key.id}`);
                        continue;
                    }
                    
                    await this._handleMessage(msg);
                }
            });
            
            // Listen for LID-PN mapping updates (Baileys 7.x)
            socket.ev.on('lid-mapping.update', async (mappings) => {
                console.log(`[Instance ${this.id}] Received LID-PN mappings:`, Object.keys(mappings).length);
                // Store mappings in our persistent cache too
                for (const [lid, pn] of Object.entries(mappings)) {
                    await this._storeLidMapping(lid, pn);
                }
            });
            
            // ========================================
            // ANTI-BAN: Group metadata cache updates
            // Prevents rate limits when sending to groups
            // ========================================
            socket.ev.on('groups.update', (updates) => {
                for (const update of updates) {
                    if (update.id) {
                        // Merge with existing cache entry
                        const existing = this.groupMetadataCache.get(update.id) || {};
                        this.groupMetadataCache.set(update.id, { ...existing, ...update });
                        console.log(`[Instance ${this.id}] Group cache updated: ${update.id}`);
                    }
                }
            });
            
            socket.ev.on('groups.upsert', (groups) => {
                for (const group of groups) {
                    if (group.id) {
                        this.groupMetadataCache.set(group.id, group);
                        console.log(`[Instance ${this.id}] Group cache added: ${group.id}`);
                    }
                }
            });
            
            // ========================================
            // ANTI-BAN: Store messages for retry handling
            // Prevents "this message can take a while" errors
            // ========================================
            socket.ev.on('messages.upsert', ({ messages }) => {
                for (const msg of messages) {
                    if (msg.key?.id && msg.message) {
                        this.messageStore.set(msg.key.id, {
                            message: msg.message,
                            timestamp: Date.now()
                        });
                        
                        // Cleanup old messages to prevent memory leak
                        if (this.messageStore.size > this.maxStoredMessages) {
                            const entries = Array.from(this.messageStore.entries());
                            const toDelete = entries
                                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                                .slice(0, 100);
                            for (const [key] of toDelete) {
                                this.messageStore.delete(key);
                            }
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Connection error:`, error);
            console.error(`[Instance ${this.id}] Error stack:`, error.stack);
            this.status = 'disconnected';
            this._emitStatusChange();
            this._log(`Connection error: ${error.message}`, 'error');
            throw error;
        }
    }
    
    /**
     * Start WhatsApp connection using pairing code (alternative to QR)
     * @param {string} phoneNumber - Phone number with country code (e.g. "447393002183")
     * @returns {Promise<string>} The 8-digit pairing code to enter on WhatsApp
     */
    async connectWithPairingCode(phoneNumber) {
        console.log(`[Instance ${this.id}] connectWithPairingCode() called for: ${phoneNumber}`);

        if (this.status === 'connected') {
            throw new Error('Already connected');
        }

        this._resetReconnectState();
        this.intentionalDisconnect = false;

        if (this.socket) {
            try {
                this.socket.ev.removeAllListeners();
                this.socket.end();
            } catch (e) {}
            this.socket = null;
        }
        
        this.status = 'connecting';
        this._emitStatusChange();
        this._log('Starting pairing code connection...', 'info');
        
        try {
            await fs.mkdir(this.authFolder, { recursive: true });
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            const waSocketVersion = await getLatestWaSocketVersion(this.id);
            
            const socket = makeWASocket({
                auth: state,
                ...(waSocketVersion ? { version: waSocketVersion } : {}),
                printQRInTerminal: false
            });
            this.socket = socket;
            
            socket.ev.on('creds.update', saveCreds);
            
            socket.ev.on('connection.update', async (update) => {
                if (this.socket !== socket) return;
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    this._handleConnectionClose(lastDisconnect, {
                        clearPairingCode: true,
                        relinkMessage: 'Logged out - pair again to reconnect'
                    });
                }
                
                if (connection === 'open') {
                    this._resetReconnectState();
                    this.status = 'connected';
                    this.qrCode = null;
                    this.pairingCode = null;
                    this.connectedPhone = this.socket.user?.id?.split(':')[0] || 'Unknown';
                    this.connectedAt = new Date().toISOString();
                    this._emitStatusChange();
                    this._log(`Connected as ${this.connectedPhone} (via pairing code)`, 'success');
                    this._startPresenceCycling();
                }
            });
            
            socket.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                for (const msg of messages) {
                    const now = Math.floor(Date.now() / 1000);
                    if (now - msg.messageTimestamp > 60) continue;
                    await this._handleMessage(msg);
                }
            });
            
            socket.ev.on('lid-mapping.update', async (mappings) => {
                for (const [lid, pn] of Object.entries(mappings)) {
                    await this._storeLidMapping(lid, pn);
                }
            });
            
            if (!this.socket.authState.creds.registered) {
                const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
                const code = await this.socket.requestPairingCode(cleanNumber);
                this.pairingCode = code;
                this._log(`Pairing code generated: ${code}`, 'info');
                return code;
            } else {
                this._log('Already registered, reconnecting...', 'info');
                return null;
            }
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Pairing code error:`, error);
            this.status = 'disconnected';
            this._emitStatusChange();
            this._log(`Pairing code error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Disconnect WhatsApp
     */
    async disconnect(options = {}) {
        const { revoke = false } = options;

        this._resetReconnectState();
        this.intentionalDisconnect = true;

        // Stop presence cycling
        this._stopPresenceCycling();
        
        if (this.socket) {
            const socket = this.socket;
            this.socket = null;
            try {
                socket.ev.removeAllListeners();
                if (revoke) {
                    await socket.logout();
                    this._log('Logged out from WhatsApp (session revoked)', 'info');
                } else {
                    socket.end();
                    this._log('Disconnected from WhatsApp (credentials kept)', 'info');
                }
            } catch (error) {
                console.error(`[Instance ${this.id}] Disconnect error:`, error);
            }
        }
        this.status = 'disconnected';
        this.qrCode = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        this._emitStatusChange();
        this.intentionalDisconnect = false;
    }

    _clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.nextReconnectAt = null;
    }

    _resetReconnectState() {
        this._clearReconnectTimer();
        this.reconnectAttempts = 0;
        this.reconnectInFlight = false;
    }

    _handleConnectionClose(lastDisconnect, options = {}) {
        const { clearPairingCode = false, relinkMessage = 'Logged out - scan QR code to reconnect' } = options;
        const disconnectInfo = getDisconnectInfo(lastDisconnect);
        const shouldReconnect = !this.intentionalDisconnect && isRecoverableDisconnect(disconnectInfo);

        console.log(
            `[Instance ${this.id}] Connection closed. Status: ${disconnectInfo.statusCode ?? 'unknown'}, ` +
            `reason: ${disconnectInfo.reasonName}, message: ${disconnectInfo.message || '(none)'}`
        );

        this.status = 'disconnected';
        this.qrCode = null;
        if (clearPairingCode) {
            this.pairingCode = null;
        }
        this.connectedPhone = null;
        this.connectedAt = null;
        this._stopPresenceCycling();
        this._emitStatusChange();

        if (shouldReconnect) {
            this._scheduleReconnect(`${describeDisconnect(disconnectInfo)}; preserving credentials.`);
        } else if (this.intentionalDisconnect) {
            this._log('Disconnected from WhatsApp (credentials kept)', 'info');
        } else {
            this._resetReconnectState();
            this._log(`${relinkMessage} (credentials preserved until manually cleared)`, 'error');
        }
    }

    _scheduleReconnect(message, options = {}) {
        const { delayMs = null } = options;

        if (!AUTO_RECONNECT_ENABLED) {
            this._log(`${message} Auto reconnect disabled by WA_AUTO_RECONNECT_ENABLED.`, 'warning');
            return;
        }

        if (AUTO_RECONNECT_MAX_ATTEMPTS === 0) {
            this._log(`${message} Auto reconnect has zero configured attempts.`, 'warning');
            return;
        }

        if (this.intentionalDisconnect || this.status === 'connected') {
            return;
        }

        if (this.reconnectTimer) {
            this._log(`Auto reconnect already scheduled for ${this.nextReconnectAt}`, 'warning');
            return;
        }

        if (this.reconnectInFlight || this.status === 'connecting') {
            this._log('Auto reconnect already in progress; skipping duplicate schedule.', 'warning');
            return;
        }

        const savedCredentials = this.hasSavedCredentials();
        const burstLimitReached = this.reconnectAttempts >= AUTO_RECONNECT_MAX_ATTEMPTS;
        if (burstLimitReached && !savedCredentials) {
            this._log(
                `Auto reconnect stopped after ${this.reconnectAttempts}/${AUTO_RECONNECT_MAX_ATTEMPTS} attempts. ` +
                'Scan QR or use the connect endpoint to retry manually.',
                'error'
            );
            return;
        }

        const attempt = this.reconnectAttempts + 1;
        const waitMs = delayMs === null
            ? (burstLimitReached ? AUTO_RECONNECT_WATCHDOG_DELAY_MS : calculateReconnectDelayMs(attempt))
            : Math.max(0, delayMs);
        this.reconnectAttempts = attempt;
        this.nextReconnectAt = new Date(Date.now() + waitMs).toISOString();

        this._log(
            burstLimitReached
                ? `${message} Auto reconnect burst limit reached; continuing saved-session watchdog attempt ${attempt} in ${Math.ceil(waitMs / 1000)}s.`
                : `${message} Auto reconnect attempt ${attempt}/${AUTO_RECONNECT_MAX_ATTEMPTS} in ${Math.ceil(waitMs / 1000)}s.`,
            'warning'
        );

        this.reconnectTimer = setTimeout(() => {
            this._runScheduledReconnect(attempt);
        }, waitMs);
    }

    async _runScheduledReconnect(attempt) {
        this.reconnectTimer = null;
        this.nextReconnectAt = null;

        if (!AUTO_RECONNECT_ENABLED || this.intentionalDisconnect || this.status === 'connected') {
            return;
        }

        if (this.reconnectInFlight || this.status === 'connecting') {
            this._log('Auto reconnect skipped because a connection attempt is already active.', 'warning');
            return;
        }

        this.reconnectInFlight = true;
        const attemptLabel = attempt > AUTO_RECONNECT_MAX_ATTEMPTS
            ? `${attempt} (watchdog)`
            : `${attempt}/${AUTO_RECONNECT_MAX_ATTEMPTS}`;
        this._log(`Auto reconnect attempt ${attemptLabel} starting.`, 'info');

        try {
            await this.connect({ autoReconnect: true });
        } catch (error) {
            this._log(`Auto reconnect attempt ${attempt} failed: ${error.message}`, 'error');
            if (!this.intentionalDisconnect && this.status !== 'connected') {
                this._scheduleReconnect('Auto reconnect start failed; preserving credentials.');
            }
        } finally {
            this.reconnectInFlight = false;
        }
    }

    hasSavedCredentials() {
        const credsFile = path.join(this.authFolder, 'creds.json');
        try {
            const stats = fsSync.statSync(credsFile);
            return stats.isFile() && stats.size > 2;
        } catch (error) {
            return false;
        }
    }

    scheduleStartupReconnect(staggerMs = AUTO_RECONNECT_BASE_DELAY_MS) {
        this._scheduleReconnect('Saved credentials found on startup; reconnecting.', {
            delayMs: staggerMs
        });
    }
    
    /**
     * ANTI-BAN: Start presence cycling
     * Randomly toggles online/offline status to appear more natural
     */
    _startPresenceCycling() {
        // Clear any existing interval
        this._stopPresenceCycling();
        
        // Cycle presence every 3-7 minutes
        const cyclePresence = async () => {
            if (!this.socket || this.status !== 'connected') return;
            
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
     * Clear local auth data and stop any active connection attempt.
     */
    async clearAuth() {
        console.log(`[Instance ${this.id}] Clearing auth...`);
        this._clearReconnectTimer();
        this.intentionalDisconnect = true;
        this._stopPresenceCycling();
        
        // Disconnect first if connected
        if (this.socket) {
            const socket = this.socket;
            this.socket = null;
            try {
                socket.ev.removeAllListeners();
                socket.end();
            } catch (e) {
                console.log(`[Instance ${this.id}] Socket close during clear auth:`, e.message);
            }
        }
        
        this.status = 'disconnected';
        this.qrCode = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        this._emitStatusChange();
        
        try {
            console.log(`[Instance ${this.id}] Deleting auth folder: ${this.authFolder}`);
            await fs.rm(this.authFolder, { recursive: true, force: true });
            await fs.mkdir(this.authFolder, { recursive: true });
            console.log(`[Instance ${this.id}] Auth folder cleared and recreated`);
            this._log('Auth cleared - ready for new QR scan', 'info');
        } catch (error) {
            console.error(`[Instance ${this.id}] Clear auth error:`, error);
            throw error;
        } finally {
            this.intentionalDisconnect = false;
        }
    }
    
    /**
     * Send a message
     * @param {string} to - Phone number or JID
     * @param {string} text - Message text
     * @param {Object} options - Override behavior settings for this message
     * @param {string} options.contactName - Optional name for saving the contact
     * @param {boolean} options.skipContactSave - Skip saving contact (default: false)
     */
    async sendMessage(to, text, options = {}) {
        if (this.status !== 'connected' || !this.socket) {
            const reason = `Instance not connected (status=${this.status}, socket=${this.socket ? 'present' : 'missing'})`;
            this._log(`Send blocked to ${to || 'unknown recipient'}: ${reason}`, 'error');
            throw new Error(reason);
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
        
        // Merge instance behavior settings with per-message overrides
        const behaviorOptions = normalizeBehaviorSettings({
            ...this.behaviorSettings,
            behaviorProfile: options.behaviorProfile || this.behaviorSettings.behaviorProfile,
            typingSimulation: options.typingSimulation !== undefined 
                ? options.typingSimulation 
                : this.behaviorSettings.typingSimulation,
            delayEnabled: options.delayEnabled !== undefined 
                ? options.delayEnabled 
                : this.behaviorSettings.delayEnabled,
            phoneNotificationsEnabled: options.phoneNotificationsEnabled !== undefined
                ? options.phoneNotificationsEnabled
                : this.behaviorSettings.phoneNotificationsEnabled,
            notificationGraceMs: options.notificationGraceMs !== undefined
                ? options.notificationGraceMs
                : this.behaviorSettings.notificationGraceMs,
        });
        
        const builtMessage = buildWhatsAppMessage({
            ...(options.messagePayload || {}),
            text: options.messagePayload?.text ?? text
        });
        
        // Send with anti-ban protections
        let result;
        try {
            result = await safeSendMessage(this.socket, jid, builtMessage.content, '', this.antiBanManager, {
                ...behaviorOptions,
                relayMessage: async (socket, targetJid, relayContent, relayOptions = {}) => {
                    let content = relayContent;
                    let additionalNodes = relayOptions.additionalNodes || [];

                    if (relayOptions.mode === 'native_flow' || content?.interactiveMessage) {
                        const isGroup = String(targetJid).endsWith('@g.us');
                        const plan = buildNativeFlowRelayPlan(content, { jid: targetJid, isGroup });
                        content = plan.relayContent;
                        additionalNodes = plan.additionalNodes;
                    }

                    const waMessage = generateWAMessageFromContent(targetJid, content, {
                        userJid: socket.user?.id
                    });
                    await socket.relayMessage(targetJid, waMessage.message, {
                        messageId: waMessage.key.id,
                        additionalNodes
                    });
                }
            });
        } catch (error) {
            this._log(`Send failed to ${to}: ${formatErrorForLog(error)}`, 'error');
            throw error;
        }
        
        if (result.sent) {
            this._log(`Sent to ${to}: ${builtMessage.logText.substring(0, 50)}...`, 'success');
        } else {
            this._log(`Send not sent to ${to}: ${result.reason || 'Unknown send failure'}`, 'warning');
        }
        
        return {
            ...result,
            messageText: builtMessage.logText,
            interactive: builtMessage.delivery
        };
    }

    /**
     * React to an existing WhatsApp message
     * @param {string} to - Phone number or JID for the chat
     * @param {{ emoji: string, key: object }} payload
     */
    async sendReaction(to, { emoji = '', key }) {
        if (this.status !== 'connected' || !this.socket) {
            const reason = `Instance not connected (status=${this.status}, socket=${this.socket ? 'present' : 'missing'})`;
            this._log(`Reaction blocked for ${to || 'unknown recipient'}: ${reason}`, 'error');
            throw new Error(reason);
        }

        if (!key?.id) {
            throw new Error('Reaction key.id is required');
        }

        const normalizedTo = to.includes('@') ? to : to.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
        const jid = normalizedTo.includes('@') ? normalizedTo : `${normalizedTo}@s.whatsapp.net`;
        const reactionKey = {
            ...key,
            remoteJid: key.remoteJid || jid
        };

        try {
            await this.socket.sendMessage(jid, {
                react: {
                    text: emoji,
                    key: reactionKey
                }
            });
        } catch (error) {
            this._log(`Reaction failed on ${key.id}: ${formatErrorForLog(error)}`, 'error');
            throw error;
        }

        const label = emoji ? emoji : '(removed)';
        this._log(`Reaction ${label} applied to message ${key.id}`, 'success');

        return {
            sent: true,
            emoji,
            key: reactionKey
        };
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
            
            // Use Baileys addOrEditContact method
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
        
        // 1. Try to get PN from message's alternate JID fields (Baileys 7.x)
        // remoteJidAlt is for DMs, participantAlt is for groups
        const altJid = msg.key.remoteJidAlt || msg.key.participantAlt;
        if (altJid && !altJid.includes('@lid')) {
            const pn = altJid.replace('@s.whatsapp.net', '');
            console.log(`[Instance ${this.id}] Found PN from alt JID: ${pn}`);
            // Cache this mapping for future use
            await this._storeLidMapping(lidId, pn);
            return pn;
        }
        
        // 2. Try to get PN from Baileys' internal LID mapping store
        if (this.socket?.signalRepository?.lidMapping) {
            try {
                const pn = await this.socket.signalRepository.lidMapping.getPNForLID(lidId);
                if (pn) {
                    console.log(`[Instance ${this.id}] Resolved LID via Baileys: ${pn}`);
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
     * Send read receipt for a message (blue ticks) with human-like delay
     */
    async _sendReadReceipt(msgKey) {
        try {
            const readDelay = 500 + Math.random() * 1500;
            await new Promise(r => setTimeout(r, readDelay));
            await this.socket.readMessages([msgKey]);
            console.log(`[Instance ${this.id}] Read receipt sent for ${msgKey.id}`);
        } catch (error) {
            console.error(`[Instance ${this.id}] Read receipt error:`, error.message);
        }
    }

    /**
     * Handle incoming message
     */
    async _handleMessage(msg) {
        try {
            if (msg.key.fromMe) return;
            
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
            
            const from = msg.key.remoteJid;
            const messageContent = this._extractMessageContent(msg.message);
            
            if (!messageContent.text || from === 'status@broadcast') return;
            
            // Handle LID (Local Identifier) to PN (Phone Number) mapping
            let phoneNumber = await this._resolvePhoneNumber(msg, from);
            
            this._log(`Received from ${phoneNumber}: ${messageContent.text.substring(0, 50)}...`, 'info');
            
            // Anti-ban: Send read receipt before replying (blue ticks)
            await this._sendReadReceipt(msg.key);
            
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
                    timestamp: new Date().toISOString(),
                    messageId: msg.key.id
                });
            }
            
            // Only use instance-specific webhook (no global fallback)
            console.log(`[Instance ${this.id}] Webhook check: ${this.webhookUrl || '(none)'}`);
            
            // Only forward if this instance has its own webhook configured
            if (this.webhookUrl) {
                this._log(`Forwarding to webhook: ${this.webhookUrl.substring(0, 50)}...`, 'info');
                await this._forwardToWebhook(msg, messageContent, from, phoneNumber, this.webhookUrl);
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
    async _forwardToWebhook(msg, messageContent, from, phoneNumber, webhookUrl) {
        const axios = (await import('axios')).default;
        
        console.log(`[Instance ${this.id}] Calling webhook: ${webhookUrl}`);
        
        try {
            const behavior = normalizeBehaviorSettings(this.behaviorSettings);
            const phoneNotificationsOn = behavior.phoneNotificationsEnabled;

            // In notification profiles, stay unavailable briefly so phones have
            // time to receive the push before any read/typing activity.
            try {
                if (phoneNotificationsOn) {
                    await this.socket.sendPresenceUpdate('unavailable', from);
                    if (behavior.notificationGraceMs > 0) {
                        await delay(behavior.notificationGraceMs);
                    }
                } else if (behavior.typingSimulation) {
                    await this.socket.sendPresenceUpdate('composing', from);
                }
            } catch (e) {}
            
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
                status: 'received',
                webhook_id: this.id,
                event: 'message',
                quoted_message: messageContent.quotedText || null
            };
            
            console.log(`[Instance ${this.id}] Webhook payload:`, JSON.stringify(payload, null, 2));
            
            const response = await axios.post(webhookUrl, payload, { timeout: 30000 });
            
            console.log(`[Instance ${this.id}] Webhook response:`, response.status, response.data);
            
            // Handle response
            if (response.data?.skip) {
                this._log(`Human handoff active for ${phoneNumber}`, 'info');
                try {
                    await this.socket.sendPresenceUpdate('paused', from);
                } catch (e) {}
                return;
            }
            
            const reply = response.data?.reply || response.data?.message || response.data?.text;
            
            if (reply) {
                let result;
                try {
                    result = await safeSendMessage(
                        this.socket, 
                        from, 
                        reply, 
                        messageContent.text, 
                        this.antiBanManager,
                        {
                            ...behavior,
                            messageKey: msg.key,  // Pass message key for read receipt simulation
                            simulateReading: !phoneNotificationsOn
                        }
                    );
                } catch (error) {
                    this._log(`Reply failed to ${phoneNumber}: ${formatErrorForLog(error)}`, 'error');
                    throw error;
                }
                if (result.sent) {
                    this._log(`Replied to ${phoneNumber}: ${reply.substring(0, 50)}...`, 'success');
                } else {
                    this._log(`Reply not sent to ${phoneNumber}: ${result.reason || 'Unknown reply failure'}`, 'warning');
                }
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
                await this.socket.sendPresenceUpdate('paused', from);
            } catch (e) {}
        }
    }
    
    /**
     * Extract message content from any message type
     */
    _extractMessageContent(message) {
        if (!message) {
            return { text: '', quotedText: null, isReply: false, messageType: 'unknown' };
        }

        let text = '';
        let quotedText = null;
        let messageType = 'unknown';

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
        } else if (message.videoMessage) {
            text = message.videoMessage.caption || '[Video]';
            messageType = 'video';
        } else if (message.documentMessage) {
            text = message.documentMessage.caption || message.documentMessage.fileName || '[Document]';
            messageType = 'document';
        } else if (message.audioMessage) {
            text = '[Voice Note]';
            messageType = 'audio';
        } else if (message.stickerMessage) {
            text = '[Sticker]';
            messageType = 'sticker';
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
            messageType
        };
    }
    
    /**
     * Update anti-ban settings
     */
    updateAntiBanSettings(settings) {
        this.antiBanSettings = { ...this.antiBanSettings, ...settings };
        this.antiBanManager.updateLimits(this.antiBanSettings);
    }
    
    /**
     * Update behavior settings (typing simulation, delays, notification profiles)
     */
    updateBehaviorSettings(settings) {
        this.behaviorSettings = normalizeBehaviorSettings({
            ...this.behaviorSettings,
            ...settings
        });
    }
    
    /**
     * Get the proxy state for API responses.
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
                    origin: this.proxy.source || 'api',
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

    _normalizeProxy(input, defaultSource = 'api') {
        if (!input) return null;
        if (input.enabled === false) return { enabled: false };
        try {
            const cfg = parseProxyConfig(input.url || input);
            if (!cfg) return null;
            return {
                enabled: true,
                source: input.source || defaultSource,
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

    async updateProxy(newProxy, opts = {}) {
        const source = opts.source || 'api';

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
     * Get instance status
     */
    getStatus() {
        return {
            id: this.id,
            name: this.name,
            status: this.status,
            qrCode: this.qrCode,
            pairingCode: this.pairingCode || null,
            connectedPhone: this.connectedPhone,
            connectedAt: this.connectedAt,
            hasSavedCredentials: this.hasSavedCredentials(),
            webhookUrl: this.webhookUrl || null,
            behaviorSettings: this.behaviorSettings,
            antiBanSettings: this.antiBanSettings,
            antiBanHealth: this.antiBanManager.getHealth(),
            autoReconnect: {
                enabled: AUTO_RECONNECT_ENABLED,
                attempts: this.reconnectAttempts,
                maxAttempts: AUTO_RECONNECT_MAX_ATTEMPTS,
                nextAttemptAt: this.nextReconnectAt
            },
            proxy: this.getProxyStatus(),
            apiKey: redactApiKeyMeta(this.apiKeyMeta),
            createdAt: this.createdAt
        };
    }
    
    /**
     * Get serializable config (for persistence)
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            webhookUrl: this.webhookUrl,
            behaviorSettings: this.behaviorSettings,
            antiBanSettings: this.antiBanSettings,
            proxy: this.proxy,
            apiKeyMeta: this.apiKeyMeta,
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

        const logFile = path.join(this.logsFolder, `${entry.timestamp.slice(0, 10)}.jsonl`);
        fs.mkdir(this.logsFolder, { recursive: true })
            .then(() => fs.appendFile(logFile, `${JSON.stringify(entry)}\n`))
            .catch(error => {
                console.error(`[Instance ${this.id}] Could not persist activity log:`, error.message);
            });
        
        const emoji = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        console.log(`${emoji[level] || ''} [${this.id}] ${message}`);
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
        this.proxyPool = new ProxyPoolManager(null);
    }
    
    /**
     * Initialize the manager
     */
    async init() {
        // Ensure instances folder exists
        await fs.mkdir(INSTANCES_FOLDER, { recursive: true });

        await this._loadOrSeedProxyPool();
        
        // Load existing instances from DB
        await this._loadInstances();

        if (this.proxyPool.isEnabled()) {
            await this._reconcileProxyPool({ emit: false });
            console.log(
                `[InstanceManager] Proxy pool ready: ${this.proxyPool.getStatus().used}/${this.proxyPool.size()} slots in use`
            );
        }

        if (WORKER_MODE === 'single-instance' && FIXED_INSTANCE_ID && this.instances.size === 0) {
            console.log(`[InstanceManager] Single-instance mode — bootstrapping ${FIXED_INSTANCE_ID}`);
            await this.createInstance({
                id: FIXED_INSTANCE_ID,
                name: process.env.WASUP_INSTANCE_NAME || FIXED_INSTANCE_ID,
            });
        }
        
        console.log(`[InstanceManager] Initialized with ${this.instances.size} instances (mode=${WORKER_MODE}, data=${INSTANCES_FOLDER})`);
        return this;
    }

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

    async _saveProxyPool() {
        try {
            const data = { entries: this.proxyPool.serialize(), savedAt: new Date().toISOString() };
            await fs.writeFile(PROXY_POOL_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[InstanceManager] Failed to save proxy-pool.json:', err);
            throw err;
        }
    }

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

    async removeProxyFromPool(slotId) {
        const result = this.proxyPool.removeEntry(slotId);
        if (!result.removed) {
            return { removed: false, pool: this.proxyPool.getStatus() };
        }
        await this._saveProxyPool();
        if (result.wasAssignedTo) {
            await this._reconcileProxyPool({ emit: true });
        }
        return {
            removed: true,
            wasAssignedTo: result.wasAssignedTo,
            pool: this.proxyPool.getStatus(),
        };
    }

    async _reconcileProxyPool({ emit = true } = {}) {
        const instanceList = Array.from(this.instances.values()).map(i => ({
            id: i.id,
            proxy: i.proxy,
            createdAt: i.createdAt,
        }));

        const { reassigned, orphaned } = this.proxyPool.reconcile(instanceList);

        for (const orphanId of orphaned) {
            const inst = this.instances.get(orphanId);
            if (!inst) continue;
            inst._log('Proxy slot no longer in pool — clearing', 'warning');
            await inst.updateProxy(null, { skipReconnect: false });
        }

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

    async reconcileProxyPool() {
        return this._reconcileProxyPool({ emit: true });
    }

    getProxyPoolStatus() {
        return this.proxyPool.getStatus();
    }

    async setInstanceProxy(id, proxy) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }

        if (proxy === null || proxy === undefined) {
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

        this.proxyPool.releaseSlot(id);
        const result = await instance.updateProxy(proxy, { source: 'api' });
        await this._saveInstances();
        return result;
    }

    async verifyInstanceProxy(id, target) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        return await instance.verifyProxy(target);
    }
    
    /**
     * Create a new instance
     */
    async createInstance(config = {}) {
        const id = config.id || this._generateId();
        
        console.log(`[InstanceManager] Creating instance: ${id}`);

        if (WORKER_MODE === 'single-instance' && this.instances.size >= 1) {
            throw new Error('Single-instance worker mode allows only one instance');
        }
        
        if (this.instances.has(id)) {
            throw new Error(`Instance ${id} already exists`);
        }

        let apiKeyMeta = config.apiKeyMeta || null;
        let issuedApiKey = null;
        if (config.apiKey) {
            apiKeyMeta = buildApiKeyMetaFromPlaintext(config.apiKey);
            if (!apiKeyMeta) throw new Error('Invalid apiKey format');
            issuedApiKey = config.apiKey;
        } else if (config.generateApiKey) {
            const generated = generateInstanceApiKey();
            apiKeyMeta = {
                publicId: generated.publicId,
                salt: generated.salt,
                secretHash: generated.secretHash,
                hint: generated.hint,
                format: 'wsp_v3',
            };
            issuedApiKey = generated.key;
        }

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
            behaviorSettings: config.behaviorSettings,
            antiBanSettings: config.antiBanSettings,
            proxy: proxyConfig,
            apiKeyMeta,
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
        
        const status = instance.getStatus();
        if (issuedApiKey) {
            status.apiKey = { ...status.apiKey, key: issuedApiKey, showOnce: true };
        }
        return status;
    }

    /**
     * Resolve instance + verify optional per-instance API key.
     * @returns {{ instanceId: string, instance: WhatsAppInstance } | null}
     */
    verifyApiKeyAccess(apiKey, preferredInstanceId = null) {
        if (!apiKey) return null;

        if (preferredInstanceId) {
            const inst = this.instances.get(preferredInstanceId);
            if (inst?.apiKeyMeta && verifyApiKeyForInstance(apiKey, inst.apiKeyMeta)) {
                return { instanceId: preferredInstanceId, instance: inst };
            }
            return null;
        }

        for (const [instanceId, inst] of this.instances) {
            if (inst.apiKeyMeta && verifyApiKeyForInstance(apiKey, inst.apiKeyMeta)) {
                return { instanceId, instance: inst };
            }
        }
        return null;
    }

    hasInstanceApiKeys() {
        for (const inst of this.instances.values()) {
            if (inst.apiKeyMeta) return true;
        }
        return false;
    }

    async rotateInstanceApiKey(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);

        const generated = generateInstanceApiKey();
        instance.apiKeyMeta = {
            publicId: generated.publicId,
            salt: generated.salt,
            secretHash: generated.secretHash,
            hint: generated.hint,
            format: 'wsp_v3',
        };
        await this._saveInstances();
        return {
            apiKey: generated.key,
            meta: redactApiKeyMeta(instance.apiKeyMeta),
        };
    }

    async clearInstanceApiKey(id) {
        const instance = this.instances.get(id);
        if (!instance) throw new Error(`Instance ${id} not found`);
        instance.apiKeyMeta = null;
        await this._saveInstances();
        return { cleared: true };
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
        return { success: true, id };
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
        if (updates.behaviorSettings) {
            instance.updateBehaviorSettings(updates.behaviorSettings);
        }
        if (updates.antiBanSettings) {
            instance.updateAntiBanSettings(updates.antiBanSettings);
        }
        
        await this._saveInstances();
        return instance.getStatus();
    }

    /**
     * Connect an instance
     */
    async connectInstance(id) {
        console.log(`[InstanceManager] Connecting instance: ${id}`);
        console.log(`[InstanceManager] Available instances:`, Array.from(this.instances.keys()));
        
        const instance = this.instances.get(id);
        if (!instance) {
            console.error(`[InstanceManager] Instance ${id} not found in map`);
            throw new Error(`Instance ${id} not found`);
        }
        
        console.log(`[InstanceManager] Instance found, current status: ${instance.status}`);
        console.log(`[InstanceManager] Auth folder: ${instance.authFolder}`);
        
        await instance.connect();
        return instance.getStatus();
    }
    
    /**
     * Connect an instance using pairing code
     */
    async connectInstanceWithPairingCode(id, phoneNumber) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        const code = await instance.connectWithPairingCode(phoneNumber);
        return { code, instance: instance.getStatus() };
    }

    /**
     * Disconnect an instance
     */
    async disconnectInstance(id, options = {}) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        await instance.disconnect(options);
        return instance.getStatus();
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
     * @param {string} text - Message text
     * @param {Object} options - Behavior options (typingSimulation, delayEnabled)
     */
    async sendMessage(instanceId, to, text, options = {}) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            throw new Error(`Instance ${instanceId} not found`);
        }
        return await instance.sendMessage(to, text, options);
    }

    async sendReaction(instanceId, to, payload) {
        const instance = this.instances.get(instanceId);
        if (!instance) {
            throw new Error(`Instance ${instanceId} not found`);
        }
        return await instance.sendReaction(to, payload);
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
                    
                    // Auto-connect credentialed instances through the guarded reconnect scheduler.
                    if (instance.hasSavedCredentials()) {
                        const staggerMs = Math.min(
                            AUTO_RECONNECT_BASE_DELAY_MS + (this.instances.size - 1) * 1500,
                            AUTO_RECONNECT_MAX_DELAY_MS
                        );
                        console.log(
                            `[InstanceManager] Scheduling startup auto-reconnect for ${instance.id} ` +
                            `in ${Math.ceil(staggerMs / 1000)}s`
                        );
                        instance.scheduleStartupReconnect(staggerMs);
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
