import { resolveMediaSource } from './media-storage.js';

export async function buildOutgoingMediaMessage(instanceId, payload = {}) {
    if (payload.image) {
        const source = await resolveMediaSource(instanceId, payload.image);
        const caption = payload.image.caption || payload.caption || '';
        const content = source.url
            ? { image: { url: source.url }, caption: caption || undefined }
            : { image: source.buffer, caption: caption || undefined, mimetype: source.mimeType };

        return {
            content,
            logText: caption || '[Image]',
            mediaType: 'image',
            storage: source.buffer ? { buffer: source.buffer, mimeType: source.mimeType, fileName: source.fileName, mediaType: 'image' } : null,
        };
    }

    if (payload.document) {
        const source = await resolveMediaSource(instanceId, payload.document);
        const caption = payload.document.caption || payload.caption || '';
        const fileName = payload.document.fileName || payload.document.filename || source.fileName || 'document';
        const mimetype = payload.document.mimetype || payload.document.mimeType || source.mimeType || 'application/octet-stream';
        const content = source.url
            ? { document: { url: source.url, fileName, mimetype }, caption: caption || undefined }
            : { document: source.buffer, fileName, mimetype, caption: caption || undefined };

        return {
            content,
            logText: caption || fileName,
            mediaType: 'document',
            storage: source.buffer ? { buffer: source.buffer, mimeType: mimetype, fileName, mediaType: 'document' } : null,
        };
    }

    if (payload.audio) {
        const source = await resolveMediaSource(instanceId, payload.audio);
        const mimetype = payload.audio.mimetype || payload.audio.mimeType || source.mimeType || 'audio/mpeg';
        const ptt = payload.audio.ptt !== false;
        const content = source.url
            ? { audio: { url: source.url, mimetype }, ptt }
            : { audio: source.buffer, mimetype, ptt };

        return {
            content,
            logText: ptt ? '[Voice note]' : '[Audio]',
            mediaType: 'audio',
            storage: source.buffer ? { buffer: source.buffer, mimeType: mimetype, fileName: source.fileName, mediaType: 'audio' } : null,
        };
    }

    if (payload.video) {
        const source = await resolveMediaSource(instanceId, payload.video);
        const caption = payload.video.caption || payload.caption || '';
        const mimetype = payload.video.mimetype || payload.video.mimeType || source.mimeType || 'video/mp4';
        const content = source.url
            ? { video: { url: source.url, mimetype }, caption: caption || undefined }
            : { video: source.buffer, caption: caption || undefined, mimetype };

        return {
            content,
            logText: caption || '[Video]',
            mediaType: 'video',
            storage: source.buffer ? { buffer: source.buffer, mimeType: mimetype, fileName: source.fileName, mediaType: 'video' } : null,
        };
    }

    if (payload.location) {
        const latitude = Number(payload.location.latitude ?? payload.location.degreesLatitude);
        const longitude = Number(payload.location.longitude ?? payload.location.degreesLongitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new Error('location.latitude and location.longitude are required');
        }

        const name = payload.location.name || undefined;
        const address = payload.location.address || undefined;
        const content = {
            location: {
                degreesLatitude: latitude,
                degreesLongitude: longitude,
                name,
                address,
            },
        };

        return {
            content,
            logText: name || address || `[Location ${latitude}, ${longitude}]`,
            mediaType: 'location',
            storage: {
                mediaType: 'location',
                location: { latitude, longitude, name, address },
            },
        };
    }

    throw new Error('Provide image, video, document, audio, or location in the send payload');
}

export function hasMediaPayload(body = {}) {
    return Boolean(body.image || body.video || body.document || body.audio || body.location);
}
