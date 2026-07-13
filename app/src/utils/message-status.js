/** @typedef {'failed' | 'pending' | 'sent' | 'delivered' | 'read' | 'played'} MessageStatusLabel */

export const MESSAGE_STATUS_RANK = {
    failed: 0,
    pending: 1,
    sent: 2,
    delivered: 3,
    read: 4,
    played: 5
};

/**
 * Map Baileys / proto WebMessageInfo.Status to a stable API label.
 * @param {unknown} raw
 * @returns {MessageStatusLabel | null}
 */
export function normalizeMessageStatus(raw) {
    if (raw == null || raw === '') return null;

    if (typeof raw === 'string') {
        const label = raw.trim().toLowerCase();
        if (label in MESSAGE_STATUS_RANK) return /** @type {MessageStatusLabel} */ (label);
        if (label === 'server_ack' || label === 'server') return 'sent';
        if (label === 'delivery_ack' || label === 'delivery') return 'delivered';
        if (label === 'error') return 'failed';
    }

    const numeric = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isFinite(numeric)) return null;

    switch (numeric) {
        case 0:
            return 'failed';
        case 1:
            return 'pending';
        case 2:
            return 'sent';
        case 3:
            return 'delivered';
        case 4:
            return 'read';
        case 5:
            return 'played';
        default:
            return null;
    }
}

/**
 * @param {MessageStatusLabel | string | null | undefined} current
 * @param {MessageStatusLabel} next
 */
export function shouldAdvanceMessageStatus(current, next) {
    const currentRank = MESSAGE_STATUS_RANK[current] ?? -1;
    const nextRank = MESSAGE_STATUS_RANK[next] ?? -1;
    return nextRank >= currentRank;
}

/**
 * @param {import('baileys').WAMessageKey | null | undefined} key
 */
export function messageKeyId(key) {
    return typeof key?.id === 'string' && key.id.trim() ? key.id.trim() : null;
}

/**
 * @param {import('baileys').WAMessageKey | null | undefined} key
 */
export function messageKeyRemoteJid(key) {
    return typeof key?.remoteJid === 'string' && key.remoteJid.trim() ? key.remoteJid.trim() : null;
}

/**
 * @param {string | null | undefined} jid
 */
export function phoneFromMessageJid(jid) {
    if (!jid) return null;
    const local = jid.split('@')[0]?.split(':')[0] ?? '';
    const digits = local.replace(/[^\d]/g, '');
    return digits.length >= 6 ? digits : null;
}
