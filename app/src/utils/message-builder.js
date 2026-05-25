const MAX_TEXT_LENGTH = 4096;

function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendUniqueLine(lines, line) {
    const value = cleanLine(line);
    if (value && !lines.includes(value)) {
        lines.push(value);
    }
}

function ensureLinkInText(text, link) {
    const lines = [];
    appendUniqueLine(lines, text);
    if (link?.url && !String(text || '').includes(link.url)) {
        appendUniqueLine(lines, link.label ? `${link.label}: ${link.url}` : link.url);
    }
    return lines.join('\n\n');
}

function buildNativeInteractiveButtons({ buttons = [], ctaUrl }) {
    const interactiveButtons = [];

    for (const button of buttons) {
        interactiveButtons.push({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: button.text,
                id: button.id
            })
        });
    }

    if (ctaUrl?.url) {
        interactiveButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: ctaUrl.label || 'Open link',
                url: ctaUrl.url,
                merchant_url: ctaUrl.url
            })
        });
    }

    return interactiveButtons;
}

export function buildWhatsAppMessage(messagePayload = {}) {
    const {
        text = '',
        link,
        linkPreview = true,
        buttons = [],
        ctaUrl,
        footer = ''
    } = messagePayload;

    const normalizedText = cleanLine(text);
    const normalizedButtons = Array.isArray(buttons) ? buttons : [];
    const requestedTypes = [];
    if (link?.url) requestedTypes.push('link');
    if (ctaUrl?.url) requestedTypes.push('cta_url');
    if (normalizedButtons.length > 0) requestedTypes.push('buttons');

    const hasInteractive = normalizedButtons.length > 0 || Boolean(ctaUrl?.url);

    if (hasInteractive) {
        const bodyText = (link?.url
            ? ensureLinkInText(normalizedText, link)
            : normalizedText || 'Choose an option').slice(0, MAX_TEXT_LENGTH);

        const interactiveButtons = buildNativeInteractiveButtons({
            buttons: normalizedButtons,
            ctaUrl
        });

        return {
            content: {
                __wasupMessageText: bodyText,
                __wasupInteractiveContent: {
                    text: bodyText,
                    footer: footer || undefined,
                    interactiveButtons
                }
            },
            logText: bodyText,
            delivery: {
                requestedTypes,
                mode: 'native_interactive',
                limitations: [
                    'Sent as native WhatsApp interactive buttons.'
                ]
            }
        };
    }

    const plainText = (link?.url
        ? ensureLinkInText(normalizedText, link)
        : normalizedText).slice(0, MAX_TEXT_LENGTH);

    const content = { text: plainText };
    if (linkPreview === false) {
        content.linkPreview = null;
    }

    return {
        content,
        logText: plainText,
        delivery: {
            requestedTypes,
            mode: 'text',
            limitations: []
        }
    };
}
