/**
 * Meta WhatsApp Business API Integration
 *
 * Drop-in replacement for Baileys connection.
 * Provides the same interface but uses official Meta API.
 *
 * Setup required:
 * 1. Create Meta Business Account
 * 2. Complete business verification
 * 3. Set environment variables (see .env.example)
 */

const axios = require('axios');
const crypto = require('crypto');

// Meta API Configuration
const META_API_VERSION = 'v18.0';
const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;

class MetaWhatsAppAPI {
    constructor(config = {}) {
        this.phoneNumberId = config.phoneNumberId || process.env.META_PHONE_NUMBER_ID;
        this.accessToken = config.accessToken || process.env.META_ACCESS_TOKEN;
        this.webhookVerifyToken = config.webhookVerifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN;
        this.appSecret = config.appSecret || process.env.META_APP_SECRET;

        // Event handlers (mimics Baileys event structure)
        this.eventHandlers = {
            'messages.upsert': [],
            'connection.update': []
        };

        // Connection state
        this.isConnected = false;
        this.businessInfo = null;

        // Validate configuration
        if (!this.phoneNumberId || !this.accessToken) {
            console.warn('[Meta API] Missing configuration. Set META_PHONE_NUMBER_ID and META_ACCESS_TOKEN in .env');
        }
    }

    /**
     * Register event handler (Baileys-compatible interface)
     */
    on(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].push(handler);
        }
    }

    /**
     * Emit event to handlers
     */
    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }

    /**
     * Initialize connection and verify credentials
     */
    async connect() {
        try {
            // Verify credentials by fetching business profile
            const response = await axios.get(
                `${META_GRAPH_URL}/${this.phoneNumberId}`,
                {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` },
                    params: { fields: 'display_phone_number,verified_name,quality_rating' }
                }
            );

            this.businessInfo = response.data;
            this.isConnected = true;

            console.log('[Meta API] Connected successfully');
            console.log(`[Meta API] Phone: ${this.businessInfo.display_phone_number}`);
            console.log(`[Meta API] Business: ${this.businessInfo.verified_name || 'Not verified'}`);

            // Emit connection update (Baileys-compatible)
            this.emit('connection.update', {
                connection: 'open',
                qr: null
            });

            return {
                success: true,
                phone: this.businessInfo.display_phone_number,
                business: this.businessInfo.verified_name,
                quality: this.businessInfo.quality_rating
            };
        } catch (error) {
            console.error('[Meta API] Connection failed:', error.response?.data || error.message);

            this.emit('connection.update', {
                connection: 'close',
                lastDisconnect: { error }
            });

            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    /**
     * Send text message
     * @param {string} to - Recipient phone number (with country code, no +)
     * @param {object} message - Message object { text: string }
     */
    async sendMessage(to, message) {
        // Format phone number (remove @s.whatsapp.net if present)
        const phoneNumber = to.replace('@s.whatsapp.net', '').replace(/\D/g, '');

        try {
            let payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: phoneNumber
            };

            // Handle different message types
            if (typeof message === 'string') {
                payload.type = 'text';
                payload.text = { body: message };
            } else if (message.text) {
                payload.type = 'text';
                payload.text = {
                    body: message.text,
                    preview_url: message.preview_url || false
                };
            } else if (message.image) {
                payload.type = 'image';
                payload.image = {
                    link: message.image.url,
                    caption: message.image.caption
                };
            } else if (message.document) {
                payload.type = 'document';
                payload.document = {
                    link: message.document.url,
                    filename: message.document.filename,
                    caption: message.document.caption
                };
            } else if (message.template) {
                payload.type = 'template';
                payload.template = message.template;
            } else if (message.interactive) {
                payload.type = 'interactive';
                payload.interactive = message.interactive;
            }

            const response = await axios.post(
                `${META_GRAPH_URL}/${this.phoneNumberId}/messages`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log(`[Meta API] Message sent to ${phoneNumber}`);

            return {
                success: true,
                messageId: response.data.messages?.[0]?.id,
                to: phoneNumber
            };
        } catch (error) {
            console.error('[Meta API] Send failed:', error.response?.data || error.message);

            return {
                success: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    /**
     * Send typing indicator (presence update)
     * Note: Meta API doesn't support typing indicators the same way.
     * This is a no-op for API compatibility with Baileys.
     */
    async sendPresenceUpdate(presence, to) {
        // Meta API doesn't support typing indicators
        // This method exists for Baileys compatibility
        console.log(`[Meta API] Presence update (${presence}) - not supported by Meta API`);
        return { success: true, note: 'Meta API does not support typing indicators' };
    }

    /**
     * Mark message as read
     */
    async markAsRead(messageId) {
        try {
            await axios.post(
                `${META_GRAPH_URL}/${this.phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return { success: true };
        } catch (error) {
            console.error('[Meta API] Mark read failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send interactive message with buttons
     */
    async sendButtonMessage(to, bodyText, buttons) {
        const phoneNumber = to.replace('@s.whatsapp.net', '').replace(/\D/g, '');

        const interactiveButtons = buttons.map((btn, index) => ({
            type: 'reply',
            reply: {
                id: btn.id || `btn_${index}`,
                title: btn.title.substring(0, 20) // Max 20 chars
            }
        }));

        return this.sendMessage(to, {
            interactive: {
                type: 'button',
                body: { text: bodyText },
                action: { buttons: interactiveButtons }
            }
        });
    }

    /**
     * Send list message
     */
    async sendListMessage(to, headerText, bodyText, buttonText, sections) {
        return this.sendMessage(to, {
            interactive: {
                type: 'list',
                header: { type: 'text', text: headerText },
                body: { text: bodyText },
                action: {
                    button: buttonText,
                    sections: sections
                }
            }
        });
    }

    /**
     * Send template message (pre-approved marketing/notification templates)
     */
    async sendTemplateMessage(to, templateName, languageCode = 'en', components = []) {
        return this.sendMessage(to, {
            template: {
                name: templateName,
                language: { code: languageCode },
                components: components
            }
        });
    }

    /**
     * Process incoming webhook from Meta
     * Call this from your Express route handler
     */
    processWebhook(body) {
        try {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            if (!value) return null;

            // Handle incoming messages
            if (value.messages) {
                value.messages.forEach(message => {
                    const from = message.from;
                    const messageId = message.id;
                    const timestamp = message.timestamp;

                    // Convert to Baileys-compatible format
                    const baileysMessage = {
                        key: {
                            remoteJid: `${from}@s.whatsapp.net`,
                            fromMe: false,
                            id: messageId
                        },
                        message: this._convertMessageFormat(message),
                        messageTimestamp: timestamp
                    };

                    // Emit in Baileys format
                    this.emit('messages.upsert', {
                        messages: [baileysMessage],
                        type: 'notify'
                    });
                });
            }

            // Handle status updates
            if (value.statuses) {
                value.statuses.forEach(status => {
                    console.log(`[Meta API] Message ${status.id}: ${status.status}`);
                });
            }

            return { processed: true };
        } catch (error) {
            console.error('[Meta API] Webhook processing error:', error);
            return { processed: false, error: error.message };
        }
    }

    /**
     * Convert Meta message format to Baileys format
     */
    _convertMessageFormat(metaMessage) {
        const type = metaMessage.type;

        switch (type) {
            case 'text':
                return {
                    conversation: metaMessage.text.body
                };
            case 'image':
                return {
                    imageMessage: {
                        url: metaMessage.image.url,
                        caption: metaMessage.image.caption,
                        mimetype: metaMessage.image.mime_type
                    }
                };
            case 'document':
                return {
                    documentMessage: {
                        url: metaMessage.document.url,
                        filename: metaMessage.document.filename,
                        mimetype: metaMessage.document.mime_type
                    }
                };
            case 'audio':
                return {
                    audioMessage: {
                        url: metaMessage.audio.url,
                        mimetype: metaMessage.audio.mime_type
                    }
                };
            case 'interactive':
                // Button reply or list reply
                if (metaMessage.interactive.type === 'button_reply') {
                    return {
                        conversation: metaMessage.interactive.button_reply.title
                    };
                } else if (metaMessage.interactive.type === 'list_reply') {
                    return {
                        conversation: metaMessage.interactive.list_reply.title
                    };
                }
                break;
            default:
                return {
                    conversation: `[${type} message]`
                };
        }
    }

    /**
     * Verify webhook signature (security)
     */
    verifyWebhookSignature(payload, signature) {
        if (!this.appSecret) {
            console.warn('[Meta API] App secret not configured - skipping signature verification');
            return true;
        }

        const expectedSignature = crypto
            .createHmac('sha256', this.appSecret)
            .update(payload)
            .digest('hex');

        return `sha256=${expectedSignature}` === signature;
    }

    /**
     * Handle webhook verification (GET request from Meta)
     */
    handleWebhookVerification(query) {
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        if (mode === 'subscribe' && token === this.webhookVerifyToken) {
            console.log('[Meta API] Webhook verified');
            return { verified: true, challenge };
        }

        return { verified: false };
    }

    /**
     * Get business profile
     */
    async getBusinessProfile() {
        try {
            const response = await axios.get(
                `${META_GRAPH_URL}/${this.phoneNumberId}/whatsapp_business_profile`,
                {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` },
                    params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' }
                }
            );

            return { success: true, profile: response.data.data?.[0] };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Update business profile
     */
    async updateBusinessProfile(profile) {
        try {
            await axios.post(
                `${META_GRAPH_URL}/${this.phoneNumberId}/whatsapp_business_profile`,
                {
                    messaging_product: 'whatsapp',
                    ...profile
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get message templates
     */
    async getTemplates() {
        try {
            // Need Business Account ID for this
            const businessId = process.env.META_BUSINESS_ID;
            if (!businessId) {
                return { success: false, error: 'META_BUSINESS_ID not configured' };
            }

            const response = await axios.get(
                `${META_GRAPH_URL}/${businessId}/message_templates`,
                {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` }
                }
            );

            return { success: true, templates: response.data.data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Disconnect (cleanup)
     */
    disconnect() {
        this.isConnected = false;
        this.emit('connection.update', { connection: 'close' });
        console.log('[Meta API] Disconnected');
    }

    /**
     * Get user info (Baileys-compatible property)
     */
    get user() {
        if (!this.businessInfo) return null;
        return {
            id: `${this.businessInfo.display_phone_number?.replace(/\D/g, '')}:0@s.whatsapp.net`,
            name: this.businessInfo.verified_name
        };
    }
}

/**
 * Express middleware for Meta webhook
 * Use this in your Express app to handle incoming messages
 */
function createWebhookMiddleware(metaApi) {
    return {
        // GET - Webhook verification
        verify: (req, res) => {
            const result = metaApi.handleWebhookVerification(req.query);
            if (result.verified) {
                res.status(200).send(result.challenge);
            } else {
                res.status(403).send('Verification failed');
            }
        },

        // POST - Incoming messages
        receive: (req, res) => {
            // Verify signature
            const signature = req.headers['x-hub-signature-256'];
            if (!metaApi.verifyWebhookSignature(JSON.stringify(req.body), signature)) {
                console.warn('[Meta API] Invalid webhook signature');
                return res.status(401).send('Invalid signature');
            }

            // Process webhook
            metaApi.processWebhook(req.body);

            // Always respond 200 quickly (Meta requirement)
            res.status(200).send('OK');
        }
    };
}

module.exports = {
    MetaWhatsAppAPI,
    createWebhookMiddleware
};
