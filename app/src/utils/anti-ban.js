/**
 * Anti-Ban Module for WhatsApp Bot
 *
 * Implements human-like behavior patterns to reduce ban risk:
 * - Rate limiting (hourly/daily message caps)
 * - Human-like delays (reading time + typing time + variance)
 * - Typing indicator simulation
 * - Time-of-day adjustments
 */

import { sendInteractiveViaHelper } from './interactive-sender.js';

// Default rate limits (can be updated dynamically)
let RATE_LIMITS = {
    messagesPerHour: 200,
    messagesPerDay: 5000,
    uniqueChatsPerHour: 50,
    uniqueChatsPerDay: 500
};

// Delay configuration
const DELAY_CONFIG = {
    minDelay: 2000,           // 2 seconds minimum
    maxDelay: 45000,          // 45 seconds maximum
    readingSpeedMs: 200,      // ms per word to "read"
    typingSpeedMs: 50,        // ms per character to "type"
    varianceFactor: 0.3       // +/- 30% randomness
};

// Preset configurations
const PRESETS = {
    conservative: {
        messagesPerHour: 100,
        messagesPerDay: 2000,
        uniqueChatsPerHour: 25,
        uniqueChatsPerDay: 250
    },
    balanced: {
        messagesPerHour: 200,
        messagesPerDay: 5000,
        uniqueChatsPerHour: 50,
        uniqueChatsPerDay: 500
    },
    aggressive: {
        messagesPerHour: 400,
        messagesPerDay: 10000,
        uniqueChatsPerHour: 100,
        uniqueChatsPerDay: 1000
    }
};

// Batching configuration
const BATCH_CONFIG = {
    maxBatchSize: 30,           // Max messages per batch
    batchCooldownMs: 300000,    // 5 minutes between batches
    priorityQueueEnabled: true   // Prioritize reply messages
};

/**
 * ANTI-BAN: Message Queue with Batching
 * Prevents volume spikes by queuing messages and sending in controlled batches
 */
class MessageBatcher {
    constructor(config = {}) {
        this.batchSize = config.maxBatchSize || BATCH_CONFIG.maxBatchSize;
        this.cooldownMs = config.batchCooldownMs || BATCH_CONFIG.batchCooldownMs;
        
        // Separate queues for priority (replies) and normal (broadcast) messages
        this.priorityQueue = [];  // Replies - processed immediately
        this.normalQueue = [];    // Broadcast - batched
        
        // Batch tracking
        this.currentBatchCount = 0;
        this.lastBatchTime = 0;
        this.isProcessing = false;
        
        // Stats
        this.totalQueued = 0;
        this.totalSent = 0;
        this.batchesSent = 0;
    }
    
    /**
     * Queue a message for sending
     * @param {Object} messageData - { socket, jid, message, incomingText, antiBanManager, options, resolve, reject }
     * @param {boolean} isPriority - Whether this is a reply (priority) message
     */
    queueMessage(messageData, isPriority = false) {
        this.totalQueued++;
        
        if (isPriority) {
            // Priority messages (replies) go to front
            this.priorityQueue.push(messageData);
        } else {
            // Normal messages (broadcast) are batched
            this.normalQueue.push(messageData);
        }
        
        // Start processing if not already
        if (!this.isProcessing) {
            this._processQueue();
        }
    }
    
    /**
     * Check if we should wait for batch cooldown
     */
    shouldWaitForCooldown() {
        if (this.currentBatchCount >= this.batchSize) {
            const timeSinceLastBatch = Date.now() - this.lastBatchTime;
            if (timeSinceLastBatch < this.cooldownMs) {
                return {
                    shouldWait: true,
                    waitTime: this.cooldownMs - timeSinceLastBatch
                };
            }
            // Reset batch count after cooldown
            this.currentBatchCount = 0;
            this.lastBatchTime = Date.now();
            this.batchesSent++;
        }
        return { shouldWait: false };
    }
    
    /**
     * Process the message queue
     */
    async _processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        
        try {
            while (this.priorityQueue.length > 0 || this.normalQueue.length > 0) {
                // Always process priority queue first (replies)
                let messageData;
                if (this.priorityQueue.length > 0) {
                    messageData = this.priorityQueue.shift();
                } else {
                    // Check batch cooldown for normal messages
                    const cooldownCheck = this.shouldWaitForCooldown();
                    if (cooldownCheck.shouldWait) {
                        console.log(`[Anti-Ban] Batch cooldown: waiting ${Math.ceil(cooldownCheck.waitTime / 1000)}s`);
                        await delay(cooldownCheck.waitTime);
                    }
                    messageData = this.normalQueue.shift();
                }
                
                if (!messageData) continue;
                
                try {
                    // Send the message using safeSendMessage
                    const result = await safeSendMessageDirect(
                        messageData.socket,
                        messageData.jid,
                        messageData.message,
                        messageData.incomingText,
                        messageData.antiBanManager,
                        messageData.options
                    );
                    
                    this.currentBatchCount++;
                    this.totalSent++;
                    
                    if (messageData.resolve) {
                        messageData.resolve(result);
                    }
                } catch (error) {
                    if (messageData.reject) {
                        messageData.reject(error);
                    }
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }
    
    /**
     * Get queue statistics
     */
    getStats() {
        return {
            priorityQueueLength: this.priorityQueue.length,
            normalQueueLength: this.normalQueue.length,
            currentBatchCount: this.currentBatchCount,
            batchSize: this.batchSize,
            totalQueued: this.totalQueued,
            totalSent: this.totalSent,
            batchesSent: this.batchesSent,
            isProcessing: this.isProcessing
        };
    }
    
    /**
     * Clear all queued messages
     */
    clearQueue() {
        const cleared = this.priorityQueue.length + this.normalQueue.length;
        this.priorityQueue = [];
        this.normalQueue = [];
        return cleared;
    }
}

class AntiBanManager {
    constructor(customLimits = null) {
        this.messageCount = { hour: 0, day: 0 };
        this.chatCount = { hour: new Set(), day: new Set() };
        this.lastMessageTime = 0;
        this.lastHourReset = Date.now();
        this.lastDayReset = Date.now();

        // Apply custom limits if provided
        if (customLimits) {
            this.updateLimits(customLimits);
        }
    }

    /**
     * Update rate limits dynamically
     * @param {Object} newLimits - New limits to apply
     */
    updateLimits(newLimits) {
        if (newLimits.preset && PRESETS[newLimits.preset]) {
            RATE_LIMITS = { ...PRESETS[newLimits.preset] };
        } else {
            RATE_LIMITS = {
                messagesPerHour: newLimits.messagesPerHour || RATE_LIMITS.messagesPerHour,
                messagesPerDay: newLimits.messagesPerDay || RATE_LIMITS.messagesPerDay,
                uniqueChatsPerHour: newLimits.uniqueChatsPerHour || RATE_LIMITS.uniqueChatsPerHour,
                uniqueChatsPerDay: newLimits.uniqueChatsPerDay || RATE_LIMITS.uniqueChatsPerDay
            };
        }
        console.log('[Anti-Ban] Limits updated:', RATE_LIMITS);
    }

    /**
     * Get current rate limits
     */
    getLimits() {
        return { ...RATE_LIMITS };
    }

    /**
     * Reset counters periodically
     */
    checkAndResetCounters() {
        const now = Date.now();

        // Reset hourly counters
        if (now - this.lastHourReset > 3600000) {
            this.messageCount.hour = 0;
            this.chatCount.hour.clear();
            this.lastHourReset = now;
            console.log('[Anti-Ban] Hourly counters reset');
        }

        // Reset daily counters
        if (now - this.lastDayReset > 86400000) {
            this.messageCount.day = 0;
            this.chatCount.day.clear();
            this.lastDayReset = now;
            console.log('[Anti-Ban] Daily counters reset');
        }
    }

    /**
     * Check if we can send a message
     * @param {string} chatId - The chat ID
     * @returns {Object} - { allowed: boolean, reason?: string, waitTime?: number }
     */
    canSendMessage(chatId) {
        this.checkAndResetCounters();

        if (this.messageCount.hour >= RATE_LIMITS.messagesPerHour) {
            return {
                allowed: false,
                reason: 'Hourly message limit reached',
                waitTime: this.getHourlyResetTime()
            };
        }

        if (this.messageCount.day >= RATE_LIMITS.messagesPerDay) {
            return {
                allowed: false,
                reason: 'Daily message limit reached',
                waitTime: this.getDailyResetTime()
            };
        }

        if (!this.chatCount.hour.has(chatId) &&
            this.chatCount.hour.size >= RATE_LIMITS.uniqueChatsPerHour) {
            return {
                allowed: false,
                reason: 'Hourly unique chat limit reached',
                waitTime: this.getHourlyResetTime()
            };
        }

        if (!this.chatCount.day.has(chatId) &&
            this.chatCount.day.size >= RATE_LIMITS.uniqueChatsPerDay) {
            return {
                allowed: false,
                reason: 'Daily unique chat limit reached',
                waitTime: this.getDailyResetTime()
            };
        }

        return { allowed: true };
    }

    /**
     * Calculate human-like delay based on message length
     * @param {string} incomingMessage - The received message
     * @param {string} outgoingReply - The reply to send
     * @returns {number} - Delay in milliseconds
     */
    calculateDelay(incomingMessage, outgoingReply) {
        const wordCount = (incomingMessage || '').split(/\s+/).length;
        const readingTime = wordCount * DELAY_CONFIG.readingSpeedMs;
        const typingTime = (outgoingReply || '').length * DELAY_CONFIG.typingSpeedMs;

        let baseDelay = DELAY_CONFIG.minDelay + readingTime + typingTime;

        // Apply time-of-day multiplier
        baseDelay *= this.getTimeMultiplier();

        // Apply random variance (+/- 30%)
        const variance = baseDelay * DELAY_CONFIG.varianceFactor;
        baseDelay += (Math.random() * 2 - 1) * variance;

        // Clamp to min/max
        return Math.max(
            DELAY_CONFIG.minDelay,
            Math.min(DELAY_CONFIG.maxDelay, Math.floor(baseDelay))
        );
    }

    /**
     * Get time-of-day multiplier for more natural patterns
     * People respond slower at night, faster during business hours
     */
    getTimeMultiplier() {
        const hour = new Date().getHours();

        if (hour >= 0 && hour < 6) return 2.0;   // Late night: much slower
        if (hour >= 6 && hour < 9) return 1.3;   // Early morning: slower
        if (hour >= 9 && hour < 12) return 1.0;  // Morning: normal
        if (hour >= 12 && hour < 14) return 1.2; // Lunch: slightly slower
        if (hour >= 14 && hour < 18) return 1.0; // Afternoon: normal
        if (hour >= 18 && hour < 22) return 1.1; // Evening: slightly slower
        return 1.5;                               // Night: slower
    }

    /**
     * Record a sent message
     * @param {string} chatId - The chat ID
     */
    recordMessage(chatId) {
        this.messageCount.hour++;
        this.messageCount.day++;
        this.chatCount.hour.add(chatId);
        this.chatCount.day.add(chatId);
        this.lastMessageTime = Date.now();
    }

    /**
     * Get remaining time until hourly reset
     */
    getHourlyResetTime() {
        return Math.max(0, 3600000 - (Date.now() - this.lastHourReset));
    }

    /**
     * Get remaining time until daily reset
     */
    getDailyResetTime() {
        return Math.max(0, 86400000 - (Date.now() - this.lastDayReset));
    }

    /**
     * Get current statistics
     */
    getStats() {
        this.checkAndResetCounters();
        return {
            messagesThisHour: this.messageCount.hour,
            messagesThisDay: this.messageCount.day,
            uniqueChatsThisHour: this.chatCount.hour.size,
            uniqueChatsThisDay: this.chatCount.day.size,
            limits: { ...RATE_LIMITS },
            nextHourlyReset: new Date(this.lastHourReset + 3600000).toISOString(),
            nextDailyReset: new Date(this.lastDayReset + 86400000).toISOString()
        };
    }

    /**
     * Get health status with warnings
     */
    getHealth() {
        const stats = this.getStats();
        const hourlyUsage = (stats.messagesThisHour / RATE_LIMITS.messagesPerHour) * 100;
        const dailyUsage = (stats.messagesThisDay / RATE_LIMITS.messagesPerDay) * 100;
        const hourlyChatsUsage = (stats.uniqueChatsThisHour / RATE_LIMITS.uniqueChatsPerHour) * 100;
        const dailyChatsUsage = (stats.uniqueChatsThisDay / RATE_LIMITS.uniqueChatsPerDay) * 100;

        const warnings = [];
        if (hourlyUsage > 80) warnings.push('Approaching hourly message limit');
        if (dailyUsage > 80) warnings.push('Approaching daily message limit');
        if (hourlyChatsUsage > 80) warnings.push('Approaching hourly chat limit');
        if (dailyChatsUsage > 80) warnings.push('Approaching daily chat limit');

        let status = 'healthy';
        if (warnings.length > 0) status = 'warning';
        if (hourlyUsage >= 100 || dailyUsage >= 100) status = 'limited';

        return {
            status,
            hourlyUsage: Math.round(hourlyUsage),
            dailyUsage: Math.round(dailyUsage),
            hourlyChatsUsage: Math.round(hourlyChatsUsage),
            dailyChatsUsage: Math.round(dailyChatsUsage),
            warnings,
            stats
        };
    }
}

/**
 * Delay utility function
 * @param {number} ms - Milliseconds to delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simulate typing indicator for realistic behavior
 * @param {Object} socket - Baileys socket
 * @param {string} jid - Chat JID
 * @param {number} messageLength - Length of message to "type"
 */
async function simulateTyping(socket, jid, messageLength) {
    try {
        // Calculate realistic typing duration
        const typingSpeed = 40 + Math.random() * 20; // 40-60 chars/second
        const thinkingTime = 1000 + Math.random() * 2000; // 1-3 seconds thinking
        const typingDuration = (messageLength / typingSpeed) * 1000;

        // Start typing indicator
        await socket.sendPresenceUpdate('composing', jid);

        // For longer messages, simulate pauses (thinking breaks)
        if (messageLength > 100) {
            const pauseCount = Math.floor(messageLength / 100);
            const segmentTime = typingDuration / (pauseCount + 1);

            for (let i = 0; i < pauseCount; i++) {
                await delay(segmentTime);
                await socket.sendPresenceUpdate('paused', jid);
                await delay(500 + Math.random() * 1000); // Brief pause
                await socket.sendPresenceUpdate('composing', jid);
            }
            await delay(segmentTime);
        } else {
            await delay(thinkingTime + typingDuration);
        }

        // Stop typing indicator
        await socket.sendPresenceUpdate('paused', jid);
    } catch (error) {
        console.error('[Anti-Ban] Typing simulation error:', error.message);
        // Continue even if typing simulation fails
    }
}

/**
 * ANTI-BAN: Simulate reading a message before replying
 * Marks the message as read and waits a realistic "reading" time
 * @param {Object} socket - Baileys socket
 * @param {Object} messageKey - The message key to mark as read
 * @param {string} messageText - The message text (for calculating read time)
 */
async function simulateReadReceipt(socket, messageKey, messageText = '') {
    try {
        // Mark message as read (sends blue ticks)
        await socket.readMessages([messageKey]);
        
        // Calculate realistic reading time based on message length
        // Average reading speed: 200-250 words per minute = ~4 words per second
        const wordCount = (messageText || '').split(/\s+/).length;
        const readingTime = Math.max(1000, Math.min(5000, wordCount * 250)); // 1-5 seconds
        
        // Add some variance
        const variance = readingTime * 0.3;
        const finalReadTime = readingTime + (Math.random() * 2 - 1) * variance;
        
        console.log(`[Anti-Ban] Simulating read receipt: ${Math.round(finalReadTime)}ms reading time`);
        await delay(finalReadTime);
        
    } catch (error) {
        console.error('[Anti-Ban] Read receipt simulation error:', error.message);
        // Continue even if read receipt fails
    }
}

/**
 * Direct send message with all anti-ban protections (internal use)
 * This is the actual sending function, used directly or via batcher
 */
async function safeSendMessageDirect(socket, jid, message, incomingText, antiBanManager, options = {}) {
    const { 
        typingSimulation = true, 
        delayEnabled = true,
        messageKey = null,
        simulateReading = true,
        relayMessage = null
    } = options;
    
    // Check rate limits
    const canSend = antiBanManager.canSendMessage(jid);
    if (!canSend.allowed) {
        console.log(`[Anti-Ban] BLOCKED: ${canSend.reason}. Wait ${Math.ceil(canSend.waitTime / 1000)}s`);
        return { sent: false, reason: canSend.reason, waitTime: canSend.waitTime };
    }
    
    // ANTI-BAN: Simulate reading the message first (if messageKey provided)
    if (simulateReading && messageKey) {
        await simulateReadReceipt(socket, messageKey, incomingText);
    }

    // Get message text for delay calculation
    const messageText = typeof message === 'string'
        ? message
        : (message.__wasupMessageText || message.text || '');

    let delayMs = 0;
    
    if (delayEnabled) {
        // Calculate human-like delay
        delayMs = antiBanManager.calculateDelay(incomingText, messageText);
        console.log(`[Anti-Ban] Waiting ${delayMs}ms before reply...`);
    }

    // Simulate typing for the duration (if enabled)
    if (typingSimulation) {
        await simulateTyping(socket, jid, messageText.length);
        
        // Additional delay if needed (typing simulation might be shorter)
        if (delayEnabled) {
            const remainingDelay = delayMs - (messageText.length * 50);
            if (remainingDelay > 0) {
                await delay(remainingDelay);
            }
        }
    } else if (delayEnabled && delayMs > 0) {
        // If no typing simulation but delay enabled, just wait
        await delay(delayMs);
    }

    // Send the message
    const messageObj = typeof message === 'string' ? { text: message } : message;
    if (messageObj?.__wasupInteractiveContent) {
        await sendInteractiveViaHelper(socket, jid, messageObj.__wasupInteractiveContent);
    } else if (messageObj?.__wasupRelayContent) {
        if (typeof relayMessage !== 'function') {
            throw new Error('This message type is not configured for direct delivery on this instance');
        }
        await relayMessage(socket, jid, messageObj.__wasupRelayContent, {
            mode: messageObj.__wasupRelayMode || null
        });
    } else {
        const { __wasupMessageText, __wasupRelayContent, __wasupInteractiveContent, ...sendableMessage } = messageObj || {};
        await socket.sendMessage(jid, sendableMessage);
    }

    // Record the message for rate limiting
    antiBanManager.recordMessage(jid);

    return { sent: true, delay: delayMs, typingSimulation, delayEnabled };
}

/**
 * Safe send message with all anti-ban protections
 * This is the main export - uses direct sending (batching is optional and managed separately)
 * @param {Object} socket - Baileys socket
 * @param {string} jid - Chat JID
 * @param {Object|string} message - Message to send
 * @param {string} incomingText - Original incoming message text
 * @param {AntiBanManager} antiBanManager - Anti-ban manager instance
 * @param {Object} options - Additional options
 * @param {boolean} options.typingSimulation - Enable typing simulation (default: true)
 * @param {boolean} options.delayEnabled - Enable human-like delays (default: true)
 * @param {Object} options.messageKey - Original message key for read receipt simulation
 * @param {boolean} options.simulateReading - Enable read receipt simulation (default: true)
 */
async function safeSendMessage(socket, jid, message, incomingText, antiBanManager, options = {}) {
    return safeSendMessageDirect(socket, jid, message, incomingText, antiBanManager, options);
}

export {
    AntiBanManager,
    MessageBatcher,
    delay,
    simulateTyping,
    simulateReadReceipt,
    safeSendMessage,
    safeSendMessageDirect,
    PRESETS,
    DELAY_CONFIG,
    BATCH_CONFIG
};
