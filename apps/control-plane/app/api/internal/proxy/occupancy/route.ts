import { NextResponse } from 'next/server';
import { getFleetProxyOccupancy } from '../../../../../lib/proxy-ops';

/**
 * GET /api/internal/proxy/occupancy
 * Worker-facing fleet-wide proxy occupancy (host:port + label).
 * Auth: X-Wasup-Worker-Secret / Bearer shared secret.
 */
export async function GET(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const supplied =
    req.headers.get('x-wasup-worker-secret') ||
    req.headers.get('x-api-key') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!requiredSecret || !supplied || supplied !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const occupancy = await getFleetProxyOccupancy();
    return NextResponse.json({ success: true, ...occupancy });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
