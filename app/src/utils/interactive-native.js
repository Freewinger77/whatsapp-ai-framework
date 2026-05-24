import { normalizeMessageContent } from 'baileys';

function buildNativeFlowButton(button) {
    if (button?.name && button?.buttonParamsJson) {
        return {
            name: button.name,
            buttonParamsJson: button.buttonParamsJson
        };
    }

    if (button?.type === 'cta_url' || button?.url) {
        return {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: button.label || button.text || 'Open link',
                url: button.url,
                merchant_url: button.url
            })
        };
    }

    const text = button?.text || button?.label || 'Button';
    const id = button?.id || text.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 64) || 'quick_reply';

    return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
            display_text: text,
            id
        })
    };
}

export function buildNativeFlowButtons({ buttons = [], ctaUrl = null }) {
    const nativeButtons = [];

    for (const button of buttons.slice(0, 3)) {
        nativeButtons.push(buildNativeFlowButton(button));
    }

    if (ctaUrl?.url && nativeButtons.length < 3) {
        nativeButtons.push(buildNativeFlowButton({
            type: 'cta_url',
            url: ctaUrl.url,
            label: ctaUrl.label || 'Open link'
        }));
    }

    return nativeButtons;
}

export function buildNativeInteractiveContent({ text, footer = '', title = '', buttons = [], ctaUrl = null }) {
    const nativeButtons = buildNativeFlowButtons({ buttons, ctaUrl });
    if (nativeButtons.length === 0) {
        return null;
    }

    const interactiveMessage = {
        nativeFlowMessage: {
            buttons: nativeButtons,
            messageVersion: 1
        }
    };

    if (title) {
        interactiveMessage.header = { title };
    }
    if (text) {
        interactiveMessage.body = { text };
    }
    if (footer) {
        interactiveMessage.footer = { text: footer };
    }

    return { interactiveMessage };
}

function getButtonArgs(message) {
    const nativeFlow = message?.interactiveMessage?.nativeFlowMessage;
    if (nativeFlow || message?.buttonsMessage) {
        return {
            tag: 'biz',
            attrs: {},
            content: [{
                tag: 'interactive',
                attrs: {
                    type: 'native_flow',
                    v: '1'
                },
                content: [{
                    tag: 'native_flow',
                    attrs: {
                        v: '9',
                        name: 'mixed'
                    }
                }]
            }]
        };
    }

    return {
        tag: 'biz',
        attrs: {}
    };
}

export function buildNativeFlowRelayPlan(content, { jid, isGroup = false } = {}) {
    const normalized = normalizeMessageContent(content);
    const additionalNodes = [getButtonArgs(normalized)];

    if (!isGroup) {
        additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
    }

    return {
        relayContent: content,
        additionalNodes,
        mode: 'native_flow',
        limitations: [
            'Native flow buttons use Baileys interactiveMessage.nativeFlowMessage with biz/bot relay nodes.',
            'WhatsApp may still reject unsupported button combinations on some accounts or client versions.'
        ]
    };
}
