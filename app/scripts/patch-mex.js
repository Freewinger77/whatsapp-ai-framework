#!/usr/bin/env node

/**
 * Patch Baileys MEX result parsing.
 *
 * WhatsApp now returns many w:mex results as format="argo" (binary GraphQL),
 * while Baileys 7.0.0-rc13 still does JSON.parse on the payload. That throws:
 *   Unexpected token '' ... is not valid JSON
 * and leaves reachoutTimeLock / newChatMessageCap empty in the UI.
 *
 * This replaces mex.js with a version that:
 * 1) still accepts JSON when WA sends it
 * 2) decodes common Argo string/timestamp patterns for reachout + message-cap
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const target = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib', 'Socket', 'mex.js');

const MEX_JS = `import { Boom } from '@hapi/boom';
import zlib from 'zlib';
import { getBinaryNodeChild, S_WHATSAPP_NET } from '../WABinary/index.js';

const wMexQuery = (variables, queryId, query, generateMessageTag) => {
    return query({
        tag: 'iq',
        attrs: {
            id: generateMessageTag(),
            type: 'get',
            to: S_WHATSAPP_NET,
            xmlns: 'w:mex'
        },
        content: [
            {
                tag: 'query',
                attrs: { query_id: queryId },
                content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
            }
        ]
    });
};

function toBuffer(content) {
    if (Buffer.isBuffer(content)) return content;
    if (content instanceof Uint8Array) return Buffer.from(content);
    if (typeof content === 'string') return Buffer.from(content, 'utf8');
    if (content && typeof content === 'object' && content.type === 'Buffer' && Array.isArray(content.data)) {
        return Buffer.from(content.data);
    }
    return null;
}

function tryParseJsonBuffer(buf) {
    const attempts = [buf];
    for (const fn of [zlib.gunzipSync, zlib.inflateSync, zlib.unzipSync]) {
        try { attempts.push(fn(buf)); } catch (_) {}
    }
    for (const candidate of attempts) {
        const text = candidate.toString('utf8').trim();
        if (!text) continue;
        if (text.startsWith('{') || text.startsWith('[')) {
            try { return JSON.parse(text); } catch (_) {}
        }
        const brace = text.indexOf('{');
        if (brace >= 0) {
            try { return JSON.parse(text.slice(brace)); } catch (_) {}
        }
    }
    return null;
}

function extractArgoStrings(buf) {
    const out = [];
    let i = 0;
    while (i < buf.length) {
        const tag = buf[i];
        if ((tag === 0x18 || tag === 0x08 || tag === 0x14) && i + 1 < buf.length) {
            let j = i + 1;
            while (j < buf.length && buf[j] >= 0x20 && buf[j] <= 0x7e) j += 1;
            if (j > i + 1) {
                out.push(buf.subarray(i + 1, j).toString('ascii'));
                i = j;
                continue;
            }
        }
        i += 1;
    }
    const runs = buf.toString('latin1').match(/[\\x20-\\x7e]{3,}/g) || [];
    for (const r of runs) {
        if (!out.includes(r)) out.push(r);
    }
    return out;
}

function extractUnixSeconds(buf, strings) {
    const candidates = [];
    const consider = (s) => {
        if (!s) return;
        // Prefer exact 10-digit windows inside longer digit runs (Argo sometimes prefixes 0/01).
        for (let i = 0; i <= s.length - 10; i++) {
            const slice = s.slice(i, i + 10);
            if (!/^\\d{10}$/.test(slice)) continue;
            const n = parseInt(slice, 10);
            if (n > 1_600_000_000 && n < 2_200_000_000) candidates.push(n);
        }
    };
    for (const s of strings) consider(s);
    for (let i = 0; i < buf.length - 10; i++) {
        if (buf[i] !== 0x14 && buf[i] !== 0x18) continue;
        let j = i + 1;
        while (j < buf.length && buf[j] >= 0x30 && buf[j] <= 0x39) j += 1;
        if (j - (i + 1) >= 10) consider(buf.subarray(i + 1, j).toString('ascii'));
    }
    if (!candidates.length) return null;
    // Prefer the latest plausible timestamp (end-of-lock / server_sent).
    candidates.sort((a, b) => a - b);
    return String(candidates[candidates.length - 1]);
}

function decodeArgoReachout(buf) {
    const strings = extractArgoStrings(buf);
    const enforcementTypes = [
        'DEFAULT', 'WEB_COMPANION_ONLY', 'RESTRICT_ALL_COMPANIONS', 'BULK_MESSAGING', 'BIZ_QUALITY',
    ];
    const enforcement = strings.find((s) => enforcementTypes.includes(s)) || 'DEFAULT';
    const ts = extractUnixSeconds(buf, strings);
    const nowSec = Math.floor(Date.now() / 1000);
    const namedRestrict = strings.some((s) => /RESTRICT|ACTIVE/i.test(s));
    // Active with a future/near-past end timestamp or an explicit restrict label.
    if (namedRestrict || (!!ts && parseInt(ts, 10) > nowSec - 60)) {
        return {
            is_active: true,
            time_enforcement_ends: ts || '0',
            enforcement_type: enforcement,
        };
    }
    // Compact argo blobs (often ~10 bytes, no strings) are ambiguous after WA's
    // format=argo switch — signal caller to keep last-known lock (do not emit inactive).
    if (buf.length <= 16 && strings.length === 0 && !ts) {
        throw new Boom('MEX argo reachout payload ambiguous', {
            statusCode: 422,
            data: { _wasupAmbiguous: true },
        });
    }
    return {
        is_active: false,
        time_enforcement_ends: '0',
        enforcement_type: enforcement,
    };
}

function decodeArgoMessageCap(buf) {
    const strings = extractArgoStrings(buf);
    const ts = extractUnixSeconds(buf, strings);
    const statuses = strings.filter((s) =>
        /^(NONE|NOT_ELIGIBLE|ELIGIBLE|ACTIVE|CAPPED|LIMITED)$/i.test(s)
    );
    const capping = statuses.find((s) => s === 'NONE' || /CAPPED|LIMITED|ACTIVE/i.test(s))
        || statuses[statuses.length - 1]
        || 'NONE';
    const notElig = statuses.filter((s) => s === 'NOT_ELIGIBLE');
    return {
        capping_status: capping,
        cycle_end_timestamp: '1',
        cycle_start_timestamp: '0',
        mv_status: notElig[0] || statuses[0] || 'NOT_ELIGIBLE',
        ote_status: notElig[1] || notElig[0] || statuses[1] || 'NOT_ELIGIBLE',
        server_sent_timestamp: ts || '0',
        total_quota: 0,
        used_quota: 0,
    };
}

export const executeWMexQuery = async (variables, queryId, dataPath, query, generateMessageTag) => {
    const result = await wMexQuery(variables, queryId, query, generateMessageTag);
    const child = getBinaryNodeChild(result, 'result');
    if (child?.content) {
        const buf = toBuffer(child.content);
        if (buf) {
            const asJson = tryParseJsonBuffer(buf);
            if (asJson) {
                if (asJson.errors && asJson.errors.length > 0) {
                    const firstError = asJson.errors[0];
                    const errorMessages = asJson.errors.map((err) => err.message || 'Unknown error').join(', ');
                    throw new Boom(\`GraphQL server error: \${errorMessages}\`, {
                        statusCode: firstError.extensions?.error_code || 400,
                        data: firstError,
                    });
                }
                const response = dataPath ? asJson?.data?.[dataPath] : asJson?.data;
                if (typeof response !== 'undefined') return response;
            }

            const fmt = String(child.attrs?.format || '').toLowerCase();
            if (fmt === 'argo' || !asJson) {
                if (dataPath === 'xwa2_fetch_account_reachout_timelock') {
                    return decodeArgoReachout(buf);
                }
                if (dataPath === 'xwa2_message_capping_info') {
                    return decodeArgoMessageCap(buf);
                }
            }
        }
    }
    const action = (dataPath || '').startsWith('xwa2_')
        ? dataPath.substring(5).replace(/_/g, ' ')
        : dataPath?.replace(/_/g, ' ');
    throw new Boom(\`Failed to \${action}, unexpected response structure.\`, { statusCode: 400, data: result });
};
`;

if (!fs.existsSync(path.dirname(target))) {
    console.log('[patch-mex] baileys mex path missing, skipping');
    process.exit(0);
}

const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const versionTag = 'wasup-mex-argo-v4';
if (existing.includes(versionTag)) {
    console.log('[patch-mex] OK — argo-aware mex.js already applied (v4)');
    process.exit(0);
}

fs.writeFileSync(target, MEX_JS.replace(
    'export const executeWMexQuery',
    `/* ${versionTag} */\nexport const executeWMexQuery`,
));
console.log('[patch-mex] Patched baileys mex.js for format=argo MEX results (v4)');
