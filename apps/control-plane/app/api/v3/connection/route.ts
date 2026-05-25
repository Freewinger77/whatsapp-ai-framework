import { NextResponse } from 'next/server';
import { maskApiKey } from '../../../../lib/api-keys';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { ensureOrgDeployment } from '../../../../lib/org-deployments';
import { getOrgPlanAccess } from '../../../../lib/plan-access';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const [deployment, plan] = await Promise.all([
    ensureOrgDeployment(principal.orgId),
    getOrgPlanAccess(principal.orgId)
  ]);

  const credentialsLocked = !plan.canViewCredentials;
  const { data: keys, error } = await (getSupabaseAdmin() as any)
    .from('api_keys')
    .select('id, name, public_id, key_kind, scopes, created_at, last_used_at, expires_at, revoked_at')
    .eq('org_id', principal.orgId)
    .is('revoked_at', null)
    .order('key_kind', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    plan: {
      tier: plan.tier,
      isPro: plan.isPro,
      canCreateInstances: plan.canCreateInstances,
      canViewCredentials: plan.canViewCredentials,
      proInstanceLimit: plan.proInstanceLimit,
      billingStatus: plan.billingStatus,
      billingGraceEndsAt: plan.billingGraceEndsAt,
      billingLockedAt: plan.billingLockedAt,
      currentPeriodEnd: plan.currentPeriodEnd,
      cancelAtPeriodEnd: plan.cancelAtPeriodEnd
    },
    credentialsLocked,
    organization: {
      id: deployment.organization.id,
      slug: deployment.organization.slug,
      name: deployment.organization.name,
      baseUrl: credentialsLocked
        ? null
        : deployment.organization.api_base_url || deployment.deployment.base_url
    },
    deployment: {
      id: deployment.deployment.id,
      status: deployment.deployment.status,
      base_url: deployment.deployment.base_url,
      public_ip: deployment.deployment.public_ip,
      last_error: deployment.deployment.last_error,
      requested_at: deployment.deployment.requested_at,
      provisioned_at: deployment.deployment.provisioned_at,
      dns_ready_at: deployment.deployment.dns_ready_at,
      progress: buildDeploymentProgress(deployment.deployment)
    },
    apiKeys: credentialsLocked
      ? []
      : (keys ?? []).map((key: any) => ({
          ...key,
          masked: maskApiKey(key.public_id)
        })),
    oneTimeApiKeys: credentialsLocked
      ? []
      : deployment.apiKeysCreated.map((key) => ({
      id: key.id,
      public_id: key.publicId,
      key_kind: key.keyKind,
      secret: key.key,
      message: 'Store this key now. It will not be shown again.'
    }))
  });
}

type DeploymentProgressInput = {
  status: string;
  last_error?: string | null;
  health?: unknown;
  requested_at?: string | null;
  provisioned_at?: string | null;
  dns_ready_at?: string | null;
};

function buildDeploymentProgress(deployment: DeploymentProgressInput) {
  const detail = latestAzureStatusLine(deployment.health);

  switch (deployment.status) {
    case 'queued':
      return {
        stage: 'queued',
        label: 'Queued',
        message: 'Provisioning queued. Requesting Azure resources...',
        estimate: 'Usually starts within a minute.',
        detail
      };
    case 'provisioning':
      return {
        stage: 'provisioning',
        label: 'Provisioning',
        message: 'Azure VM is starting. This usually takes 5-10 minutes.',
        estimate: 'Azure VM provisioning usually takes 5-10 minutes.',
        detail
      };
    case 'dns_pending':
      return {
        stage: 'dns_pending',
        label: 'Verifying worker',
        message: 'VM is running. DNS, HTTPS, and worker health are being verified...',
        estimate: 'Public worker verification usually takes 1-5 minutes.',
        detail
      };
    case 'ready':
      return {
        stage: 'ready',
        label: 'Ready',
        message: 'Workspace is ready. You can connect instances now.',
        estimate: null,
        detail: null
      };
    case 'failed':
      return {
        stage: 'failed',
        label: 'Failed',
        message: deployment.last_error
          ? `Provisioning failed: ${deployment.last_error}`
          : 'Provisioning failed. Please retry or contact support.',
        estimate: null,
        detail: null
      };
    default:
      return {
        stage: deployment.status || 'not_started',
        label: humanizeStatus(deployment.status || 'not_started'),
        message: 'Workspace provisioning has not started yet.',
        estimate: null,
        detail
      };
  }
}

function latestAzureStatusLine(health: unknown) {
  if (!health || typeof health !== 'object') return null;
  const azureReconcile = (health as { azureReconcile?: unknown }).azureReconcile;
  if (!azureReconcile || typeof azureReconcile !== 'object') return null;

  const statuses = (azureReconcile as { statuses?: unknown }).statuses;
  if (!Array.isArray(statuses)) return null;

  const latestDisplay = statuses
    .map((status) => {
      if (!status || typeof status !== 'object') return null;
      const displayStatus = (status as { displayStatus?: unknown }).displayStatus;
      return typeof displayStatus === 'string' ? displayStatus : null;
    })
    .filter(Boolean)
    .pop();

  return latestDisplay ? `Azure reports ${latestDisplay}.` : null;
}

function humanizeStatus(status: string) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
