/**
 * TyreJobs trial / ATK / ATK2: one opt-in CTA per new fitter.
 *
 * Gap between CTAs is random 30–60 minutes per instance.
 * Cold (no tctoken) → one CTA. After a live tctoken exists, jobs send.
 * No exclusion list.
 */

import crypto from 'crypto';
import { digitsPhone, isTyrejobsColdOptInExclusive } from './tyrejobs-cold-opt-in.js';

export const ATK2_OPT_IN_CTA_MIN_INTERVAL_MS = 30 * 60 * 1000;
export const ATK2_OPT_IN_CTA_MAX_INTERVAL_MS = 60 * 60 * 1000;
/** @deprecated use min/max; kept so older imports keep working */
export const ATK2_OPT_IN_CTA_INTERVAL_MS = ATK2_OPT_IN_CTA_MIN_INTERVAL_MS;

export const ATK2_OPT_IN_CTA_VARIANTS = Object.freeze([
    'Hi — please save this number and reply SAVED to start receiving jobs.',
    'Save this WhatsApp number and reply start jobs when you are ready to get jobs.',
    'To start getting jobs, save this number and reply saved.',
    'Hi, this is TyreJobs. Save this chat and reply START JOBS to receive work.',
    'Please save this number. Reply saved and we will start sending you jobs.',
    'Save this number, then reply saved — that is how you start receiving jobs.',
    'Quick one: save this chat and reply saved to switch jobs on.',
    'Reply START JOBS after saving this number and we will send work through.',
    'Save this number please. Reply saved when you want jobs to start.',
]);

export function randomOptInCtaGapMs() {
    const min = ATK2_OPT_IN_CTA_MIN_INTERVAL_MS;
    const max = ATK2_OPT_IN_CTA_MAX_INTERVAL_MS;
    return crypto.randomInt(min, max + 1);
}

export function parseOptInCtaState(parsed) {
    const byPhone = new Map();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { lastSentAt: 0, nextAllowedAt: 0, lastVariant: null, byPhone };
    }
    const lastSentAt = Number(parsed.lastSentAt) || 0;
    const nextAllowedAt = Number(parsed.nextAllowedAt) || 0;
    const lastVariant = parsed.lastVariant || null;
    const rows = parsed.byPhone && typeof parsed.byPhone === 'object' ? parsed.byPhone : {};
    for (const [phone, value] of Object.entries(rows)) {
        const key = digitsPhone(phone);
        if (key.length < 6 || !value || typeof value !== 'object') continue;
        byPhone.set(key, {
            phone: key,
            sentAt: String(value.sentAt || ''),
            variant: value.variant || null,
            source: value.source || 'opt-in-cta',
        });
    }
    return { lastSentAt, nextAllowedAt, lastVariant, byPhone };
}

export function serializeOptInCtaState(state) {
    const byPhone = {};
    for (const [phone, entry] of (state?.byPhone || new Map()).entries()) {
        byPhone[phone] = entry;
    }
    return {
        lastSentAt: Number(state?.lastSentAt) || 0,
        nextAllowedAt: Number(state?.nextAllowedAt) || 0,
        lastVariant: state?.lastVariant || null,
        byPhone,
    };
}

export function pickOptInCtaVariant(lastVariant = null) {
    const pool = ATK2_OPT_IN_CTA_VARIANTS.filter((text) => text !== lastVariant);
    const choices = pool.length ? pool : ATK2_OPT_IN_CTA_VARIANTS;
    return choices[crypto.randomInt(0, choices.length)];
}

export function shouldSendAtk2OptInCta({
    id,
    instancePhone,
    contactPhone,
    alreadySentCta,
    nextAllowedAt,
    lastSentAt,
    dedicatedWorker = false,
    now = Date.now(),
} = {}) {
    if (!dedicatedWorker && !isTyrejobsColdOptInExclusive({ id, phone: instancePhone })) {
        return { send: false, reason: 'not-tyrejobs-optin' };
    }
    const phone = digitsPhone(contactPhone);
    if (phone.length < 6) return { send: false, reason: 'bad-phone' };
    if (alreadySentCta) return { send: false, reason: 'cta-already-sent' };
    const gate = Number(nextAllowedAt) || 0;
    if (gate && now < gate) {
        return { send: false, reason: 'throttle', waitMs: gate - now };
    }
    if (!gate && lastSentAt) {
        const elapsed = now - Number(lastSentAt);
        if (elapsed < ATK2_OPT_IN_CTA_MIN_INTERVAL_MS) {
            return { send: false, reason: 'throttle', waitMs: ATK2_OPT_IN_CTA_MIN_INTERVAL_MS - elapsed };
        }
    }
    return { send: true, phone };
}
