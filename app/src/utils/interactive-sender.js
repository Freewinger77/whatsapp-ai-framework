import { hydratedTemplate, setLogger } from 'baileys_helpers';

function getSocketLogger(socket) {
    if (socket?.logger) {
        return socket.logger;
    }

    return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        trace: () => {},
        child: () => getSocketLogger(null)
    };
}

/**
 * Send native WhatsApp interactive content using baileys_helpers.
 * Injects biz/interactive/native_flow (+ bot node for 1:1) without patching Baileys.
 */
export async function sendInteractiveViaHelper(socket, jid, content, options = {}) {
    if (!socket) {
        throw new Error('WhatsApp socket is required for interactive sends');
    }

    setLogger(getSocketLogger(socket));
    return hydratedTemplate(socket, jid, content, options);
}
