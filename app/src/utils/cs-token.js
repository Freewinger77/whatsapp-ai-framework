/**
 * CS token (NCT) helpers — Baileys PR #2438 / WA Web genCsTokenBody.
 *
 * tctoken = recipient-issued trust. cstoken = self-computed fallback when
 * no usable tctoken exists: HMAC-SHA256(nctSalt, recipientLID).
 *
 * Switch is OFF by default. Never attach an empty/missing cstoken.
 */

import { createHmac } from 'node:crypto';

export function computeCsToken(nctSalt, recipientLid) {
    if (!nctSalt?.length || !recipientLid) return null;
    const key = Buffer.isBuffer(nctSalt) ? nctSalt : Buffer.from(nctSalt);
    if (!key.length) return null;
    return new Uint8Array(createHmac('sha256', key).update(String(recipientLid), 'utf8').digest());
}

export function nctSaltFromCreds(creds) {
    const salt = creds?.nctSalt;
    if (!salt) return null;
    if (Buffer.isBuffer(salt)) return salt.length ? salt : null;
    if (salt instanceof Uint8Array) return salt.length ? Buffer.from(salt) : null;
    if (typeof salt === 'string' && salt.length) return Buffer.from(salt, 'base64');
    if (salt?.type === 'Buffer' && Array.isArray(salt.data)) {
        return salt.data.length ? Buffer.from(salt.data) : null;
    }
    return null;
}

export function shouldAttachCsToken({
    attachCsToken,
    is1on1Send,
    hasTcToken,
    nctSalt,
    recipientLidJid,
    meLid,
}) {
    if (!attachCsToken) return false;
    if (!is1on1Send || hasTcToken) return false;
    if (!nctSalt?.length) return false;
    if (!meLid) return false;
    if (!recipientLidJid || !String(recipientLidJid).includes('@lid')) return false;
    return true;
}

/** Minimal protobuf field walker — harvest NCT salt without regenerating WAProto. */
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

/** SyncActionData.value (2) → NctSaltSyncAction (80) → salt (1). */
export function extractNctSaltFromSyncActionData(buf) {
    const value = protoBytesField(buf, 2);
    if (!value) return null;
    const action = protoBytesField(value, 80);
    if (!action) return null;
    const salt = protoBytesField(action, 1);
    return salt?.length ? salt : null;
}

/** HistorySync.nctSalt = field 19. */
export function extractNctSaltFromHistorySync(buf) {
    const salt = protoBytesField(buf, 19);
    return salt?.length ? salt : null;
}
