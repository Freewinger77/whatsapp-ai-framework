/**
 * Azure Blob Storage integration for WhatsApp media files.
 *
 * Uploads images, audio, video, documents, and stickers received via
 * WhatsApp to a public Azure Blob container and returns the public URL.
 *
 * Required env vars:
 *   AZURE_STORAGE_CONNECTION_STRING - Full connection string from Azure portal
 *   AZURE_STORAGE_CONTAINER        - Container name (default: "whatsapp-media")
 */

import { BlobServiceClient } from '@azure/storage-blob';
import crypto from 'crypto';

let containerClient = null;
let enabled = false;

const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || 'whatsapp-media';

export function isStorageEnabled() {
    return enabled;
}

export async function initAzureStorage() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
        console.log('[AzureStorage] No AZURE_STORAGE_CONNECTION_STRING set — media storage disabled');
        return false;
    }

    try {
        const blobService = BlobServiceClient.fromConnectionString(connStr);
        containerClient = blobService.getContainerClient(CONTAINER_NAME);
        await containerClient.createIfNotExists({ access: 'blob' });
        enabled = true;
        console.log(`[AzureStorage] Ready — container "${CONTAINER_NAME}" (public blob access)`);
        return true;
    } catch (err) {
        console.error('[AzureStorage] Init failed:', err.message);
        return false;
    }
}

/**
 * Upload a buffer to Azure Blob Storage.
 *
 * @param {Buffer} buffer - File data
 * @param {object} opts
 * @param {string} opts.extension   - e.g. "jpg", "ogg", "mp4"
 * @param {string} opts.mimeType    - e.g. "image/jpeg"
 * @param {string} opts.instanceId  - Instance ID (used as folder prefix)
 * @param {string} [opts.folder]    - Subfolder, defaults to media type
 * @returns {Promise<{url: string, blobName: string} | null>}
 */
export async function uploadMedia(buffer, opts = {}) {
    if (!enabled || !containerClient) return null;

    const { extension = 'bin', mimeType = 'application/octet-stream', instanceId = 'default', folder = '' } = opts;
    const ts = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    const prefix = folder || 'media';
    const blobName = `${instanceId}/${prefix}/${ts}-${rand}.${extension}`;

    try {
        const blockBlob = containerClient.getBlockBlobClient(blobName);
        await blockBlob.uploadData(buffer, {
            blobHTTPHeaders: { blobContentType: mimeType }
        });
        return { url: blockBlob.url, blobName };
    } catch (err) {
        console.error('[AzureStorage] Upload failed:', err.message);
        return null;
    }
}

/**
 * Upload arbitrary file from a ReadableStream.
 */
export async function uploadStream(stream, length, opts = {}) {
    if (!enabled || !containerClient) return null;

    const { extension = 'bin', mimeType = 'application/octet-stream', instanceId = 'default', folder = 'uploads' } = opts;
    const ts = Date.now();
    const rand = crypto.randomBytes(4).toString('hex');
    const blobName = `${instanceId}/${folder}/${ts}-${rand}.${extension}`;

    try {
        const blockBlob = containerClient.getBlockBlobClient(blobName);
        await blockBlob.uploadStream(stream, undefined, undefined, {
            blobHTTPHeaders: { blobContentType: mimeType }
        });
        return { url: blockBlob.url, blobName };
    } catch (err) {
        console.error('[AzureStorage] Stream upload failed:', err.message);
        return null;
    }
}
