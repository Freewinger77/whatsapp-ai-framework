/**
 * Group vs DM sender extraction from Baileys message keys.
 * Pure helpers — unit-tested without a live WhatsApp socket.
 */

export function jidToLocalId(jid) {
    if (!jid || typeof jid !== 'string') return null;
    const local = jid.trim().split('@')[0].split(':')[0];
    const digits = local.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '').replace(/[^\d]/g, '');
    return digits || null;
}

export function isGroupJid(jid) {
    return typeof jid === 'string' && jid.includes('@g.us');
}

/** JID to resolve for the human sender (participant in groups, remoteJid in DMs). */
export function resolveSenderJid(msg) {
    const remoteJid = msg?.key?.remoteJid || '';
    if (isGroupJid(remoteJid)) {
        return msg?.key?.participant || msg?.key?.participantAlt || null;
    }
    if (remoteJid.includes('@lid') && msg?.key?.remoteJidAlt && !msg.key.remoteJidAlt.includes('@lid')) {
        return msg.key.remoteJidAlt;
    }
    return remoteJid || null;
}

/**
 * Best-effort sender phone from the message key alone (sync).
 * LID participants may still need async _resolvePhoneNumber on the instance.
 */
export function resolveSenderPhoneSync(msg, normalizePhone = (p) => p) {
    const remoteJid = msg?.key?.remoteJid || '';
    if (isGroupJid(remoteJid)) {
        const participantAlt = msg?.key?.participantAlt;
        const participant = msg?.key?.participant;
        if (participantAlt && !participantAlt.includes('@lid')) {
            return normalizePhone(jidToLocalId(participantAlt)) || null;
        }
        if (participant && !participant.includes('@lid')) {
            return normalizePhone(jidToLocalId(participant)) || null;
        }
        const lidJid = participant || participantAlt;
        return lidJid ? (normalizePhone(jidToLocalId(lidJid)) || null) : null;
    }
    const senderJid = resolveSenderJid(msg);
    return senderJid ? (normalizePhone(jidToLocalId(senderJid)) || null) : null;
}

export function buildMessageSenderContext(msg, normalizePhone = (p) => p) {
    const remoteJid = msg?.key?.remoteJid || '';
    const isGroup = isGroupJid(remoteJid);
    const groupId = isGroup ? (normalizePhone(jidToLocalId(remoteJid)) || null) : null;
    const senderJid = resolveSenderJid(msg);
    const senderPhone = resolveSenderPhoneSync(msg, normalizePhone);
    const legacyFromPhone = isGroup ? groupId : senderPhone;

    return {
        is_group: isGroup,
        group_id: groupId,
        sender_phone: senderPhone,
        from_jid: remoteJid || null,
        sender_jid: senderJid,
        /** Matches historical webhook `from_phone` semantics. */
        legacy_from_phone: legacyFromPhone,
    };
}
