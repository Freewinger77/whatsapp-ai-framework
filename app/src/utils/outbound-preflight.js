/**
 * Outbound preflight for 463 / reach-out budget.
 *
 * Enabled per-worker via env (do not turn on globally):
 *   WASUP_OUTBOUND_HARDENING=true
 *     → cold-without-token block + onWhatsApp preflight
 *   WASUP_BLOCK_COLD_WITHOUT_TOKEN=true
 *   WASUP_ONWHATSAPP_PREFLIGHT=true
 *
 * onWhatsApp is a usync IQ. Cache 7d. Never batch. Skip @lid (API unsupported).
 * exists:false on @lid must not be treated as authoritative.
 */

export const ONWHATSAPP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ONWHATSAPP_TIMEOUT_MS = 8_000;

export function envEnabled(name) {
    const v = String(process.env[name] || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function envDisabled(name) {
    const v = String(process.env[name] || '').trim().toLowerCase();
    return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

export function isOutboundHardeningEnabled() {
    return envEnabled('WASUP_OUTBOUND_HARDENING');
}

export function isOnWhatsAppPreflightEnabled() {
    if (envDisabled('WASUP_ONWHATSAPP_PREFLIGHT')) return false;
    return envEnabled('WASUP_ONWHATSAPP_PREFLIGHT') || isOutboundHardeningEnabled();
}

export function hardeningBlocksColdWithoutToken(options = {}) {
    if (options.allowColdWithoutToken === true) return false;
    if (options.blockColdWithoutToken === true) return true;
    if (envDisabled('WASUP_BLOCK_COLD_WITHOUT_TOKEN')) return false;
    if (envEnabled('WASUP_BLOCK_COLD_WITHOUT_TOKEN')) return true;
    // Worker env must be explicit. Do not imply a fleet-wide cold block
    // from WASUP_OUTBOUND_HARDENING — that is a per-instance switch.
    return false;
}

export function onWhatsAppCacheKey(jidOrPhone) {
    const digits = String(jidOrPhone || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
    return digits.length >= 6 ? digits : null;
}

export function parseOnWhatsAppCache(parsed) {
    const map = new Map();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
    const now = Date.now();
    for (const [phone, value] of Object.entries(parsed)) {
        const key = onWhatsAppCacheKey(phone);
        if (!key || !value || typeof value !== 'object') continue;
        const checkedAt = Number(value.checkedAt) || 0;
        if (!checkedAt || now - checkedAt > ONWHATSAPP_CACHE_TTL_MS) continue;
        map.set(key, {
            exists: value.exists !== false,
            jid: value.jid || null,
            checkedAt,
        });
    }
    return map;
}

export function serializeOnWhatsAppCache(map) {
    const obj = {};
    for (const [phone, entry] of map.entries()) obj[phone] = entry;
    return obj;
}

export function interpretOnWhatsAppResult(results, phoneDigits) {
    if (!Array.isArray(results) || !results.length) return { known: false, exists: null, jid: null, lid: null };
    const hit = results.find((row) => {
        const id = String(row?.jid || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
        return id && phoneDigits && (id === phoneDigits || id.endsWith(phoneDigits) || phoneDigits.endsWith(id));
    }) || results[0];
    if (!hit) return { known: false, exists: null, jid: null, lid: null };
    const exists = hit.exists === true || hit.contact === true || hit.exists === 'true';
    const missing = hit.exists === false || hit.contact === false;
    const lid = hit.lid || (String(hit.jid || '').includes('@lid') ? hit.jid : null);
    if (!exists && !missing) return { known: false, exists: null, jid: hit.jid || null, lid };
    return { known: true, exists, jid: hit.jid || null, lid };
}
