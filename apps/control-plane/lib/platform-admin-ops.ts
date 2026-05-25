import { deleteAzureVmResourceGroup } from './azure-vm-provisioner';
import { deprovisionOrgDeployment } from './org-deployments';
import { getSupabaseAdmin } from './supabase-admin';

export async function blockOrganization(orgId: string, actorId: string, reason?: string) {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date().toISOString();

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name, status')
    .eq('id', orgId)
    .single();

  if (orgError || !org) throw new Error(orgError?.message || 'Organization not found');

  await supabase
    .from('organizations')
    .update({
      status: 'platform_blocked',
      updated_at: now
    })
    .eq('id', orgId);

  await supabase
    .from('api_keys')
    .update({ revoked_at: now })
    .eq('org_id', orgId)
    .is('revoked_at', null);

  await supabase
    .from('instances')
    .update({ status: 'suspended', updated_at: now })
    .eq('org_id', orgId)
    .is('deleted_at', null);

  await supabase
    .from('org_deployments')
    .update({ status: 'suspended', updated_at: now })
    .eq('org_id', orgId)
    .eq('environment', 'production');

  await supabase.from('audit_events').insert({
    org_id: orgId,
    actor_clerk_user_id: actorId,
    action: 'platform.organization.blocked',
    target_type: 'organization',
    target_id: orgId,
    metadata: { reason: reason || null, previousStatus: org.status }
  });

  return { success: true, organization: org, status: 'platform_blocked' as const };
}

export async function unblockOrganization(orgId: string, actorId: string) {
  const supabase = getSupabaseAdmin() as any;
  const now = new Date().toISOString();

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name, status')
    .eq('id', orgId)
    .single();

  if (orgError || !org) throw new Error(orgError?.message || 'Organization not found');

  await supabase
    .from('organizations')
    .update({
      status: 'active',
      updated_at: now
    })
    .eq('id', orgId);

  await supabase.from('audit_events').insert({
    org_id: orgId,
    actor_clerk_user_id: actorId,
    action: 'platform.organization.unblocked',
    target_type: 'organization',
    target_id: orgId,
    metadata: { previousStatus: org.status }
  });

  return { success: true, organization: org, status: 'active' as const };
}

export async function deleteOrganizationAsPlatformAdmin(orgId: string, actorId: string) {
  const supabase = getSupabaseAdmin() as any;

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name')
    .eq('id', orgId)
    .single();

  if (orgError || !org) throw new Error(orgError?.message || 'Organization not found');

  const { data: instances } = await supabase
    .from('instances')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  for (const instance of instances ?? []) {
    await supabase.rpc('release_proxy_for_instance', { p_instance_id: instance.id });
  }

  let vmDeprovisioning: unknown = { requested: false, reason: 'not_attempted' };
  try {
    vmDeprovisioning = await deprovisionOrgDeployment(orgId, actorId);
  } catch (error) {
    vmDeprovisioning = {
      requested: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  await supabase.from('audit_events').insert({
    org_id: orgId,
    actor_clerk_user_id: actorId,
    action: 'platform.organization.deleted',
    target_type: 'organization',
    target_id: orgId,
    metadata: { vmDeprovisioning, instancesReleased: instances?.length ?? 0 }
  });

  const { error: deleteError } = await supabase.from('organizations').delete().eq('id', orgId);
  if (deleteError) throw new Error(deleteError.message);

  return {
    success: true,
    organization: org,
    instancesReleased: instances?.length ?? 0,
    vmDeprovisioning
  };
}

export async function deleteOrganizationVm(orgId: string, actorId: string) {
  const supabase = getSupabaseAdmin() as any;

  const { data: deployment, error } = await supabase
    .from('org_deployments')
    .select('*')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!deployment?.azure_resource_group) {
    throw new Error('No Azure resource group found for this organization');
  }

  const result = await deleteAzureVmResourceGroup(deployment.azure_resource_group);

  await supabase
    .from('org_deployments')
    .update({
      status: 'suspended',
      public_ip: null,
      base_url: null,
      last_error: null,
      health: {
        ...(deployment.health || {}),
        azureDeprovisioning: result,
        deletedByPlatformAdmin: actorId,
        deletedAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', deployment.id);

  await supabase.from('audit_events').insert({
    org_id: orgId,
    actor_clerk_user_id: actorId,
    action: 'platform.vm.deleted',
    target_type: 'org_deployment',
    target_id: deployment.id,
    metadata: { resourceGroup: deployment.azure_resource_group, vmName: deployment.vm_name, result }
  });

  return { success: true, deployment, result };
}

export async function removeProxyFromPool(proxyId: string, actorId: string, force = false) {
  const supabase = getSupabaseAdmin() as any;

  const { data: proxy, error } = await supabase
    .from('proxy_allocations')
    .select('id, region_code, host, port, status, instance_id, org_id')
    .eq('id', proxyId)
    .single();

  if (error || !proxy) throw new Error(error?.message || 'Proxy not found');

  if (proxy.instance_id && proxy.status === 'assigned') {
    if (!force) {
      throw new Error('Proxy is assigned to an instance. Release it first or use force=true.');
    }
    await supabase.rpc('release_proxy_for_instance', { p_instance_id: proxy.instance_id });
  }

  const { error: deleteError } = await supabase.from('proxy_allocations').delete().eq('id', proxyId);
  if (deleteError) throw new Error(deleteError.message);

  await supabase.from('audit_events').insert({
    org_id: proxy.org_id,
    actor_clerk_user_id: actorId,
    action: 'platform.proxy.removed',
    target_type: 'proxy_allocation',
    target_id: proxyId,
    metadata: { host: proxy.host, port: proxy.port, regionCode: proxy.region_code, force }
  });

  return { success: true, proxy };
}
