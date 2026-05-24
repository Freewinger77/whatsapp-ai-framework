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

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Instance Manager
import { InstanceManager } from './src/utils/instance-manager.js';
import axios from 'axios';
import {
    getDeploymentDefaultProxy,
    redactProxy,
    createProxyAgent,
    parseProxyConfig,
    parseFlexibleProxyInput,
} from './src/utils/proxy.js';

// ========================================
// CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ''; // Optional API key for external access
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_WEBHOOK_URL = process.env.DEFAULT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';
const ALLOW_PUBLIC_DASHBOARD = ['true', '1', 'yes'].includes(
    (process.env.ALLOW_PUBLIC_DASHBOARD || '').toLowerCase()
);
const DOCS_REVEAL_PASSWORD = process.env.DOCS_REVEAL_PASSWORD || ADMIN_PASSWORD || '';
const VALID_BEHAVIOR_PROFILES = new Set(['bot-native', 'notification-balanced', 'notification-max']);
const MAX_MESSAGE_LENGTH = 4096;
const MAX_BUTTONS = 3;
const MAX_BUTTON_TEXT_LENGTH = 20;
const WASUP_WORKER_SHARED_SECRET = process.env.WASUP_WORKER_SHARED_SECRET || '';
const WASUP_WORKER_MODE = (process.env.WASUP_WORKER_MODE || 'multi').toLowerCase();
const REGION_CODE = process.env.REGION_CODE || null;
const WASUP_ORG_ID = process.env.WASUP_ORG_ID || null;
const WASUP_DATA_DIR = process.env.WASUP_DATA_DIR || null;

// ========================================
// STATE MANAGEMENT
// ========================================

let instanceManager = null;
const wsClients = new Map(); // Map of WebSocket -> { subscribedInstances: Set }

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

let _openapiCache = null;
function loadOpenapiYaml() {
    if (_openapiCache !== null) return _openapiCache;
    try {
        _openapiCache = fsSync.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8');
    } catch (err) {
        console.error('[OpenAPI] Failed to read openapi.yaml:', err.message);
        _openapiCache = '';
    }
    return _openapiCache;
}

function buildDynamicOpenapiYaml(req) {
    const yaml = loadOpenapiYaml();
    if (!yaml) return null;

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`).toString().split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    const region = REGION_CODE || null;

    const dynamicServers = [
        'servers:',
        `  - url: ${baseUrl}`,
        `    description: ${region ? `Region "${region}"` : 'This deployment'}`,
        '',
    ].join('\n');

    return yaml.replace(
        /^servers:[\s\S]*?(?=^[a-zA-Z][a-zA-Z0-9_-]*:)/m,
        dynamicServers
    );
}

function getPublicBaseUrl(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`).toString().split(',')[0].trim();
    return `${proto}://${host}`;
}

app.get('/openapi.yaml', (req, res) => {
    const rewritten = buildDynamicOpenapiYaml(req);
    if (!rewritten) {
        return res.status(500).type('text/plain').send('# openapi.yaml unavailable');
    }
    res.type('application/yaml').send(rewritten);
});

app.get('/api/openapi.yaml', (req, res) => {
    const rewritten = buildDynamicOpenapiYaml(req);
    if (!rewritten) {
        return res.status(500).type('text/plain').send('# openapi.yaml unavailable');
    }
    res.type('application/yaml').send(rewritten);
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.get('/api/docs/config', (req, res) => {
    res.json({
        success: true,
        unlockEnabled: Boolean(DOCS_REVEAL_PASSWORD),
        apiKeyConfigured: Boolean(API_KEY),
        region: REGION_CODE,
    });
});

app.post('/api/docs/unlock', (req, res) => {
    try {
        if (!DOCS_REVEAL_PASSWORD) {
            return res.status(503).json({
                success: false,
                error: 'Docs key reveal is not configured on this deployment',
            });
        }
        const submitted = String(req.body?.password || '').trim();
        if (submitted !== DOCS_REVEAL_PASSWORD) {
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }
        res.json({
            success: true,
            baseUrl: getPublicBaseUrl(req),
            apiKey: API_KEY || '',
            regionCode: REGION_CODE,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get('/playground', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
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

/**
 * Authenticate API requests
 * Supports: API Key (X-API-Key header) or Bearer token (Authorization header)
 */
function getRequestOrigin(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req.protocol || 'http')
        .split(',')[0]
        .trim();
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host || '')
        .split(',')[0]
        .trim();
    return host ? `${protocol}://${host}` : '';
}

function isSameOriginDashboardRequest(req) {
    if (!ALLOW_PUBLIC_DASHBOARD) {
        return false;
    }

    if (req.headers['sec-fetch-site'] === 'same-origin') {
        return true;
    }

    const requestOrigin = getRequestOrigin(req);
    if (!requestOrigin) {
        return false;
    }

    if (req.headers.origin && req.headers.origin === requestOrigin) {
        return true;
    }

    if (req.headers.referer) {
        try {
            return new URL(req.headers.referer).origin === requestOrigin;
        } catch (error) {
            return false;
        }
    }

    return false;
}

function extractAuthToken(req) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) return apiKey;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    return null;
}

function resolveRouteInstanceId(req) {
    if (req.params?.id) return req.params.id;
    const bodyId = req.body?.instanceId || req.body?.instance_id;
    if (bodyId) return String(bodyId);
    return null;
}

function authenticateAPI(req, res, next) {
    if (req.path === '/health' || req.path.startsWith('/internal') || req.path.startsWith('/docs')) {
        return next();
    }

    const openApi = !API_KEY;
    if (openApi) {
        req.auth = { type: 'open' };
        return next();
    }

    if (isSameOriginDashboardRequest(req)) {
        req.auth = { type: 'dashboard' };
        return next();
    }

    const token = extractAuthToken(req);

    if (API_KEY && token === API_KEY) {
        req.auth = { type: 'deployment' };
        return next();
    }

    if (ADMIN_PASSWORD && token === ADMIN_PASSWORD) {
        req.auth = { type: 'admin' };
        return next();
    }

    if (token && instanceManager) {
        const routeInstanceId = resolveRouteInstanceId(req);
        const match = instanceManager.verifyApiKeyAccess(token, routeInstanceId);
        if (match) {
            req.auth = { type: 'instance', instanceId: match.instanceId };
            return next();
        }

        // Allow instance key on routes without :id if it maps to exactly one instance
        if (!routeInstanceId) {
            const anyMatch = instanceManager.verifyApiKeyAccess(token);
            if (anyMatch) {
                req.auth = { type: 'instance', instanceId: anyMatch.instanceId };
                return next();
            }
        }
    }

    res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid deployment API key or per-instance wsp_v3_* key required.',
    });
}

function authorizeInstanceScope(req, res, next) {
    if (!req.auth || ['deployment', 'admin', 'dashboard', 'open', 'internal'].includes(req.auth.type)) {
        return next();
    }
    if (req.auth.type === 'instance') {
        const routeId = req.params.id;
        if (routeId && routeId !== req.auth.instanceId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'This API key is scoped to a different instance.',
            });
        }
    }
    next();
}

function authenticateInternal(req, res, next) {
    if (!WASUP_WORKER_SHARED_SECRET) {
        return res.status(503).json({ error: 'Internal API not configured' });
    }
    const secret = req.headers['x-wasup-worker-secret'] || extractAuthToken(req);
    if (secret !== WASUP_WORKER_SHARED_SECRET) {
        return res.status(401).json({ error: 'Unauthorized internal call' });
    }
    req.auth = { type: 'internal' };
    next();
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeHttpUrl(value, fieldName, errors) {
    const url = normalizeText(value);
    if (!url) {
        errors.push(`${fieldName}.url is required`);
        return '';
    }

    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            errors.push(`${fieldName}.url must start with http:// or https://`);
            return '';
        }
        return parsed.toString();
    } catch (error) {
        errors.push(`${fieldName}.url must be a valid URL`);
        return '';
    }
}

function normalizeLinkField(body, errors) {
    const rawLink = body.link ?? body.linkUrl;
    if (rawLink === undefined || rawLink === null || rawLink === '') {
        return null;
    }

    if (typeof rawLink === 'string') {
        const url = normalizeHttpUrl(rawLink, 'link', errors);
        return url ? { url } : null;
    }

    if (!isPlainObject(rawLink)) {
        errors.push('link must be a URL string or an object with url');
        return null;
    }

    const url = normalizeHttpUrl(rawLink.url, 'link', errors);
    return url ? {
        url,
        label: normalizeText(rawLink.label || rawLink.text || rawLink.title)
    } : null;
}

function normalizeCtaUrlField(body, errors) {
    const rawCta = body.ctaUrl ?? body.urlButton ?? body.linkButton;
    if (rawCta === undefined || rawCta === null || rawCta === '') {
        return null;
    }

    if (typeof rawCta === 'string') {
        const url = normalizeHttpUrl(rawCta, 'ctaUrl', errors);
        return url ? { url, label: 'Open link' } : null;
    }

    if (!isPlainObject(rawCta)) {
        errors.push('ctaUrl must be a URL string or an object with url and label/text');
        return null;
    }

    const url = normalizeHttpUrl(rawCta.url, 'ctaUrl', errors);
    const label = normalizeText(rawCta.label || rawCta.text || rawCta.title || 'Open link');
    if (label.length > 25) {
        errors.push('ctaUrl label/text must be 25 characters or fewer');
    }

    return url ? { url, label: label || 'Open link' } : null;
}

function normalizeButtonsField(body, errors) {
    if (body.buttons === undefined || body.buttons === null) {
        return [];
    }

    if (!Array.isArray(body.buttons)) {
        errors.push('buttons must be an array');
        return [];
    }

    if (body.buttons.length > MAX_BUTTONS) {
        errors.push(`buttons supports at most ${MAX_BUTTONS} items`);
    }

    const seenIds = new Set();
    return body.buttons.slice(0, MAX_BUTTONS).map((button, index) => {
        if (!isPlainObject(button)) {
            errors.push(`buttons[${index}] must be an object`);
            return null;
        }

        const text = normalizeText(button.text || button.title || button.label);
        const id = normalizeText(button.id || button.buttonId || text.toLowerCase().replace(/[^a-z0-9]+/g, '_'));

        if (!text) {
            errors.push(`buttons[${index}].text is required`);
        } else if (text.length > MAX_BUTTON_TEXT_LENGTH) {
            errors.push(`buttons[${index}].text must be ${MAX_BUTTON_TEXT_LENGTH} characters or fewer`);
        }

        if (!id) {
            errors.push(`buttons[${index}].id is required`);
        } else if (id.length > MAX_BUTTON_ID_LENGTH) {
            errors.push(`buttons[${index}].id must be ${MAX_BUTTON_ID_LENGTH} characters or fewer`);
        } else if (seenIds.has(id)) {
            errors.push(`buttons[${index}].id must be unique`);
        }

        seenIds.add(id);
        return text && id ? { id, text } : null;
    }).filter(Boolean);
}

function parseMessagePayload(body) {
    const errors = [];
    const rawText = body.message ?? body.text;
    let text = normalizeText(rawText);
    const link = normalizeLinkField(body, errors);
    const ctaUrl = normalizeCtaUrlField(body, errors);
    const buttons = normalizeButtonsField(body, errors);
    const footer = normalizeText(body.footer);

    if (rawText !== undefined && typeof rawText !== 'string') {
        errors.push('message/text must be a string');
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
        errors.push(`message/text must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }
    if (body.linkPreview !== undefined && typeof body.linkPreview !== 'boolean') {
        errors.push('linkPreview must be a boolean when provided');
    }

    if (!text) {
        if (link?.label) {
            text = link.label;
        } else if (ctaUrl?.label) {
            text = ctaUrl.label;
        } else if (link?.url || ctaUrl?.url) {
            text = 'Open this link';
        } else if (buttons.length > 0) {
            text = 'Please choose an option';
        }
    }

    if (!text && !link?.url && !ctaUrl?.url && buttons.length === 0) {
        errors.push('Missing message content: provide message/text, link, ctaUrl, or buttons');
    }

    if (errors.length > 0) {
        return { errors };
    }

    return {
        messagePayload: {
            text,
            link,
            ctaUrl,
            buttons,
            footer,
            linkPreview: body.linkPreview !== false
        }
    };
}

function parseReactionPayload(body) {
    const errors = [];
    const to = normalizeText(body.to || body.to_phone);
    const emoji = body.emoji ?? body.reaction ?? '';

    if (typeof emoji !== 'string') {
        errors.push('emoji must be a string');
    }

    let key = body.key;
    if (!key) {
        const messageId = normalizeText(body.messageId || body.message_id || body.id);
        if (!messageId) {
            errors.push('messageId or key is required');
        }
        if (!to) {
            errors.push('to is required when key is not provided');
        }

        key = {
            id: messageId,
            fromMe: Boolean(body.fromMe ?? body.from_me ?? false)
        };

        const participant = normalizeText(body.participant);
        if (participant) {
            key.participant = participant;
        }
        const remoteJid = normalizeText(body.remoteJid || body.remote_jid);
        if (remoteJid) {
            key.remoteJid = remoteJid;
        }
    } else if (!isPlainObject(key) || !normalizeText(key.id)) {
        errors.push('key must be an object with id');
    }

    if (errors.length > 0) {
        return { errors };
    }

    return { to, emoji, key };
}

function parseSendOptions(body) {
    const { messagePayload, errors } = parseMessagePayload(body);
    if (errors) {
        return { errors };
    }

    if (body.behaviorProfile !== undefined && !VALID_BEHAVIOR_PROFILES.has(body.behaviorProfile)) {
        return {
            errors: [`behaviorProfile must be one of: ${Array.from(VALID_BEHAVIOR_PROFILES).join(', ')}`]
        };
    }

    const options = { messagePayload };
    const optionFields = [
        'behaviorProfile',
        'typingSimulation',
        'delayEnabled',
        'phoneNotificationsEnabled',
        'notificationGraceMs',
        'contactName',
        'skipContactSave'
    ];

    for (const field of optionFields) {
        if (body[field] !== undefined) {
            options[field] = body[field];
        }
    }

    return { options, messagePayload };
}

app.get('/api/dashboard-config', (req, res) => {
    res.json({
        success: true,
        allowPublicDashboard: ALLOW_PUBLIC_DASHBOARD,
        dashboardRequiresApiKey: !!API_KEY && !ALLOW_PUBLIC_DASHBOARD
    });
});

app.get('/api/health', (req, res) => {
    const instances = instanceManager?.getAllInstances?.() || [];
    const connectedCount = instances.filter(i => i.status === 'connected').length;
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        workerMode: WASUP_WORKER_MODE,
        region: REGION_CODE,
        dataDir: WASUP_DATA_DIR,
        instances: {
            total: instances.length,
            connected: connectedCount,
        },
    });
});

app.use('/api/internal', authenticateInternal);
app.post('/api/internal/heartbeat', (req, res) => {
    res.json({
        success: true,
        orgId: WASUP_ORG_ID,
        region: REGION_CODE,
        workerMode: WASUP_WORKER_MODE,
        instances: instanceManager.getAllInstances().map(i => ({
            id: i.id,
            status: i.status,
            phone: i.connectedPhone,
            proxySource: i.proxy?.source,
            apiKey: i.apiKey,
        })),
    });
});

// Apply authentication to all API routes
app.use('/api', authenticateAPI);
app.use('/api/instances/:id', authorizeInstanceScope);

// ========================================
// INSTANCE MANAGEMENT API
// ========================================

/**
 * GET /api/instances
 * List all WhatsApp instances
 */
app.get('/api/instances', (req, res) => {
    try {
        if (req.auth?.type === 'instance') {
            const inst = instanceManager.getInstance(req.auth.instanceId);
            const instances = inst ? [inst.getStatus()] : [];
            return res.json({
                success: true,
                count: instances.length,
                instances,
            });
        }

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
        const {
            id,
            name,
            webhookUrl,
            antiBanSettings,
            apiKey,
            generateApiKey,
        } = req.body;

        if (req.auth?.type === 'instance') {
            return res.status(403).json({ error: 'Instance-scoped API keys cannot create instances' });
        }
        
        const instance = await instanceManager.createInstance({
            id,
            name,
            webhookUrl,
            antiBanSettings,
            apiKey,
            generateApiKey: generateApiKey === true || generateApiKey === 'true',
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
 * POST /api/instances/:id/api-key/rotate
 */
app.post('/api/instances/:id/api-key/rotate', async (req, res) => {
    try {
        if (req.auth?.type === 'instance' && req.auth.instanceId !== req.params.id) {
            return res.status(403).json({ error: 'Forbidden for this instance key' });
        }
        const result = await instanceManager.rotateInstanceApiKey(req.params.id);
        res.json({ success: true, ...result, showOnce: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/instances/:id/api-key
 */
app.delete('/api/instances/:id/api-key', async (req, res) => {
    try {
        if (req.auth?.type === 'instance') {
            return res.status(403).json({ error: 'Use deployment key to clear instance API keys' });
        }
        const result = await instanceManager.clearInstanceApiKey(req.params.id);
        res.json({ success: true, ...result });
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
 * PUT /api/instances/:id
 * Update instance settings
 * Body: { name?, webhookUrl?, antiBanSettings? }
 */
app.put('/api/instances/:id', async (req, res) => {
    try {
        const { name, webhookUrl, antiBanSettings } = req.body;
        
        const instance = await instanceManager.updateInstance(req.params.id, {
            name,
            webhookUrl,
            antiBanSettings
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
        await instanceManager.deleteInstance(req.params.id);
        
        broadcastToAll({
            type: 'instance_deleted',
            data: { id: req.params.id }
        });
        
        res.json({ 
            success: true, 
            message: `Instance ${req.params.id} deleted` 
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
 * Start WhatsApp connection for instance
 */
app.post('/api/instances/:id/connect', async (req, res) => {
    console.log(`[API] Connect request for instance: ${req.params.id}`);
    try {
        const instance = await instanceManager.connectInstance(req.params.id);
        console.log(`[API] Connect successful for: ${req.params.id}`);
        res.json({ 
            success: true, 
            message: 'Connection started',
            instance 
        });
    } catch (error) {
        console.error(`[API] Connect error for ${req.params.id}:`, error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/disconnect
 * Disconnect instance
 */
app.post('/api/instances/:id/disconnect', async (req, res) => {
    try {
        const revoke = req.body?.revoke === true;
        const instance = await instanceManager.disconnectInstance(req.params.id, { revoke });
        res.json({ 
            success: true, 
            message: revoke ? 'Logged out and session revoked' : 'Disconnected',
            instance 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/pair
 * Connect using pairing code (alternative to QR)
 * Body: { phoneNumber: "447393002183" }
 */
app.post('/api/instances/:id/pair', async (req, res) => {
    console.log(`[API] Pairing code request for instance: ${req.params.id}`);
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Missing required field: phoneNumber (with country code, e.g. "447393002183")' });
        }
        
        const result = await instanceManager.connectInstanceWithPairingCode(req.params.id, phoneNumber);
        
        console.log(`[API] Pairing code generated for: ${req.params.id}`);
        res.json({ 
            success: true, 
            pairingCode: result.code,
            message: `Enter this code on WhatsApp: ${result.code}. Go to WhatsApp > Linked Devices > Link a Device > Link with phone number`,
            instance: result.instance
        });
    } catch (error) {
        console.error(`[API] Pairing code error for ${req.params.id}:`, error.message);
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
 * Get QR code for instance (if connecting)
 */
app.get('/api/instances/:id/qr', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }
        
        const status = instance.getStatus();
        
        if (status.status === 'connected') {
            return res.json({ 
                success: true, 
                status: 'connected',
                phone: status.connectedPhone,
                message: 'Already connected'
            });
        }
        
        if (!status.qrCode) {
            return res.json({ 
                success: true, 
                status: status.status,
                qrCode: null,
                message: 'QR code not yet generated. Call /connect first.'
            });
        }
        
        res.json({ 
            success: true, 
            status: status.status,
            qrCode: status.qrCode
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
        const { to } = req.body;
        
        if (!to) {
            return res.status(400).json({ error: 'Missing required field: to' });
        }

        const { options, messagePayload, errors } = parseSendOptions(req.body);
        if (errors) {
            return res.status(400).json({
                error: 'Invalid send payload',
                details: errors
            });
        }
        
        const result = await instanceManager.sendMessage(req.params.id, to, messagePayload.text, options);
        
        res.json({ 
            success: true, 
            result 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/send/interactive
 * Alias for interactive-capable sends. Uses the same payload as /send,
 * but is easier to discover in OpenAPI and smoke checks.
 */
app.post('/api/instances/:id/send/interactive', async (req, res) => {
    try {
        const { to } = req.body;

        if (!to) {
            return res.status(400).json({ error: 'Missing required field: to' });
        }

        const { options, messagePayload, errors } = parseSendOptions(req.body);
        if (errors) {
            return res.status(400).json({
                error: 'Invalid send payload',
                details: errors
            });
        }

        const result = await instanceManager.sendMessage(req.params.id, to, messagePayload.text, options);

        res.json({
            success: true,
            result
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/instances/:id/react
 * React to a WhatsApp message
 * Body: { to, messageId, emoji, fromMe?, participant?, key? }
 */
app.post('/api/instances/:id/react', async (req, res) => {
    try {
        const parsed = parseReactionPayload(req.body);
        if (parsed.errors) {
            return res.status(400).json({
                error: 'Invalid reaction payload',
                details: parsed.errors
            });
        }

        const result = await instanceManager.sendReaction(req.params.id, parsed.to, {
            emoji: parsed.emoji,
            key: parsed.key
        });

        res.json({ success: true, result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/react
 * React via auto-selected or from_phone matched instance
 */
app.post('/api/react', async (req, res) => {
    try {
        const parsed = parseReactionPayload(req.body);
        if (parsed.errors) {
            return res.status(400).json({
                error: 'Invalid reaction payload',
                details: parsed.errors
            });
        }

        const fromPhone = req.body.from_phone || req.body.from;
        const instances = instanceManager.getAllInstances();
        let matchedInstance = null;

        if (fromPhone) {
            const normalizedFrom = normalizePhone(fromPhone);
            matchedInstance = instances.find((instance) => {
                if (!instance.connectedPhone || instance.status !== 'connected') return false;
                const normalizedConnected = normalizePhone(instance.connectedPhone);
                return normalizedConnected.endsWith(normalizedFrom)
                    || normalizedFrom.endsWith(normalizedConnected)
                    || normalizedConnected === normalizedFrom;
            });

            if (!matchedInstance) {
                return res.status(400).json({
                    error: `No connected instance found for phone number: ${fromPhone}`
                });
            }
        } else {
            matchedInstance = instances.find((instance) => instance.status === 'connected');
            if (!matchedInstance) {
                return res.status(400).json({ error: 'No connected instances available' });
            }
        }

        const result = await instanceManager.sendReaction(matchedInstance.id, parsed.to, {
            emoji: parsed.emoji,
            key: parsed.key
        });

        res.json({
            success: true,
            instanceId: matchedInstance.id,
            result
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ========================================
// PROXY CONFIGURATION API
// ========================================

app.get('/api/proxy', (req, res) => {
    const cfg = getDeploymentDefaultProxy();
    const pool = instanceManager.getProxyPoolStatus();
    res.json({
        success: true,
        region: process.env.REGION_CODE || null,
        deploymentDefault: redactProxy(cfg),
        deploymentDefaultConfigured: !!cfg,
        pool,
    });
});

app.get('/api/proxy/pool', (req, res) => {
    const pool = instanceManager.getProxyPoolStatus();
    res.json({
        success: true,
        enabled: pool.enabled,
        pool,
        message: pool.enabled
            ? undefined
            : 'No PROXY_POOL configured. Pool auto-assignment is off.',
    });
});

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

app.post('/api/proxy/pool/entries', async (req, res) => {
    try {
        const body = req.body || {};
        let inputs;
        if (Array.isArray(body.entries)) {
            inputs = body.entries;
        } else if (body.url || body.shorthand || body.host) {
            inputs = [body.shorthand || body.url || body];
        } else {
            return res.status(400).json({
                error: 'Missing proxy. Provide url, shorthand (host:port:user:pass), {host,port,...}, or entries: [...]',
            });
        }

        const results = [];
        for (const inp of inputs) {
            try {
                const r = await instanceManager.addProxyToPool(inp);
                results.push({ ok: true, added: r.added, slot: r.slot });
            } catch (err) {
                results.push({ ok: false, error: err.message });
            }
        }

        let reconciled = null;
        if (body.reconcile !== false) {
            reconciled = await instanceManager.reconcileProxyPool();
        }

        const pool = instanceManager.getProxyPoolStatus();
        broadcastToAll({ type: 'proxy_pool_updated', data: pool });
        res.status(201).json({ success: results.every(r => r.ok), results, reconciled, pool });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/proxy/pool/entries/:slotId', async (req, res) => {
    try {
        const slotId = decodeURIComponent(req.params.slotId);
        const confirm = req.query.confirm === 'true' || req.query.confirm === '1';
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
                hint: 'Re-call with ?confirm=true to remove anyway.',
            });
        }

        const result = await instanceManager.removeProxyFromPool(slotId);
        broadcastToAll({ type: 'proxy_pool_updated', data: result.pool });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/proxy/test', async (req, res) => {
    try {
        let cfg;
        if (req.body?.url || req.body?.shorthand || req.body?.host) {
            cfg = parseFlexibleProxyInput(req.body.shorthand || req.body.url || req.body);
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

        res.json({
            success: true,
            proxy: redactProxy(cfg),
            target,
            responseStatus: response.status,
            elapsedMs: Date.now() - start,
        });
    } catch (error) {
        res.status(502).json({ success: false, error: error.message, code: error.code || null });
    }
});

app.get('/api/instances/:id/proxy', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) return res.status(404).json({ error: 'Instance not found' });
        res.json({ success: true, proxy: instance.getProxyStatus() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/instances/:id/proxy', async (req, res) => {
    try {
        const body = req.body || {};
        let proxyArg;
        if (body.enabled === false) {
            proxyArg = { enabled: false };
        } else if (body.url || body.shorthand || body.host) {
            const cfg = parseFlexibleProxyInput(body.shorthand || body.url || body);
            if (!cfg) {
                return res.status(400).json({ error: 'Invalid proxy config' });
            }
            proxyArg = {
                enabled: true,
                type: cfg.type,
                host: cfg.host,
                port: cfg.port,
                username: cfg.username,
                password: cfg.password,
            };
        } else {
            proxyArg = null;
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

app.post('/api/instances/:id/proxy/verify', async (req, res) => {
    try {
        const result = await instanceManager.verifyInstanceProxy(req.params.id, req.body?.target);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

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

app.get('/api/instances/:id/connection', (req, res) => {
    try {
        const instance = instanceManager.getInstance(req.params.id);
        if (!instance) return res.status(404).json({ error: 'Instance not found' });

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
            proxy: status.proxy || null,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Normalize phone number - remove leading + and any non-digit characters
 */
function normalizePhone(phone) {
    if (!phone) return null;
    return phone.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
}

/**
 * POST /api/send
 * Global send endpoint - finds instance by 'from_phone' number
 * Body: { 
 *   from_phone: "sender_phone_number",  // Which of your connected numbers to send from
 *   to_phone: "recipient_phone_number", 
 *   message: "text", 
 *   typingSimulation?: boolean, 
 *   delayEnabled?: boolean,
 *   contactName?: string,      // Optional: Name to save contact as (default: "Unknown User XXXX")
 *   skipContactSave?: boolean  // Optional: Skip auto-saving contact (default: false)
 * }
 */
app.post('/api/send', async (req, res) => {
    try {
        // Support both new format (from_phone, to_phone) and legacy format (from, to)
        const fromPhone = req.body.from_phone || req.body.from;
        const toPhone = req.body.to_phone || req.body.to;
        
        if (!toPhone) {
            return res.status(400).json({ error: 'Missing required field: to_phone' });
        }

        const { options, messagePayload, errors } = parseSendOptions(req.body);
        if (errors) {
            return res.status(400).json({
                error: 'Invalid send payload',
                details: errors
            });
        }
        
        let targetInstanceId = null;
        let matchedInstance = null;
        
        // If 'from_phone' provided, find the instance with that connected number
        if (fromPhone) {
            const instances = instanceManager.getAllInstances();
            
            // Debug: Log all instances
            console.log(`[API /send] Looking for from_phone: ${fromPhone}`);
            console.log(`[API /send] Available instances:`, instances.map(i => ({
                id: i.id,
                status: i.status,
                connectedPhone: i.connectedPhone
            })));
            
            // Normalize the 'from' number (remove +, spaces, dashes)
            const normalizedFrom = normalizePhone(fromPhone);
            console.log(`[API /send] Normalized from: ${normalizedFrom}`);
            
            // Find instance where connectedPhone matches
            matchedInstance = instances.find(i => {
                if (!i.connectedPhone || i.status !== 'connected') {
                    console.log(`[API /send] Skipping ${i.id}: phone=${i.connectedPhone}, status=${i.status}`);
                    return false;
                }
                const normalizedConnected = normalizePhone(i.connectedPhone);
                console.log(`[API /send] Comparing: ${normalizedConnected} vs ${normalizedFrom}`);
                // Match if either is a suffix of the other (handles country code variations)
                const matches = normalizedConnected.endsWith(normalizedFrom) || 
                       normalizedFrom.endsWith(normalizedConnected) ||
                       normalizedConnected === normalizedFrom;
                console.log(`[API /send] Match result: ${matches}`);
                return matches;
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
            // No from_phone provided - use first connected instance
            const instances = instanceManager.getAllInstances();
            matchedInstance = instances.find(i => i.status === 'connected');
            
            if (!matchedInstance) {
                return res.status(400).json({ error: 'No connected instances available' });
            }
            
            targetInstanceId = matchedInstance.id;
        }
        
        const result = await instanceManager.sendMessage(targetInstanceId, toPhone, messagePayload.text, options);
        
        // Determine status based on actual result
        let status = 'sent';
        if (!result.sent) {
            status = result.reason?.includes('Rate') ? 'rate_limited' : 'failed';
        }
        
        res.json([{
            message_id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            from_phone: normalizePhone(matchedInstance.connectedPhone),
            to_phone: normalizePhone(toPhone),
            message: result.messageText || messagePayload.text,
            status: status,
            interactive: result.interactive
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
    const instances = instanceManager.getAllInstances();
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
 */
app.put('/api/instances/:id/behavior', async (req, res) => {
    try {
        const {
            behaviorProfile,
            typingSimulation,
            delayEnabled,
            phoneNotificationsEnabled,
            notificationGraceMs
        } = req.body;

        if (behaviorProfile !== undefined && !VALID_BEHAVIOR_PROFILES.has(behaviorProfile)) {
            return res.status(400).json({
                error: 'Invalid behaviorProfile',
                allowedProfiles: Array.from(VALID_BEHAVIOR_PROFILES)
            });
        }
        
        const instance = await instanceManager.updateInstance(req.params.id, { 
            behaviorSettings: {
                behaviorProfile,
                typingSimulation,
                delayEnabled,
                phoneNotificationsEnabled,
                notificationGraceMs
            } 
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
// GENERAL API ENDPOINTS
// ========================================

/**
 * GET /api/status
 * Get overall system status (backward compatible)
 */
app.get('/api/status', (req, res) => {
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
        authenticated: !API_KEY || ALLOW_PUBLIC_DASHBOARD // Auto-auth if dashboard auth is disabled
    });
    
    // Send initial data
    const instances = instanceManager.getAllInstances();
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            instances,
            requiresAuth: !!API_KEY && !ALLOW_PUBLIC_DASHBOARD
        }
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleWebSocketMessage(ws, data);
        } catch (error) {
            console.error('[WS] Invalid message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('[WS] Client disconnected');
        wsClients.delete(ws);
    });
});

function handleWebSocketMessage(ws, data) {
    const clientState = wsClients.get(ws);
    
    switch (data.type) {
        case 'auth':
            // Authenticate WebSocket client
            if (data.apiKey === API_KEY || data.apiKey === ADMIN_PASSWORD) {
                clientState.authenticated = true;
                ws.send(JSON.stringify({ type: 'auth_success' }));
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
🔐 Auth:        ${API_KEY ? (ALLOW_PUBLIC_DASHBOARD ? 'API Key Required (dashboard bypass enabled)' : 'API Key Required') : 'Open (set API_KEY in .env for production)'}

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
  POST   /api/instances/:id/send/interactive  Send native interactive message
  POST   /api/instances/:id/react       React to a message
  POST   /api/send                      Send message (by 'from' phone or instanceId)
  POST   /api/react                     React to a message (auto-select instance)
  GET    /api/proxy                     Deployment proxy + pool summary
  GET    /api/instances/:id/proxy       Instance proxy status (poll)
  PUT    /api/instances/:id/proxy       Attach proxy (URL or Webshare shorthand)
  DELETE /api/instances/:id/proxy       Detach proxy override
  POST   /api/instances/:id/proxy/verify  Verify egress IP through proxy
  GET    /api/numbers                   List all connected phone numbers
  
  GET    /api/instances/:id/logs        Get activity logs
  GET    /api/instances/:id/anti-ban    Get anti-ban status
  PUT    /api/instances/:id/anti-ban    Update anti-ban settings
  
  GET    /api/health                    Health check
  GET    /api/status                    System status

Initializing...
    `);
    
    // Initialize instance manager
    instanceManager = new InstanceManager();
    await instanceManager.init();
    
    // Set up event handlers
    instanceManager.onStatusChange = (instanceId, status) => {
        console.log(`[Event] Status change for ${instanceId}: ${status.status}, hasQR: ${!!status.qrCode}`);
        broadcastToInstance(instanceId, {
            type: 'instance_status',
            data: status
        });
    };
    
    instanceManager.onMessage = (data) => {
        broadcastToInstance(data.instanceId, {
            type: 'message',
            data
        });
    };
    
    instanceManager.onLog = (instanceId, entry) => {
        broadcastToInstance(instanceId, {
            type: 'log',
            instanceId,
            data: entry
        });
    };
    
    console.log(`[Server] Ready! ${instanceManager.getAllInstances().length} instances loaded.`);
});

// Graceful shutdown (Docker / K8s SIGTERM)
async function gracefulShutdown(signal) {
    console.log(`\n\n🛑 ${signal} received — shutting down...`);
    if (instanceManager) {
        await instanceManager.shutdown();
    }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
