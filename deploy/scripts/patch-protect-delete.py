#!/usr/bin/env python3
"""Block accidental DELETE of CP UUID instances from non-internal callers."""
from pathlib import Path
import sys

path = Path(sys.argv[1]) / "server.js"
text = path.read_text()

marker = """app.delete('/api/instances/:id', async (req, res) => {
    try {
        const result = await instanceManager.deleteInstance(req.params.id);"""

guard = """app.delete('/api/instances/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const credential = getCredentialFromRequest(req);
        const isInternal =
            (WORKER_SHARED_SECRET && credential === WORKER_SHARED_SECRET) ||
            (API_KEY && credential === API_KEY);
        if (process.env.WASUP_ORG_ID && isUuid && !isInternal) {
            console.warn(`[API] Blocked DELETE for protected org instance ${id}`);
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Protected instance cannot be deleted via this API key. Manage it from the Wasup control plane.',
            });
        }
        console.log(`[API] DELETE instance ${id} (internal=${!!isInternal})`);
        const result = await instanceManager.deleteInstance(id);"""

if guard in text:
    print('DELETE guard already present')
elif marker not in text:
    raise SystemExit('DELETE route marker missing')
else:
    path.write_text(text.replace(marker, guard, 1))
    print('DELETE guard patched')
