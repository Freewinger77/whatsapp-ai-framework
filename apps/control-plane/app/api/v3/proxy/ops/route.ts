import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { requirePlatformAdmin } from '../../../../../lib/platform-admin';
import { buildProxyOpsBoard } from '../../../../../lib/proxy-ops';

/**
 * GET /api/v3/proxy/ops
 * Platform-admin proxy ops board: labeled catalog mapping, risk, antiban, last probe.
 * Triggers a background light hourly probe when stale.
 */
export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const url = new URL(req.url);
  const autoHourly = url.searchParams.get('autoHourly') !== '0';

  try {
    const board = await buildProxyOpsBoard({ autoHourlyProbe: autoHourly });
    return NextResponse.json(board);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
