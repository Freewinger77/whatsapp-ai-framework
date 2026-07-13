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
 * classification, per-contact 463 circuit breaker, and fleet metrics.
 */

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
        last463At: null,
        last463Jid: null,
        lastHistoryHarvestAt: null,
    };
}

export function shouldBlockColdWithoutToken(options = {}) {
    if (options.allowColdWithoutToken === true) return false;
    if (options.blockColdWithoutToken === true) return true;
    const env = String(process.env.WASUP_BLOCK_COLD_WITHOUT_TOKEN || '').trim().toLowerCase();
    return env === '1' || env === 'true' || env === 'yes';
}

export function circuitKeyForJid(jid) {
    if (!jid || typeof jid !== 'string') return null;
    return jid.split('@')[0].split(':')[0] || null;
}

/**
 * Lookup a usable tctoken for an outbound PN/LID jid.
 * Prefers LID storage keys (WA Web indexing) then PN.
 */
export async function lookupPrivacyToken(sock, lidCache, jid) {
    const empty = { present: false, expired: false, storageJid: null, entry: null };
    if (!jid || jid.includes('@g.us')) return empty;

    const keys = sock?.authState?.keys;
    if (!keys?.get) return empty;

    const getLIDForPN = sock?.signalRepository?.lidMapping?.getLIDForPN?.bind(
        sock?.signalRepository?.lidMapping
    );
    const pnUser = jid.split('@')[0].split(':')[0];
    const lookupKeys = [];

    try {
        const lidJid = typeof getLIDForPN === 'function' ? await getLIDForPN(jid) : null;
        if (lidJid) lookupKeys.push(lidJid);
    } catch (_) { /* ignore */ }

    if (lidCache && typeof lidCache.entries === 'function') {
        for (const [lid, pn] of lidCache.entries()) {
            if (pn === pnUser) {
                const lidJid = `${lid}@lid`;
                if (!lookupKeys.includes(lidJid)) lookupKeys.push(lidJid);
            }
        }
    }

    if (!lookupKeys.includes(jid)) lookupKeys.push(jid);
    const pnJid = `${pnUser}@s.whatsapp.net`;
    if (!lookupKeys.includes(pnJid)) lookupKeys.push(pnJid);

    try {
        const existing = await keys.get('tctoken', lookupKeys);
        for (const key of lookupKeys) {
            const entry = existing?.[key];
            if (!entry?.token?.length) continue;
            const expired = isTcTokenExpired(entry.timestamp);
            return { present: true, expired, storageJid: key, entry };
        }
    } catch (_) { /* ignore */ }

    return empty;
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
