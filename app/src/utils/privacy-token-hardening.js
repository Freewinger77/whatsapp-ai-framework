/**
 * tctoken / 463 / reachout hardening helpers.
 *
 * Baileys 7.0.0-rc13 already:
 *  - harvests chat.tcToken from history sync into auth keys (`tctoken`)
 *  - persists privacy_token notifications
 *  - stores under LID when possible
 *  - prunes ~28-day expired tokens
 *
 * This module adds Wasup-layer policy: expiry-aware lookup, cold vs warm
 * classification, per-contact 463 circuit breaker, fleet metrics, and an
 * optional proactive inbound `<tctoken>` capture (Baileys PR #2752 / issue #2698).
 */

import {
    getBinaryNodeChild,
    isHostedLidUser,
    isHostedPnUser,
    isJidGroup,
    isJidMetaAI,
    isLidUser,
    isPnUser,
    jidNormalizedUser
} from 'baileys';
import { hardeningBlocksColdWithoutToken } from './outbound-preflight.js';

/** Mirrors Baileys tc-token-utils (~28-day rolling window via 7-day buckets). */
const TC_TOKEN_BUCKET_DURATION = 604800;
const TC_TOKEN_NUM_BUCKETS = 4;

/** After a 463 NACK, pause cold sends to that contact (retries worsen reachout budget). */
export const CONTACT_463_CIRCUIT_MS = 6 * 60 * 60 * 1000;

export function isTcTokenExpired(timestamp) {
    if (timestamp === null || timestamp === undefined) return true;
    const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : Number(timestamp);
    if (!Number.isFinite(ts) || Number.isNaN(ts)) return true;
    const now = Math.floor(Date.now() / 1000);
    const currentBucket = Math.floor(now / TC_TOKEN_BUCKET_DURATION);
    const cutoffBucket = currentBucket - (TC_TOKEN_NUM_BUCKETS - 1);
    const cutoffTimestamp = cutoffBucket * TC_TOKEN_BUCKET_DURATION;
    return ts < cutoffTimestamp;
}

export function createPrivacyTokenMetrics() {
    return {
        tokenHits: 0,
        tokenMisses: 0,
        tokenExpired: 0,
        coldSends: 0,
        coldBlocked: 0,
        nack463: 0,
        historyHarvestEvents: 0,
        historyChatsWithToken: 0,
        proactiveCaptures: 0,
        last463At: null,
        last463Jid: null,
        lastHistoryHarvestAt: null,
        lastProactiveCaptureAt: null,
        lastProactiveCaptureJid: null,
    };
}

export function shouldBlockColdWithoutToken(options = {}) {
    return hardeningBlocksColdWithoutToken(options);
}

export function circuitKeyForJid(jid) {
    if (!jid || typeof jid !== 'string') return null;
    return jid.split('@')[0].split(':')[0] || null;
}

function pushLookupKey(keys, value) {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || keys.includes(trimmed)) return;
    keys.push(trimmed);
}

function digitsOnly(value) {
    return String(value || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
}

/**
 * Every JID Baileys / Wasup may have stored a tctoken under for this contact.
 * Tokens are almost always keyed by LID (`123@lid`); outbound send uses PN.
 */
export function collectPrivacyTokenLookupKeys(jid, lidCache = null, extraKeys = []) {
    const lookupKeys = [];
    if (!jid || String(jid).includes('@g.us')) return lookupKeys;

    const user = String(jid).split('@')[0].split(':')[0];
    const isLid = String(jid).includes('@lid');
    const pnUser = isLid ? null : digitsOnly(jid);

    if (isLid) {
        pushLookupKey(lookupKeys, jid.includes('@') ? jid : `${user}@lid`);
        pushLookupKey(lookupKeys, `${user}@lid`);
        if (lidCache?.get) {
            const pn = lidCache.get(user);
            if (pn) pushLookupKey(lookupKeys, `${digitsOnly(pn)}@s.whatsapp.net`);
        }
    } else if (pnUser) {
        pushLookupKey(lookupKeys, `${pnUser}@s.whatsapp.net`);
        pushLookupKey(lookupKeys, jid);
        if (lidCache && typeof lidCache.entries === 'function') {
            for (const [lid, pn] of lidCache.entries()) {
                if (digitsOnly(pn) === pnUser) pushLookupKey(lookupKeys, `${lid}@lid`);
            }
        }
    }

    for (const extra of extraKeys) pushLookupKey(lookupKeys, extra);
    return lookupKeys;
}

/**
 * Lookup a usable tctoken for an outbound PN/LID jid.
 * Prefers LID storage keys (WA Web indexing) then PN.
 */
export async function lookupPrivacyToken(sock, lidCache, jid, extraKeys = []) {
    const empty = { present: false, expired: false, storageJid: null, entry: null, lookupKeys: [] };
    if (!jid || jid.includes('@g.us')) return empty;

    const keys = sock?.authState?.keys;
    if (!keys?.get) return { ...empty, lookupKeys: collectPrivacyTokenLookupKeys(jid, lidCache, extraKeys) };

    const lookupKeys = collectPrivacyTokenLookupKeys(jid, lidCache, extraKeys);
    const mapping = sock?.signalRepository?.lidMapping;
    try {
        const lidJid = typeof mapping?.getLIDForPN === 'function'
            ? await mapping.getLIDForPN(jid)
            : null;
        pushLookupKey(lookupKeys, lidJid);
        if (lidJid && !String(lidJid).includes('@')) pushLookupKey(lookupKeys, `${lidJid}@lid`);
    } catch (_) { /* ignore */ }
    try {
        if (String(jid).includes('@lid') && typeof mapping?.getPNForLID === 'function') {
            const pnJid = await mapping.getPNForLID(jid);
            pushLookupKey(lookupKeys, pnJid);
        }
    } catch (_) { /* ignore */ }

    try {
        const existing = await keys.get('tctoken', lookupKeys);
        for (const key of lookupKeys) {
            const entry = existing?.[key];
            if (!entry?.token?.length) continue;
            const expired = isTcTokenExpired(entry.timestamp);
            return { present: true, expired, storageJid: key, entry, lookupKeys };
        }
    } catch (_) { /* ignore */ }

    return { ...empty, lookupKeys };
}

/**
 * Baileys attaches tctoken by the *send* JID. Tokens harvested from history
 * live under @lid. Copy a usable token onto the PN send key so 1:1 does not
 * go out bare (463) when the LID mapping is known.
 */
export async function mirrorPrivacyTokenToJid(sock, probe, sendJid) {
    if (!probe?.present || probe.expired || !probe.entry || !sendJid) return probe;
    const keys = sock?.authState?.keys;
    if (!keys?.set) return probe;
    const target = sendJid.includes('@') ? sendJid : `${sendJid}@s.whatsapp.net`;
    if (probe.storageJid === target) return probe;
    try {
        await keys.set({
            tctoken: {
                [target]: {
                    token: probe.entry.token,
                    timestamp: probe.entry.timestamp,
                    senderTimestamp: probe.entry.senderTimestamp,
                }
            }
        });
        return { ...probe, mirroredTo: target };
    } catch (_) {
        return probe;
    }
}

export function summarizeAuthTokenFiles(authFolder, fsSync) {
    const out = { tctokenFiles: 0, lidMappingFiles: 0, deviceListFiles: 0 };
    try {
        if (!fsSync.existsSync(authFolder)) return out;
        for (const name of fsSync.readdirSync(authFolder)) {
            if (!name.endsWith('.json') || name.includes('__index')) continue;
            if (name.startsWith('tctoken-')) out.tctokenFiles += 1;
            else if (name.startsWith('lid-mapping-')) out.lidMappingFiles += 1;
            else if (name.startsWith('device-list-')) out.deviceListFiles += 1;
        }
    } catch (_) { /* ignore */ }
    return out;
}

// Same phone-number pattern as Baileys isJidBot (lnlix/Baileys@6194870).
const BOT_PHONE_REGEX = /^1313555\d{4}$|^131655500\d{2}$/;
const TC_TOKEN_INDEX_KEY = '__index';

/**
 * Mirrors Baileys `isRegularUser` (not exported in 7.0.0-rc13).
 * user ∧ ¬PSA ∧ ¬Bot — WA Web `WAWebSetTcTokenChatAction.handleIncomingTcToken`.
 */
export function isRegularUserJid(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const user = jid.split('@')[0] || '';
    if (user === '0') return false;
    if (BOT_PHONE_REGEX.test(user)) return false;
    if (isJidMetaAI(jid) || jid.endsWith('@bot')) return false;
    if (isJidGroup(jid) || jid.endsWith('@broadcast') || jid.includes('status@broadcast')) return false;
    return !!(isPnUser(jid) || isLidUser(jid) || isHostedPnUser(jid) || isHostedLidUser(jid) || jid.endsWith('@c.us'));
}

async function buildTcTokenIndexWrite(keys, storageJid) {
    const data = await keys.get('tctoken', [TC_TOKEN_INDEX_KEY]);
    const entry = data?.[TC_TOKEN_INDEX_KEY];
    let list = [];
    if (entry?.token?.length) {
        try {
            const parsed = JSON.parse(Buffer.from(entry.token).toString());
            if (Array.isArray(parsed)) list = parsed.filter((j) => typeof j === 'string' && j && j !== TC_TOKEN_INDEX_KEY);
        } catch (_) { /* ignore */ }
    }
    if (list.includes(storageJid)) return {};
    list.push(storageJid);
    return {
        [TC_TOKEN_INDEX_KEY]: { token: Buffer.from(JSON.stringify(list)) }
    };
}

/**
 * Prefer LID storage keys (WA Web indexing). Falls back to PN for regular users.
 * Mirrors Baileys resolveTcTokenJid (not exported in 7.0.0-rc13).
 */
export async function resolveTcTokenStorageJid(sockOrGetLid, jid) {
    if (!jid || typeof jid !== 'string') return null;
    const normalized = jidNormalizedUser(jid);
    if (!normalized || isJidMetaAI(normalized)) return null;
    if (isLidUser(normalized) || isHostedLidUser(normalized)) return normalized;
    if (!(isPnUser(normalized) || isHostedPnUser(normalized))) return null;

    const getLIDForPN = typeof sockOrGetLid === 'function'
        ? sockOrGetLid
        : sockOrGetLid?.signalRepository?.lidMapping?.getLIDForPN?.bind(
            sockOrGetLid?.signalRepository?.lidMapping
        );
    if (typeof getLIDForPN === 'function') {
        try {
            const lid = await getLIDForPN(normalized);
            if (lid) return jidNormalizedUser(lid);
        } catch (_) { /* ignore */ }
    }
    return normalized;
}

/**
 * Proactive capture of inbound `<tctoken>` on message stanzas (Baileys PR #2752 / #2698).
 * Mirrors WA Web `WAWebSetTcTokenChatAction.handleIncomingTcToken`.
 *
 * @returns {Promise<string|null>} storage JID written, or null if nothing stored
 */
export async function storeTcTokenFromMessageNode(sock, node, logger = null) {
    try {
        const keys = sock?.authState?.keys;
        if (!keys?.set || !keys?.get || !node) return null;

        const tcTokenNode = getBinaryNodeChild(node, 'tctoken');
        const content = tcTokenNode?.content;
        if (!tcTokenNode || !(content instanceof Uint8Array || Buffer.isBuffer(content))) {
            return null;
        }

        const rawFrom = node.attrs?.from;
        if (!rawFrom) return null;
        const rawJid = jidNormalizedUser(rawFrom);
        if (!isRegularUserJid(rawJid)) return null;

        const senderLidAttr = node.attrs?.sender_lid;
        const senderLid = senderLidAttr && isLidUser(jidNormalizedUser(senderLidAttr))
            ? jidNormalizedUser(senderLidAttr)
            : null;

        const getLIDForPN = sock?.signalRepository?.lidMapping?.getLIDForPN?.bind(
            sock?.signalRepository?.lidMapping
        );
        const storageJid = senderLid
            || (await resolveTcTokenStorageJid(getLIDForPN || sock, rawJid));
        if (!storageJid) return null;

        const existingTcData = await keys.get('tctoken', [storageJid]);
        const existingEntry = existingTcData?.[storageJid];
        const existingTs = existingEntry?.timestamp ? Number(existingEntry.timestamp) : 0;
        const incomingTs = tcTokenNode.attrs?.t ? Number(tcTokenNode.attrs.t) : 0;
        // timestamp-less tokens would be immediately expired (PR #2752)
        if (!incomingTs) return null;
        if (existingTs > 0 && existingTs >= incomingTs) return null;

        const indexWrite = await buildTcTokenIndexWrite(keys, storageJid);
        await keys.set({
            tctoken: {
                [storageJid]: {
                    ...existingEntry,
                    token: Buffer.from(content),
                    timestamp: tcTokenNode.attrs.t
                },
                ...indexWrite
            }
        });

        if (typeof logger?.info === 'function') {
            logger.info({ storageJid, from: rawJid }, 'Proactive tctoken capture from inbound message');
        }
        return storageJid;
    } catch (err) {
        if (typeof logger?.warn === 'function') {
            logger.warn({ err: err?.message || String(err) }, 'Proactive tctoken capture failed');
        }
        return null;
    }
}
