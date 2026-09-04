#!/usr/bin/env node

/**
 * Wasup cstoken patch for Baileys 7.0.0-rc13 (PR #2438, not merged).
 *
 * Default: no <cstoken> unless the live socket has __wasupAttachCsToken.
 * Never attaches when nctSalt / me.lid / recipient LID is missing.
 *
 * Idempotent. Safe to run on every postinstall.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baileys = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib');

const MARK = 'WASUP_CSTOKEN';

function writeIfChanged(file, next) {
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (prev === next) return false;
    fs.writeFileSync(file, next);
    return true;
}

function patchOnce(file, needle, insert, already) {
    if (!fs.existsSync(file)) {
        console.log(`[patch-cstoken] skip missing ${path.basename(file)}`);
        return false;
    }
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes(already || MARK)) {
        console.log(`[patch-cstoken] OK — ${path.basename(file)} already patched`);
        return false;
    }
    if (!src.includes(needle)) {
        console.log(`[patch-cstoken] could not find anchor in ${path.basename(file)}`);
        return false;
    }
    fs.writeFileSync(file, src.replace(needle, insert));
    console.log(`[patch-cstoken] patched ${path.basename(file)}`);
    return true;
}

const helper = `/** ${MARK} — harvested from app/src/utils/cs-token.js */
import { createHmac } from 'node:crypto';

export function computeCsToken(nctSalt, recipientLid) {
    if (!nctSalt?.length || !recipientLid) return null;
    const key = Buffer.isBuffer(nctSalt) ? nctSalt : Buffer.from(nctSalt);
    if (!key.length) return null;
    return new Uint8Array(createHmac('sha256', key).update(String(recipientLid), 'utf8').digest());
}

function readVarint(buf, offset) {
    let x = 0;
    let s = 0;
    let i = offset;
    while (i < buf.length) {
        const b = buf[i++];
        x |= (b & 0x7f) << s;
        if ((b & 0x80) === 0) return [x >>> 0, i];
        s += 7;
        if (s > 35) break;
    }
    return [0, buf.length];
}

function protoBytesField(buf, fieldNo) {
    if (!buf?.length) return null;
    let i = 0;
    while (i < buf.length) {
        const [key, n1] = readVarint(buf, i);
        i = n1;
        const fn = key >>> 3;
        const wt = key & 7;
        if (wt === 0) {
            const [, n2] = readVarint(buf, i);
            i = n2;
        } else if (wt === 1) {
            i += 8;
        } else if (wt === 5) {
            i += 4;
        } else if (wt === 2) {
            const [len, n2] = readVarint(buf, i);
            i = n2;
            const slice = buf.subarray(i, i + len);
            i += len;
            if (fn === fieldNo) return Buffer.from(slice);
        } else {
            return null;
        }
    }
    return null;
}

export function extractNctSaltFromSyncActionData(buf) {
    const value = protoBytesField(buf, 2);
    if (!value) return null;
    const action = protoBytesField(value, 80);
    if (!action) return null;
    const salt = protoBytesField(action, 1);
    return salt?.length ? salt : null;
}

export function extractNctSaltFromHistorySync(buf) {
    const salt = protoBytesField(buf, 19);
    return salt?.length ? salt : null;
}
`;

const helperPath = path.join(baileys, 'Utils', 'cs-token-wasup.js');
if (!fs.existsSync(baileys)) {
    console.log('[patch-cstoken] baileys not installed, skipping');
    process.exit(0);
}
writeIfChanged(helperPath, helper);
console.log('[patch-cstoken] helper ready');

patchOnce(
    path.join(baileys, 'Socket', 'messages-send.js'),
    `import { buildMergedTcTokenIndexWrite, isTcTokenExpired, resolveIssuanceJid, resolveTcTokenJid, shouldSendNewTcToken, storeTcTokensFromIqResult } from '../Utils/tc-token-utils.js';`,
    `import { buildMergedTcTokenIndexWrite, isTcTokenExpired, resolveIssuanceJid, resolveTcTokenJid, shouldSendNewTcToken, storeTcTokensFromIqResult } from '../Utils/tc-token-utils.js';
import { computeCsToken } from '../Utils/cs-token-wasup.js'; // ${MARK}`,
    MARK
);

patchOnce(
    path.join(baileys, 'Socket', 'messages-send.js'),
    `            if (tcTokenBuffer?.length && sock.serverProps.privacyTokenOn1to1) {
                ;
                stanza.content.push({
                    tag: 'tctoken',
                    attrs: {},
                    content: tcTokenBuffer
                });
            }`,
    `            if (tcTokenBuffer?.length && sock.serverProps.privacyTokenOn1to1) {
                ;
                stanza.content.push({
                    tag: 'tctoken',
                    attrs: {},
                    content: tcTokenBuffer
                });
            }
            else if (
                (sock.__wasupAttachCsToken || authState.creds.__wasupAttachCsToken) &&
                is1on1Send &&
                authState.creds.me?.lid &&
                authState.creds.nctSalt?.length &&
                tcTokenJid &&
                isLidUser(tcTokenJid)
            ) {
                // ${MARK} PR #2438: attach <cstoken> only when switch is ON and salt exists.
                const csToken = computeCsToken(authState.creds.nctSalt, tcTokenJid);
                if (csToken?.length) {
                    stanza.content.push({
                        tag: 'cstoken',
                        attrs: {},
                        content: csToken
                    });
                    logger.info({ jid: destinationJid }, 'attached cstoken fallback');
                }
            }`,
    'attached cstoken fallback'
);

patchOnce(
    path.join(baileys, 'Utils', 'chat-utils.js'),
    `import { emitSyncActionResults, processContactAction } from './sync-action-utils.js';`,
    `import { emitSyncActionResults, processContactAction } from './sync-action-utils.js';
import { extractNctSaltFromSyncActionData } from './cs-token-wasup.js'; // ${MARK}`,
    'extractNctSaltFromSyncActionData'
);

patchOnce(
    path.join(baileys, 'Utils', 'chat-utils.js'),
    `        const syncAction = proto.SyncActionData.decode(result);
        if (validateMacs) {`,
    `        const syncAction = proto.SyncActionData.decode(result);
        const wasupNctSalt = extractNctSaltFromSyncActionData(result);
        if (wasupNctSalt) syncAction._wasupNctSalt = wasupNctSalt;
        if (validateMacs) {`,
    '_wasupNctSalt = wasupNctSalt'
);

patchOnce(
    path.join(baileys, 'Utils', 'chat-utils.js'),
    `export const processSyncAction = (syncAction, ev, me, initialSyncOpts, logger) => {
    const isInitialSync = !!initialSyncOpts;`,
    `export const processSyncAction = (syncAction, ev, me, initialSyncOpts, logger) => {
    if (syncAction?._wasupNctSalt?.length) {
        ev.emit('creds.update', { nctSalt: syncAction._wasupNctSalt });
        logger?.info({ bytes: syncAction._wasupNctSalt.length }, 'NCT salt via nctSaltSyncAction');
    }
    const isInitialSync = !!initialSyncOpts;`,
    'NCT salt via nctSaltSyncAction'
);

patchOnce(
    path.join(baileys, 'Utils', 'history.js'),
    `import { downloadContentFromMessage } from './messages-media.js';`,
    `import { downloadContentFromMessage } from './messages-media.js';
import { extractNctSaltFromHistorySync } from './cs-token-wasup.js'; // ${MARK}`,
    'extractNctSaltFromHistorySync'
);

patchOnce(
    path.join(baileys, 'Utils', 'history.js'),
    `    const syncData = proto.HistorySync.decode(buffer);
    return syncData;`,
    `    const syncData = proto.HistorySync.decode(buffer);
    const wasupNctSalt = extractNctSaltFromHistorySync(buffer);
    if (wasupNctSalt) syncData.nctSalt = wasupNctSalt;
    return syncData;`,
    'syncData.nctSalt = wasupNctSalt'
);

patchOnce(
    path.join(baileys, 'Utils', 'history.js'),
    `        historyMsg = proto.HistorySync.decode(await inflatePromise(msg.initialHistBootstrapInlinePayload));`,
    `        const inlineBuf = await inflatePromise(msg.initialHistBootstrapInlinePayload);
        historyMsg = proto.HistorySync.decode(inlineBuf);
        {
            const wasupNctSalt = extractNctSaltFromHistorySync(inlineBuf);
            if (wasupNctSalt) historyMsg.nctSalt = wasupNctSalt;
        }`,
    'historyMsg.nctSalt = wasupNctSalt'
);

// inline payload is already a decoded object — also try item.nctSalt from proto if ever present
patchOnce(
    path.join(baileys, 'Utils', 'history.js'),
    `        lidPnMappings,
        pastParticipants: item.pastParticipants,
        syncType: item.syncType,
        progress: item.progress
    };`,
    `        lidPnMappings,
        pastParticipants: item.pastParticipants,
        syncType: item.syncType,
        progress: item.progress,
        nctSalt: item.nctSalt || null
    };`,
    'nctSalt: item.nctSalt'
);

patchOnce(
    path.join(baileys, 'Utils', 'process-message.js'),
    `                    await storeTcTokensFromHistorySync(data.chats, signalRepository, keyStore, logger);
                    ev.emit('messaging-history.set', {`,
    `                    await storeTcTokensFromHistorySync(data.chats, signalRepository, keyStore, logger);
                    if (data.nctSalt?.length) {
                        ev.emit('creds.update', { nctSalt: data.nctSalt });
                        logger?.info({ bytes: data.nctSalt.length }, 'NCT salt via history sync');
                    }
                    ev.emit('messaging-history.set', {`,
    'NCT salt via history sync'
);

const chatsFile = path.join(baileys, 'Socket', 'chats.js');
if (fs.existsSync(chatsFile)) {
    const src = fs.readFileSync(chatsFile, 'utf8');
    if (!src.includes('ensureNctSaltSynced')) {
        const anchor = `    ev.on('connection.update', ({ connection, receivedPendingNotifications }) => {
        if (connection === 'close') {`;
        const insert = `    let nctSaltSyncInFlight = false;
    const ensureNctSaltSynced = async () => {
        if (!sock.__wasupAttachCsToken && !authState.creds.__wasupAttachCsToken) return;
        if (authState.creds.nctSalt?.length || nctSaltSyncInFlight) return;
        nctSaltSyncInFlight = true;
        try {
            const { regular_high: state } = await authState.keys.get('app-state-sync-version', ['regular_high']);
            if (state?.version) return;
            logger.info('no NCT salt stored — syncing regular_high to fetch it');
            await resyncAppState(['regular_high'], false);
        } catch (error) {
            onUnexpectedError(error, 'nct salt regular_high resync');
        } finally {
            nctSaltSyncInFlight = false;
        }
    };
    ev.on('connection.update', ({ connection, receivedPendingNotifications }) => {
        if (connection === 'close') {`;
        if (src.includes(anchor)) {
            let next = src.replace(anchor, insert);
            next = next.replace(
                `        if (connection === 'open') {
            if (fireInitQueries) {
                executeInitQueries().catch(error => onUnexpectedError(error, 'init queries'));
            }
            sendPresenceUpdate(markOnlineOnConnect ? 'available' : 'unavailable').catch(error => onUnexpectedError(error, 'presence update requests'));
        }`,
                `        if (connection === 'open') {
            if (fireInitQueries) {
                executeInitQueries().catch(error => onUnexpectedError(error, 'init queries'));
            }
            sendPresenceUpdate(markOnlineOnConnect ? 'available' : 'unavailable').catch(error => onUnexpectedError(error, 'presence update requests'));
            void ensureNctSaltSynced();
        }`
            );
            // also kick after going Online without history
            next = next.replace(
                `            logger.info('History sync is disabled by config, not waiting for notification. Transitioning to Online.');
            syncState = SyncState.Online;
            setTimeout(() => ev.flush(), 0);
            return;`,
                `            logger.info('History sync is disabled by config, not waiting for notification. Transitioning to Online.');
            syncState = SyncState.Online;
            setTimeout(() => ev.flush(), 0);
            void ensureNctSaltSynced();
            return;`
            );
            fs.writeFileSync(chatsFile, next);
            console.log('[patch-cstoken] patched chats.js ensureNctSaltSynced');
        } else {
            console.log('[patch-cstoken] could not find chats.js connection.update anchor');
        }
    } else {
        console.log('[patch-cstoken] OK — chats.js already has ensureNctSaltSynced');
    }
}

console.log('[patch-cstoken] done');
