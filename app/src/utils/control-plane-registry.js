/**
 * Register worker-only instances with the control plane so dev.wasup always has visibility.
 */

import axios from 'axios';

const CONTROL_PLANE_URL = String(process.env.WASUP_CONTROL_PLANE_URL || process.env.CONTROL_PLANE_URL || '')
    .trim()
    .replace(/\/+$/, '');
const WORKER_SECRET = process.env.WASUP_WORKER_SHARED_SECRET || process.env.API_KEY || '';
const ORG_ID = process.env.WASUP_ORG_ID || null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let queue = Promise.resolve();

export function isControlPlaneRegistryEnabled() {
    return Boolean(CONTROL_PLANE_URL && WORKER_SECRET && ORG_ID);
}

function enqueue(task) {
    queue = queue
        .then(task)
        .catch((error) => {
            console.warn('[ControlPlaneRegistry]', error.message);
        });
}

export function registerWorkerInstance(instanceStatus = {}, options = {}) {
    if (!isControlPlaneRegistryEnabled()) return;
    const workerInstanceId = String(instanceStatus.id || '').trim();
    if (!workerInstanceId) return;

    enqueue(async () => {
        const response = await axios.post(
            `${CONTROL_PLANE_URL}/api/internal/instances/register`,
            {
                orgId: ORG_ID,
                workerInstanceId,
                controlPlaneInstanceId: UUID_RE.test(workerInstanceId) ? workerInstanceId : options.controlPlaneInstanceId || null,
                name: instanceStatus.name || undefined,
                webhookUrl: instanceStatus.webhookUrl ?? null,
                status: instanceStatus.status || 'disconnected',
                phone: instanceStatus.connectedPhone || instanceStatus.phone || null,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wasup-Worker-Secret': WORKER_SECRET,
                    Authorization: `Bearer ${WORKER_SECRET}`,
                },
                timeout: 10_000,
                validateStatus: () => true,
            }
        );

        if (response.status >= 400) {
            console.warn(
                '[ControlPlaneRegistry] Register failed',
                workerInstanceId,
                response.status,
                response.data?.error || response.statusText
            );
            return;
        }

        const cpId = response.data?.instance?.id || workerInstanceId;
        console.log(
            `[ControlPlaneRegistry] Captured ${workerInstanceId} → control plane ${cpId}`,
            response.data?.created ? '(imported)' : '(linked)'
        );
    });
}

export function syncWorkerInstanceCatalog(instances = []) {
    if (!isControlPlaneRegistryEnabled() || !Array.isArray(instances) || !instances.length) return;

    enqueue(async () => {
        await axios.post(
            `${CONTROL_PLANE_URL}/api/internal/instances/sync`,
            {
                orgId: ORG_ID,
                cleanupOrphanWorkers: false,
                importOrphanWorkers: true,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wasup-Worker-Secret': WORKER_SECRET,
                    Authorization: `Bearer ${WORKER_SECRET}`,
                },
                timeout: 20_000,
                validateStatus: (status) => status >= 200 && status < 500,
            }
        );
    });
}
