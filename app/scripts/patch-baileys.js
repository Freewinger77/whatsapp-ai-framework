#!/usr/bin/env node

/**
 * Idempotent Baileys patches. Safe to re-run. Does not touch instance auth.
 *
 * 1) Platform.WEB → MACOS (QR / pairing 405)
 * 2) lnlix/Baileys@6194870 — storeTcTokenFromMessageNode + handleMessage hook
 *    so inbound <tctoken> is captured even when the body does not decrypt.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BAILEYS = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib');
const MARK = 'wasup-tctoken-from-message-6194870';

function patchMacos() {
    const filePath = path.join(BAILEYS, 'Utils', 'validate-connection.js');
    if (!fs.existsSync(filePath)) {
        console.log('[patch-baileys] validate-connection.js missing — skip MACOS');
        return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const from = 'platform: proto.ClientPayload.UserAgent.Platform.WEB,';
    const to = 'platform: proto.ClientPayload.UserAgent.Platform.MACOS,';
    if (content.includes(to) && !content.includes(from)) {
        console.log('[patch-baileys] OK — already Platform.MACOS');
        return;
    }
    if (!content.includes(from)) {
        console.log('[patch-baileys] Could not find Platform.WEB to patch');
        return;
    }
    fs.writeFileSync(filePath, content.replace(from, to));
    console.log('[patch-baileys] Patched Platform.WEB → Platform.MACOS (fixes 405 before QR)');
}

const STORE_FN = `
// ${MARK}
export async function storeTcTokenFromMessageNode({ node, keys, getLIDForPN }) {
    const tcTokenNode = getBinaryNodeChild(node, 'tctoken');
    if (!tcTokenNode || !(tcTokenNode.content instanceof Uint8Array))
        return undefined;
    const rawJid = jidNormalizedUser(node.attrs.from);
    if (!isRegularUser(rawJid))
        return undefined;
    const senderLid = node.attrs.sender_lid && isLidUser(jidNormalizedUser(node.attrs.sender_lid))
        ? jidNormalizedUser(node.attrs.sender_lid)
        : undefined;
    const storageJid = senderLid ?? (await resolveTcTokenJid(rawJid, getLIDForPN));
    const existingTcData = await keys.get('tctoken', [storageJid]);
    const existingEntry = existingTcData[storageJid];
    const existingTs = existingEntry?.timestamp ? Number(existingEntry.timestamp) : 0;
    const incomingTs = tcTokenNode.attrs.t ? Number(tcTokenNode.attrs.t) : 0;
    if (!incomingTs)
        return undefined;
    if (existingTs > 0 && existingTs >= incomingTs)
        return undefined;
    await keys.set({
        tctoken: {
            [storageJid]: {
                ...existingEntry,
                token: Buffer.from(tcTokenNode.content),
                timestamp: tcTokenNode.attrs.t
            }
        }
    });
    return storageJid;
}
`;

function patchTcTokenUtils() {
    const filePath = path.join(BAILEYS, 'Utils', 'tc-token-utils.js');
    if (!fs.existsSync(filePath)) {
        console.log('[patch-baileys] tc-token-utils.js missing — skip capture fn');
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(MARK) || content.includes('export async function storeTcTokenFromMessageNode')) {
        console.log('[patch-baileys] OK — storeTcTokenFromMessageNode already present');
        return;
    }
    content = content.replace(
        /\/\/# sourceMappingURL=tc-token-utils\.js\.map\s*$/,
        `${STORE_FN}\n//# sourceMappingURL=tc-token-utils.js.map\n`
    );
    if (!content.includes(MARK)) {
        content += `\n${STORE_FN}\n`;
    }
    fs.writeFileSync(filePath, content);
    console.log('[patch-baileys] Added storeTcTokenFromMessageNode (6194870)');
}

function patchMessagesRecv() {
    const filePath = path.join(BAILEYS, 'Socket', 'messages-recv.js');
    if (!fs.existsSync(filePath)) {
        console.log('[patch-baileys] messages-recv.js missing — skip handleMessage hook');
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(MARK)) {
        console.log('[patch-baileys] OK — handleMessage tctoken hook already present');
        return;
    }

    const importFrom = "import { buildMergedTcTokenIndexWrite, isTcTokenExpired, readTcTokenIndex, resolveIssuanceJid, resolveTcTokenJid, storeTcTokensFromIqResult, TC_TOKEN_INDEX_KEY } from '../Utils/tc-token-utils.js';";
    const importTo = "import { buildMergedTcTokenIndexWrite, isTcTokenExpired, readTcTokenIndex, resolveIssuanceJid, resolveTcTokenJid, storeTcTokenFromMessageNode, storeTcTokensFromIqResult, TC_TOKEN_INDEX_KEY } from '../Utils/tc-token-utils.js';";
    if (!content.includes(importFrom)) {
        if (content.includes('storeTcTokenFromMessageNode')) {
            console.log('[patch-baileys] messages-recv already imports storeTcTokenFromMessageNode');
        } else {
            console.log('[patch-baileys] Could not find tc-token-utils import in messages-recv.js');
            return;
        }
    } else {
        content = content.replace(importFrom, importTo);
    }

    const handleFrom = `    const handleMessage = async (node) => {
        const encNode = getBinaryNodeChild(node, 'enc');`;
    const handleTo = `    const handleMessage = async (node) => {
        // ${MARK}
        void storeTcTokenFromMessageNode({ node, keys: authState.keys, getLIDForPN })
            .then(storedJid => {
            if (storedJid)
                trackTcTokenJid(storedJid);
        })
            .catch(err => logger.debug({ err: err?.message }, 'failed to store tctoken from incoming message'));
        const encNode = getBinaryNodeChild(node, 'enc');`;
    if (!content.includes(handleFrom)) {
        console.log('[patch-baileys] Could not find handleMessage start to hook');
        return;
    }
    content = content.replace(handleFrom, handleTo);
    fs.writeFileSync(filePath, content);
    console.log('[patch-baileys] Hooked handleMessage inbound tctoken capture (6194870)');
}

patchMacos();
patchTcTokenUtils();
patchMessagesRecv();
