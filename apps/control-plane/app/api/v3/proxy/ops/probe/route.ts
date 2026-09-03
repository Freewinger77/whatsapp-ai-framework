import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { requirePlatformAdmin } from '../../../../../../lib/platform-admin';
import { probeProxyOps } from '../../../../../../lib/proxy-ops';

/**
 * POST /api/v3/proxy/ops/probe
 * Body: { labels?: string[], light?: boolean, workerId?: string }
 */
export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await probeProxyOps({
      labels: Array.isArray(body?.labels) ? body.labels.map(String) : undefined,
      light: !!body?.light,
      workerId: body?.workerId ? String(body.workerId) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
