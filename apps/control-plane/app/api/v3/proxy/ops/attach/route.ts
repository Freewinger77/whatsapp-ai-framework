import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { requirePlatformAdmin } from '../../../../../../lib/platform-admin';
import { attachProxyOps, detachProxyOps } from '../../../../../../lib/proxy-ops';

/**
 * POST /api/v3/proxy/ops/attach
 * Body: { workerId, instanceId, label, forceShared? }
 *        or { workerId, instanceId, action: "detach" }
 */
export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (!body?.workerId || !body?.instanceId) {
      return NextResponse.json({ error: 'workerId and instanceId are required' }, { status: 400 });
    }
    if (body.action === 'detach' || body.detach === true) {
      const result = await detachProxyOps({
        workerId: String(body.workerId),
        instanceId: String(body.instanceId),
      });
      return NextResponse.json({ success: true, result });
    }
    if (!body.label) {
      return NextResponse.json({ error: 'label is required for attach' }, { status: 400 });
    }
    const result = await attachProxyOps({
      workerId: String(body.workerId),
      instanceId: String(body.instanceId),
      label: String(body.label),
      forceShared: !!body.forceShared,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /already used|PROXY_SHARED/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
