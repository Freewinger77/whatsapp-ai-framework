#!/usr/bin/env node

/**
 * Patches Baileys to use MACOS platform instead of WEB.
 * WhatsApp servers reject Platform.WEB as of Feb 2026.
 * See: https://github.com/WhiskeySockets/Baileys/issues/2364
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const filePath = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib', 'Utils', 'validate-connection.js');

if (!fs.existsSync(filePath)) {
    console.log('[patch-baileys] File not found, skipping patch');
    process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

if (content.includes('Platform.WEB')) {
    content = content.replaceAll('Platform.WEB', 'Platform.MACOS');
    fs.writeFileSync(filePath, content);
    console.log('[patch-baileys] Patched Platform.WEB -> Platform.MACOS');
} else if (content.includes('Platform.MACOS')) {
    console.log('[patch-baileys] Already patched');
} else {
    console.log('[patch-baileys] Could not find Platform.WEB to patch');
}
