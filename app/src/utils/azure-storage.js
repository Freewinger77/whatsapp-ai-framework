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
        console.log('[AzureStorage] No AZURE_STORAGE_CONNECTION_STRING set — cloud media upload disabled (local disk still used)');
        return false;
    }

    try {
        const { BlobServiceClient } = await import('@azure/storage-blob');
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
