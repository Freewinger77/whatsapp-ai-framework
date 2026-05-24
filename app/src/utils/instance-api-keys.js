/**
 * Per-instance API keys (Wasup v3 compatible).
 *
 * Format: wsp_v3_<publicId>_<secret>
 * Stored: publicId + salt + secretHash (never persist plaintext after create).
 */

import crypto from 'crypto';

export const WSP_V3_PREFIX = 'wsp_v3';
const SECRET_BYTES = 32;

export function generateInstanceApiKey(pepper = process.env.WASUP_API_KEY_PEPPER || '') {
    const publicId = crypto.randomBytes(8).toString('hex');
    const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const secretHash = hashApiKeySecret(secret, salt, pepper);

    return {
        key: `${WSP_V3_PREFIX}_${publicId}_${secret}`,
        publicId,
        salt,
        secretHash,
        hint: publicId.slice(-4),
    };
}

export function parseApiKey(key) {
    if (!key || typeof key !== 'string') return null;
    const trimmed = key.trim();
    if (trimmed.startsWith(`${WSP_V3_PREFIX}_`)) {
        const parts = trimmed.split('_');
        if (parts.length < 4) return null;
        const publicId = parts[2];
        const secret = parts.slice(3).join('_');
        if (!publicId || !secret) return null;
        return { format: 'wsp_v3', publicId, secret, raw: trimmed };
    }
    return { format: 'legacy', raw: trimmed };
}

export function hashApiKeySecret(secret, salt, pepper = process.env.WASUP_API_KEY_PEPPER || '') {
    return crypto
        .createHmac('sha256', pepper || 'wasup-v3-dev-pepper')
        .update(`${salt}:${secret}`)
        .digest('hex');
}

export function hashLegacyApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

export function constantTimeEqual(a, b) {
    try {
        const left = Buffer.from(a, 'hex');
        const right = Buffer.from(b, 'hex');
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    } catch {
        return false;
    }
}

/**
 * Build persisted metadata from a plaintext key (create / rotate).
 */
export function buildApiKeyMetaFromPlaintext(key) {
    const parsed = parseApiKey(key);
    if (!parsed) return null;

    if (parsed.format === 'wsp_v3') {
        const salt = crypto.randomBytes(16).toString('hex');
        const secretHash = hashApiKeySecret(parsed.secret, salt);
        return {
            publicId: parsed.publicId,
            salt,
            secretHash,
            hint: parsed.publicId.slice(-4),
            format: 'wsp_v3',
        };
    }

    return {
        legacyHash: hashLegacyApiKey(parsed.raw),
        hint: parsed.raw.slice(-4),
        format: 'legacy',
    };
}

/**
 * Verify a plaintext key against stored instance metadata.
 */
export function verifyApiKeyForInstance(key, apiKeyMeta) {
    if (!key || !apiKeyMeta) return false;
    const parsed = parseApiKey(key);

    if (apiKeyMeta.format === 'wsp_v3' || apiKeyMeta.publicId) {
        if (!parsed || parsed.format !== 'wsp_v3') return false;
        if (parsed.publicId !== apiKeyMeta.publicId) return false;
        const expected = hashApiKeySecret(parsed.secret, apiKeyMeta.salt);
        return constantTimeEqual(expected, apiKeyMeta.secretHash);
    }

    if (apiKeyMeta.legacyHash) {
        const hash = hashLegacyApiKey(parsed?.raw || key);
        return constantTimeEqual(hash, apiKeyMeta.legacyHash);
    }

    return false;
}

export function redactApiKeyMeta(apiKeyMeta) {
    if (!apiKeyMeta) return null;
    return {
        configured: true,
        format: apiKeyMeta.format || (apiKeyMeta.publicId ? 'wsp_v3' : 'legacy'),
        hint: apiKeyMeta.hint || null,
        publicId: apiKeyMeta.publicId || null,
    };
}
