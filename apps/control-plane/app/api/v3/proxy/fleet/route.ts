import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { requirePlatformAdmin } from '../../../../../lib/platform-admin';
import { buildFleetProxyAudit } from '../../../../../lib/fleet-proxy-audit';

/**
 * GET /api/v3/proxy/fleet
 * Platform-admin rollup: shared workers (wasup/wasup2/…/wasup05/wasup-dev)
 * + org VMs from org_deployments + control-plane proxy_allocations summary.
 *
 * Query:
 *   includeShared=0|1 (default 1)
 *   includeOrg=0|1 (default 1)
 *   workers=wasup2,wasup3 (optional filter for shared ids)
 */
export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const url = new URL(req.url);
  const includeShared = url.searchParams.get('includeShared') !== '0';
  const includeOrg = url.searchParams.get('includeOrg') !== '0';
  const workersParam = url.searchParams.get('workers');
  const workerIds = workersParam
    ? workersParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  try {
    const audit = await buildFleetProxyAudit({
      includeShared,
      includeOrgDeployments: includeOrg,
      workerIds,
    });
    return NextResponse.json(audit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
