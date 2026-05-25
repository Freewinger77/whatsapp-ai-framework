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

  // Fast path for dns_pending / provisioning — avoids 15+ minute UI stalls.
  setTimeout(runDnsPendingSweep, 15_000);
  setInterval(runDnsPendingSweep, 60_000);

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
