#!/usr/bin/env python3
"""Patch legacy wasup server.js with docs unlock routes."""
from pathlib import Path
import sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else '/opt/whatsapp-ai/app/server.js')
text = path.read_text()

if "DOCS_REVEAL_PASSWORD" not in text:
    text = text.replace(
        "const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';\n",
        "const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';\n"
        "const DOCS_REVEAL_PASSWORD = process.env.DOCS_REVEAL_PASSWORD || 'Wasup@123';\n",
        1,
    )

if "/api/docs/config" not in text:
    insert = '''
function getPublicBaseUrl(req) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`).toString().split(',')[0].trim();
    return `${proto}://${host}`;
}

app.get('/api/docs/config', (req, res) => {
    res.json({
        success: true,
        unlockEnabled: Boolean(DOCS_REVEAL_PASSWORD),
        apiKeyConfigured: Boolean(API_KEY),
        region: null,
    });
});

app.post('/api/docs/unlock', (req, res) => {
    try {
        if (!DOCS_REVEAL_PASSWORD) {
            return res.status(503).json({
                success: false,
                error: 'Docs key reveal is not configured on this deployment',
            });
        }
        const submitted = String(req.body?.password || '').trim();
        if (submitted !== DOCS_REVEAL_PASSWORD) {
            return res.status(401).json({ success: false, error: 'Invalid password' });
        }
        res.json({
            success: true,
            baseUrl: getPublicBaseUrl(req),
            apiKey: API_KEY || '',
            regionCode: null,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

'''
    marker = "app.get('/api/openapi.yaml', (req, res) => {\n    res.type('text/yaml').sendFile(path.join(__dirname, 'openapi.yaml'));\n});"
    if marker not in text:
        print('Could not find openapi route marker', file=sys.stderr)
        sys.exit(1)
    text = text.replace(marker, marker + insert, 1)

if "req.path.startsWith('/docs')" not in text:
    text = text.replace(
        "function authenticateAPI(req, res, next) {\n    // If no API key is configured, skip auth (for local development)\n    if (!API_KEY) {\n        return next();\n    }",
        "function authenticateAPI(req, res, next) {\n    if (req.path.startsWith('/docs') || req.path === '/openapi.yaml') {\n        return next();\n    }\n\n    // If no API key is configured, skip auth (for local development)\n    if (!API_KEY) {\n        return next();\n    }",
        1,
    )

path.write_text(text)
print('patched', path)
