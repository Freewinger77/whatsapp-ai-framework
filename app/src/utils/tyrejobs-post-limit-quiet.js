/**
 * After trial / ATK / ATK2 was reach-out locked, 403'd, or 401-logged-out,
 * CTAs are illegal for 5 days from the *next successful connect*.
 *
 * Outbound (jobs included) waits until creds.registered === true (status
 * sync finished), then 6 more hours. Leftover LID tctoken files are not warm
 * on a brand-new companion. CTAs / buttons are never sent on these lines.
 */

import { isTyrejobsColdOptInExclusive } from './tyrejobs-cold-opt-in.js';
import { isTyrejobsDedicatedWorker } from './tyrejobs-worker-defaults.js';

export const POST_LIMIT_NO_CTA_MS = 5 * 24 * 60 * 60 * 1000;
/** After registered=true (status sync done), keep holding outbound this long. */
export const POST_REGISTERED_QUIET_MS = 6 * 60 * 60 * 1000;

export function parsePostLimitQuiet(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            limitedAt: null,
            limitedReason: null,
            connectedAt: null,
            registeredAt: null,
            noCtaUntil: 0,
        };
    }
    return {
        limitedAt: parsed.limitedAt || null,
        limitedReason: parsed.limitedReason || null,
        connectedAt: parsed.connectedAt || null,
        registeredAt: parsed.registeredAt || null,
        noCtaUntil: Number(parsed.noCtaUntil) || 0,
    };
}

export function serializePostLimitQuiet(state) {
    return {
        limitedAt: state?.limitedAt || null,
        limitedReason: state?.limitedReason || null,
        connectedAt: state?.connectedAt || null,
        registeredAt: state?.registeredAt || null,
        noCtaUntil: Number(state?.noCtaUntil) || 0,
    };
}

export function isTyrejobsPostLimitLine({ id = '', phone = '' } = {}) {
    if (isTyrejobsDedicatedWorker()) return true;
    return isTyrejobsColdOptInExclusive({ id, phone });
}

export function isCtaBlockedByPostLimit(state, now = Date.now()) {
    const until = Number(state?.noCtaUntil) || 0;
    return until > now;
}

/**
 * Hold while unpaired, not connected, or within 6 hours of the link clock.
 * Clock prefers registeredAt (status sync); if WhatsApp never flips it, use connectedAt.
 */
export function isPostLinkOutboundQuiet({
    status,
    connectedAt,
    registeredAt,
    now = Date.now(),
} = {}) {
    if (status !== 'connected' || !connectedAt) return true;
    const startSrc = registeredAt || connectedAt;
    const started = new Date(startSrc).getTime();
    if (!Number.isFinite(started)) return true;
    return now - started < POST_REGISTERED_QUIET_MS;
}

export function noteRegisteredAt(state, at = new Date().toISOString()) {
    if (state?.registeredAt) {
        return { ...state, changed: false };
    }
    return { ...state, registeredAt: at, changed: true };
}

export function resetRegisteredAt(state) {
    return { ...state, registeredAt: null };
}

/** Buttons / lists / CTA URL payloads. Allowed after quiet only with a live tctoken. */
export function isCtaOrInteractivePayload(textOrParams) {
    if (!textOrParams || typeof textOrParams !== 'object') return false;
    if (textOrParams.__wasupInteractiveContent) return true;
    const type = String(textOrParams.messageType || textOrParams._type || '').toLowerCase();
    if (type === 'buttons' || type === 'list') return true;
    if (Array.isArray(textOrParams.buttons) && textOrParams.buttons.length) return true;
    if (Array.isArray(textOrParams.sections) && textOrParams.sections.length) return true;
    if (Array.isArray(textOrParams.interactiveButtons) && textOrParams.interactiveButtons.length) return true;
    if (textOrParams.ctaUrl || textOrParams.buttonText) return true;
    return false;
}

export function markLimited(state, reason, at = new Date().toISOString()) {
    return {
        ...(state || {}),
        limitedAt: at,
        limitedReason: reason || 'restricted',
    };
}

/** Call on successful connect. Starts the 5-day CTA clock if this line was limited. */
export function armAfterConnect(state, connectedAt = new Date().toISOString(), now = Date.now()) {
    const prev = state || {};
    if (!prev.limitedAt) {
        return { ...prev, connectedAt, changed: false };
    }
    const noCtaUntil = now + POST_LIMIT_NO_CTA_MS;
    return {
        ...prev,
        connectedAt,
        noCtaUntil,
        changed: true,
    };
}
