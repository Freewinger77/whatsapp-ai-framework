import { createHmac } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeCsToken,
    shouldAttachCsToken,
    extractNctSaltFromHistorySync,
    extractNctSaltFromSyncActionData,
} from './cs-token.js';

test('computeCsToken matches Node HMAC-SHA256(salt, recipientLid)', () => {
    const salt = Buffer.from('nct-salt-fixture');
    const lid = '123456789012345@lid';
    const got = computeCsToken(salt, lid);
    const expect = createHmac('sha256', salt).update(lid, 'utf8').digest();
    assert.deepEqual(Buffer.from(got), expect);
});

test('shouldAttachCsToken stays off without switch, salt, lid, or when tctoken exists', () => {
    const base = {
        attachCsToken: true,
        is1on1Send: true,
        hasTcToken: false,
        nctSalt: Buffer.from('x'),
        recipientLidJid: '1@lid',
        meLid: '2@lid',
    };
    assert.equal(shouldAttachCsToken(base), true);
    assert.equal(shouldAttachCsToken({ ...base, attachCsToken: false }), false);
    assert.equal(shouldAttachCsToken({ ...base, hasTcToken: true }), false);
    assert.equal(shouldAttachCsToken({ ...base, nctSalt: Buffer.alloc(0) }), false);
    assert.equal(shouldAttachCsToken({ ...base, recipientLidJid: '4474@s.whatsapp.net' }), false);
    assert.equal(shouldAttachCsToken({ ...base, meLid: null }), false);
    assert.equal(shouldAttachCsToken({ ...base, is1on1Send: false }), false);
});

function writeVarint(n) {
    const out = [];
    while (n > 0x7f) {
        out.push((n & 0x7f) | 0x80);
        n >>>= 7;
    }
    out.push(n);
    return Buffer.from(out);
}

function fieldBytes(fieldNo, payload) {
    return Buffer.concat([
        writeVarint((fieldNo << 3) | 2),
        writeVarint(payload.length),
        payload,
    ]);
}

test('extractNctSaltFromHistorySync reads field 19', () => {
    const salt = Buffer.from('history-salt');
    const buf = fieldBytes(19, salt);
    assert.deepEqual(extractNctSaltFromHistorySync(buf), salt);
});

test('extractNctSaltFromSyncActionData reads value.80.salt', () => {
    const salt = Buffer.from('appstate-salt');
    const action = fieldBytes(1, salt);
    const value = fieldBytes(80, action);
    const data = fieldBytes(2, value);
    assert.deepEqual(extractNctSaltFromSyncActionData(data), salt);
});
