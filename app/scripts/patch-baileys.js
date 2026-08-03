#!/usr/bin/env node

/**
 * Baileys UserAgent platform patch.
 *
 * WhatsApp rejects Platform.WEB during pairing/handshake with 405 Method Not Allowed
 * before a QR is ever emitted (WhiskeySockets/Baileys#2370 / #2376).
 * Flip WEB → MACOS so QR / pairing codes can generate.
 *
 * Historical note: an earlier MACOS flip was associated with ghost ACKs on one worker.
 * As of Jul 2026, WEB cannot pair at all fleet-wide, so MACOS is required.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const filePath = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib', 'Utils', 'validate-connection.js');

if (!fs.existsSync(filePath)) {
    console.log('[patch-baileys] File not found, skipping');
    process.exit(0);
}

const content = fs.readFileSync(filePath, 'utf8');
const from = 'platform: proto.ClientPayload.UserAgent.Platform.WEB,';
const to = 'platform: proto.ClientPayload.UserAgent.Platform.MACOS,';

if (content.includes(to) && !content.includes(from)) {
    console.log('[patch-baileys] OK — already Platform.MACOS');
    process.exit(0);
}

if (!content.includes(from)) {
    console.log('[patch-baileys] Could not find Platform.WEB to patch');
    process.exit(0);
}

fs.writeFileSync(filePath, content.replace(from, to));
console.log('[patch-baileys] Patched Platform.WEB → Platform.MACOS (fixes 405 before QR)');
