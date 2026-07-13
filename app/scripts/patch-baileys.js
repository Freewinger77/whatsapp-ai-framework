#!/usr/bin/env node

/**
 * Baileys platform identity.
 *
 * Historically this patched Platform.WEB → Platform.MACOS (Feb 2026 WA rejection).
 * Production wasup2 still runs unpatched Platform.WEB and delivers reliably;
 * wasup3 bootstraps that applied MACOS showed ghost ACKs (sent:true, no inbox).
 *
 * Keep WEB to match wasup2. Do not flip to MACOS without a controlled A/B on a
 * non-customer worker first.
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

if (content.includes('Platform.WEB')) {
    console.log('[patch-baileys] OK — Platform.WEB (matches wasup2)');
} else if (content.includes('Platform.MACOS')) {
    console.log('[patch-baileys] WARN — Platform.MACOS present; wasup2 uses WEB. Not auto-reverting (session-sensitive).');
} else {
    console.log('[patch-baileys] Could not find Platform.WEB or Platform.MACOS');
}
