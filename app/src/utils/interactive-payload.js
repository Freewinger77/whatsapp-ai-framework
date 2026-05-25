const MAX_BUTTON_TEXT = 20;
const MAX_CTA_LABEL = 25;
const MAX_BUTTON_ID = 256;
const MAX_INTERACTIVE_ACTIONS = 3;

function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isHttpUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

export function normalizeCtaUrl(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const url = value.trim();
        return url ? { url, label: 'Open link' } : null;
    }
    if (typeof value === 'object' && value.url) {
        return {
            url: String(value.url).trim(),
            label: String(value.label || 'Open link').trim()
        };
    }
    return null;
}

export function normalizeLink(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const url = value.trim();
        return url ? { url } : null;
    }
    if (typeof value === 'object' && value.url) {
        return {
            url: String(value.url).trim(),
            label: value.label ? String(value.label).trim() : undefined
        };
    }
    return null;
}

export function hasNativeInteractiveFields(body = {}) {
    const ctaUrl = normalizeCtaUrl(body.ctaUrl);
    const link = normalizeLink(body.link);
    const buttons = Array.isArray(body.buttons) ? body.buttons : [];
    return Boolean(ctaUrl?.url || link?.url || buttons.length > 0);
}

export function validateInteractiveSendBody(body = {}, { interactiveFocus = false } = {}) {
    const details = [];
    const message = cleanLine(body.message ?? body.text);
    const link = normalizeLink(body.link);
    const ctaUrl = normalizeCtaUrl(body.ctaUrl);
    const linkPreview = body.linkPreview !== false;
    const footer = cleanLine(body.footer);
    const rawButtons = Array.isArray(body.buttons) ? body.buttons : [];

    if (link?.url && !isHttpUrl(link.url)) {
        details.push('link.url must use http or https');
    }
    if (ctaUrl?.url && !isHttpUrl(ctaUrl.url)) {
        details.push('ctaUrl.url must use http or https');
    }
    if (ctaUrl?.label && ctaUrl.label.length > MAX_CTA_LABEL) {
        details.push(`ctaUrl.label must be ${MAX_CTA_LABEL} characters or fewer`);
    }

    const buttons = [];
    for (let index = 0; index < rawButtons.length; index += 1) {
        const button = rawButtons[index] || {};
        const text = cleanLine(button.text || button.title);
        const id = cleanLine(button.id) || `btn_${index + 1}`;

        if (!text) {
            details.push(`Button ${index + 1} is missing text`);
        }
        if (text.length > MAX_BUTTON_TEXT) {
            details.push(`Button ${index + 1} text must be ${MAX_BUTTON_TEXT} characters or fewer`);
        }
        if (id.length > MAX_BUTTON_ID) {
            details.push(`Button ${index + 1} id is too long`);
        }

        buttons.push({
            id,
            text: text.slice(0, MAX_BUTTON_TEXT)
        });
    }

    if (buttons.length > MAX_INTERACTIVE_ACTIONS) {
        details.push(`WhatsApp supports a maximum of ${MAX_INTERACTIVE_ACTIONS} quick-reply buttons`);
    }

    const totalActions = buttons.length + (ctaUrl?.url ? 1 : 0);
    if (totalActions > MAX_INTERACTIVE_ACTIONS) {
        details.push('Combine at most 3 interactive actions (quick replies plus one CTA URL button)');
    }

    if (!message && !link?.url && !ctaUrl?.url && buttons.length === 0) {
        details.push('message, link, ctaUrl, or buttons is required');
    }

    if (interactiveFocus && !link?.url && !ctaUrl?.url && buttons.length === 0 && !message) {
        details.push('Interactive sends require message, link, ctaUrl, or buttons');
    }

    if (details.length > 0) {
        return {
            ok: false,
            error: 'Invalid interactive send payload',
            details
        };
    }

    return {
        ok: true,
        payload: {
            text: message,
            link: link?.url ? link : undefined,
            linkPreview,
            ctaUrl: ctaUrl?.url
                ? {
                    url: ctaUrl.url,
                    label: (ctaUrl.label || 'Open link').slice(0, MAX_CTA_LABEL)
                }
                : undefined,
            buttons,
            footer
        }
    };
}

export function shouldUseMessageBuilder(body = {}, messageType = 'text') {
    const explicitRichType = messageType && !['text', 'buttons', 'list'].includes(messageType);
    if (explicitRichType) return false;

    const ctaUrl = normalizeCtaUrl(body.ctaUrl);
    const link = normalizeLink(body.link);
    if (ctaUrl?.url || link?.url) return true;

    return false;
}
