import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { ensureOrgDeployment } from '../../../../lib/org-deployments';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const deployment = await ensureOrgDeployment(principal.orgId);
  const baseUrl = deployment.organization.api_base_url || deployment.deployment.base_url;

  return NextResponse.json({
    success: true,
    baseUrl,
    links: {
      docs: baseUrl ? `${baseUrl}/docs` : null,
      playground: baseUrl ? `${baseUrl}/test` : null,
      openapi: baseUrl ? `${baseUrl}/openapi.yaml` : null,
      admin: baseUrl ? `${baseUrl}/` : null,
      health: baseUrl ? `${baseUrl}/api/health` : null
    }
  });
}
