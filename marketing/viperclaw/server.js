/**
 * Viperclaw / Wasup Backend — marketing landing page server.
 * Tiny Express static host. No backend logic, no API calls.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});

app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=300');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    },
}));

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', role: 'viperclaw-marketing' });
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[viperclaw] listening on :${PORT}`);
});
