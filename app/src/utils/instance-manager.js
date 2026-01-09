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

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { AntiBanManager, safeSendMessage } = require('./anti-ban');

// Base paths
const INSTANCES_FOLDER = path.join(__dirname, '../../instances');
const INSTANCES_DB_FILE = path.join(INSTANCES_FOLDER, 'instances.json');

// Global default webhook URL (from environment)
const DEFAULT_WEBHOOK_URL = process.env.DEFAULT_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL || '';

/**
 * Single WhatsApp Instance
 */
class WhatsAppInstance {
    constructor(config) {
        this.id = config.id;
        this.name = config.name || `Instance ${config.id}`;
        this.webhookUrl = config.webhookUrl || '';
        this.createdAt = config.createdAt || new Date().toISOString();
        
        // Connection state
        this.socket = null;
        this.status = 'disconnected'; // disconnected | connecting | connected
        this.qrCode = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        
        // Behavior settings (typing simulation, delays)
        this.behaviorSettings = config.behaviorSettings || {
            typingSimulation: true,   // Show "typing..." indicator
            delayEnabled: true,       // Human-like response delays
        };
        
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
        
        // Activity log (in-memory, capped)
        this.activityLog = [];
        
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
        return this;
    }
    
    /**
     * Start WhatsApp connection
     */
    async connect() {
        if (this.status === 'connected') {
            throw new Error('Already connected');
        }
        if (this.status === 'connecting') {
            throw new Error('Connection in progress');
        }
        
        this.status = 'connecting';
        this._emitStatusChange();
        this._log('Starting connection...', 'info');
        
        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            
            this.socket = makeWASocket({
                auth: state,
                printQRInTerminal: false
            });
            
            // Save credentials when updated
            this.socket.ev.on('creds.update', saveCreds);
            
            // Handle connection updates
            this.socket.ev.on('connection.update', async (update) => {
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
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(`[Instance ${this.id}] Connection closed. Status:`, statusCode);
                    this.status = 'disconnected';
                    this.qrCode = null;
                    this.connectedPhone = null;
                    this.connectedAt = null;
                    this._emitStatusChange();
                    
                    if (shouldReconnect) {
                        this._log('Connection lost - reconnecting in 5 seconds...', 'warning');
                        setTimeout(() => this.connect(), 5000);
                    } else {
                        this._log('Logged out - scan QR code to reconnect', 'error');
                    }
                }
                
                // Connected successfully
                if (connection === 'open') {
                    console.log(`[Instance ${this.id}] Connected!`);
                    this.status = 'connected';
                    this.qrCode = null;
                    this.connectedPhone = this.socket.user?.id?.split(':')[0] || 'Unknown';
                    this.connectedAt = new Date().toISOString();
                    this._emitStatusChange();
                    this._log(`Connected as ${this.connectedPhone}`, 'success');
                }
            });
            
            // Handle incoming messages
            this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                
                for (const msg of messages) {
                    await this._handleMessage(msg);
                }
            });
            
        } catch (error) {
            console.error(`[Instance ${this.id}] Connection error:`, error);
            this.status = 'disconnected';
            this._emitStatusChange();
            this._log(`Connection error: ${error.message}`, 'error');
            throw error;
        }
    }
    
    /**
     * Disconnect WhatsApp
     */
    async disconnect() {
        if (this.socket) {
            try {
                await this.socket.logout();
                this._log('Disconnected from WhatsApp', 'info');
            } catch (error) {
                console.error(`[Instance ${this.id}] Logout error:`, error);
            }
            this.socket = null;
        }
        this.status = 'disconnected';
        this.qrCode = null;
        this.connectedPhone = null;
        this.connectedAt = null;
        this._emitStatusChange();
    }
    
    /**
     * Clear auth data (logout + delete credentials)
     */
    async clearAuth() {
        await this.disconnect();
        try {
            await fs.rm(this.authFolder, { recursive: true, force: true });
            await fs.mkdir(this.authFolder, { recursive: true });
            this._log('Auth cleared - ready for new QR scan', 'info');
        } catch (error) {
            console.error(`[Instance ${this.id}] Clear auth error:`, error);
            throw error;
        }
    }
    
    /**
     * Send a message
     * @param {string} to - Phone number or JID
     * @param {string} text - Message text
     * @param {Object} options - Override behavior settings for this message
     */
    async sendMessage(to, text, options = {}) {
        if (this.status !== 'connected' || !this.socket) {
            throw new Error('Instance not connected');
        }
        
        // Format JID if needed
        const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        
        // Check rate limits
        const canSend = this.antiBanManager.canSendMessage(jid);
        if (!canSend.allowed) {
            throw new Error(`Rate limited: ${canSend.reason}`);
        }
        
        // Merge instance behavior settings with per-message overrides
        const behaviorOptions = {
            typingSimulation: options.typingSimulation !== undefined 
                ? options.typingSimulation 
                : this.behaviorSettings.typingSimulation,
            delayEnabled: options.delayEnabled !== undefined 
                ? options.delayEnabled 
                : this.behaviorSettings.delayEnabled
        };
        
        // Send with anti-ban protections
        const result = await safeSendMessage(this.socket, jid, text, '', this.antiBanManager, behaviorOptions);
        
        if (result.sent) {
            this._log(`Sent to ${to}: ${text.substring(0, 50)}...`, 'success');
        }
        
        return result;
    }
    
    /**
     * Handle incoming message
     */
    async _handleMessage(msg) {
        try {
            if (msg.key.fromMe) return;
            
            const from = msg.key.remoteJid;
            const messageContent = this._extractMessageContent(msg.message);
            
            if (!messageContent.text || from === 'status@broadcast') return;
            
            const phoneNumber = from.replace('@s.whatsapp.net', '');
            
            this._log(`Received from ${phoneNumber}: ${messageContent.text.substring(0, 50)}...`, 'info');
            
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
            
            // Get effective webhook URL (instance-specific or global default)
            const effectiveWebhookUrl = this.webhookUrl || DEFAULT_WEBHOOK_URL;
            
            // If webhook URL is configured (either instance or global), forward to it
            if (effectiveWebhookUrl && effectiveWebhookUrl !== 'YOUR_N8N_WEBHOOK_URL_HERE') {
                await this._forwardToWebhook(msg, messageContent, from, phoneNumber, effectiveWebhookUrl);
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
        const axios = require('axios');
        
        try {
            // Show typing indicator
            try {
                await this.socket.sendPresenceUpdate('composing', from);
            } catch (e) {}
            
            const response = await axios.post(webhookUrl, {
                instanceId: this.id,
                from: phoneNumber,
                fromJid: from,
                message: messageContent.text,
                messageType: messageContent.messageType,
                isReply: messageContent.isReply,
                quotedMessage: messageContent.quotedText,
                timestamp: new Date().toISOString(),
                messageId: msg.key.id
            }, { timeout: 30000 });
            
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
                const result = await safeSendMessage(
                    this.socket, 
                    from, 
                    reply, 
                    messageContent.text, 
                    this.antiBanManager,
                    this.behaviorSettings
                );
                if (result.sent) {
                    this._log(`Replied to ${phoneNumber}: ${reply.substring(0, 50)}...`, 'success');
                }
            } else {
                try {
                    await this.socket.sendPresenceUpdate('paused', from);
                } catch (e) {}
            }
            
        } catch (error) {
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
     * Update behavior settings (typing simulation, delays)
     */
    updateBehaviorSettings(settings) {
        if (settings.typingSimulation !== undefined) {
            this.behaviorSettings.typingSimulation = !!settings.typingSimulation;
        }
        if (settings.delayEnabled !== undefined) {
            this.behaviorSettings.delayEnabled = !!settings.delayEnabled;
        }
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
            connectedPhone: this.connectedPhone,
            connectedAt: this.connectedAt,
            webhookUrl: this.webhookUrl,
            effectiveWebhookUrl: this.webhookUrl || DEFAULT_WEBHOOK_URL || null,
            behaviorSettings: this.behaviorSettings,
            antiBanSettings: this.antiBanSettings,
            antiBanHealth: this.antiBanManager.getHealth(),
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
    }
    
    /**
     * Initialize the manager
     */
    async init() {
        // Ensure instances folder exists
        await fs.mkdir(INSTANCES_FOLDER, { recursive: true });
        
        // Load existing instances from DB
        await this._loadInstances();
        
        console.log(`[InstanceManager] Initialized with ${this.instances.size} instances`);
        return this;
    }
    
    /**
     * Create a new instance
     */
    async createInstance(config = {}) {
        const id = config.id || this._generateId();
        
        if (this.instances.has(id)) {
            throw new Error(`Instance ${id} already exists`);
        }
        
        const instance = new WhatsAppInstance({
            id,
            name: config.name || `Instance ${id}`,
            webhookUrl: config.webhookUrl || '',
            antiBanSettings: config.antiBanSettings
        });
        
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
        this.instances.set(id, instance);
        await this._saveInstances();
        
        console.log(`[InstanceManager] Created instance: ${id}`);
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
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        await instance.connect();
        return instance.getStatus();
    }
    
    /**
     * Disconnect an instance
     */
    async disconnectInstance(id) {
        const instance = this.instances.get(id);
        if (!instance) {
            throw new Error(`Instance ${id} not found`);
        }
        await instance.disconnect();
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
    
    /**
     * Load instances from DB file
     */
    async _loadInstances() {
        try {
            if (fsSync.existsSync(INSTANCES_DB_FILE)) {
                const data = await fs.readFile(INSTANCES_DB_FILE, 'utf8');
                const instanceConfigs = JSON.parse(data);
                
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
                }
            }
        } catch (error) {
            console.error('[InstanceManager] Error loading instances:', error);
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

module.exports = { InstanceManager, WhatsAppInstance };
