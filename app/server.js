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

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

// Instance Manager
const { InstanceManager } = require('./src/utils/instance-manager');

// ========================================
// CONFIGURATION
// ========================================

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ''; // Optional API key for external access
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

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
const wss = new WebSocket.Server({ server, path: '/ws' });

// Middleware
app.use(express.json());
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
    try {
        const instance = await instanceManager.connectInstance(req.params.id);
        res.json({ 
            success: true, 
            message: 'Connection started',
            instance 
        });
    } catch (error) {
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
 * Body: { to: "phone_number", message: "text", typingSimulation?: boolean, delayEnabled?: boolean }
 */
app.post('/api/instances/:id/send', async (req, res) => {
    try {
        const { to, message, typingSimulation, delayEnabled } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ error: 'Missing required fields: to, message' });
        }
        
        // Build options for per-message behavior override
        const options = {};
        if (typingSimulation !== undefined) options.typingSimulation = typingSimulation;
        if (delayEnabled !== undefined) options.delayEnabled = delayEnabled;
        
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
 * POST /api/send
 * Send a message (auto-select instance by phone or specify instanceId)
 * Body: { instanceId?, to: "phone_number", message: "text", typingSimulation?: boolean, delayEnabled?: boolean }
 */
app.post('/api/send', async (req, res) => {
    try {
        const { instanceId, to, message, typingSimulation, delayEnabled } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ error: 'Missing required fields: to, message' });
        }
        
        // Build options for per-message behavior override
        const options = {};
        if (typingSimulation !== undefined) options.typingSimulation = typingSimulation;
        if (delayEnabled !== undefined) options.delayEnabled = delayEnabled;
        
        // If instanceId provided, use that instance
        if (instanceId) {
            const result = await instanceManager.sendMessage(instanceId, to, message, options);
            return res.json({ success: true, result });
        }
        
        // Otherwise, use first connected instance
        const instances = instanceManager.getAllInstances();
        const connectedInstance = instances.find(i => i.status === 'connected');
        
        if (!connectedInstance) {
            return res.status(400).json({ error: 'No connected instances available' });
        }
        
        const result = await instanceManager.sendMessage(connectedInstance.id, to, message, options);
        res.json({ 
            success: true, 
            instanceId: connectedInstance.id,
            result 
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
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
        const { PRESETS } = require('./src/utils/anti-ban');
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
    const message = JSON.stringify(data);
    wsClients.forEach((clientState, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

/**
 * Broadcast to clients subscribed to a specific instance
 */
function broadcastToInstance(instanceId, data) {
    const message = JSON.stringify(data);
    wsClients.forEach((clientState, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            if (clientState.subscribedInstances.has(instanceId) || clientState.subscribedInstances.size === 0) {
                ws.send(message);
            }
        }
    });
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
  
  POST   /api/instances/:id/send        Send message
  POST   /api/send                      Send (auto-select instance)
  
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
