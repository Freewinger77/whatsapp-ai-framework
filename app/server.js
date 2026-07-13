/**
 * WhatsApp AI Bot - Multi-Instance API Server
 *
 * Features:
 * - Multiple WhatsApp instances (multiple phone numbers)
 * - RESTful API for instance management
 * - WebSocket for real-time updates
 * - Per-instance settings and anti-ban protection
 * - API key authentication for external platform integration
 */

import 'dotenv/config';
import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import QRCode from 'qrcode';
import { initAzureStorage, uploadMedia, isStorageEnabled } from './src/utils/azure-storage.js';
import { initMediaStorage, listMedia, resolveMediaBuffer } from './src/utils/media-storage.js';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Instance Manager
import { InstanceManager } from './src/utils/instance-manager.js';
import { buildWhatsAppMessage } from './src/utils/message-builder.js';
import {
    hasNativeInteractiveFields,
    shouldUseMessageBuilder,
    validateInteractiveSendBody
} from './src/utils/interactive-payload.js';
import {
    getDeploymentDefaultProxy,
    redactProxy,
    createProxyAgent,
    parseProxyConfig,
    parseFlexibleProxyInput,
    buildProxyAttachArg,
} from './src/utils/proxy.js';
import { normalizeMessageStatus } from './src/utils/message-status.js';
import {
    isControlPlaneReportingEnabled,
    reportActivityLog,
    reportConnectionStatus,
    reportMessageEvent,
} from './src/utils/control-plane-reporter.js';
import {
    isControlPlaneRegistryEnabled,
    registerWorkerInstance,
    syncWorkerInstanceCatalog,
} from './src/utils/control-plane-registry.js';

// ========================================
// CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ''; // Optional API key for external access
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const WORKER_SHARED_SECRET = process.env.WASUP_WORKER_SHARED_SECRET || API_KEY;
const CONTROL_PLANE_URL = (
    process.env.WASUP_CONTROL_PLANE_URL ||
    process.env.CONTROL_PLANE_URL ||
    'https://control-plane.wasup.co'
).replace(/\/+$/, '');
const DEFAULT_WEBHOOK_URL = process.env.DEFAULT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';
const ALLOW_PUBLIC_DASHBOARD = process.env.ALLOW_PUBLIC_DASHBOARD === 'true';
const WASUP_DASHBOARD_URL = (process.env.WASUP_DASHBOARD_URL || 'https://dev.wasup.co').replace(/\/+$/, '');
const CUSTOMER_KEY_AUTH_CACHE_TTL_MS = 60_000;

// ========================================
// STATE MANAGEMENT
// ========================================

let instanceManager = null;
const wsClients = new Map(); // Map of WebSocket -> { subscribedInstances: Set }
const customerKeyAuthCache = new Map();

// ========================================
// EXPRESS WEB SERVER
// ========================================

const app = express();
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Named page routes
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/test', (req, res) => res.sendFile(path.join(__dirname, 'public', 'test.html')));
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')));
app.get('/playground', (req, res) => res.redirect(301, '/test'));
// Cache the OpenAPI yaml file in memory, but re-read when the file changes on
// disk (mtime-aware). This lets a static `scp` of openapi.yaml refresh /docs
// WITHOUT a process restart — important because restarting drops WhatsApp sockets.
let _openapiCache = null;
let _openapiCacheMtimeMs = 0;
function loadOpenapiYaml() {
    const file = path.join(__dirname, 'openapi.yaml');
    try {
        const mtimeMs = fsSync.statSync(file).mtimeMs;
        if (_openapiCache !== null && mtimeMs === _openapiCacheMtimeMs) {
            return _openapiCache;
        }
        _openapiCache = fsSync.readFileSync(file, 'utf8');
        _openapiCacheMtimeMs = mtimeMs;
    } catch (err) {
        console.error('[OpenAPI] Failed to read openapi.yaml:', err.message);
        if (_openapiCache === null) _openapiCache = '';
    }
    return _openapiCache;
}

/**
 * Serve the OpenAPI spec with the `servers:` section dynamically rewritten to
 * the actual host the request came in on. So when this region is hit at
 *   https://wasup-uk-west.azurewebsites.net/api/openapi.yaml
 * the docs page shows that exact URL, not localhost:3000.
 *
 * Honors X-Forwarded-Proto / X-Forwarded-Host (Azure App Service sets these).
 */
app.get('/api/openapi.yaml', (req, res) => {
    const yaml = loadOpenapiYaml();
    if (!yaml) return res.status(500).send('# openapi.yaml unavailable');

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
    const host  = (req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`).toString().split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    const region  = process.env.REGION_CODE || null;

    // Build dynamic servers block. Drop the hard-coded localhost block entirely.
    const dynamicServers = [
        `servers:`,
        `  - url: ${baseUrl}`,
        `    description: ${region ? `Region "${region}"` : 'This deployment'}`,
        ``,
    ].join('\n');

    // Replace the existing `servers:` block (everything from `^servers:` up to
    // the next top-level `^[a-z]` directive) with our dynamic one.
    const rewritten = yaml.replace(
        /^servers:[\s\S]*?(?=^[a-zA-Z][a-zA-Z0-9_-]*:)/m,
        dynamicServers
    );

    res.type('text/yaml').send(rewritten);
});

// CORS for API access
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ========================================
// API AUTHENTICATION MIDDLEWARE
// ========================================

function isPublicDashboardRead(req) {
    if (!ALLOW_PUBLIC_DASHBOARD) return false;
    if (req.method !== 'GET') return false;

    const path = req.path || '';
    return (
        path === '/health' ||
        path === '/dashboard-config' ||
        path === '/instances' ||
        /^\/instances\/[^/]+$/.test(path) ||
        /^\/instances\/[^/]+\/(qr|connection|logs)$/.test(path)
    );
}

/**
 * Authenticate API requests
 * Supports: API Key (X-API-Key header) or Bearer token (Authorization header)
 */
async function authenticateAPI(req, res, next) {
    // If no API key is configured, skip auth (for local development)
    if (!API_KEY || isPublicDashboardRead(req)) {
        return next();
    }

    const credential = getCredentialFromRequest(req);
    const authHeader = req.headers.authorization;

    if (credential === API_KEY || (WORKER_SHARED_SECRET && credential === WORKER_SHARED_SECRET)) {
        return next();
    }

    // Check admin password as fallback
    if (ADMIN_PASSWORD && authHeader === `Bearer ${ADMIN_PASSWORD}`) {
        return next();
    }

    const customerAuth = await validateCustomerApiKeyForHost(
        credential,
        getHostnameFromRequest(req),
        requiredScopeForRequest(req)
    );
    if (customerAuth.valid) {
        req.wasupCustomerAuth = customerAuth;
        return next();
    }

    res.status(401).json({ 
        error: 'Unauthorized', 
        message: customerAuth.message || 'Valid API key required. Use X-API-Key header or Authorization: Bearer <key>' 
    });
}

function getCredentialFromRequest(req) {
    const apiKey = String(req.headers['x-api-key'] || '').trim();
    if (apiKey) return apiKey;

    const authHeader = String(req.headers.authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function getHostnameFromRequest(req) {
    return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
}

function requiredScopeForRequest(req) {
    const path = req.path || '';
    if (/\/(?:send|react)(?:\/|$)/.test(path)) return 'messages:send';
    if (req.method === 'GET') return 'instances:read';
    return 'instances:write';
}

async function validateCustomerApiKeyForHost(apiKey, hostname, requiredScope = 'instances:read') {
    const key = String(apiKey || '').trim();
    const host = String(hostname || '').trim().toLowerCase();
    if (!key || !/^sk-(?:prod|dev)-/i.test(key)) {
        return { valid: false };
    }

    if (!WORKER_SHARED_SECRET) {
        return { valid: false, message: 'Worker authentication is not configured.' };
    }

    const cacheKey = crypto
        .createHash('sha256')
        .update(`${host}:${requiredScope}:${key}`)
        .digest('hex');
    const cached = customerKeyAuthCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    try {
        const response = await axios.post(
            `${CONTROL_PLANE_URL}/api/internal/worker-auth`,
            { apiKey: key, hostname: host, requiredScope },
            {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'x-wasup-worker-secret': WORKER_SHARED_SECRET,
                },
            }
        );
        const data = response.data || {};
        const result = data.valid
            ? { valid: true, orgId: data.orgId, orgSlug: data.orgSlug, keyKind: data.keyKind, scopes: data.scopes || [] }
            : { valid: false, message: data.message };

        customerKeyAuthCache.set(cacheKey, {
            result,
            expiresAt: Date.now() + CUSTOMER_KEY_AUTH_CACHE_TTL_MS,
        });
        return result;
    } catch (error) {
        console.error('[Auth] Control-plane key validation failed:', error.response?.status || error.message);
        return { valid: false, message: 'Could not validate the API key right now.' };
    }
}

// Apply authentication to all API routes
app.use('/api', authenticateAPI);

/**
 * GET /api/dashboard-config
 * Playground/admin UI hints for auth and dashboard return links.
 */
app.get('/api/dashboard-config', (req, res) => {
    const dashboardRequiresApiKey = Boolean(API_KEY) && !ALLOW_PUBLIC_DASHBOARD;
    res.json({
        success: true,
        allowPublicDashboard: ALLOW_PUBLIC_DASHBOARD || !API_KEY,
        dashboardRequiresApiKey,
        dashboardUrl: WASUP_DASHBOARD_URL,
        showDashboardReturnOverlay: Boolean(WASUP_DASHBOARD_URL),
    });
});

// ========================================
// INSTANCE MANAGEMENT API
// ========================================

/**
 * GET /api/instances
 * List all WhatsApp instances
 */
app.get('/api/instances', (req, res) => {
    try {
        const instances = instanceManager.getAllInstances();
        res.json({ 
            success: true, 
            count: instances.length,
            instances 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/instances
 * Create a new WhatsApp instance
 * Body: { name?, webhookUrl?, antiBanSettings? }
 */
app.post('/api/instances', async (req, res) => {
    try {
        const { id, name, webhookUrl, webhookSigningSecret, antiBanSettings, behaviorSettings, handoffSettings, proxy } = req.body;
        
        const instance = await instanceManager.createInstance({
            id,
            name,
            webhookUrl,
            webhookSigningSecret: webhookSigningSecret || '',
            antiBanSettings,
            behaviorSettings,
            handoffSettings,
            proxy
        });
        
        broadcastToAll({
            type: 'instance_created',
            data: instance
        });
        
        res.status(201).json({ 
            success: true, 
            instance 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id
 * Get instance details
 */
app.get('/api/instances/:id', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        res.json({ 
            success: true, 
            instance: instance.getStatus() 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/migrate-id
 * Rename instance ID while preserving auth/session state.
 * Body: { newId: "51981fe4-..." }
 */
app.post('/api/instances/:id/migrate-id', async (req, res) => {
    try {
        const { newId } = req.body || {};
        const instance = await instanceManager.migrateInstanceId(req.params.id, newId);
        registerWorkerInstance(instance, { controlPlaneInstanceId: newId });
        broadcastToAll({
            type: 'instance_migrated',
            data: { from: req.params.id, to: newId, instance }
        });
        res.json({ success: true, instance, previousId: req.params.id, newId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id
 * Update instance settings
 * Body: { name?, webhookUrl?, webhookSigningSecret?, behaviorSettings?, antiBanSettings?, handoffSettings? }
 */
app.put('/api/instances/:id', async (req, res) => {
    try {
        const { name, webhookUrl, webhookSigningSecret, behaviorSettings, antiBanSettings, handoffSettings } = req.body;
        
        const instance = await instanceManager.updateInstance(req.params.id, {
            name,
            webhookUrl,
            webhookSigningSecret,
            behaviorSettings,
            antiBanSettings,
            handoffSettings,
        });
        
        broadcastToAll({
            type: 'instance_updated',
            data: instance
        });
        
        res.json({ 
            success: true, 
            instance 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/instances/:id
 * Delete an instance
 */
app.delete('/api/instances/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const credential = getCredentialFromRequest(req);
        const isInternal =
            (WORKER_SHARED_SECRET && credential === WORKER_SHARED_SECRET) ||
            (API_KEY && credential === API_KEY);
        if (process.env.WASUP_ORG_ID && isUuid && !isInternal) {
            console.warn(`[API] Blocked DELETE for protected org instance ${id}`);
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Protected instance cannot be deleted via this API key. Manage it from the Wasup control plane.',
            });
        }
        console.log(`[API] DELETE instance ${id} (internal=${!!isInternal})`);
        const result = await instanceManager.deleteInstance(id);

        broadcastToAll({
            type: 'instance_deleted',
            data: { id: req.params.id }
        });

        res.json({
            success: true,
            message: `Instance ${req.params.id} deleted`,
            poolSlotReleased: !!result.poolSlotReleased,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// INSTANCE CONNECTION API
// ========================================

/**
 * POST /api/instances/:id/connect
 * Start WhatsApp connection for instance (QR code mode)
 * Body: { pairingPhone?: "phone_number" } - if provided, uses pairing code instead of QR
 */
app.post('/api/instances/:id/connect', async (req, res) => {
    console.log(`[API] Connect request for instance: ${req.params.id}`);
    try {
        const options = {};
        const pairingPhone = req.body.pairingPhone || req.body.phoneNumber || req.body.phone;
        if (pairingPhone) {
            const cleanPhone = String(pairingPhone).replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
            const inst = instanceManager.getInstance(req.params.id);
            if (inst?.pairingCode && inst.pairingPhoneTarget === cleanPhone && inst.pairingCodeIssuedAt) {
                const ageMs = Date.now() - new Date(inst.pairingCodeIssuedAt).getTime();
                if (ageMs >= 0 && ageMs < 120000) {
                    return res.json({
                        success: true,
                        reused: true,
                        pairingCode: inst.pairingCode,
                        message: `Pairing code still active: ${inst.pairingCode}. Enter it in WhatsApp now — do not refresh.`,
                        instance: inst.getStatus(),
                    });
                }
            }
            options.pairingPhone = cleanPhone;
        }
        
        const instance = await instanceManager.connectInstance(req.params.id, options);
        console.log(`[API] Connect successful for: ${req.params.id}`);
        res.json({ 
            success: true, 
            message: options.pairingPhone 
                ? `Pairing code generated: ${instance.pairingCode}` 
                : 'Connection started (QR mode)',
            pairingCode: instance.pairingCode || null,
            instance 
        });
    } catch (error) {
        console.error(`[API] Connect error for ${req.params.id}:`, error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/pair
 * Connect using pairing code (alternative to QR scan)
 * Body: { phoneNumber: "447393002183" } - phone number WITH country code, NO + prefix
 */
app.post('/api/instances/:id/pair', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                error: 'Missing required field: phoneNumber',
                hint: 'Provide phone number with country code, e.g. "447393002183"'
            });
        }
        
        const instance = await instanceManager.connectInstance(req.params.id, { 
            pairingPhone: phoneNumber 
        });
        
        res.json({ 
            success: true, 
            pairingCode: instance.pairingCode,
            message: instance.pairingCode 
                ? `Enter code ${instance.pairingCode} in WhatsApp > Linked Devices > Link a Device`
                : 'Already registered, reconnecting...',
            instance 
        });
    } catch (error) {
        console.error(`[API] Pair error for ${req.params.id}:`, error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/disconnect
 * Close the live socket. Credentials on disk are kept unless body.revoke is true.
 */
app.post('/api/instances/:id/disconnect', async (req, res) => {
    try {
        const revokeSession = !!(req.body && req.body.revoke);
        const instance = await instanceManager.disconnectInstance(req.params.id, { revokeSession });
        res.json({ 
            success: true, 
            message: revokeSession ? 'Disconnected (session revoked)' : 'Disconnected (auth preserved on disk)',
            instance 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/clear-auth
 * Clear instance auth (logout + delete credentials)
 */
app.post('/api/instances/:id/clear-auth', async (req, res) => {
    try {
        const instance = await instanceManager.clearInstanceAuth(req.params.id);
        res.json({ 
            success: true, 
            message: 'Auth cleared',
            instance 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/qr
 * Get QR code and/or pairing code for instance
 * Query: ?format=image returns a raw PNG image
 */
app.get('/api/instances/:id/qr', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const status = instance.getStatus();
        
        if (status.status === 'connected') {
            if (req.query.format === 'image') {
                return res.status(204).end();
            }
            return res.json({ 
                success: true, 
                status: 'connected',
                phone: status.connectedPhone,
                qrCode: null,
                qrCodeUpdatedAt: status.qrCodeUpdatedAt || null,
                qrVersion: status.qrVersion || 0,
                qrAgeMs: status.qrAgeMs ?? null,
                qrTtlMs: status.qrTtlMs ?? null,
                qrExpiresInMs: status.qrExpiresInMs ?? null,
                qrRefreshRestartCount: status.qrRefreshRestartCount || 0,
                staleProtocolResetCount: status.staleProtocolResetCount || 0,
                qrScanReceivedAt: status.qrScanReceivedAt || null,
                linkingGraceUntil: status.linkingGraceUntil || null,
                linkingGraceActive: !!status.linkingGraceActive,
                lastCredsUpdateAt: status.lastCredsUpdateAt || null,
                pairingCode: null,
                message: 'Already connected'
            });
        }
        
        if (req.query.format === 'image' && instance.qrContent) {
            const pngBuffer = await QRCode.toBuffer(instance.qrContent, { type: 'png', width: 300, margin: 2 });
            res.set('Content-Type', 'image/png');
            return res.send(pngBuffer);
        }
        
        if (!status.qrCode && !status.pairingCode) {
            return res.json({ 
                success: true, 
                status: status.status,
                qrCode: null,
                qrCodeUpdatedAt: status.qrCodeUpdatedAt || null,
                qrVersion: status.qrVersion || 0,
                qrAgeMs: status.qrAgeMs ?? null,
                qrTtlMs: status.qrTtlMs ?? null,
                qrExpiresInMs: status.qrExpiresInMs ?? null,
                qrRefreshRestartCount: status.qrRefreshRestartCount || 0,
                staleProtocolResetCount: status.staleProtocolResetCount || 0,
                qrScanReceivedAt: status.qrScanReceivedAt || null,
                linkingGraceUntil: status.linkingGraceUntil || null,
                linkingGraceActive: !!status.linkingGraceActive,
                lastCredsUpdateAt: status.lastCredsUpdateAt || null,
                pairingCode: null,
                connectionIssue: status.connectionIssue || null,
                message: status.connectionIssue?.message || 'Not yet generated. Call /connect or /pair first.'
            });
        }
        
        res.json({ 
            success: true, 
            status: status.status,
            qrCode: status.qrCode || null,
            qrCodeUpdatedAt: status.qrCodeUpdatedAt || null,
            qrVersion: status.qrVersion || 0,
            qrAgeMs: status.qrAgeMs ?? null,
            qrTtlMs: status.qrTtlMs ?? null,
            qrExpiresInMs: status.qrExpiresInMs ?? null,
            qrRefreshRestartCount: status.qrRefreshRestartCount || 0,
            staleProtocolResetCount: status.staleProtocolResetCount || 0,
            qrScanReceivedAt: status.qrScanReceivedAt || null,
            linkingGraceUntil: status.linkingGraceUntil || null,
            linkingGraceActive: !!status.linkingGraceActive,
            lastCredsUpdateAt: status.lastCredsUpdateAt || null,
            connectionIssue: status.connectionIssue || null,
            pairingCode: status.pairingCode || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// MESSAGING API
// ========================================

/**
 * POST /api/instances/:id/send
 * Send a message via instance
 * Body: { 
 *   to: "phone_number", 
 *   message: "text", 
 *   typingSimulation?: boolean, 
 *   delayEnabled?: boolean,
 *   contactName?: string,      // Optional: Name to save contact as (default: "Unknown User XXXX")
 *   skipContactSave?: boolean  // Optional: Skip auto-saving contact (default: false)
 * }
 */
app.post('/api/instances/:id/send', async (req, res) => {
    try {
        const response = await executeInstanceSend(req.params.id, req.body);
        res.status(response.status).json(response.body);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/instances/:id/send/interactive', async (req, res) => {
    try {
        const response = await executeInstanceSend(req.params.id, req.body, { interactiveFocus: true });
        res.status(response.status).json(response.body);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/react
 * Send an emoji reaction to a message
 * Body: { to, messageId, emoji, fromMe? }
 */
app.post('/api/instances/:id/react', async (req, res) => {
    try {
        const { to, messageId, emoji, fromMe } = req.body;
        if (!to || !messageId) {
            return res.status(400).json({ error: 'Missing required fields: to, messageId' });
        }
        const result = await instanceManager.sendReaction(req.params.id, to, messageId, emoji || '', !!fromMe);
        res.json({ success: true, result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/react
 * Send an emoji reaction (auto-select instance by from_phone)
 * Body: { from_phone?, to_phone, messageId, emoji }
 */
app.post('/api/react', async (req, res) => {
    try {
        const fromPhone = req.body.from_phone || req.body.from;
        const toPhone = req.body.to_phone || req.body.to;
        const { messageId, emoji } = req.body;

        if (!toPhone || !messageId) {
            return res.status(400).json({ error: 'Missing required fields: to_phone, messageId' });
        }

        let matchedInstance = null;
        if (fromPhone) {
            const instances = instanceManager.getAllInstances();
            const normalizedFrom = normalizePhone(fromPhone);
            matchedInstance = instances.find(i => {
                if (!i.connectedPhone || i.status !== 'connected') return false;
                const nc = normalizePhone(i.connectedPhone);
                return nc.endsWith(normalizedFrom) || normalizedFrom.endsWith(nc) || nc === normalizedFrom;
            });
        } else {
            matchedInstance = instanceManager.getAllInstances().find(i => i.status === 'connected');
        }

        if (!matchedInstance) {
            return res.status(400).json({ error: 'No connected instance found' });
        }

        const result = await instanceManager.sendReaction(matchedInstance.id, toPhone, messageId, emoji || '', !!req.body.fromMe);
        res.json({ success: true, instanceId: matchedInstance.id, result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * Normalize phone number - remove leading + and any non-digit characters
 */
function normalizePhone(phone) {
    if (!phone) return null;
    return phone.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
}

function buildSendOptions(body = {}) {
    const options = {};
    if (body.typingSimulation !== undefined) options.typingSimulation = body.typingSimulation;
    if (body.delayEnabled !== undefined) options.delayEnabled = body.delayEnabled;
    if (body.contactName !== undefined) options.contactName = body.contactName;
    if (body.skipContactSave !== undefined) options.skipContactSave = body.skipContactSave;
    return options;
}

function buildOutboundPayload(body = {}, { interactiveFocus = false } = {}) {
    const message = body.message ?? body.text;
    const messageType = resolveSendMessageType(body.messageType, body);
    const {
        mediaUrl, mimeType, fileName, ptt,
        footer, buttons, buttonText, title, sections,
        latitude, longitude, locationName, locationAddress,
        contactCard
    } = body;

    const explicitRichMedia = messageType && !['text', 'buttons', 'list'].includes(messageType);
    const useMessageBuilder = interactiveFocus || shouldUseMessageBuilder(body, messageType);

    if (useMessageBuilder) {
        const validation = validateInteractiveSendBody(body, { interactiveFocus });
        if (!validation.ok) {
            return {
                status: 400,
                body: {
                    error: validation.error,
                    details: validation.details
                }
            };
        }

        const built = buildWhatsAppMessage(validation.payload);
        return {
            textOrParams: built.content,
            messageType: built.delivery.mode,
            delivery: built.delivery
        };
    }

    const richType = messageType && messageType !== 'text';
    if (richType) {
        const normalizedInteractive = normalizeInteractivePayload(messageType, body, message);
        return {
            textOrParams: {
                messageType,
                text: message || '',
                mediaUrl, mimeType, fileName, ptt,
                footer,
                buttons: normalizedInteractive.buttons || buttons,
                buttonText, title,
                sections: normalizedInteractive.sections || sections,
                latitude, longitude, locationName, locationAddress,
                contactCard
            },
            messageType
        };
    }

    if (!message && !hasNativeInteractiveFields(body)) {
        return {
            status: 400,
            body: { error: 'Missing required field: message' }
        };
    }

    return {
        textOrParams: message,
        messageType: messageType || 'text'
    };
}

async function executeInstanceSend(instanceId, body = {}, { interactiveFocus = false } = {}) {
    const { to } = body;
    if (!to) {
        return {
            status: 400,
            body: { error: 'Missing required field: to' }
        };
    }

    const payload = buildOutboundPayload(body, { interactiveFocus });
    if (payload.status) {
        return payload;
    }

    const result = await instanceManager.sendMessage(
        instanceId,
        to,
        payload.textOrParams,
        buildSendOptions(body)
    );

    return {
        status: 200,
        body: {
            success: true,
            messageType: payload.messageType || 'text',
            delivery: payload.delivery,
            message_id: result.key?.id || null,
            message_status: result.key?.id ? (result.status != null ? normalizeMessageStatus(result.status) || 'pending' : 'pending') : null,
            result
        }
    };
}

function resolveSendMessageType(messageType, body = {}) {
    const explicitType = String(messageType || '').trim().toLowerCase();
    if (explicitType) return explicitType;
    if (Array.isArray(body.buttons) && body.buttons.length > 0) return 'buttons';
    if (Array.isArray(body.sections) && body.sections.length > 0) return 'list';
    return 'text';
}

function normalizeInteractivePayload(messageType, body = {}, message) {
    if (messageType === 'buttons') {
        if (!message) {
            throw new Error('Missing required field: message or text');
        }
        if (!Array.isArray(body.buttons) || body.buttons.length === 0) {
            throw new Error('Missing required field: buttons');
        }
        if (body.buttons.length > 3) {
            throw new Error('WhatsApp quick-reply buttons support a maximum of 3 buttons');
        }
        return {
            buttons: body.buttons.map((button, index) => {
                const text = String(button?.text || button?.title || '').trim();
                if (!text) {
                    throw new Error(`Button ${index + 1} is missing text`);
                }
                return {
                    id: String(button?.id || `btn_${index + 1}`).trim(),
                    text: text.slice(0, 20)
                };
            })
        };
    }

    if (messageType === 'list') {
        if (!Array.isArray(body.sections) || body.sections.length === 0) {
            throw new Error('Missing required field: sections');
        }
        return {
            sections: body.sections.map((section, sectionIndex) => ({
                title: String(section?.title || `Section ${sectionIndex + 1}`).trim(),
                rows: Array.isArray(section?.rows)
                    ? section.rows.map((row, rowIndex) => ({
                        title: String(row?.title || `Option ${rowIndex + 1}`).trim(),
                        id: String(row?.id || `row_${sectionIndex + 1}_${rowIndex + 1}`).trim(),
                        description: String(row?.description || '').trim()
                    }))
                    : []
            }))
        };
    }

    return {};
}

/**
 * POST /api/send
 * Global send endpoint - finds instance by 'from_phone' number
 * Supports rich messages: image, video, document, audio, buttons, list, location, contact
 */
app.post('/api/send', async (req, res) => {
    try {
        const fromPhone = req.body.from_phone || req.body.from;
        const toPhone = req.body.to_phone || req.body.to;
        const message = req.body.message ?? req.body.text;
        const messageType = resolveSendMessageType(req.body.messageType, req.body);
        
        if (!toPhone) {
            return res.status(400).json({ error: 'Missing required field: to_phone' });
        }

        const payload = buildOutboundPayload(req.body, {
            interactiveFocus: shouldUseMessageBuilder(req.body, messageType)
        });
        if (payload.status) {
            return res.status(payload.status).json(payload.body);
        }
        const textOrParams = payload.textOrParams;
        const options = buildSendOptions(req.body);
        
        let targetInstanceId = null;
        let matchedInstance = null;
        
        if (fromPhone) {
            const instances = instanceManager.getAllInstances();
            console.log(`[API /send] Looking for from_phone: ${fromPhone}`);
            
            const normalizedFrom = normalizePhone(fromPhone);
            
            matchedInstance = instances.find(i => {
                if (!i.connectedPhone || i.status !== 'connected') return false;
                const normalizedConnected = normalizePhone(i.connectedPhone);
                return normalizedConnected.endsWith(normalizedFrom) || 
                       normalizedFrom.endsWith(normalizedConnected) ||
                       normalizedConnected === normalizedFrom;
            });
            
            if (!matchedInstance) {
                return res.status(400).json({ 
                    error: `No connected instance found for phone number: ${fromPhone}`,
                    hint: 'Make sure the phone number is connected and matches exactly',
                    debug: { 
                        searchedFor: normalizedFrom,
                        availableInstances: instances.map(i => ({
                            id: i.id,
                            status: i.status,
                            phone: i.connectedPhone
                        }))
                    }
                });
            }
            
            targetInstanceId = matchedInstance.id;
        } else {
            const instances = instanceManager.getAllInstances();
            matchedInstance = instances.find(i => i.status === 'connected');
            
            if (!matchedInstance) {
                return res.status(400).json({ error: 'No connected instances available' });
            }
            
            targetInstanceId = matchedInstance.id;
        }
        
        const result = await instanceManager.sendMessage(targetInstanceId, toPhone, textOrParams, options);
        
        res.json([{
            message_id: result.key?.id || crypto.randomUUID(),
            created_at: new Date().toISOString(),
            from_phone: normalizePhone(matchedInstance.connectedPhone),
            to_phone: normalizePhone(toPhone),
            message: message || payload.delivery?.mode || `[${messageType || 'text'}]`,
            message_type: payload.messageType || messageType || 'text',
            status: !result.sent
                ? (result.reason?.includes('Rate') ? 'rate_limited' : 'failed')
                : (normalizeMessageStatus(result.status) || 'pending')
        }]);
    } catch (error) {
        // Check if error indicates a ban or connection issue
        const errorMsg = error.message.toLowerCase();
        let status = 'failed';
        if (errorMsg.includes('rate') || errorMsg.includes('limit')) {
            status = 'rate_limited';
        } else if (errorMsg.includes('ban') || errorMsg.includes('blocked')) {
            status = 'banned';
        } else if (errorMsg.includes('connect') || errorMsg.includes('disconnect')) {
            status = 'disconnected';
        }
        
        res.status(400).json({ 
            error: error.message,
            status: status
        });
    }
});

/**
 * GET /api/numbers
 * Get list of all connected phone numbers (for webhook integration)
 */
app.get('/api/numbers', (req, res) => {
    const instances = instanceManager ? instanceManager.getAllInstances() : [];
    const numbers = instances
        .filter(i => i.status === 'connected' && i.connectedPhone)
        .map(i => ({
            phone: normalizePhone(i.connectedPhone),
            instanceId: i.id,
            name: i.name
        }));
    
    res.json({ 
        success: true,
        count: numbers.length,
        numbers 
    });
});

// ========================================
// INSTANCE LOGS API
// ========================================

/**
 * GET /api/instances/:id/logs
 * Get activity logs for instance
 */
app.get('/api/instances/:id/logs', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        res.json({ 
            success: true, 
            logs: instance.activityLog.slice(0, limit) 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// BEHAVIOR SETTINGS API (Typing Simulation, Delays)
// ========================================

/**
 * GET /api/instances/:id/behavior
 * Get behavior settings for instance (typing simulation, delays)
 */
app.get('/api/instances/:id/behavior', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        res.json({ 
            success: true, 
            behaviorSettings: instance.behaviorSettings
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/behavior
 * Update behavior settings for instance
 * Body: { behaviorProfile?, typingSimulation?, delayEnabled?, phoneNotificationsEnabled?, notificationGraceMs? }
 * Any subset may be sent; omitted keys are left unchanged.
 */
app.put('/api/instances/:id/behavior', async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const behaviorSettings = {};
        if (body.behaviorProfile !== undefined) behaviorSettings.behaviorProfile = body.behaviorProfile;
        if (body.profile !== undefined) behaviorSettings.profile = body.profile;
        if (body.typingSimulation !== undefined) behaviorSettings.typingSimulation = body.typingSimulation;
        if (body.delayEnabled !== undefined) behaviorSettings.delayEnabled = body.delayEnabled;
        if (body.phoneNotificationsEnabled !== undefined) behaviorSettings.phoneNotificationsEnabled = body.phoneNotificationsEnabled;
        if (body.notificationGraceMs !== undefined) behaviorSettings.notificationGraceMs = body.notificationGraceMs;

        const instance = await instanceManager.updateInstance(req.params.id, {
            behaviorSettings,
        });
        
        broadcastToAll({
            type: 'instance_updated',
            data: instance
        });
        
        res.json({ 
            success: true, 
            behaviorSettings: instance.behaviorSettings,
            message: 'Behavior settings updated'
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// ANTI-BAN API
// ========================================

/**
 * GET /api/instances/:id/anti-ban
 * Get anti-ban health for instance
 */
app.get('/api/instances/:id/anti-ban', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        res.json({ 
            success: true, 
            settings: instance.antiBanSettings,
            health: instance.antiBanManager.getHealth() 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/anti-ban
 * Update anti-ban settings for instance
 * Body: { preset?, messagesPerHour?, messagesPerDay?, uniqueChatsPerHour?, uniqueChatsPerDay? }
 */
app.put('/api/instances/:id/anti-ban', async (req, res) => {
    try {
        const { preset, messagesPerHour, messagesPerDay, uniqueChatsPerHour, uniqueChatsPerDay } = req.body;
        
        // Build antiBanSettings object
        const { PRESETS } = await import('./src/utils/anti-ban.js');
        let antiBanSettings;
        
        if (preset && PRESETS[preset]) {
            antiBanSettings = { preset, ...PRESETS[preset] };
        } else if (preset === 'custom') {
            antiBanSettings = {
                preset: 'custom',
                messagesPerHour: messagesPerHour || 50,
                messagesPerDay: messagesPerDay || 300,
                uniqueChatsPerHour: uniqueChatsPerHour || 25,
                uniqueChatsPerDay: uniqueChatsPerDay || 100
            };
        } else {
            antiBanSettings = {};
            if (messagesPerHour) antiBanSettings.messagesPerHour = messagesPerHour;
            if (messagesPerDay) antiBanSettings.messagesPerDay = messagesPerDay;
            if (uniqueChatsPerHour) antiBanSettings.uniqueChatsPerHour = uniqueChatsPerHour;
            if (uniqueChatsPerDay) antiBanSettings.uniqueChatsPerDay = uniqueChatsPerDay;
        }
        
        const instance = await instanceManager.updateInstance(req.params.id, { antiBanSettings });
        
        res.json({ 
            success: true, 
            settings: instance.antiBanSettings,
            health: instanceManager.getInstance(req.params.id).antiBanManager.getHealth()
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// ANTI-BAN v2 API (Wasup transport anti-ban pipeline)
// ========================================

/**
 * GET /api/instances/:id/antiban-v2
 * Full v2 status: config + health + warmup + rate-limiter + retry tracker +
 * session stability + LID resolver stats.
 */
app.get('/api/instances/:id/antiban-v2', (req, res) => {
    try {
        const data = instanceManager.getAntibanV2(req.params.id);
        res.json({ success: true, antibanV2: data });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/antiban-v2/config
 * Just the per-instance config block.
 */
app.get('/api/instances/:id/antiban-v2/config', (req, res) => {
    try {
        const data = instanceManager.getAntibanV2(req.params.id);
        res.json({ success: true, config: data?.config || null });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/antiban-v2/config
 * Update preset, overrides, or module flags.
 *
 * Body shapes (all optional):
 *   { enabled?: boolean,
 *     preset?: 'conservative' | 'moderate' | 'aggressive',
 *     overrides?: { maxPerMinute, maxPerHour, maxPerDay, minDelayMs, maxDelayMs, ... },
 *     modules?: { warmup: { enabled }, replyRatio: { enabled }, ... },
 *     alertsWebhook?: 'https://...' | null }
 *
 * Hot-reloads rate limits when possible. Other fields take effect on next reconnect.
 */
app.put('/api/instances/:id/antiban-v2/config', async (req, res) => {
    try {
        const result = await instanceManager.updateAntibanV2(req.params.id, req.body || {});
        broadcastToAll({ type: 'antibanV2_updated', instanceId: req.params.id, data: result });
        res.json({ success: true, antibanV2: result, message: 'Config updated. Some fields take effect on reconnect.' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/antiban-v2/health
 * Compact health view: { risk, score, recommendation, isPaused, reasons }
 */
app.get('/api/instances/:id/antiban-v2/health', (req, res) => {
    try {
        const data = instanceManager.getAntibanV2(req.params.id);
        if (!data || !data.running) {
            return res.json({ success: true, health: null, message: 'Anti-ban v2 not running for this instance' });
        }
        res.json({ success: true, health: data.health });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/antiban-v2/warmup
 * Compact warmup view: { phase, day, totalDays, todayLimit, todaySent, progress, complete }
 */
app.get('/api/instances/:id/antiban-v2/warmup', (req, res) => {
    try {
        const data = instanceManager.getAntibanV2(req.params.id);
        if (!data || !data.running) {
            return res.json({ success: true, warmup: null, message: 'Anti-ban v2 not running for this instance' });
        }
        res.json({ success: true, warmup: data.warmup });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/antiban-v2/lid-mappings
 * Snapshot of the LID↔PN cache (size + sample).
 */
app.get('/api/instances/:id/antiban-v2/lid-mappings', (req, res) => {
    try {
        const data = instanceManager.getLidMappings(req.params.id);
        res.json({ success: true, lidMappings: data });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/antiban-v2/pause
 * Manual emergency pause. All sends will be blocked until /resume.
 */
app.post('/api/instances/:id/antiban-v2/pause', (req, res) => {
    try {
        const result = instanceManager.pauseAntibanV2(req.params.id);
        broadcastToAll({ type: 'antibanV2_paused', instanceId: req.params.id });
        res.json({ success: true, antibanV2: result, message: 'Anti-ban v2 paused — sends blocked' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/antiban-v2/resume
 */
app.post('/api/instances/:id/antiban-v2/resume', (req, res) => {
    try {
        const result = instanceManager.resumeAntibanV2(req.params.id);
        broadcastToAll({ type: 'antibanV2_resumed', instanceId: req.params.id });
        res.json({ success: true, antibanV2: result, message: 'Anti-ban v2 resumed' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/antiban-v2/warmup
 * Body: { action: 'graduate' } — lift day-1 warm-up caps without reconnecting.
 */
app.post('/api/instances/:id/antiban-v2/warmup', async (req, res) => {
    try {
        const action = req.body?.action || 'graduate';
        if (action !== 'graduate') {
            return res.status(400).json({ error: 'Unsupported action. Use { action: "graduate" }.' });
        }
        const result = await instanceManager.graduateWarmupAntiban(req.params.id);
        broadcastToAll({ type: 'antibanV2_warmup', instanceId: req.params.id, action });
        res.json({ success: true, antibanV2: result, message: 'Warm-up graduated — daily send cap lifted.' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/antiban-v2/reset
 * Nuclear reset — clears warmup, rate-limit history, health stats, retry-tracker
 * state. Use after serving a real ban period. Fingerprint is preserved.
 */
app.post('/api/instances/:id/antiban-v2/reset', async (req, res) => {
    try {
        const result = await instanceManager.resetAntibanV2(req.params.id);
        broadcastToAll({ type: 'antibanV2_reset', instanceId: req.params.id });
        res.json({ success: true, antibanV2: result, message: 'Anti-ban v2 state wiped (fingerprint kept)' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// PROXY CONFIGURATION API
// ========================================

/**
 * GET /api/proxy
 * Get this deployment's default proxy (from env vars).
 * Applied to any instance that doesn't have its own override.
 */
app.get('/api/proxy', (req, res) => {
    const cfg = getDeploymentDefaultProxy();
    const pool = instanceManager.getProxyPoolStatus();
    res.json({
        success: true,
        region: process.env.REGION_CODE || null,
        deploymentDefault: redactProxy(cfg),
        deploymentDefaultConfigured: !!cfg,
        deploymentDefaultSource: cfg ? (process.env.DEFAULT_PROXY_URL ? 'env:DEFAULT_PROXY_URL' : 'env:DEFAULT_PROXY_HOST') : null,
        pool, // { enabled, total, used, free, entries:[...] }
        hint: !cfg && !pool.enabled
            ? 'Set DEFAULT_PROXY_URL or PROXY_POOL on this App Service to configure proxies.'
            : undefined,
    });
});

/**
 * GET /api/proxy/pool
 * Detailed pool state: every slot with its current assignment.
 */
app.get('/api/proxy/pool', (req, res) => {
    const pool = instanceManager.getProxyPoolStatus();
    if (!pool.enabled) {
        return res.json({
            success: true,
            enabled: false,
            message: 'No PROXY_POOL configured on this deployment. Pool auto-assignment is off.',
            pool,
        });
    }
    res.json({ success: true, enabled: true, pool });
});

/**
 * POST /api/proxy/pool/reconcile
 * Rebuild pool assignments. Useful after changing the PROXY_POOL env var or
 * when you want to retroactively hand slots to existing direct-connection
 * instances (e.g. created before the pool was set up).
 */
app.post('/api/proxy/pool/reconcile', async (req, res) => {
    try {
        const result = await instanceManager.reconcileProxyPool();
        broadcastToAll({ type: 'proxy_pool_reconciled', data: result });
        res.json({
            success: true,
            message: `Pool reconciled: ${result.reassigned.length} reassigned, ${result.orphaned.length} orphaned.`,
            ...result,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/proxy/pool/entries
 * Add a new proxy to the pool at runtime. No restart needed, doesn't affect
 * existing instances. Idempotent on host:port (duplicates return added=false).
 *
 * Body accepts any of:
 *   { url: "http://user:pass@host:port" }        URL form
 *   { shorthand: "host:port:user:pass" }         Webshare shorthand line
 *   { host, port, username?, password?, type? } Structured (type defaults to http)
 *   { entries: [ ... ] }                         Bulk add (array of any form above)
 *
 * By default, after add, we reconcile the pool so any direct-connection
 * instance oldest-first can claim the new slot. Set `reconcile:false` in the
 * body to skip that (the new slot stays free until a new instance is created).
 */
app.post('/api/proxy/pool/entries', async (req, res) => {
    try {
        const body = req.body || {};

        // Normalize into an array of inputs
        let inputs;
        if (Array.isArray(body.entries)) {
            inputs = body.entries;
        } else if (body.url || body.shorthand || body.host) {
            inputs = [body.shorthand || body.url || body];
        } else {
            return res.status(400).json({
                error: 'Missing proxy. Provide one of: url, shorthand, {host,port,username,password}, or entries: [...]',
            });
        }

        const results = [];
        for (const inp of inputs) {
            try {
                const r = await instanceManager.addProxyToPool(inp);
                results.push({ ok: true, added: r.added, slot: r.slot });
            } catch (err) {
                results.push({ ok: false, error: err.message, input: typeof inp === 'string' ? inp : JSON.stringify(inp) });
            }
        }

        // Retroactively hand new slots to direct-connection instances unless disabled
        let reconciled = null;
        if (body.reconcile !== false) {
            reconciled = await instanceManager.reconcileProxyPool();
        }

        const pool = instanceManager.getProxyPoolStatus();
        broadcastToAll({ type: 'proxy_pool_updated', data: pool });

        res.status(201).json({
            success: results.every(r => r.ok),
            results,
            reconciled,
            pool,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/proxy/pool/entries/:slotId
 * Remove a pool slot by id (host:port format, e.g. "212.212.18.198:6849").
 * If the slot is currently assigned to an instance, that instance is bounced
 * and — if other free slots exist — re-assigned automatically.
 *
 * Pass ?confirm=true to acknowledge removing an assigned slot.
 */
app.delete('/api/proxy/pool/entries/:slotId', async (req, res) => {
    try {
        const slotId = decodeURIComponent(req.params.slotId);
        const confirm = req.query.confirm === 'true' || req.query.confirm === '1';

        // Peek first to see if it's assigned
        const current = instanceManager.getProxyPoolStatus();
        const entry = (current.entries || []).find(e => e.id === slotId);
        if (!entry) {
            return res.status(404).json({ error: `Pool slot ${slotId} not found` });
        }
        if (entry.assignedTo && !confirm) {
            return res.status(409).json({
                error: 'Slot is currently in use',
                slotId,
                assignedTo: entry.assignedTo,
                hint: 'Re-call with ?confirm=true to remove anyway. The affected instance will reconnect (possibly direct) within seconds.',
            });
        }

        const result = await instanceManager.removeProxyFromPool(slotId);
        broadcastToAll({ type: 'proxy_pool_updated', data: result.pool });

        res.json({
            success: true,
            removed: result.removed,
            wasAssignedTo: result.wasAssignedTo || null,
            pool: result.pool,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/proxy/test
 * Test the deployment-level default proxy (or supplied one) by making an HTTPS HEAD request
 * through it. Returns 200 if the upstream responds, plus timing info.
 * Body (optional): { url: "http://user:pass@proxy:8080", target?: "https://web.whatsapp.com/" }
 */
app.post('/api/proxy/test', async (req, res) => {
    try {
        let cfg;
        if (req.body?.url || req.body?.host) {
            cfg = parseProxyConfig(req.body.url || req.body);
        } else {
            cfg = getDeploymentDefaultProxy();
        }
        if (!cfg) {
            return res.status(400).json({ error: 'No proxy configured and none supplied in request body.' });
        }

        const target = req.body?.target || 'https://web.whatsapp.com/';
        const agent = createProxyAgent(cfg);
        const start = Date.now();
        const response = await axios.get(target, {
            httpsAgent: agent,
            httpAgent: agent,
            timeout: 15000,
            validateStatus: () => true,
            maxRedirects: 0,
        });
        const elapsedMs = Date.now() - start;

        res.json({
            success: true,
            proxy: redactProxy(cfg),
            target,
            responseStatus: response.status,
            elapsedMs,
            message: `Proxy reached ${target} (HTTP ${response.status}) in ${elapsedMs}ms`,
        });
    } catch (error) {
        res.status(502).json({
            success: false,
            error: error.message,
            code: error.code || null,
            message: 'Proxy test failed — the upstream was unreachable through the supplied proxy.',
        });
    }
});

/**
 * GET /api/instances/:id/proxy
 * Get per-instance proxy state:
 *   - override:  the instance-level override (null = inheriting deployment default)
 *   - effective: what's actually in use right now (deployment default if no override)
 *   - source:    'instance' | 'deployment' | 'disabled' | 'none'
 */
app.get('/api/instances/:id/proxy', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        res.json({ success: true, proxy: instance.getProxyStatus() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/proxy
 * Set per-instance proxy. Automatically reconnects if the instance is currently connected.
 *
 * Body shapes:
 *   { url: "http://user:pass@proxy.example.com:8080" }    -> use this proxy
 *   { url: "socks5://proxy.example.com:1080" }            -> SOCKS5 also supported
 *   { type, host, port, username?, password? }            -> structured form
 *   { enabled: false }                                    -> explicitly disable (ignore deployment default)
 *   null / {}                                             -> clear override, inherit deployment default
 */
app.put('/api/instances/:id/proxy', async (req, res) => {
    try {
        const body = req.body || {};
        let proxyArg;
        if (body.enabled === false) {
            proxyArg = { enabled: false };
        } else if (body.url || body.shorthand || body.host) {
            proxyArg = buildProxyAttachArg(body);
        } else if (Object.keys(body).length === 0) {
            proxyArg = null;
        } else {
            return res.status(400).json({
                error: 'Missing proxy. Provide url, shorthand (host:port:user:pass), or {host,port,username,password}.',
            });
        }

        const result = await instanceManager.setInstanceProxy(req.params.id, proxyArg);

        broadcastToAll({
            type: 'instance_updated',
            data: instanceManager.getInstance(req.params.id).getStatus(),
        });

        res.json({ success: true, proxy: result, message: 'Proxy updated. Instance will reconnect if it was online.' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/proxy/verify
 * Probe the outbound egress IP through this instance's effective proxy agent.
 * If the proxy is working, the echoed IP should be the proxy's upstream IP
 * (e.g. a Webshare residential IP), NOT the Azure App Service's outbound IP.
 *
 * Body (optional):
 *   { target: "https://api.ipify.org?format=json" }   // default
 *   { target: "https://ifconfig.co/json" }
 *
 * Returns:
 *   { success, egressIp, proxySource, proxy, active, elapsedMs, httpStatus }
 */
app.post('/api/instances/:id/proxy/verify', async (req, res) => {
    try {
        const body = req.body || {};
        const target = body.target;
        if (body.url || body.shorthand || body.host) {
            const cfg = parseFlexibleProxyInput(body.shorthand || body.url || body);
            if (!cfg) {
                return res.status(400).json({ error: 'Invalid proxy config for verification.' });
            }
            const result = await instanceManager.verifyProxyConfig(cfg, target);
            return res.json({ success: true, dryRun: true, ...result });
        }
        const result = await instanceManager.verifyInstanceProxy(req.params.id, target);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

/**
 * DELETE /api/instances/:id/proxy
 * Clear the per-instance override so the instance falls back to the deployment default.
 */
app.delete('/api/instances/:id/proxy', async (req, res) => {
    try {
        const result = await instanceManager.setInstanceProxy(req.params.id, null);

        broadcastToAll({
            type: 'instance_updated',
            data: instanceManager.getInstance(req.params.id).getStatus(),
        });

        res.json({ success: true, proxy: result, message: 'Per-instance proxy override cleared.' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// WEBHOOK CONFIGURATION API
// ========================================

/**
 * GET /api/webhook
 * Get global default webhook URL
 */
app.get('/api/webhook', (req, res) => {
    res.json({
        success: true,
        message: 'Webhooks are configured per-instance. Use GET /api/instances/:id/webhook to check.'
    });
});

/**
 * GET /api/instances/:id/webhook
 * Get webhook configuration for instance
 */
app.get('/api/instances/:id/webhook', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const status = instance.getStatus();
        res.json({
            success: true,
            webhookUrl: status.webhookUrl || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/webhook
 * Set webhook URL for instance
 * Body: { webhookUrl: "https://..." } or { webhookUrl: null } to use global default
 */
app.put('/api/instances/:id/webhook', async (req, res) => {
    try {
        const { webhookUrl } = req.body;
        
        const instance = await instanceManager.updateInstance(req.params.id, { 
            webhookUrl: webhookUrl || '' 
        });
        
        broadcastToAll({
            type: 'instance_updated',
            data: instance
        });
        
        res.json({
            success: true,
            webhookUrl: instance.webhookUrl || null,
            message: instance.webhookUrl 
                ? 'Instance webhook URL set' 
                : 'No webhook configured - messages will be logged only'
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// WHITELABEL API
// ========================================

/**
 * POST /api/onboard
 * Single-call create + connect + configure for whitelabel customers
 * Body: { phone, name?, webhookUrl?, profileName?, profileStatus? }
 */
app.post('/api/onboard', async (req, res) => {
    try {
        const { phone, name, webhookUrl, profileName, profileStatus, behaviorSettings } = req.body;
        
        if (!phone) {
            return res.status(400).json({ error: 'Missing required field: phone' });
        }
        
        // Check if an instance with this phone already exists and is connected
        const allInstances = instanceManager.getAllInstances();
        const existing = allInstances.find(i => i.connectedPhone === phone.replace(/^\+/, ''));
        if (existing) {
            // If the caller passed behaviorSettings, apply them on top of the
            // existing instance so notification-critical onboards can be flipped
            // on without recreating the instance.
            if (behaviorSettings && typeof behaviorSettings === 'object') {
                try {
                    await instanceManager.updateInstance(existing.id, { behaviorSettings });
                } catch (e) {
                    console.warn(`[Onboard] Failed to apply behaviorSettings to existing ${existing.id}:`, e.message);
                }
            }
            return res.json({
                success: true,
                instanceId: existing.id,
                pairingCode: null,
                status: existing.status,
                message: 'Instance already exists for this phone number'
            });
        }
        
        // Create instance (with optional behaviorSettings for clinic / human-monitored verticals)
        const instance = await instanceManager.createInstance({
            name: name || `WhatsApp ${phone}`,
            webhookUrl: webhookUrl || '',
            ...(behaviorSettings && typeof behaviorSettings === 'object' ? { behaviorSettings } : {}),
        });
        
        broadcastToAll({ type: 'instance_created', data: instance });
        
        // Update webhook if provided (already set during creation, but also on the raw instance)
        const rawInstance = instanceManager.getInstance(instance.id);
        
        // Connect with pairing code
        const cleanPhone = phone.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
        await instanceManager.connectInstance(instance.id, { pairingPhone: cleanPhone });
        const status = rawInstance.getStatus();
        
        // Set profile if provided (will apply once connected)
        if (profileName || profileStatus) {
            const applyProfile = async () => {
                try {
                    if (profileName) await rawInstance.updateProfileName(profileName);
                    if (profileStatus) await rawInstance.updateProfileStatus(profileStatus);
                } catch (e) {
                    console.error(`[Onboard] Profile update failed for ${instance.id}:`, e.message);
                }
            };
            
            if (rawInstance.status === 'connected') {
                await applyProfile();
            } else {
                const origHandler = rawInstance.onStatusChange;
                rawInstance.onStatusChange = (id, newStatus) => {
                    if (origHandler) origHandler(id, newStatus);
                    if (newStatus.status === 'connected') {
                        applyProfile();
                        rawInstance.onStatusChange = origHandler;
                    }
                };
            }
        }
        
        registerWorkerInstance(status, { controlPlaneInstanceId: instance.id });

        res.status(201).json({
            success: true,
            instanceId: instance.id,
            pairingCode: status.pairingCode || null,
            status: status.status,
            message: status.pairingCode 
                ? `Enter code ${status.pairingCode} in WhatsApp > Linked Devices > Link a Device`
                : 'Connection started'
        });
    } catch (error) {
        console.error('[API] Onboard error:', error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/connection
 * Clean polling endpoint for connection status
 */
app.get('/api/instances/:id/connection', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const status = instance.getStatus();
        const uptime = status.connectedAt 
            ? Math.floor((Date.now() - new Date(status.connectedAt).getTime()) / 1000)
            : null;
        
        res.json({
            success: true,
            status: status.status,
            phone: status.connectedPhone || null,
            connectedAt: status.connectedAt || null,
            uptime,
            pairingCode: status.pairingCode || null,
            qrCode: status.qrCode || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/messages/:messageId/status
 * Poll outbound delivery/read status for a message sent by this instance.
 */
app.get('/api/instances/:id/messages/:messageId/status', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        const tracked = instance.getMessageStatus(req.params.messageId);
        if (!tracked) {
            return res.status(404).json({
                error: 'Message status not found',
                hint: 'Status is tracked for outbound messages sent after this worker version was deployed, or while the instance is still connected.'
            });
        }

        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            instanceId: req.params.id,
            message_id: tracked.messageId,
            status: tracked.status,
            status_at: tracked.statusAt,
            sent_at: tracked.sentAt,
            from_phone: tracked.fromPhone,
            to_phone: tracked.toPhone,
            preview: tracked.preview,
            updates: tracked.updates
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/messages
 * Get message history with filtering
 * Query: ?direction=inbound|outbound  &limit=50  &since=ISO_timestamp
 */
app.get('/api/instances/:id/messages', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const filters = {};
        if (req.query.direction) filters.direction = req.query.direction;
        if (req.query.limit) filters.limit = parseInt(req.query.limit, 10);
        if (req.query.since) filters.since = req.query.since;
        
        const messages = instance.getMessages(filters);
        
        res.json({
            success: true,
            count: messages.length,
            messages
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/webhook/test
 * Send a test payload to the configured webhook URL
 */
app.post('/api/instances/:id/webhook/test', async (req, res) => {
    let webhookUrl;
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        webhookUrl = instance.webhookUrl;
        
        if (!webhookUrl) {
            return res.status(400).json({ 
                error: 'No webhook URL configured for this instance',
                hint: 'Set webhookUrl via PUT /api/instances/:id or during onboarding'
            });
        }
        
        const testPayload = {
            event: 'test',
            instanceId: instance.id,
            timestamp: new Date().toISOString(),
            message: 'This is a test webhook delivery from your WhatsApp instance',
            data: {
                from: '0000000000',
                text: 'Hello! This is a test message.',
                direction: 'inbound'
            }
        };
        
        const response = await axios.post(webhookUrl, testPayload, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true
        });
        
        const success = response.status >= 200 && response.status < 300;
        
        res.json({
            success,
            webhookUrl,
            responseStatus: response.status,
            responseBody: typeof response.data === 'string' 
                ? response.data.substring(0, 500) 
                : response.data,
            message: success 
                ? 'Webhook test delivered successfully' 
                : `Webhook returned status ${response.status}`
        });
    } catch (error) {
        res.json({
            success: false,
            webhookUrl: webhookUrl || null,
            error: error.message,
            message: 'Failed to deliver test webhook'
        });
    }
});

// ========================================
// PROFILE API
// ========================================

/**
 * GET /api/instances/:id/profile
 * Get current profile info (name, phone, about)
 */
app.get('/api/instances/:id/profile', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const status = instance.getStatus();
        res.json({
            success: true,
            profile: {
                phone: status.connectedPhone,
                connected: status.status === 'connected'
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/profile/name
 * Update WhatsApp display name (push name visible to everyone)
 * Body: { name: "Your Business Name" }
 */
app.put('/api/instances/:id/profile/name', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        await instance.updateProfileName(name);
        res.json({ success: true, message: `Display name updated to "${name}"` });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/profile/picture
 * Update WhatsApp profile picture
 * Body: { imageUrl: "https://example.com/photo.jpg" }
 */
app.put('/api/instances/:id/profile/picture', async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ error: 'Missing required field: imageUrl' });
        }
        
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        await instance.updateProfilePicture(imageUrl);
        res.json({ success: true, message: 'Profile picture updated' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/instances/:id/profile/picture
 * Remove WhatsApp profile picture
 */
app.delete('/api/instances/:id/profile/picture', async (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        await instance.removeProfilePicture();
        res.json({ success: true, message: 'Profile picture removed' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/instances/:id/profile/status
 * Update WhatsApp "About" text
 * Body: { status: "We reply within minutes!" }
 */
app.put('/api/instances/:id/profile/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (status === undefined) {
            return res.status(400).json({ error: 'Missing required field: status' });
        }
        
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        await instance.updateProfileStatus(status);
        res.json({ success: true, message: `About text updated to "${status}"` });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// HUMAN HANDOFF API
// ========================================

/**
 * GET /api/instances/:id/handoff
 * Get all chats currently in human handoff mode
 */
app.get('/api/instances/:id/handoff', (req, res) => {
    const instance = instanceManager.getInstance(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    
    res.json({
        success: true,
        instanceId: instance.id,
        settings: instance.handoffSettings,
        humanModeChats: instance.getHandoffChats()
    });
});

/**
 * POST /api/instances/:id/handoff
 * Tag or untag a chat for human handoff
 * Body: { phone: "60123456789", active: true|false }
 */
app.post('/api/instances/:id/handoff', (req, res) => {
    const instance = instanceManager.getInstance(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    
    const { phone, jid, active } = req.body;
    const target = jid || phone;
    if (!target) return res.status(400).json({ error: 'Missing required field: phone or jid' });
    if (active === undefined) return res.status(400).json({ error: 'Missing required field: active (true/false)' });
    
    instance.setHandoff(target, !!active);
    
    res.json({
        success: true,
        phone: target,
        humanMode: !!active,
        humanModeChats: instance.getHandoffChats()
    });
});

/**
 * DELETE /api/instances/:id/handoff
 * Clear all human handoff tags (resume bot for all chats)
 */
app.delete('/api/instances/:id/handoff', (req, res) => {
    const instance = instanceManager.getInstance(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    
    const count = instance.humanModeChats.size;
    instance.humanModeChats.clear();
    instance._log(`All human handoffs cleared (${count} chats)`, 'success');
    instance._emitStatusChange();
    
    res.json({ success: true, cleared: count });
});

/**
 * GET /api/instances/:id/handoff/settings
 * Get current handoff settings (resume keywords, resume message)
 */
app.get('/api/instances/:id/handoff/settings', (req, res) => {
    const instance = instanceManager.getInstance(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.json({ success: true, settings: instance.handoffSettings });
});

/**
 * PUT /api/instances/:id/handoff/settings
 * Update handoff settings
 * Body: { resumeKeywords?: string[], resumeMessage?: string }
 */
app.put('/api/instances/:id/handoff/settings', async (req, res) => {
    const instance = instanceManager.getInstance(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });

    const { resumeKeywords, resumeMessage } = req.body;
    if (resumeKeywords !== undefined) {
        if (!Array.isArray(resumeKeywords) || resumeKeywords.length === 0) {
            return res.status(400).json({ error: 'resumeKeywords must be a non-empty array of strings' });
        }
        instance.handoffSettings.resumeKeywords = resumeKeywords.map(k => String(k));
    }
    if (resumeMessage !== undefined) {
        instance.handoffSettings.resumeMessage = String(resumeMessage);
    }

    await instanceManager._saveInstances();
    instance._log(`Handoff settings updated: keywords=[${instance.handoffSettings.resumeKeywords.join(', ')}]`, 'info');
    res.json({ success: true, settings: instance.handoffSettings });
});

// ========================================
// MEDIA / STORAGE API
// ========================================

/**
 * GET /api/storage/status
 * Check Azure Blob Storage connectivity
 */
app.get('/api/storage/status', (req, res) => {
    res.json({ success: true, enabled: isStorageEnabled(), container: process.env.AZURE_STORAGE_CONTAINER || 'whatsapp-media' });
});

/**
 * POST /api/upload
 * Upload a file to Azure Blob Storage via base64 payload.
 * Body: { data: "base64...", mimeType: "image/jpeg", fileName?: "photo.jpg", instanceId?: "wa_xxx" }
 */
app.post('/api/upload', async (req, res) => {
    if (!isStorageEnabled()) {
        return res.status(503).json({ error: 'Azure Blob Storage not configured. Set AZURE_STORAGE_CONNECTION_STRING in .env' });
    }
    const { data, mimeType, fileName, instanceId } = req.body;
    if (!data) return res.status(400).json({ error: 'data (base64 string) is required' });
    if (!mimeType) return res.status(400).json({ error: 'mimeType is required (e.g. image/jpeg)' });

    try {
        const buffer = Buffer.from(data, 'base64');
        const ext = fileName
            ? fileName.split('.').pop()
            : mimeType.split('/')[1]?.split(';')[0] || 'bin';
        const result = await uploadMedia(buffer, {
            extension: ext,
            mimeType,
            instanceId: instanceId || 'manual',
            folder: 'uploads'
        });
        if (!result) return res.status(500).json({ error: 'Upload failed' });
        res.json({ success: true, url: result.url, blobName: result.blobName });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/instances/:id/media
 * List stored media for an instance (inbound + outbound saved on worker disk).
 */
app.get('/api/instances/:id/media', async (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) return res.status(404).json({ error: 'Instance not found' });

        const mediaType = req.query.type || req.query.mediaType || undefined;
        const limit = Number(req.query.limit || 50);
        const media = await listMedia(req.params.id, {
            mediaType: typeof mediaType === 'string' ? mediaType : undefined,
            limit: Number.isFinite(limit) ? limit : 50,
        });

        res.json({ success: true, count: media.length, media });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/instances/:id/media/:mediaId
 * Download one stored media file by id from an inbound webhook or media list.
 */
app.get('/api/instances/:id/media/:mediaId', async (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) return res.status(404).json({ error: 'Instance not found' });

        const resolved = await resolveMediaBuffer(req.params.id, req.params.mediaId);
        if (!resolved) return res.status(404).json({ error: 'Media not found' });

        const fileName = resolved.entry.fileName || `${req.params.mediaId}.bin`;
        res.setHeader('Content-Type', resolved.entry.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
        res.send(resolved.buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// GENERAL API ENDPOINTS
// ========================================

/**
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
    if (!instanceManager) {
        return res.json({
            status: 'starting',
            uptime: process.uptime(),
            instances: { total: 0, connected: 0 },
        });
    }
    const instances = instanceManager.getAllInstances();
    const connectedCount = instances.filter(i => i.status === 'connected').length;
    
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        instances: {
            total: instances.length,
            connected: connectedCount
        }
    });
});

/**
 * GET /api/status
 * Get overall system status (backward compatible)
 */
app.get('/api/status', (req, res) => {
    if (!instanceManager) {
        return res.json({ success: true, instanceCount: 0, instances: [], note: 'starting' });
    }
    const instances = instanceManager.getAllInstances();
    res.json({
        success: true,
        instanceCount: instances.length,
        instances: instances.map(i => ({
            id: i.id,
            name: i.name,
            status: i.status,
            phone: i.connectedPhone
        }))
    });
});

/**
 * POST /api/system/reload-behavior-from-disk
 * Re-read instances.json and apply behaviorSettings to in-memory instances (no process restart).
 */
app.post('/api/system/reload-behavior-from-disk', async (req, res) => {
    try {
        if (!instanceManager) {
            return res.status(503).json({ success: false, error: 'Instance manager not ready' });
        }
        const out = await instanceManager.reloadBehaviorSettingsFromDisk();
        res.json(out);
    } catch (error) {
        console.error('[API] reload-behavior-from-disk:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/reload-instances
 * Manually trigger instance loading from disk (for Railway volume mount timing issues)
 */
app.post('/api/reload-instances', async (req, res) => {
    try {
        console.log('[API] Manual instance reload triggered');
        await instanceManager._loadInstances();
        const instances = instanceManager.getAllInstances();
        res.json({
            success: true,
            message: `Loaded ${instances.length} instances`,
            instances: instances.map(i => ({
                id: i.id,
                name: i.name,
                status: i.status
            }))
        });
    } catch (error) {
        console.error('[API] Instance reload error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/generate-api-key
 * Generate a new API key (admin only)
 */
app.post('/api/generate-api-key', (req, res) => {
    const newKey = crypto.randomBytes(32).toString('hex');
    res.json({
        success: true,
        apiKey: newKey,
        message: 'Add this to your .env file as API_KEY=<key>'
    });
});

/**
 * POST /api/restore-instances
 * Restore instances from backup file (for deployment recovery)
 */
app.post('/api/restore-instances', async (req, res) => {
    try {
        const backupPath = path.join(__dirname, 'instances-backup.json');
        const instancesDir = path.join(__dirname, 'instances');
        const instancesFile = path.join(instancesDir, 'instances.json');
        
        // Check if backup exists
        if (!fsSync.existsSync(backupPath)) {
            return res.status(404).json({ 
                error: 'Backup file not found',
                path: backupPath
            });
        }
        
        // Read backup
        const backupData = await fs.readFile(backupPath, 'utf8');
        const instances = JSON.parse(backupData);
        
        // Create instances directory
        await fs.mkdir(instancesDir, { recursive: true });
        
        // Create folder structure for each instance
        for (const instance of instances) {
            const instanceDir = path.join(instancesDir, instance.id);
            const authDir = path.join(instanceDir, 'auth');
            const logsDir = path.join(instanceDir, 'logs');
            
            await fs.mkdir(authDir, { recursive: true });
            await fs.mkdir(logsDir, { recursive: true });
        }
        
        // Write instances.json
        await fs.writeFile(instancesFile, JSON.stringify(instances, null, 2));
        
        res.json({
            success: true,
            message: `Restored ${instances.length} instances. Restart the app to load them.`,
            instances: instances.map(i => ({ id: i.id, name: i.name }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/backup-status
 * Check if backup file exists and instances are configured
 */
app.get('/api/backup-status', async (req, res) => {
    const backupPath = path.join(__dirname, 'instances-backup.json');
    const instancesFile = path.join(__dirname, 'instances', 'instances.json');
    
    const status = {
        backupExists: fsSync.existsSync(backupPath),
        instancesExists: fsSync.existsSync(instancesFile),
        backupCount: 0,
        activeCount: 0
    };
    
    try {
        if (status.backupExists) {
            const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
            status.backupCount = backup.length;
        }
        if (status.instancesExists) {
            const instances = JSON.parse(await fs.readFile(instancesFile, 'utf8'));
            status.activeCount = instances.length;
        }
    } catch (e) {
        // ignore parse errors
    }
    
    res.json(status);
});

/**
 * GET /api/export-all-credentials
 * Export ALL instance data including auth credentials for backup
 */
app.get('/api/export-all-credentials', async (req, res) => {
    try {
        const instancesDir = path.join(__dirname, 'instances');
        const instancesFile = path.join(instancesDir, 'instances.json');
        
        if (!fsSync.existsSync(instancesFile)) {
            return res.status(404).json({ error: 'No instances found' });
        }
        
        const instances = JSON.parse(await fs.readFile(instancesFile, 'utf8'));
        const fullBackup = {
            exportedAt: new Date().toISOString(),
            instances: [],
            credentials: {}
        };
        
        for (const instance of instances) {
            fullBackup.instances.push(instance);
            const authDir = path.join(instancesDir, instance.id, 'auth');
            if (fsSync.existsSync(authDir)) {
                const authFiles = await fs.readdir(authDir);
                fullBackup.credentials[instance.id] = {};
                for (const file of authFiles) {
                    const filePath = path.join(authDir, file);
                    const stat = await fs.stat(filePath);
                    if (stat.isFile()) {
                        const content = await fs.readFile(filePath, 'utf8');
                        fullBackup.credentials[instance.id][file] = content;
                    }
                }
            }
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=whatsapp-full-backup-${Date.now()}.json`);
        res.json(fullBackup);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/import-all-credentials
 * Import ALL instance data including auth credentials from backup
 */
app.post('/api/import-all-credentials', async (req, res) => {
    try {
        const backup = req.body;
        
        if (!backup || !backup.instances || !backup.credentials) {
            return res.status(400).json({ error: 'Invalid backup format. Need instances and credentials.' });
        }
        
        const instancesDir = path.join(__dirname, 'instances');
        const instancesFile = path.join(instancesDir, 'instances.json');
        
        await fs.mkdir(instancesDir, { recursive: true });
        await fs.writeFile(instancesFile, JSON.stringify(backup.instances, null, 2));
        
        let restoredCount = 0;
        for (const instance of backup.instances) {
            const instanceDir = path.join(instancesDir, instance.id);
            const authDir = path.join(instanceDir, 'auth');
            const logsDir = path.join(instanceDir, 'logs');
            
            await fs.mkdir(authDir, { recursive: true });
            await fs.mkdir(logsDir, { recursive: true });
            
            if (backup.credentials[instance.id]) {
                for (const [filename, content] of Object.entries(backup.credentials[instance.id])) {
                    const filePath = path.join(authDir, filename);
                    await fs.writeFile(filePath, content);
                }
                restoredCount++;
            }
        }
        
        res.json({
            success: true,
            message: `Restored ${backup.instances.length} instances with ${restoredCount} credential sets. RESTART THE APP to reconnect.`,
            instances: backup.instances.map(i => ({ id: i.id, name: i.name }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// WEBSOCKET HANDLING
// ========================================

wss.on('connection', (ws, req) => {
    console.log('[WS] Client connected');
    
    // Initialize client state
    wsClients.set(ws, {
        subscribedInstances: new Set(),
        authenticated: !API_KEY, // When API_KEY is set, wait for { type:'auth' } before full init + broadcasts
        hostname: getHostnameFromRequest(req),
    });
    
    // Initial payload: hide instance metadata on the socket until authenticated
    const instances = instanceManager.getAllInstances();
    const hideInstancesUntilAuth = Boolean(API_KEY) && !ALLOW_PUBLIC_DASHBOARD;
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            instances: hideInstancesUntilAuth ? [] : instances,
            requiresAuth: hideInstancesUntilAuth,
        },
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            void handleWebSocketMessage(ws, data).catch((error) => {
                console.error('[WS] Message handling failed:', error);
                ws.send(JSON.stringify({ type: 'auth_failed' }));
            });
        } catch (error) {
            console.error('[WS] Invalid message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('[WS] Client disconnected');
        wsClients.delete(ws);
    });
});

async function handleWebSocketMessage(ws, data) {
    const clientState = wsClients.get(ws);
    
    switch (data.type) {
        case 'auth':
            // Authenticate WebSocket client (API key or admin password)
            const customerAuth = await validateCustomerApiKeyForHost(
                data.apiKey,
                clientState.hostname,
                'instances:read'
            );
            if (
                data.apiKey === API_KEY ||
                data.apiKey === WORKER_SHARED_SECRET ||
                data.apiKey === ADMIN_PASSWORD ||
                customerAuth.valid
            ) {
                clientState.authenticated = true;
                ws.send(JSON.stringify({ type: 'auth_success' }));
                if (API_KEY && instanceManager) {
                    ws.send(JSON.stringify({
                        type: 'init',
                        data: {
                            instances: instanceManager.getAllInstances(),
                            requiresAuth: true,
                        },
                    }));
                }
            } else {
                ws.send(JSON.stringify({ type: 'auth_failed' }));
            }
            break;
            
        case 'subscribe':
            // Subscribe to specific instance updates
            if (data.instanceId) {
                clientState.subscribedInstances.add(data.instanceId);
            }
            break;
            
        case 'unsubscribe':
            // Unsubscribe from instance updates
            if (data.instanceId) {
                clientState.subscribedInstances.delete(data.instanceId);
            }
            break;
            
        case 'subscribe_all':
            // Subscribe to all instances
            const instances = instanceManager.getAllInstances();
            instances.forEach(i => clientState.subscribedInstances.add(i.id));
            break;
    }
}

/**
 * Broadcast to all connected WebSocket clients
 */
function broadcastToAll(data) {
    console.log(`[WS] Broadcasting to ALL:`, data.type);
    const message = JSON.stringify(data);
    let sentCount = 0;
    wsClients.forEach((clientState, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            if (API_KEY && !clientState.authenticated) return;
            ws.send(message);
            sentCount++;
        }
    });
    console.log(`[WS] Sent to ${sentCount} clients`);
}

/**
 * Broadcast to clients subscribed to a specific instance
 */
function broadcastToInstance(instanceId, data) {
    console.log(`[WS] Broadcasting to instance ${instanceId}:`, data.type);
    const message = JSON.stringify(data);
    let sentCount = 0;
    wsClients.forEach((clientState, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            if (API_KEY && !clientState.authenticated) return;
            // Send to all clients when they're subscribed to all (empty set) or to this specific instance
            if (clientState.subscribedInstances.size === 0 || clientState.subscribedInstances.has(instanceId)) {
                ws.send(message);
                sentCount++;
            }
        }
    });
    console.log(`[WS] Sent to ${sentCount} clients`);
}

// ========================================
// START SERVER
// ========================================

server.listen(PORT, async () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║       WhatsApp AI Bot - Multi-Instance API Server          ║
╚════════════════════════════════════════════════════════════╝

🌐 Web UI:      http://localhost:${PORT}
🔌 API Base:    http://localhost:${PORT}/api
🔐 Auth:        ${API_KEY ? 'API Key Required' : 'Open (set API_KEY in .env for production)'}

API Endpoints:
  POST   /api/instances              Create new instance
  GET    /api/instances              List all instances
  GET    /api/instances/:id          Get instance details
  PUT    /api/instances/:id          Update instance
  DELETE /api/instances/:id          Delete instance
  
  POST   /api/instances/:id/connect     Start connection
  POST   /api/instances/:id/disconnect  Disconnect
  POST   /api/instances/:id/clear-auth  Clear credentials
  GET    /api/instances/:id/qr          Get QR code
  
  POST   /api/instances/:id/send        Send message via specific instance
  POST   /api/send                      Send message (by 'from' phone or instanceId)
  GET    /api/numbers                   List all connected phone numbers
  
  GET    /api/instances/:id/logs        Get activity logs
  GET    /api/instances/:id/anti-ban    Get anti-ban status
  PUT    /api/instances/:id/anti-ban    Update anti-ban settings
  
  GET    /api/health                    Health check
  GET    /api/status                    System status

Initializing...
    `);
    
    // Initialize Azure Blob Storage (optional public URLs) + local media index
    await initMediaStorage();
    await initAzureStorage();

    // Initialize instance manager
    instanceManager = new InstanceManager();
    await instanceManager.init();
    
    // Set up event handlers
    instanceManager.onStatusChange = (instanceId, status) => {
        console.log(`[Event] Status change for ${instanceId}: ${status.status}, hasQR: ${!!status.qrCode}`);
        if (isControlPlaneReportingEnabled()) {
            reportConnectionStatus(instanceId, status);
        }
        broadcastToInstance(instanceId, {
            type: 'instance_status',
            data: status
        });
    };
    
    instanceManager.onMessage = (data) => {
        if (isControlPlaneReportingEnabled()) {
            reportMessageEvent(data.instanceId, {
                direction: data.direction || (data.fromMe ? 'outbound' : 'inbound'),
                phone: data.phone || data.from,
                body: data.body || data.text || data.message,
                externalMessageId: data.messageId || data.id,
                status: data.status,
                metadata: data.metadata || {},
            });
        }
        broadcastToInstance(data.instanceId, {
            type: 'message',
            data
        });
    };
    
    instanceManager.onLog = (instanceId, entry) => {
        if (isControlPlaneReportingEnabled()) {
            reportActivityLog(instanceId, entry);
        }
        broadcastToInstance(instanceId, {
            type: 'log',
            instanceId,
            data: entry
        });
    };

    instanceManager.onInstanceCreated = (status, config) => {
        registerWorkerInstance(status, { controlPlaneInstanceId: config?.id || null });
    };

    if (isControlPlaneRegistryEnabled()) {
        console.log('[Server] Control plane instance registry enabled — worker creates will sync to dev.wasup');
        syncWorkerInstanceCatalog(instanceManager.getAllInstances());
    }
    
    console.log(`[Server] Ready! ${instanceManager.getAllInstances().length} instances loaded.`);

    if (typeof process.send === 'function') {
        try {
            process.send('ready');
        } catch (_) {
            /* ignore */
        }
    }
});

let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Server] ${signal} — graceful shutdown (closing HTTP, then WhatsApp sockets)...`);

    await new Promise((resolve) => {
        const t = setTimeout(resolve, 45000);
        server.close(() => {
            clearTimeout(t);
            resolve();
        });
    });

    if (instanceManager) {
        try {
            await instanceManager.shutdown();
        } catch (e) {
            console.error('[Server] instanceManager.shutdown error:', e.message);
        }
    }
    process.exit(0);
}

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT').catch((e) => {
        console.error(e);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM').catch((e) => {
        console.error(e);
        process.exit(1);
    });
});

let sighupReloadBusy = false;
process.on('SIGHUP', () => {
    if (process.env.WASUP_SIGHUP_BEHAVIOR_RELOAD !== '1') {
        console.log('[Server] SIGHUP received (ignored). Set WASUP_SIGHUP_BEHAVIOR_RELOAD=1 to reload behaviorSettings from instances.json without restart.');
        return;
    }
    if (sighupReloadBusy || !instanceManager) return;
    sighupReloadBusy = true;
    instanceManager
        .reloadBehaviorSettingsFromDisk()
        .then((out) => {
            console.log('[Server] SIGHUP behavior reload:', JSON.stringify(out));
        })
        .catch((e) => {
            console.error('[Server] SIGHUP behavior reload failed:', e.message);
        })
        .finally(() => {
            sighupReloadBusy = false;
        });
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
