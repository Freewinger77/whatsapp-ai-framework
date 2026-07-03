#!/usr/bin/env node
/**
 * Smoke test: group ID + sender phone extraction from Baileys-shaped keys.
 * Run: node app/scripts/test-group-sender-context.js
 */
import {
    buildMessageSenderContext,
    isGroupJid,
    resolveSenderJid,
} from '../src/utils/message-sender-context.js';

function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/^\+/, '').replace(/[\s\-\(\)]/g, '');
}

function assert(label, cond) {
    if (!cond) {
        console.error('FAIL:', label);
        process.exitCode = 1;
        return false;
    }
    console.log('OK  ', label);
    return true;
}

function msg(key) {
    return { key };
}

// Real-world shape from user report (group tyre quote)
const groupTyre = msg({
    remoteJid: '120363302926299309@g.us',
    participant: '447404306348@s.whatsapp.net',
    id: '2A73FA87F306D535D857',
    fromMe: false,
});

const groupLid = msg({
    remoteJid: '120363302926299309@g.us',
    participant: '123456789012345@lid',
    participantAlt: '447991234567@s.whatsapp.net',
    id: 'ABC',
    fromMe: false,
});

const dm = msg({
    remoteJid: '447835156367@s.whatsapp.net',
    id: 'DM1',
    fromMe: false,
});

const dmLid = msg({
    remoteJid: '999888777666@lid',
    remoteJidAlt: '447835156367@s.whatsapp.net',
    id: 'DM2',
    fromMe: false,
});

const cases = [
    {
        name: 'group with phone participant',
        m: groupTyre,
        expect: {
            is_group: true,
            group_id: '120363302926299309',
            sender_phone: '447404306348',
            legacy_from_phone: '120363302926299309',
        },
    },
    {
        name: 'group with LID participant + participantAlt',
        m: groupLid,
        expect: {
            is_group: true,
            group_id: '120363302926299309',
            sender_phone: '447991234567',
        },
    },
    {
        name: 'direct message',
        m: dm,
        expect: {
            is_group: false,
            group_id: null,
            sender_phone: '447835156367',
            legacy_from_phone: '447835156367',
        },
    },
    {
        name: 'direct message LID + remoteJidAlt',
        m: dmLid,
        expect: {
            is_group: false,
            sender_phone: '447835156367',
        },
    },
];

console.log('=== message-sender-context unit tests ===\n');

for (const { name, m, expect } of cases) {
    const ctx = buildMessageSenderContext(m, normalizePhone);
    for (const [k, v] of Object.entries(expect)) {
        assert(`${name} → ${k}=${JSON.stringify(v)}`, ctx[k] === v);
    }
}

assert('isGroupJid detects @g.us', isGroupJid('120363302926299309@g.us'));
assert('resolveSenderJid group uses participant', resolveSenderJid(groupTyre) === '447404306348@s.whatsapp.net');
assert('resolveSenderJid DM uses remoteJid', resolveSenderJid(dm) === '447835156367@s.whatsapp.net');

if (process.exitCode) {
    console.error('\nSome tests failed.');
    process.exit(1);
}
console.log('\nAll tests passed.');
