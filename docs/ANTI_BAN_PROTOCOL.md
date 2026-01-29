# WhatsApp Anti-Ban Protocol

> **Version:** 1.0
> **Last Updated:** December 17, 2025
> **Purpose:** Risk reduction strategies for WhatsApp automation using Baileys

---

## Table of Contents

1. [Why Accounts Get Banned](#1-why-accounts-get-banned)
2. [Human-Like Delay System](#2-human-like-delay-system)
3. [Rate Limiting Configuration](#3-rate-limiting-configuration)
4. [Typing Indicator Simulation](#4-typing-indicator-simulation)
5. [Account Warm-Up Protocol](#5-account-warm-up-protocol)
6. [Profile Requirements](#6-profile-requirements)
7. [JavaScript Anti-Ban Module](#7-javascript-anti-ban-module)
8. [Client Onboarding Checklist](#8-client-onboarding-checklist)
9. [Risk Mitigation Strategies](#9-risk-mitigation-strategies)
10. [Monitoring & Early Warning Signs](#10-monitoring--early-warning-signs)

---

## 1. Why Accounts Get Banned

WhatsApp's detection systems flag accounts based on several behavioral patterns:

### High-Risk Behaviors
| Behavior | Risk Level | Detection Method |
|----------|------------|------------------|
| Instant replies (<1 second) | **Critical** | Timing analysis |
| Identical messages to many users | **Critical** | Content hashing |
| High message volume (>100/hour) | **High** | Rate monitoring |
| New account + high activity | **High** | Age/activity ratio |
| No profile picture/status | **Medium** | Profile completeness |
| Messages to non-contacts | **Medium** | Contact relationship |
| Sending during odd hours only | **Low** | Activity pattern |

### Account Age Factor
```
New Account (0-7 days):    EXTREME RISK - minimal automation
Week 2-4:                  HIGH RISK - light automation only
Month 2-3:                 MEDIUM RISK - moderate automation
Month 4+:                  LOWER RISK - full automation possible
```

### Ban Types
1. **Temporary Ban (24-72 hours)**: First offense, usually recoverable
2. **Extended Ban (2 weeks)**: Repeated violations
3. **Permanent Ban**: Severe violations or multiple offenses

---

## 2. Human-Like Delay System

### Delay Formula
```javascript
// Base delay: 1-3 seconds minimum
// Reading time: ~200ms per word in message received
// Typing time: ~50ms per character in response
// Random variance: +/- 30%

function calculateHumanDelay(incomingMessage, outgoingReply) {
    const readingTime = incomingMessage.split(' ').length * 200;
    const typingTime = outgoingReply.length * 50;
    const baseDelay = Math.random() * 2000 + 1000; // 1-3 seconds

    const totalDelay = baseDelay + readingTime + typingTime;
    const variance = totalDelay * (Math.random() * 0.6 - 0.3); // +/- 30%

    return Math.floor(totalDelay + variance);
}
```

### Recommended Delay Ranges
| Message Length | Minimum Delay | Maximum Delay |
|----------------|---------------|---------------|
| Short (1-5 words) | 2 seconds | 5 seconds |
| Medium (6-20 words) | 4 seconds | 10 seconds |
| Long (21-50 words) | 8 seconds | 20 seconds |
| Very Long (50+ words) | 15 seconds | 45 seconds |

### Time of Day Adjustments
```javascript
function getTimeMultiplier() {
    const hour = new Date().getHours();

    if (hour >= 0 && hour < 6) return 2.0;   // Late night: slower
    if (hour >= 6 && hour < 9) return 1.3;   // Early morning: slower
    if (hour >= 9 && hour < 12) return 1.0;  // Morning: normal
    if (hour >= 12 && hour < 14) return 1.2; // Lunch: slightly slower
    if (hour >= 14 && hour < 18) return 1.0; // Afternoon: normal
    if (hour >= 18 && hour < 22) return 1.1; // Evening: slightly slower
    return 1.5;                               // Night: slower
}
```

---

## 3. Rate Limiting Configuration

### Hourly Limits by Account Age
| Account Age | Messages/Hour | Unique Chats/Hour |
|-------------|---------------|-------------------|
| Week 1 | 10-15 | 5-8 |
| Week 2-4 | 20-30 | 10-15 |
| Month 2-3 | 40-60 | 20-30 |
| Month 4+ | 80-100 | 40-50 |

### Daily Limits
```javascript
const DAILY_LIMITS = {
    week1: { messages: 50, uniqueChats: 20 },
    week2to4: { messages: 150, uniqueChats: 50 },
    month2to3: { messages: 300, uniqueChats: 100 },
    month4plus: { messages: 500, uniqueChats: 200 }
};
```

### Cooldown Periods
```javascript
const COOLDOWN_CONFIG = {
    afterBurst: 300000,        // 5 minutes after 10+ messages in 5 min
    afterNewContact: 60000,    // 1 minute after messaging new contact
    afterMedia: 30000,         // 30 seconds after sending media
    betweenChats: 5000,        // 5 seconds between different chats
    hourlyReset: 3600000       // Reset counters every hour
};
```

---

## 4. Typing Indicator Simulation

### Implementation
```javascript
async function simulateTyping(socket, jid, messageLength) {
    // Calculate realistic typing duration
    const typingSpeed = 40 + Math.random() * 20; // 40-60 chars/second
    const thinkingTime = 1000 + Math.random() * 2000; // 1-3 seconds
    const typingDuration = (messageLength / typingSpeed) * 1000;

    // Start typing indicator
    await socket.sendPresenceUpdate('composing', jid);

    // Simulate pauses for longer messages (thinking breaks)
    if (messageLength > 100) {
        const pauseCount = Math.floor(messageLength / 100);
        const segmentTime = typingDuration / (pauseCount + 1);

        for (let i = 0; i < pauseCount; i++) {
            await delay(segmentTime);
            await socket.sendPresenceUpdate('paused', jid);
            await delay(500 + Math.random() * 1000);
            await socket.sendPresenceUpdate('composing', jid);
        }
        await delay(segmentTime);
    } else {
        await delay(thinkingTime + typingDuration);
    }

    // Stop typing indicator
    await socket.sendPresenceUpdate('paused', jid);
}
```

### Presence Updates
```javascript
// Available presence states
'available'   // Online
'unavailable' // Offline
'composing'   // Typing...
'paused'      // Stopped typing
'recording'   // Recording audio
```

---

## 5. Account Warm-Up Protocol

### Phase 1: Days 1-3 (Manual Only)
- [ ] Complete profile setup (photo, name, status, about)
- [ ] Add 10-20 contacts manually
- [ ] Send manual messages to friends/family
- [ ] Join 2-3 group chats
- [ ] **NO automation whatsoever**

### Phase 2: Days 4-7 (Minimal Automation)
- [ ] Enable bot for **3-5 trusted contacts only**
- [ ] Maximum 20 messages/day
- [ ] Respond only to incoming messages (no outbound)
- [ ] Monitor for any warnings or restrictions
- [ ] Manual interaction: 30% of activity

### Phase 3: Week 2 (Light Automation)
- [ ] Expand to 10-15 contacts
- [ ] Maximum 50 messages/day
- [ ] Enable auto-reply during business hours only
- [ ] Continue manual interaction: 20% of activity

### Phase 4: Week 3-4 (Moderate Automation)
- [ ] Expand to 25-30 contacts
- [ ] Maximum 100 messages/day
- [ ] Enable auto-reply 12 hours/day
- [ ] Continue manual interaction: 10% of activity

### Phase 5: Month 2+ (Full Automation)
- [ ] Gradual increase to full capacity
- [ ] Maximum 300-500 messages/day
- [ ] 24/7 availability (with rate limiting)
- [ ] Weekly manual check-ins recommended

---

## 6. Profile Requirements

### Mandatory Setup
```
[x] Profile Picture     - Real photo, not logo (for personal accounts)
[x] Display Name        - Full name, not business name initially
[x] About/Status        - Something personal, not promotional
[x] Privacy Settings    - Default (not "Nobody")
```

### Business Account Considerations
| Factor | Personal Number | WhatsApp Business |
|--------|-----------------|-------------------|
| Detection Risk | Lower initially | Slightly higher monitoring |
| Features | Basic | Catalog, labels, quick replies |
| Recommendation | Use for first 30 days | Migrate after warm-up |

### Status Updates
Post occasional status updates (1-2 per week) during warm-up:
- Personal photos
- Non-promotional content
- Engage with others' statuses

---

## 7. JavaScript Anti-Ban Module

### Complete Implementation

```javascript
// File: app/src/utils/anti-ban.js

const RATE_LIMITS = {
    messagesPerHour: 50,
    messagesPerDay: 300,
    uniqueChatsPerHour: 25,
    uniqueChatsPerDay: 100
};

const DELAY_CONFIG = {
    minDelay: 2000,           // 2 seconds minimum
    maxDelay: 45000,          // 45 seconds maximum
    readingSpeedMs: 200,      // ms per word to "read"
    typingSpeedMs: 50,        // ms per character to "type"
    varianceFactor: 0.3       // +/- 30% randomness
};

class AntiBanManager {
    constructor() {
        this.messageCount = { hour: 0, day: 0 };
        this.chatCount = { hour: new Set(), day: new Set() };
        this.lastMessageTime = 0;
        this.lastHourReset = Date.now();
        this.lastDayReset = Date.now();
    }

    // Reset counters periodically
    checkAndResetCounters() {
        const now = Date.now();

        if (now - this.lastHourReset > 3600000) {
            this.messageCount.hour = 0;
            this.chatCount.hour.clear();
            this.lastHourReset = now;
        }

        if (now - this.lastDayReset > 86400000) {
            this.messageCount.day = 0;
            this.chatCount.day.clear();
            this.lastDayReset = now;
        }
    }

    // Check if we can send a message
    canSendMessage(chatId) {
        this.checkAndResetCounters();

        if (this.messageCount.hour >= RATE_LIMITS.messagesPerHour) {
            return { allowed: false, reason: 'Hourly message limit reached', waitTime: this.getHourlyResetTime() };
        }

        if (this.messageCount.day >= RATE_LIMITS.messagesPerDay) {
            return { allowed: false, reason: 'Daily message limit reached', waitTime: this.getDailyResetTime() };
        }

        if (!this.chatCount.hour.has(chatId) && this.chatCount.hour.size >= RATE_LIMITS.uniqueChatsPerHour) {
            return { allowed: false, reason: 'Hourly unique chat limit reached', waitTime: this.getHourlyResetTime() };
        }

        return { allowed: true };
    }

    // Calculate human-like delay
    calculateDelay(incomingMessage, outgoingReply) {
        const wordCount = incomingMessage.split(/\s+/).length;
        const readingTime = wordCount * DELAY_CONFIG.readingSpeedMs;
        const typingTime = outgoingReply.length * DELAY_CONFIG.typingSpeedMs;

        let baseDelay = DELAY_CONFIG.minDelay + readingTime + typingTime;

        // Apply time-of-day multiplier
        baseDelay *= this.getTimeMultiplier();

        // Apply random variance
        const variance = baseDelay * DELAY_CONFIG.varianceFactor;
        baseDelay += (Math.random() * 2 - 1) * variance;

        // Clamp to min/max
        return Math.max(DELAY_CONFIG.minDelay, Math.min(DELAY_CONFIG.maxDelay, Math.floor(baseDelay)));
    }

    // Time-of-day multiplier for more natural patterns
    getTimeMultiplier() {
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 6) return 2.0;
        if (hour >= 6 && hour < 9) return 1.3;
        if (hour >= 9 && hour < 12) return 1.0;
        if (hour >= 12 && hour < 14) return 1.2;
        if (hour >= 14 && hour < 18) return 1.0;
        if (hour >= 18 && hour < 22) return 1.1;
        return 1.5;
    }

    // Record a sent message
    recordMessage(chatId) {
        this.messageCount.hour++;
        this.messageCount.day++;
        this.chatCount.hour.add(chatId);
        this.chatCount.day.add(chatId);
        this.lastMessageTime = Date.now();
    }

    // Get remaining time until hourly reset
    getHourlyResetTime() {
        return Math.max(0, 3600000 - (Date.now() - this.lastHourReset));
    }

    // Get remaining time until daily reset
    getDailyResetTime() {
        return Math.max(0, 86400000 - (Date.now() - this.lastDayReset));
    }

    // Get current stats
    getStats() {
        this.checkAndResetCounters();
        return {
            messagesThisHour: this.messageCount.hour,
            messagesThisDay: this.messageCount.day,
            uniqueChatsThisHour: this.chatCount.hour.size,
            uniqueChatsThisDay: this.chatCount.day.size,
            limits: RATE_LIMITS
        };
    }
}

// Delay utility
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Typing simulation
async function simulateTyping(socket, jid, messageLength) {
    const typingSpeed = 40 + Math.random() * 20;
    const thinkingTime = 1000 + Math.random() * 2000;
    const typingDuration = (messageLength / typingSpeed) * 1000;

    await socket.sendPresenceUpdate('composing', jid);

    if (messageLength > 100) {
        const pauseCount = Math.floor(messageLength / 100);
        const segmentTime = typingDuration / (pauseCount + 1);

        for (let i = 0; i < pauseCount; i++) {
            await delay(segmentTime);
            await socket.sendPresenceUpdate('paused', jid);
            await delay(500 + Math.random() * 1000);
            await socket.sendPresenceUpdate('composing', jid);
        }
        await delay(segmentTime);
    } else {
        await delay(thinkingTime + typingDuration);
    }

    await socket.sendPresenceUpdate('paused', jid);
}

// Safe send message with all protections
async function safeSendMessage(socket, jid, message, incomingText, antiBanManager) {
    // Check rate limits
    const canSend = antiBanManager.canSendMessage(jid);
    if (!canSend.allowed) {
        console.log(`[RATE LIMIT] ${canSend.reason}. Wait ${Math.ceil(canSend.waitTime / 1000)}s`);
        return { sent: false, reason: canSend.reason };
    }

    // Calculate and apply delay
    const messageText = typeof message === 'string' ? message : message.text || '';
    const delayMs = antiBanManager.calculateDelay(incomingText, messageText);

    console.log(`[ANTI-BAN] Waiting ${delayMs}ms before reply...`);

    // Simulate typing
    await simulateTyping(socket, jid, messageText.length);

    // Additional delay after typing
    await delay(delayMs - (messageText.length * 50));

    // Send the message
    await socket.sendMessage(jid, message);

    // Record the message
    antiBanManager.recordMessage(jid);

    return { sent: true, delay: delayMs };
}

module.exports = {
    AntiBanManager,
    delay,
    simulateTyping,
    safeSendMessage,
    RATE_LIMITS,
    DELAY_CONFIG
};
```

### Usage Example

```javascript
const { AntiBanManager, safeSendMessage } = require('./utils/anti-ban');

const antiBan = new AntiBanManager();

// In your message handler
sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const incomingText = msg.message.conversation ||
                         msg.message.extendedTextMessage?.text || '';

    // Get AI response from n8n
    const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: incomingText, from })
    });
    const { reply } = await response.json();

    // Send with anti-ban protection
    const result = await safeSendMessage(sock, from, { text: reply }, incomingText, antiBan);

    if (!result.sent) {
        console.log(`Message queued or skipped: ${result.reason}`);
    }
});
```

---

## 8. Client Onboarding Checklist

### Pre-Deployment (Client Responsibility)
```markdown
## Client Onboarding Form

**Phone Number Details:**
- [ ] Phone number age: _____ months
- [ ] Has WhatsApp been used on this number before? Yes / No
- [ ] Any previous bans on this number? Yes / No

**Account Setup (REQUIRED before automation):**
- [ ] Profile picture uploaded (real photo, not logo)
- [ ] Display name set (full name format)
- [ ] About/status written (non-promotional)
- [ ] 10+ contacts saved in phone
- [ ] Active in 2+ group chats
- [ ] Manual conversations: _____ in past 7 days

**Warm-Up Period Agreement:**
- [ ] Week 1: Manual usage only (no bot)
- [ ] Week 2-4: Limited bot activation (50 msgs/day max)
- [ ] Month 2+: Full bot activation

**Client Signature: _______________ Date: ___________
```

### Deployment Steps
1. **Day 0**: Complete client checklist, verify phone number history
2. **Day 1-3**: Client uses WhatsApp manually, we monitor
3. **Day 4**: Install bot in "passive mode" (logging only)
4. **Day 7**: Enable replies to 5 trusted test contacts
5. **Day 14**: Expand to 15 contacts
6. **Day 21**: Expand to 30 contacts
7. **Day 30**: Full deployment with rate limiting

---

## 9. Risk Mitigation Strategies

### Message Content Guidelines
| Do | Don't |
|----|-------|
| Personalize each response | Send identical messages |
| Use natural language variations | Use template text repeatedly |
| Include typos occasionally | Perfect grammar always |
| Vary response length | Same length responses |
| Use emoji naturally | Overuse emoji patterns |

### Behavioral Guidelines
| Do | Don't |
|----|-------|
| Respond only to incoming messages | Initiate broadcast messages |
| Maintain business hours | 24/7 instant responses |
| Pause on weekends occasionally | Non-stop availability |
| Vary online/offline status | Always online |
| Delay first response to new chats | Instant reply to strangers |

### Message Variation Examples
```javascript
const greetingVariations = [
    "Hi! How can I help you today?",
    "Hello! What can I do for you?",
    "Hey there! How may I assist you?",
    "Hi, thanks for reaching out! How can I help?",
    "Hello! Thanks for your message. What do you need?"
];

function getRandomGreeting() {
    return greetingVariations[Math.floor(Math.random() * greetingVariations.length)];
}
```

---

## 10. Monitoring & Early Warning Signs

### Warning Signs to Watch
| Sign | Risk Level | Action |
|------|------------|--------|
| "Try again later" error | Medium | Pause 1-2 hours |
| QR code re-scan required | High | Reduce volume 50% |
| Messages not delivering | High | Pause 24 hours |
| Temporary restriction notice | Critical | Pause 72 hours |
| Account review notice | Critical | Stop all automation |

### Health Check Endpoints
```javascript
// Add to your Express server
app.get('/api/anti-ban/stats', (req, res) => {
    res.json(antiBanManager.getStats());
});

app.get('/api/anti-ban/health', (req, res) => {
    const stats = antiBanManager.getStats();
    const hourlyUsage = (stats.messagesThisHour / RATE_LIMITS.messagesPerHour) * 100;
    const dailyUsage = (stats.messagesThisDay / RATE_LIMITS.messagesPerDay) * 100;

    res.json({
        status: hourlyUsage > 80 || dailyUsage > 80 ? 'warning' : 'healthy',
        hourlyUsage: `${hourlyUsage.toFixed(1)}%`,
        dailyUsage: `${dailyUsage.toFixed(1)}%`,
        recommendations: hourlyUsage > 80 ? ['Consider reducing automation'] : []
    });
});
```

### Daily Monitoring Checklist
- [ ] Check message delivery rate
- [ ] Review rate limit stats
- [ ] Verify no warning messages
- [ ] Check connection stability
- [ ] Review response time patterns

---

## Appendix: Quick Reference Card

```
+--------------------------------------------------+
|          ANTI-BAN QUICK REFERENCE                |
+--------------------------------------------------+
| DELAYS:                                          |
|   Min: 2 seconds | Max: 45 seconds              |
|   Formula: Reading + Typing + Random Variance    |
+--------------------------------------------------+
| RATE LIMITS:                                     |
|   Hourly: 50 messages, 25 unique chats          |
|   Daily: 300 messages, 100 unique chats         |
+--------------------------------------------------+
| WARM-UP:                                         |
|   Week 1: Manual only (0 bot messages)          |
|   Week 2-4: 50 msgs/day max                     |
|   Month 2+: Full capacity                       |
+--------------------------------------------------+
| PROFILE:                                         |
|   - Real photo                                   |
|   - Full name                                    |
|   - Non-promotional status                       |
|   - 10+ contacts                                 |
+--------------------------------------------------+
| RED FLAGS:                                       |
|   - "Try again later" = PAUSE 1-2 hours         |
|   - QR re-scan needed = REDUCE 50%              |
|   - Account review = STOP ALL                    |
+--------------------------------------------------+
```

---

## 11. Baileys-Recommended Socket Configuration

Based on the official [Baileys documentation](https://baileys.wiki/docs/socket/configuration/), the following configurations are **critical** for anti-ban protection.

### cachedGroupMetadata (CRITICAL)

From Baileys docs:
> "When sending messages to a group, the sendMessage function will try to get the group participant list (to encrypt the message to each participant). **This is a problem and causes a ratelimit and potential bans from WhatsApp.** To counter this, you should provide the socket with a cachedGroupMetadata cache."

```javascript
const NodeCache = require('node-cache');
const groupCache = new NodeCache({ stdTTL: 300 }); // 5 min TTL

const sock = makeWASocket({
    cachedGroupMetadata: async (jid) => groupCache.get(jid)
});

// Update cache on group events
sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
        groupCache.set(update.id, update);
    }
});
```

### userDevicesCache

Reduces redundant device list queries when messaging the same user multiple times.

```javascript
const userDevicesCache = new NodeCache({ stdTTL: 600 });

const sock = makeWASocket({
    userDevicesCache: userDevicesCache
});
```

### markOnlineOnConnect: false (Stealth Mode)

From Baileys docs:
> "By default, Baileys sets your presence as online on connect. This will stop sending notifications to your phone."

Setting this to `false` makes the bot appear offline until explicitly set online.

```javascript
const sock = makeWASocket({
    markOnlineOnConnect: false
});
```

### getMessage Implementation (Retry Handling)

From Baileys docs:
> "This functionality is needed for resending missing messages or decrypting poll votes... implement this so that messages failed to send can be retried"

```javascript
const messageStore = new Map();

const sock = makeWASocket({
    getMessage: async (key) => {
        const msg = messageStore.get(key.id);
        return msg?.message || undefined;
    }
});

// Store messages for retry
sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
        if (msg.key?.id && msg.message) {
            messageStore.set(msg.key.id, { message: msg.message });
        }
    }
});
```

### msgRetryCounterCache

Prevents excessive retry attempts that could look suspicious.

```javascript
const msgRetryCounterCache = new NodeCache({ stdTTL: 1800 });

const sock = makeWASocket({
    msgRetryCounterCache: msgRetryCounterCache
});
```

### mediaCache

Prevents re-uploading the same media repeatedly.

```javascript
const mediaCache = new NodeCache({ stdTTL: 3600 });

const sock = makeWASocket({
    mediaCache: mediaCache
});
```

### Full Socket Configuration Example

```javascript
const NodeCache = require('node-cache');
const pino = require('pino');

// Create caches
const groupMetadataCache = new NodeCache({ stdTTL: 300 });
const userDevicesCache = new NodeCache({ stdTTL: 600 });
const msgRetryCounterCache = new NodeCache({ stdTTL: 1800 });
const mediaCache = new NodeCache({ stdTTL: 3600 });
const messageStore = new Map();

const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    
    // CRITICAL: Group metadata cache
    cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid),
    
    // Reduce API calls
    userDevicesCache: userDevicesCache,
    msgRetryCounterCache: msgRetryCounterCache,
    mediaCache: mediaCache,
    
    // Stealth mode
    markOnlineOnConnect: false,
    
    // Retry handling
    getMessage: async (key) => messageStore.get(key.id)?.message,
    
    // Session health
    enableAutoSessionRecreation: true,
    enableRecentMessageCache: true
});
```

---

## 12. Advanced Anti-Ban Techniques

### Read Receipt Simulation

Before replying, mark the message as read and wait a realistic "reading" time:

```javascript
async function simulateReadReceipt(socket, messageKey, messageText) {
    // Mark as read (sends blue ticks)
    await socket.readMessages([messageKey]);
    
    // Calculate reading time (1-5 seconds based on length)
    const wordCount = messageText.split(/\s+/).length;
    const readingTime = Math.max(1000, Math.min(5000, wordCount * 250));
    
    await delay(readingTime);
}
```

### Presence Cycling

Periodically toggle online/offline status to avoid "always online" pattern:

```javascript
// Cycle presence every 3-7 minutes
setInterval(async () => {
    const random = Math.random();
    if (random < 0.3) {
        await sock.sendPresenceUpdate('unavailable');
    } else {
        await sock.sendPresenceUpdate('available');
    }
}, 180000 + Math.random() * 240000); // 3-7 minutes
```

### Message Batching

For broadcast/bulk messaging, send in batches with cooldowns:

```javascript
const BATCH_CONFIG = {
    maxBatchSize: 30,           // Max messages per batch
    batchCooldownMs: 300000     // 5 minutes between batches
};
```

### Contact Saving Before Messaging

Save contacts before sending to reduce "messaging non-contacts" risk:

```javascript
await socket.addOrEditContact(jid, {
    fullName: contactName,
    firstName: contactName,
    saveOnPrimaryAddressbook: true
});
```

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 17, 2025 | Initial documentation |
| 2.0 | Jan 29, 2026 | Added Baileys-recommended socket configurations, read receipt simulation, presence cycling, message batching, contact saving |

---

**Disclaimer**: WhatsApp's Terms of Service prohibit automated messaging. This documentation is for educational purposes. Use at your own risk. Implementing these protocols reduces but does not eliminate ban risk.
