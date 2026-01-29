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
import { WebSocketServer } from 'ws';
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

// ========================================
// CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ''; // Optional API key for external access
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_WEBHOOK_URL = process.env.DEFAULT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';

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
function authenticateAPI(req, res, next) {
    // If no API key is configured, skip auth (for local development)
    if (!API_KEY) {
        return next();
    }
    
    const apiKey = req.headers['x-api-key'];
    const authHeader = req.headers.authorization;
    
    if (apiKey === API_KEY) {
        return next();
    }
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === API_KEY) {
            return next();
        }
    }
    
    // Check admin password as fallback
    if (ADMIN_PASSWORD && authHeader === `Bearer ${ADMIN_PASSWORD}`) {
        return next();
    }
    
    res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Valid API key required. Use X-API-Key header or Authorization: Bearer <key>' 
    });
}

// Apply authentication to all API routes
app.use('/api', authenticateAPI);

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
        const { id, name, webhookUrl, antiBanSettings } = req.body;
        
        const instance = await instanceManager.createInstance({
            id,
            name,
            webhookUrl,
            antiBanSettings
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
        const instance = await instanceManager.disconnectInstance(req.params.id);
        res.json({ 
            success: true, 
            message: 'Disconnected',
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
        const { to, message, typingSimulation, delayEnabled, contactName, skipContactSave } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ error: 'Missing required fields: to, message' });
        }
        
        // Build options for per-message behavior override
        const options = {};
        if (typingSimulation !== undefined) options.typingSimulation = typingSimulation;
        if (delayEnabled !== undefined) options.delayEnabled = delayEnabled;
        if (contactName !== undefined) options.contactName = contactName;
        if (skipContactSave !== undefined) options.skipContactSave = skipContactSave;
        
        const result = await instanceManager.sendMessage(req.params.id, to, message, options);
        
        res.json({ 
            success: true, 
            result 
        });
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
        const { message, typingSimulation, delayEnabled, contactName, skipContactSave } = req.body;
        
        if (!toPhone || !message) {
            return res.status(400).json({ error: 'Missing required fields: to_phone, message' });
        }
        
        // Build options for per-message behavior override
        const options = {};
        if (typingSimulation !== undefined) options.typingSimulation = typingSimulation;
        if (delayEnabled !== undefined) options.delayEnabled = delayEnabled;
        if (contactName !== undefined) options.contactName = contactName;
        if (skipContactSave !== undefined) options.skipContactSave = skipContactSave;
        
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
        
        const result = await instanceManager.sendMessage(targetInstanceId, toPhone, message, options);
        
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
            message: message,
            status: status
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
 * Body: { typingSimulation?: boolean, delayEnabled?: boolean }
 */
app.put('/api/instances/:id/behavior', async (req, res) => {
    try {
        const { typingSimulation, delayEnabled } = req.body;
        
        const instance = await instanceManager.updateInstance(req.params.id, { 
            behaviorSettings: { typingSimulation, delayEnabled } 
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
 * GET /api/health
 * Health check
 */
app.get('/api/health', (req, res) => {
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
 * CRITICAL: Call this BEFORE deploying to preserve WhatsApp sessions
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
            
            // Read auth credentials for this instance
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
 * Call this AFTER deploying to restore WhatsApp sessions
 */
app.post('/api/import-all-credentials', async (req, res) => {
    try {
        const backup = req.body;
        
        if (!backup || !backup.instances || !backup.credentials) {
            return res.status(400).json({ error: 'Invalid backup format. Need instances and credentials.' });
        }
        
        const instancesDir = path.join(__dirname, 'instances');
        const instancesFile = path.join(instancesDir, 'instances.json');
        
        // Create instances directory
        await fs.mkdir(instancesDir, { recursive: true });
        
        // Write instances.json
        await fs.writeFile(instancesFile, JSON.stringify(backup.instances, null, 2));
        
        // Restore credentials for each instance
        let restoredCount = 0;
        for (const instance of backup.instances) {
            const instanceDir = path.join(instancesDir, instance.id);
            const authDir = path.join(instanceDir, 'auth');
            const logsDir = path.join(instanceDir, 'logs');
            
            await fs.mkdir(authDir, { recursive: true });
            await fs.mkdir(logsDir, { recursive: true });
            
            // Write auth files
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
        authenticated: !API_KEY // Auto-auth if no API key configured
    });
    
    // Send initial data
    const instances = instanceManager.getAllInstances();
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            instances,
            requiresAuth: !!API_KEY
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

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    if (instanceManager) {
        await instanceManager.shutdown();
    }
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
