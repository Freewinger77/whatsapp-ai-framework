/**
 * Fire-and-forget activity sync from worker → control plane (Supabase via /api/internal/events).
 * Powers dev.wasup.co Home, Instance detail, and Deep Dive feeds.
 */

import axios from 'axios';

const CONTROL_PLANE_URL = String(process.env.WASUP_CONTROL_PLANE_URL || '').trim().replace(/\/+$/, '');
const WORKER_SECRET = process.env.WASUP_WORKER_SHARED_SECRET || '';
const ORG_ID = process.env.WASUP_ORG_ID || null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let queue = Promise.resolve();

export function isControlPlaneReportingEnabled() {
    return Boolean(CONTROL_PLANE_URL && WORKER_SECRET && ORG_ID);
}

function isControlPlaneInstanceId(instanceId) {
    return UUID_RE.test(String(instanceId || ''));
}

function enqueue(task) {
    queue = queue
        .then(task)
        .catch((error) => {
            console.warn('[ControlPlaneReporter]', error.message);
        });
}

async function postEvent(payload) {
    if (!isControlPlaneReportingEnabled()) return;
    if (payload.instanceId && !isControlPlaneInstanceId(payload.instanceId)) return;

    await axios.post(`${CONTROL_PLANE_URL}/api/internal/events`, payload, {
        headers: {
            'Content-Type': 'application/json',
            'X-Wasup-Worker-Secret': WORKER_SECRET,
            Authorization: `Bearer ${WORKER_SECRET}`,
        },
        timeout: 8000,
        validateStatus: (status) => status >= 200 && status < 500,
    });
}

function mapLogSeverity(level) {
    switch (level) {
        case 'error':
            return 'error';
        case 'warning':
            return 'warning';
        case 'success':
            return 'info';
        default:
            return 'info';
    }
}

function inferEventType(message, level) {
    const text = String(message || '').toLowerCase();
    if (text.includes('connected as')) return 'connection.open';
    if (text.includes('starting connection') || text.includes('qr code')) return 'connection.connecting';
    if (text.includes('disconnected') || text.includes('logged out')) return 'connection.close';
    if (text.startsWith('sent to ') || text.startsWith('replied to ')) return 'message.outbound';
    if (text.startsWith('received from ')) return 'message.inbound';
    if (text.includes('send failed') || text.includes('connection error')) return 'connection.error';
    if (level === 'error') return 'worker.error';
    return 'worker.log';
}

export function reportActivityLog(instanceId, entry) {
    if (!entry?.message) return;
    enqueue(() => postEvent({
        kind: 'log',
        orgId: ORG_ID,
        instanceId,
        eventType: inferEventType(entry.message, entry.level),
        severity: mapLogSeverity(entry.level),
        summary: entry.message.slice(0, 2000),
        payload: {
            level: entry.level,
            timestamp: entry.timestamp,
        },
    }));
}

export function reportMessageEvent(instanceId, {
    direction,
    phone,
    body,
    externalMessageId,
    status,
    metadata = {},
}) {
    enqueue(() => postEvent({
        kind: 'message',
        orgId: ORG_ID,
        instanceId,
        externalMessageId: externalMessageId || undefined,
        direction,
        phone: phone || undefined,
        body: body || undefined,
        status: status || (direction === 'outbound' ? 'sent' : 'received'),
        metadata,
    }));
}

export function reportConnectionStatus(instanceId, status) {
    if (!status?.status) return;
    const summary = status.connectedPhone
        ? `Connected as ${status.connectedPhone}`
        : `Instance status: ${status.status}`;

    enqueue(() => postEvent({
        kind: 'log',
        orgId: ORG_ID,
        instanceId,
        eventType: status.status === 'connected' ? 'connection.open' : `connection.${status.status}`,
        severity: status.status === 'error' ? 'error' : 'info',
        summary,
        payload: {
            status: status.status,
            phone: status.connectedPhone || null,
            hasQr: Boolean(status.qrCode),
        },
    }));
}
