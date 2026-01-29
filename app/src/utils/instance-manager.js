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
const crypto = require('crypto');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { AntiBanManager, safeSendMessage } = require('./anti-ban');

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
        
        // Message deduplication (prevent processing same message multiple times)
        this.processedMessages = new Set();
        this.maxProcessedMessages = 1000; // Keep last 1000 message IDs
        
        // LID to PN mapping cache (persistent fallback) - initialized after authFolder is set
        this.lidCache = new Map();
        
        // Saved contacts cache (to avoid re-saving contacts we've already saved)
        this.savedContacts = new Set();
        
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
        this.lidCacheFile = path.join(this.authFolder, 'lid-mapping.json');
        this.savedContactsFile = path.join(this.authFolder, 'saved-contacts.json');
        
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
        // Load LID cache from disk
        await this._loadLidCache();
        // Load saved contacts cache from disk
        await this._loadSavedContacts();
        return this;
    }
    
    /**
     * Start WhatsApp connection
     */
    async connect() {
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
        
        this.status = 'connecting';
        this._emitStatusChange();
        this._log('Starting connection...', 'info');
        
        try {
            // Ensure auth folder exists
            await fs.mkdir(this.authFolder, { recursive: true });
            console.log(`[Instance ${this.id}] Auth folder ready: ${this.authFolder}`);
            
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            console.log(`[Instance ${this.id}] Auth state loaded`);
            
            this.socket = makeWASocket({
                auth: state,
                printQRInTerminal: false
            });
            console.log(`[Instance ${this.id}] Socket created`);
            
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
            this.socket.ev.on('lid-mapping.update', async (mappings) => {
                console.log(`[Instance ${this.id}] Received LID-PN mappings:`, Object.keys(mappings).length);
                // Store mappings in our persistent cache too
                for (const [lid, pn] of Object.entries(mappings)) {
                    await this._storeLidMapping(lid, pn);
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
        console.log(`[Instance ${this.id}] Clearing auth...`);
        
        // Disconnect first if connected
        if (this.socket) {
            try {
                await this.socket.logout();
            } catch (e) {
                console.log(`[Instance ${this.id}] Logout during clear auth:`, e.message);
            }
            this.socket = null;
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
                this.processedMessages = new Set(idsArray.slice(-500)); // Keep last 500
            }
            
            const from = msg.key.remoteJid;
            const messageContent = this._extractMessageContent(msg.message);
            
            if (!messageContent.text || from === 'status@broadcast') return;
            
            // Handle LID (Local Identifier) to PN (Phone Number) mapping
            let phoneNumber = await this._resolvePhoneNumber(msg, from);
            
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
        const axios = require('axios');
        
        console.log(`[Instance ${this.id}] Calling webhook: ${webhookUrl}`);
        
        try {
            // Show typing indicator
            try {
                await this.socket.sendPresenceUpdate('composing', from);
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
            webhookUrl: this.webhookUrl || null,
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
        
        console.log(`[InstanceManager] Creating instance: ${id}`);
        
        if (this.instances.has(id)) {
            throw new Error(`Instance ${id} already exists`);
        }
        
        const instance = new WhatsAppInstance({
            id,
            name: config.name || `Instance ${id}`,
            webhookUrl: config.webhookUrl || '',
            antiBanSettings: config.antiBanSettings
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
