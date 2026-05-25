import { getProInstanceLimit, type PlanTier } from './plan-access';
import { getSupabaseAdmin } from './supabase-admin';

const PRO_BILLING_STATUSES = new Set(['active', 'trialing']);
const GRACE_BILLING_STATUSES = new Set(['past_due', 'unpaid']);

export type PlatformOrgRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  orgStatus: string;
  clerkOrgId: string | null;
  apiBaseUrl: string | null;
  subdomain: string | null;
  deploymentStatus: string | null;
  createdAt: string;
  tier: PlanTier;
  billingStatus: string | null;
  billingGraceEndsAt: string | null;
  billingLockedAt: string | null;
  trialEndsAt: string | null;
  instancesDeleteAfter: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activeInstanceCount: number;
  paidInstanceLimit: number;
  availableInstanceSlots: number;
  messageCreditBalance: number;
  deployment: {
    status: string;
    baseUrl: string | null;
    publicIp: string | null;
    vmName: string | null;
    azureRegion: string | null;
    lastError: string | null;
    requestedAt: string | null;
    provisionedAt: string | null;
    dnsReadyAt: string | null;
  } | null;
  instanceCounts: {
    total: number;
    connected: number;
    disconnected: number;
    provisioning: number;
    error: number;
    suspended: number;
  };
};

export type PlatformInstanceRow = {
  id: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  name: string;
  status: string;
  regionCode: string;
  phone: string | null;
  provisioningState: string | null;
  createdAt: string;
};

export type PlatformOverview = {
  generatedAt: string;
  summary: {
    totalOrganizations: number;
    proOrganizations: number;
    trialingOrganizations: number;
    graceOrganizations: number;
    lockedOrganizations: number;
    freeOrganizations: number;
    totalInstances: number;
    connectedInstances: number;
    readyDeployments: number;
    failedDeployments: number;
    proxyTotal: number;
    proxyFree: number;
    proxyAssigned: number;
  };
  organizations: PlatformOrgRow[];
  instances: PlatformInstanceRow[];
  proxyPool: Array<{
    regionCode: string;
    total: number;
    free: number;
    assigned: number;
    unavailable: number;
  }>;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  clerk_org_id: string | null;
  api_base_url: string | null;
  subdomain: string | null;
  deployment_status: string | null;
  created_at: string;
};

type DeploymentRow = {
  org_id: string;
  status: string;
  base_url: string | null;
  public_ip: string | null;
  vm_name: string | null;
  azure_region: string | null;
  last_error: string | null;
  requested_at: string | null;
  provisioned_at: string | null;
  dns_ready_at: string | null;
};

type InstanceRow = {
  id: string;
  org_id: string;
  name: string;
  status: string;
  region_code: string;
  phone: string | null;
  provisioning_state: string | null;
  created_at: string;
};

export async function fetchPlatformOverview(): Promise<PlatformOverview> {
  const supabase = getSupabaseAdmin() as any;
  const proLimit = getProInstanceLimit();

  const [
    { data: organizations, error: orgError },
    { data: deployments, error: deploymentError },
    { data: billingSummaries, error: billingError },
    { data: entitlements, error: entitlementError },
    { data: instances, error: instanceError },
    { data: proxyPool, error: proxyError }
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, slug, name, plan, status, clerk_org_id, api_base_url, subdomain, deployment_status, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('org_deployments')
      .select(
        'org_id, status, base_url, public_ip, vm_name, azure_region, last_error, requested_at, provisioned_at, dns_ready_at'
      )
      .eq('environment', 'production'),
    supabase.from('org_billing_summary').select('*'),
    supabase
      .from('billing_entitlements')
      .select('org_id, status, paid_instance_limit, current_period_end, cancel_at_period_end, metadata'),
    supabase
      .from('instances')
      .select('id, org_id, name, status, region_code, phone, provisioning_state, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('proxy_pool_summary').select('*')
  ]);

  if (orgError) throw new Error(orgError.message);
  if (deploymentError) throw new Error(deploymentError.message);
  if (billingError) throw new Error(billingError.message);
  if (entitlementError) throw new Error(entitlementError.message);
  if (instanceError) throw new Error(instanceError.message);
  if (proxyError) throw new Error(proxyError.message);

  const deploymentByOrg = new Map<string, DeploymentRow>();
  for (const deployment of (deployments ?? []) as DeploymentRow[]) {
    deploymentByOrg.set(deployment.org_id, deployment);
  }

  const billingByOrg = new Map<string, Record<string, unknown>>();
  for (const summary of billingSummaries ?? []) {
    billingByOrg.set(summary.org_id as string, summary as Record<string, unknown>);
  }

  const entitlementByOrg = new Map<string, Record<string, unknown>>();
  for (const entitlement of entitlements ?? []) {
    entitlementByOrg.set(entitlement.org_id as string, entitlement as Record<string, unknown>);
  }

  const orgMeta = new Map<string, { slug: string; name: string }>();
  for (const org of (organizations ?? []) as OrganizationRow[]) {
    orgMeta.set(org.id, { slug: org.slug, name: org.name });
  }

  const instanceCountsByOrg = new Map<
    string,
    PlatformOrgRow['instanceCounts']
  >();

  for (const instance of (instances ?? []) as InstanceRow[]) {
    const counts = instanceCountsByOrg.get(instance.org_id) ?? {
      total: 0,
      connected: 0,
      disconnected: 0,
      provisioning: 0,
      error: 0,
      suspended: 0
    };
    counts.total += 1;
    if (instance.status === 'connected') counts.connected += 1;
    else if (instance.status === 'disconnected') counts.disconnected += 1;
    else if (instance.status === 'provisioning' || instance.status === 'connecting') counts.provisioning += 1;
    else if (instance.status === 'error') counts.error += 1;
    else if (instance.status === 'suspended') counts.suspended += 1;
    instanceCountsByOrg.set(instance.org_id, counts);
  }

  const platformOrganizations: PlatformOrgRow[] = ((organizations ?? []) as OrganizationRow[]).map((org) => {
    const billing = billingByOrg.get(org.id);
    const entitlement = entitlementByOrg.get(org.id);
    const entitlementMetadata = (entitlement?.metadata ?? {}) as Record<string, unknown>;
    const billingStatus = (entitlement?.status as string | undefined) ?? (billing?.billing_status as string | undefined) ?? null;
    const billingGraceEndsAt =
      (entitlementMetadata.billing_grace_ends_at as string | undefined) ??
      (entitlementMetadata.billingGraceEndsAt as string | undefined) ??
      null;
    const billingLockedAt =
      (entitlementMetadata.billing_locked_at as string | undefined) ??
      (entitlementMetadata.billingLockedAt as string | undefined) ??
      null;
    const trialEndsAt =
      billingStatus === 'trialing'
        ? ((entitlementMetadata.stripe_trial_end as string | undefined) ??
          (entitlement?.current_period_end as string | undefined) ??
          null)
        : null;
    const instancesDeleteAfter =
      (entitlementMetadata.instances_delete_after as string | undefined) ??
      (entitlementMetadata.instancesDeleteAfter as string | undefined) ??
      null;
    const activeInstanceCount = Number(billing?.active_instance_count ?? 0);
    const paidInstanceLimit = Math.min(Number(entitlement?.paid_instance_limit ?? billing?.paid_instance_limit ?? 0), proLimit);
    const availableInstanceSlots = Math.max(paidInstanceLimit - activeInstanceCount, 0);
    const now = Date.now();
    const graceActive =
      Boolean(billingGraceEndsAt) &&
      !billingLockedAt &&
      new Date(billingGraceEndsAt as string).getTime() > now;

    let tier: PlanTier = 'free';
    if (billingLockedAt || org.status === 'billing_locked') {
      tier = 'locked';
    } else if (graceActive || (billingStatus && GRACE_BILLING_STATUSES.has(billingStatus))) {
      tier = 'grace';
    } else if (billingStatus && PRO_BILLING_STATUSES.has(billingStatus) && paidInstanceLimit > 0) {
      tier = 'pro';
    }

    const deployment = deploymentByOrg.get(org.id);

    return {
      id: org.id,
      slug: org.slug,
      name: org.name,
      plan: org.plan,
      orgStatus: org.status,
      clerkOrgId: org.clerk_org_id,
      apiBaseUrl: org.api_base_url,
      subdomain: org.subdomain,
      deploymentStatus: org.deployment_status,
      createdAt: org.created_at,
      tier,
      billingStatus,
      billingGraceEndsAt,
      billingLockedAt,
      trialEndsAt,
      instancesDeleteAfter,
      currentPeriodEnd: (entitlement?.current_period_end as string | null) ?? (billing?.current_period_end as string | null) ?? null,
      cancelAtPeriodEnd: Boolean(entitlement?.cancel_at_period_end ?? billing?.cancel_at_period_end),
      activeInstanceCount,
      paidInstanceLimit,
      availableInstanceSlots,
      messageCreditBalance: Number(billing?.message_credit_balance ?? 0),
      deployment: deployment
        ? {
            status: deployment.status,
            baseUrl: deployment.base_url,
            publicIp: deployment.public_ip,
            vmName: deployment.vm_name,
            azureRegion: deployment.azure_region,
            lastError: deployment.last_error,
            requestedAt: deployment.requested_at,
            provisionedAt: deployment.provisioned_at,
            dnsReadyAt: deployment.dns_ready_at
          }
        : null,
      instanceCounts: instanceCountsByOrg.get(org.id) ?? {
        total: 0,
        connected: 0,
        disconnected: 0,
        provisioning: 0,
        error: 0,
        suspended: 0
      }
    };
  });

  const platformInstances: PlatformInstanceRow[] = ((instances ?? []) as InstanceRow[]).map((instance) => {
    const org = orgMeta.get(instance.org_id);
    return {
      id: instance.id,
      orgId: instance.org_id,
      orgSlug: org?.slug ?? 'unknown',
      orgName: org?.name ?? 'Unknown org',
      name: instance.name,
      status: instance.status,
      regionCode: instance.region_code,
      phone: instance.phone,
      provisioningState: instance.provisioning_state,
      createdAt: instance.created_at
    };
  });

  const proxyRows: PlatformOverview['proxyPool'] = (proxyPool ?? []).map((row: Record<string, unknown>) => ({
    regionCode: String(row.region_code ?? ''),
    total: Number(row.total ?? 0),
    free: Number(row.free ?? 0),
    assigned: Number(row.assigned ?? 0),
    unavailable: Number(row.unavailable ?? 0)
  }));

  const summary = {
    totalOrganizations: platformOrganizations.length,
    proOrganizations: platformOrganizations.filter((org) => org.tier === 'pro' && org.billingStatus === 'active').length,
    trialingOrganizations: platformOrganizations.filter((org) => org.billingStatus === 'trialing').length,
    graceOrganizations: platformOrganizations.filter((org) => org.tier === 'grace').length,
    lockedOrganizations: platformOrganizations.filter((org) => org.tier === 'locked').length,
    freeOrganizations: platformOrganizations.filter((org) => org.tier === 'free').length,
    totalInstances: platformInstances.length,
    connectedInstances: platformInstances.filter((instance) => instance.status === 'connected').length,
    readyDeployments: platformOrganizations.filter((org) => org.deployment?.status === 'ready').length,
    failedDeployments: platformOrganizations.filter((org) => org.deployment?.status === 'failed').length,
    proxyTotal: proxyRows.reduce((sum: number, row) => sum + row.total, 0),
    proxyFree: proxyRows.reduce((sum: number, row) => sum + row.free, 0),
    proxyAssigned: proxyRows.reduce((sum: number, row) => sum + row.assigned, 0)
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    organizations: platformOrganizations,
    instances: platformInstances,
    proxyPool: proxyRows
  };
}
