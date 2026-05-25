/**
 * Per-instance media storage — local disk always, Azure Blob when configured.
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { uploadMedia, isStorageEnabled, initAzureStorage } from './azure-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_ROOT = process.env.WASUP_DATA_DIR
    ? path.join(process.env.WASUP_DATA_DIR, 'instances')
    : path.join(__dirname, '../../instances');

const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
};

function mediaRoot(instanceId) {
    return path.join(DATA_ROOT, instanceId, 'media');
}

function indexPath(instanceId) {
    return path.join(mediaRoot(instanceId), 'index.json');
}

async function readIndex(instanceId) {
    try {
        const raw = await fs.readFile(indexPath(instanceId), 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeIndex(instanceId, entries) {
    const root = mediaRoot(instanceId);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(indexPath(instanceId), JSON.stringify(entries.slice(0, 500), null, 2));
}

function guessExtension(mimeType, fallback = 'bin') {
    if (!mimeType) return fallback;
    return MIME_EXT[mimeType] || mimeType.split('/').pop()?.replace(/[^a-z0-9]/gi, '') || fallback;
}

function newMediaId() {
    return crypto.randomBytes(8).toString('hex');
}

export async function initMediaStorage() {
    await initAzureStorage();
}

/**
 * Persist an incoming or uploaded media buffer for an instance.
 */
export async function storeMediaBuffer(instanceId, buffer, opts = {}) {
    const {
        mimeType = 'application/octet-stream',
        fileName = null,
        mediaType = 'media',
        direction = 'inbound',
        sourceMessageId = null,
    } = opts;

    const mediaId = newMediaId();
    const ext = guessExtension(mimeType, path.extname(fileName || '').replace('.', '') || 'bin');
    const folder = mediaType === 'document' || mediaType === 'audio' ? mediaType : 'media';
    const root = mediaRoot(instanceId);
    const relativePath = path.join(folder, `${Date.now()}-${mediaId}.${ext}`);
    const absolutePath = path.join(root, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, buffer);

    let publicUrl = null;
    if (isStorageEnabled()) {
        const uploaded = await uploadMedia(buffer, {
            extension: ext,
            mimeType,
            instanceId,
            folder,
        });
        publicUrl = uploaded?.url || null;
    }

    const entry = {
        id: mediaId,
        instanceId,
        mediaType,
        direction,
        mimeType,
        fileName: fileName || `${mediaId}.${ext}`,
        localPath: relativePath,
        publicUrl,
        size: buffer.length,
        sourceMessageId,
        createdAt: new Date().toISOString(),
    };

    const index = await readIndex(instanceId);
    index.unshift(entry);
    await writeIndex(instanceId, index);

    return entry;
}

export async function storeMediaMetadata(instanceId, opts = {}) {
    const mediaId = newMediaId();
    const entry = {
        id: mediaId,
        instanceId,
        mediaType: opts.mediaType || 'media',
        direction: opts.direction || 'outbound',
        mimeType: opts.mimeType || null,
        fileName: opts.fileName || null,
        localPath: null,
        publicUrl: opts.publicUrl || null,
        size: 0,
        sourceMessageId: opts.sourceMessageId || null,
        location: opts.location || null,
        createdAt: new Date().toISOString(),
    };

    const index = await readIndex(instanceId);
    index.unshift(entry);
    await writeIndex(instanceId, index);
    return entry;
}

export async function getMediaEntry(instanceId, mediaId) {
    const index = await readIndex(instanceId);
    return index.find((item) => item.id === mediaId) || null;
}

export async function listMedia(instanceId, { mediaType, limit = 50 } = {}) {
    let index = await readIndex(instanceId);
    if (mediaType) {
        index = index.filter((item) => item.mediaType === mediaType);
    }
    return index.slice(0, limit).map((item) => ({
        ...item,
        localPath: undefined,
        downloadUrl: item.localPath
            ? `/api/instances/${encodeURIComponent(instanceId)}/media/${encodeURIComponent(item.id)}`
            : null,
    }));
}

export async function resolveMediaBuffer(instanceId, mediaId) {
    const entry = await getMediaEntry(instanceId, mediaId);
    if (!entry) return null;

    const absolutePath = path.join(mediaRoot(instanceId), entry.localPath);
    if (!fsSync.existsSync(absolutePath)) return null;

    const buffer = await fs.readFile(absolutePath);
    return { entry, buffer };
}

export async function resolveMediaSource(instanceId, source = {}) {
    if (source.mediaId) {
        const resolved = await resolveMediaBuffer(instanceId, source.mediaId);
        if (!resolved) throw new Error(`Media ${source.mediaId} not found for instance`);
        return {
            buffer: resolved.buffer,
            mimeType: source.mimetype || source.mimeType || resolved.entry.mimeType,
            fileName: source.fileName || source.filename || resolved.entry.fileName,
        };
    }

    if (source.url) {
        return {
            url: source.url,
            mimeType: source.mimetype || source.mimeType,
            fileName: source.fileName || source.filename,
        };
    }

    if (source.base64) {
        const raw = String(source.base64);
        const match = raw.match(/^data:([^;]+);base64,(.+)$/);
        const mimeType = source.mimetype || source.mimeType || match?.[1] || 'application/octet-stream';
        const encoded = match ? match[2] : raw;
        return {
            buffer: Buffer.from(encoded, 'base64'),
            mimeType,
            fileName: source.fileName || source.filename,
        };
    }

    if (source.path) {
        const absolutePath = path.isAbsolute(source.path)
            ? source.path
            : path.join(mediaRoot(instanceId), source.path);
        const buffer = await fs.readFile(absolutePath);
        return {
            buffer,
            mimeType: source.mimetype || source.mimeType || 'application/octet-stream',
            fileName: source.fileName || source.filename || path.basename(absolutePath),
        };
    }

    throw new Error('Media source requires url, base64, mediaId, or path');
}
