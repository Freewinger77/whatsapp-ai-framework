export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (process.env.WASUP_ENABLE_INTERNAL_SCHEDULER !== 'true') return;
  if ((globalThis as typeof globalThis & { __wasupSchedulerStarted?: boolean }).__wasupSchedulerStarted) return;

  (globalThis as typeof globalThis & { __wasupSchedulerStarted?: boolean }).__wasupSchedulerStarted = true;

  const runFullSweep = () => {
    void callInternal('/api/internal/azure/reconcile');
    void callInternal('/api/internal/trials/sweep');
    void callInternal('/api/internal/billing/sweep');
  };

  const runDnsPendingSweep = () => {
    void callInternal('/api/internal/azure/reconcile');
  };

  // Adopt worker-created instances into the control plane and clean up dead
  // worker orphans. The sync endpoint imports any worker instance missing from
  // the CP and deletes disconnected legacy (wa_*) orphans, while explicitly
  // protecting connected/connecting instances and UUID instances. Without this,
  // raw /api/onboard instances never register in the CP and pile up as orphans.
  const runWorkerInstanceSweep = () => {
    void callInternal('/api/internal/instances/sync');
  };

  // Fast path for dns_pending / provisioning — avoids 15+ minute UI stalls.
  setTimeout(runDnsPendingSweep, 15_000);
  setInterval(runDnsPendingSweep, 60_000);

  // Adopt/clean worker orphans quickly so a new onboard is tracked within ~2 min.
  setTimeout(runWorkerInstanceSweep, 30_000);
  setInterval(runWorkerInstanceSweep, 2 * 60_000);

  setTimeout(runFullSweep, 60_000);
  setInterval(runFullSweep, 15 * 60_000);
}

async function callInternal(path: string) {
  const baseUrl = process.env.WASUP_CONTROL_PLANE_URL;
  const secret = process.env.WASUP_WORKER_SHARED_SECRET;
  if (!baseUrl || !secret) return;

  try {
    await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'x-wasup-worker-secret': secret
      }
    });
  } catch (error) {
    console.error(`Wasup scheduler failed for ${path}:`, error);
  }
}
