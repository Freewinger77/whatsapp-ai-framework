/**
 * TyreJobs-only outbound gate (trial + ATK + ATK2).
 *
 * HARD ALLOWLIST — trial-Tyrejobs + TyreJobs-ATK / ATK2 phones/instance ids only.
 * Other businesses must never enter this path even if the behavior flag is set.
 *
 * When enabled: live tctoken → send the job. No tctoken → hold (nothing sent).
 * CTAs / buttons are never sent on these three. Token-only jobs after
 * registered + 6 hours. On wasup-tyrejobs the same law applies to every line.
 */

export const TYREJOBS_COLD_OPTIN_PHONES = Object.freeze([
    '447503741818', // TyreJobs-ATK
    '447503207364', // trial-Tyrejobs
    '447503742842', // TyreJobs-ATK2
]);

export const TYREJOBS_COLD_OPTIN_INSTANCE_IDS = Object.freeze([
    'wa_mrkslqeb_0b6og',
    'wa_mrscw48u_xfqds',
    'wa_mt7k88um_46lo7',
]);

export function digitsPhone(value) {
    return String(value || '').replace(/[^\d]/g, '');
}

export function isTyrejobsColdOptInExclusive({ id = '', phone = '' } = {}) {
    if (id && TYREJOBS_COLD_OPTIN_INSTANCE_IDS.includes(id)) return true;
    const digits = digitsPhone(phone);
    if (!digits) return false;
    return TYREJOBS_COLD_OPTIN_PHONES.some(
        (allowed) => digits === allowed || digits.endsWith(allowed) || allowed.endsWith(digits)
    );
}

export function normalizeJobReplyName(name) {
    const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    return cleaned.slice(0, 80);
}

/** ATK2 identity — kept for instance checks. Job exclusions are gone. */
export const ATK2_INSTANCE_ID = 'wa_mt7k88um_46lo7';
export const ATK2_PHONE = '447503742842';

/** @deprecated empty — tctoken is the only send gate now */
export const ATK2_JOB_SEND_EXCLUSIONS = Object.freeze([]);

export function phonesMatch(a, b) {
    const da = digitsPhone(a);
    const db = digitsPhone(b);
    if (da.length < 6 || db.length < 6) return false;
    return da === db || da.endsWith(db) || db.endsWith(da);
}

export function isAtk2Instance({ id = '', phone = '' } = {}) {
    if (id && id === ATK2_INSTANCE_ID) return true;
    const digits = digitsPhone(phone);
    if (!digits) return false;
    return phonesMatch(digits, ATK2_PHONE);
}

export function matchAtk2JobSendExclusion(_contactPhone) {
    return null;
}

export function parseJobReplyAllowFile(parsed) {
    const map = new Map();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
    for (const [phone, value] of Object.entries(parsed)) {
        const key = digitsPhone(phone);
        if (key.length < 6) continue;
        if (value && typeof value === 'object' && value.repliedAt) {
            map.set(key, {
                name: normalizeJobReplyName(value.name) || null,
                phone: key,
                repliedAt: String(value.repliedAt),
                source: value.source || null,
            });
        }
    }
    return map;
}
