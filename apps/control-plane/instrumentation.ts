export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (process.env.WASUP_ENABLE_INTERNAL_SCHEDULER !== 'true') return;
  if ((globalThis as typeof globalThis & { __wasupSchedulerStarted?: boolean }).__wasupSchedulerStarted) return;

  (globalThis as typeof globalThis & { __wasupSchedulerStarted?: boolean }).__wasupSchedulerStarted = true;

  const run = () => {
    void callInternal('/api/internal/azure/reconcile');
    void callInternal('/api/internal/trials/sweep');
    void callInternal('/api/internal/billing/sweep');
  };

  setTimeout(run, 60_000);
  setInterval(run, 15 * 60_000);
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
