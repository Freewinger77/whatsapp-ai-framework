import { generateApiKey } from './api-keys';
import { standardizeWorkerRuntime } from './azure-vm-provisioner';
import { getServerEnv } from './env';
import { checkWorkerSurfaceMarkers } from './worker-surface';
import { notifyDeploymentReady, notifyInstanceReady, recordAppNotification, recordDeploymentStatusNotification } from './notifications';
import { upsertGoDaddyARecord } from './godaddy';
import type { ProxyClaimResult } from './proxy-pool';
import { getSupabaseAdmin } from './supabase-admin';
import { checkWorkerHealth, createWorkerInstance, getWorkerInstance } from './worker-client';
import { mapWorkerInstanceStatus, workerPhoneFromResult, workerStatusFromResult } from './worker-instance-state';

type OrganizationRecord = {
  id: string;
  slug: string;
  name: string;
  region_preference: string | null;
  api_base_url: string | null;
  subdomain: string | null;
};

type DeploymentRecord = {
  id: string;
  org_id: string;
  status: string;
  base_url: string | null;
  public_ip: string | null;
  vm_name: string | null;
  azure_region: string | null;
  azure_resource_group: string | null;
  health?: unknown;
  last_error?: string | null;
  requested_at?: string | null;
  provisioned_at?: string | null;
  dns_ready_at?: string | null;
};

export type OneTimeOrgApiKey = {
  id: string;
  keyKind: 'live' | 'test';
  publicId: string;
  key: string;
};

export type EnsureOrgDeploymentResult = {
  organization: OrganizationRecord;
  deployment: DeploymentRecord;
  created: boolean;
  apiKeysCreated: OneTimeOrgApiKey[];
  provisioning: {
    mode: string;
    requested: boolean;
    dns?: unknown;
  };
};

export async function ensureOrgDeployment(orgId: string): Promise<EnsureOrgDeploymentResult> {
  const supabase = getSupabaseAdmin() as any;
  const env = getServerEnv();

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name, region_preference, api_base_url, subdomain')
    .eq('id', orgId)
    .single();

  if (orgError || !organization) {
    throw new Error(orgError?.message || `Organization ${orgId} not found`);
  }

  const subdomain = organization.subdomain || organization.slug;
  const baseUrl = `https://${subdomain}.${env.WASUP_BASE_DOMAIN}`;
  const vmName = stableVmName(organization.slug);
  const resourceGroup = `${env.AZURE_RESOURCE_GROUP_PREFIX}-${organization.slug}`;
  const azureRegion = organization.region_preference || env.AZURE_LOCATION;
  const apiKeysCreated = await ensureDefaultOrgApiKeys(orgId);

  const { data: existingDeployment } = await supabase
    .from('org_deployments')
    .select('*')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (existingDeployment?.status === 'ready' || existingDeployment?.status === 'provisioning' || existingDeployment?.status === 'dns_pending' || existingDeployment?.status === 'queued') {
    await recordDeploymentStatusNotification({
      orgId,
      deploymentId: existingDeployment.id,
      status: existingDeployment.status,
      baseUrl: existingDeployment.base_url,
      message: deploymentStatusMessage(existingDeployment.status, existingDeployment.last_error)
    });

    return {
      organization,
      deployment: existingDeployment,
      created: false,
      apiKeysCreated,
      provisioning: { mode: env.WASUP_PROVISIONING_MODE, requested: false }
    };
  }

  const workerKey = generateApiKey();
  const internalSecret = generateApiKey();
  const deploymentPayload = {
    org_id: orgId,
    environment: 'production',
    status: env.WASUP_PROVISIONING_MODE === 'webhook' ? 'provisioning' : 'queued',
    azure_subscription_id: env.AZURE_SUBSCRIPTION_ID ?? null,
    azure_resource_group: resourceGroup,
    azure_region: azureRegion,
    vm_name: vmName,
    vm_size: env.AZURE_VM_SIZE,
    base_url: baseUrl,
    fqdn: `${subdomain}.${env.WASUP_BASE_DOMAIN}`,
    worker_api_key_public_id: workerKey.publicId,
    worker_api_key_hash: workerKey.secretHash,
    worker_api_key_salt: workerKey.salt,
    internal_secret_hash: internalSecret.secretHash,
    internal_secret_salt: internalSecret.salt,
    health: {
      desiredBaseUrl: baseUrl,
      workerApiKeyPreview: `${workerKey.key.slice(0, 18)}...`,
      internalSecretPreview: `${internalSecret.key.slice(0, 18)}...`
    },
    updated_at: new Date().toISOString()
  };

  const { data: deployment, error: deploymentError } = await supabase
    .from('org_deployments')
    .upsert(deploymentPayload, { onConflict: 'org_id,environment' })
    .select('*')
    .single();

  if (deploymentError || !deployment) {
    throw new Error(deploymentError?.message || 'Could not create org deployment');
  }

  await recordDeploymentStatusNotification({
    orgId,
    deploymentId: deployment.id,
    status: 'queued',
    baseUrl: deployment.base_url,
    message: deploymentStatusMessage('queued', deployment.last_error)
  });

  await supabase
    .from('organizations')
    .update({
      api_base_url: baseUrl,
      subdomain,
      deployment_status: deployment.status,
      updated_at: new Date().toISOString()
    })
    .eq('id', orgId);

  let provisioning;
  try {
    provisioning = await requestProvisioningWebhook({
      org: organization,
      deployment,
      workerApiKey: workerKey.key,
      internalSecret: internalSecret.key
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from('org_deployments')
      .update({
        status: 'failed',
        last_error: message,
        updated_at: new Date().toISOString()
      })
      .eq('id', deployment.id);
    await recordAppNotification({
      orgId,
      eventType: 'deployment.failed',
      kind: 'deployment',
      severity: 'error',
      title: 'Workspace provisioning failed',
      body: message,
      idempotencyKey: `in-app:deployment-failed:${deployment.id}`,
      metadata: {
        deploymentId: deployment.id,
        baseUrl: deployment.base_url
      },
      error: message
    });
    throw error;
  }

  return {
    organization: { ...organization, api_base_url: baseUrl, subdomain },
    deployment,
    created: !existingDeployment,
    apiKeysCreated,
    provisioning
  };
}

export async function markDeploymentPublicIp(input: {
  orgId: string;
  publicIp: string;
  deployedVersion?: string;
}) {
  const supabase = getSupabaseAdmin() as any;
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, subdomain')
    .eq('id', input.orgId)
    .single();

  if (orgError || !org) throw new Error(orgError?.message || 'Organization not found');

  const { data: currentDeployment, error: deploymentLookupError } = await supabase
    .from('org_deployments')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('environment', 'production')
    .single();

  if (deploymentLookupError || !currentDeployment) {
    throw new Error(deploymentLookupError?.message || 'Deployment not found');
  }

  const dns = await upsertGoDaddyARecord({
    subdomain: org.subdomain || org.slug,
    value: input.publicIp
  });

  const health = await checkWorkerHealth({
    endpoint: currentDeployment.base_url,
    publicIp: input.publicIp,
    sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null
  });

  const nextStatus = dns.skipped || !health.reachable ? 'dns_pending' : 'ready';
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('org_deployments')
    .update({
      public_ip: input.publicIp,
      status: nextStatus,
      deployed_version: input.deployedVersion ?? null,
      provisioned_at: health.reachable ? now : null,
      dns_ready_at: nextStatus === 'ready' ? now : null,
      last_error: health.reachable ? null : health.error || 'Worker health is not reachable yet.',
      health: {
        ...(currentDeployment.health || {}),
        dns,
        publicReadinessCheck: {
          checkedAt: now,
          ...health
        }
      },
      updated_at: now
    })
    .eq('org_id', input.orgId)
    .eq('environment', 'production')
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  await recordDeploymentStatusNotification({
    orgId: input.orgId,
    deploymentId: data.id,
    status: data.status,
    baseUrl: data.base_url,
    message: deploymentStatusMessage(data.status, data.last_error)
  });

  await supabase
    .from('organizations')
    .update({
      deployment_status: data.status,
      updated_at: new Date().toISOString()
    })
    .eq('id', input.orgId);

  if (data.status === 'ready') {
    const workerReconcile = await reconcileQueuedWorkerInstances(input.orgId, data);
    const becameReady = currentDeployment.status !== 'ready';
    const surface = await checkWorkerSurfaceMarkers(data.base_url);
    const needsStandardize = !surface.ok;
    const env = getServerEnv();
    await Promise.allSettled([
      (becameReady || needsStandardize) && data.azure_resource_group && data.vm_name
        ? standardizeWorkerRuntime({
            resourceGroup: data.azure_resource_group,
            vmName: data.vm_name,
            workerGitRepo: env.WASUP_WORKER_GIT_REPO,
            workerGitRef: env.WASUP_WORKER_GIT_REF
          })
        : Promise.resolve(null),
      notifyDeploymentReady({
        orgId: input.orgId,
        deploymentId: data.id,
        baseUrl: data.base_url
      })
    ]);
    return { deployment: data, dns, workerReconcile };
  }

  return { deployment: data, dns };
}

export async function deprovisionOrgDeployment(orgId: string, actorId: string) {
  const supabase = getSupabaseAdmin() as any;
  const env = getServerEnv();
  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('*')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (!deployment) {
    return { requested: false, reason: 'no_deployment' };
  }

  await supabase
    .from('org_deployments')
    .update({
      status: 'suspended',
      last_error: null,
      health: {
        ...deployment.health,
        deletionRequestedBy: actorId,
        deletionRequestedAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', deployment.id);

  if (!env.AZURE_DEPROVISIONING_WEBHOOK_URL) {
    return {
      requested: false,
      reason: 'deprovisioning_webhook_not_configured',
      deployment
    };
  }

  const response = await fetch(env.AZURE_DEPROVISIONING_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgId,
      actorId,
      deployment: {
        id: deployment.id,
        azureResourceGroup: deployment.azure_resource_group,
        vmName: deployment.vm_name,
        publicIp: deployment.public_ip,
        baseUrl: deployment.base_url,
        fqdn: deployment.fqdn
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    await supabase
      .from('org_deployments')
      .update({
        status: 'failed',
        last_error: `Azure deprovisioning webhook failed (${response.status}): ${body}`,
        updated_at: new Date().toISOString()
      })
      .eq('id', deployment.id);
    throw new Error(`Azure deprovisioning webhook failed (${response.status}): ${body}`);
  }

  return { requested: true, deployment };
}

async function ensureDefaultOrgApiKeys(orgId: string) {
  const supabase = getSupabaseAdmin() as any;
  const created: OneTimeOrgApiKey[] = [];

  for (const keyKind of ['live', 'test'] as const) {
    const { data: existing } = await supabase
      .from('api_keys')
      .select('id, scopes')
      .eq('org_id', orgId)
      .eq('key_kind', keyKind)
      .is('revoked_at', null)
      .limit(1);

    const desiredScopes = defaultOrgApiKeyScopes(keyKind);
    if (existing?.length) {
      const scopes = Array.isArray(existing[0].scopes) ? existing[0].scopes : [];
      if (!desiredScopes.every((scope) => scopes.includes(scope))) {
        await supabase
          .from('api_keys')
          .update({ scopes: Array.from(new Set([...scopes, ...desiredScopes])) })
          .eq('id', existing[0].id);
      }
      continue;
    }

    const generated = generateApiKey(keyKind);
    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        org_id: orgId,
        name: keyKind === 'live' ? 'Live API key' : 'Test API key',
        public_id: generated.publicId,
        secret_hash: generated.secretHash,
        salt: generated.salt,
        key_kind: keyKind,
        scopes: desiredScopes
      })
      .select('id, public_id, key_kind')
      .single();

    if (error) throw new Error(error.message);
    created.push({
      id: data.id,
      keyKind,
      publicId: data.public_id,
      key: generated.key
    });
  }

  return created;
}

function defaultOrgApiKeyScopes(keyKind: 'live' | 'test') {
  const sharedScopes = ['instances:read', 'instances:write', 'messages:send'];
  return keyKind === 'live' ? [...sharedScopes, 'webhooks:manage'] : sharedScopes;
}

async function requestProvisioningWebhook(input: {
  org: OrganizationRecord;
  deployment: DeploymentRecord;
  workerApiKey: string;
  internalSecret: string;
}) {
  const env = getServerEnv();
  if (env.WASUP_PROVISIONING_MODE !== 'webhook' || !env.AZURE_PROVISIONING_WEBHOOK_URL) {
    return { mode: env.WASUP_PROVISIONING_MODE, requested: false };
  }

  const response = await fetch(env.AZURE_PROVISIONING_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.WASUP_WORKER_SHARED_SECRET
        ? { 'x-wasup-worker-secret': process.env.WASUP_WORKER_SHARED_SECRET }
        : {})
    },
    body: JSON.stringify({
      org: input.org,
      deployment: input.deployment,
      workerApiKey: input.workerApiKey,
      internalSecret: input.internalSecret
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure provisioning webhook failed (${response.status}): ${body}`);
  }

  return { mode: env.WASUP_PROVISIONING_MODE, requested: true };
}

function stableVmName(slug: string) {
  return `wasup-${slug}`.replace(/[^a-z0-9-]/g, '-').slice(0, 48);
}

function deploymentStatusMessage(status: string, lastError?: string | null) {
  switch (status) {
    case 'queued':
      return 'Provisioning queued. Requesting Azure resources...';
    case 'provisioning':
      return 'Azure VM is starting. This usually takes 5-10 minutes.';
    case 'dns_pending':
      return lastError || 'VM is running. DNS, HTTPS, and worker health are being verified...';
    default:
      return null;
  }
}

export async function reconcileQueuedWorkerInstances(orgId: string, deployment: DeploymentRecord) {
  const supabase = getSupabaseAdmin() as any;
  if (deployment.status !== 'ready') {
    return {
      checked: 0,
      created: 0,
      failed: 0,
      deferred: true,
      reason: 'deployment_not_ready'
    };
  }

  const { data: instances, error } = await supabase
    .from('instances')
    .select('*')
    .eq('org_id', orgId)
    .or('status.eq.provisioning,provisioning_state.eq.desired')
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  const results = [];
  for (const instance of instances ?? []) {
    try {
      const proxy = await getAssignedProxyForInstance(instance.id);
      const existingWorker = await getWorkerInstance({
        endpoint: deployment.base_url,
        publicIp: deployment.public_ip,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null,
        instanceId: instance.id
      });
      const worker = existingWorker.found
        ? {
            attempted: true,
            alreadyExists: true,
            result: existingWorker.result
          }
        : await createWorkerInstance({
            endpoint: deployment.base_url,
            publicIp: deployment.public_ip,
            sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null,
            instance,
            proxy
          });
      const workerStatus = workerStatusFromResult(worker.result);
      const nextStatus = worker.attempted ? mapWorkerInstanceStatus(workerStatus) : 'provisioning';
      const phone = nextStatus === 'connected' ? workerPhoneFromResult(worker.result) : null;
      const reconciledAt = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        provisioning_state: worker.attempted ? 'provisioned' : 'desired',
        worker_endpoint: deployment.base_url,
        worker_name: deployment.vm_name,
        worker_namespace: deployment.azure_resource_group,
        metadata: {
          ...(instance.metadata || {}),
          deploymentId: deployment.id,
          deploymentStatus: deployment.status,
          lastWorkerReconcile: {
            attempted: worker.attempted,
            alreadyExists: 'alreadyExists' in worker && Boolean(worker.alreadyExists),
            reconciledAt,
            result: summarizeWorkerResult(worker.result)
          },
          last_error: null
        },
        updated_at: reconciledAt
      };

      if (phone) updatePayload.phone = phone;

      await supabase
        .from('instances')
        .update(updatePayload)
        .eq('id', instance.id);

      await supabase.from('worker_events').insert({
        org_id: orgId,
        instance_id: instance.id,
        event_type: worker.attempted
          ? 'alreadyExists' in worker && worker.alreadyExists
            ? 'instance.worker_reconciled_existing'
            : 'instance.worker_created'
          : 'instance.worker_create_deferred',
        summary: worker.attempted
          ? 'alreadyExists' in worker && worker.alreadyExists
            ? 'Queued instance already existed on the org worker and control-plane state was refreshed.'
            : 'Queued instance was created on the org worker after VM readiness.'
          : 'Queued instance is still waiting for worker readiness.',
        payload: { deploymentId: deployment.id, worker: summarizeWorkerResult(worker) }
      });
      if (worker.attempted) {
        await notifyInstanceReady({
          orgId,
          instanceId: instance.id,
          instanceName: instance.name,
          baseUrl: deployment.base_url
        });
      }
      results.push({
        instanceId: instance.id,
        attempted: worker.attempted,
        alreadyExists: 'alreadyExists' in worker && Boolean(worker.alreadyExists),
        success: worker.attempted,
        status: nextStatus
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      await supabase
        .from('instances')
        .update({
          status: 'error',
          provisioning_state: 'failed',
          metadata: {
            ...(instance.metadata || {}),
            deploymentId: deployment.id,
            deploymentStatus: deployment.status,
            lastWorkerReconcile: {
              attempted: true,
              reconciledAt: failedAt,
              error: message
            },
            last_error: message
          },
          updated_at: failedAt
        })
        .eq('id', instance.id);

      await supabase.from('worker_events').insert({
        org_id: orgId,
        instance_id: instance.id,
        event_type: 'instance.worker_create_failed',
        severity: 'error',
        summary: message,
        payload: { deploymentId: deployment.id }
      });
      await recordAppNotification({
        orgId,
        eventType: 'instance.failed',
        kind: 'instance',
        severity: 'error',
        title: 'Instance creation failed',
        body: message,
        idempotencyKey: `in-app:instance-worker-create-failed:${instance.id}`,
        metadata: {
          instanceId: instance.id,
          deploymentId: deployment.id,
          instanceName: instance.name
        },
        error: message
      });
      results.push({ instanceId: instance.id, attempted: true, success: false, error: message });
    }
  }

  return {
    checked: instances?.length ?? 0,
    created: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results
  };
}

function summarizeWorkerResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const source = result as Record<string, any>;
  const workerResult = source.result && typeof source.result === 'object' ? source.result : source;
  const instance = workerResult.instance && typeof workerResult.instance === 'object' ? workerResult.instance : workerResult;

  return {
    attempted: source.attempted,
    alreadyExists: source.alreadyExists,
    success: workerResult.success,
    instance: {
      id: instance.id,
      name: instance.name,
      status: instance.status,
      connectedPhone: workerPhoneFromResult(instance),
      connectedAt: instance.connectedAt ?? null,
      webhookUrl: instance.webhookUrl ?? null
    }
  };
}

async function getAssignedProxyForInstance(instanceId: string): Promise<ProxyClaimResult> {
  const { data } = await (getSupabaseAdmin() as any)
    .from('proxy_allocations')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('status', 'assigned')
    .maybeSingle();

  if (!data) {
    return { assigned: false, reason: 'no_proxy_assigned', regionCode: '' };
  }

  return {
    assigned: true,
    id: String(data.id),
    region_code: String(data.region_code),
    host: String(data.host),
    port: Number(data.port),
    proxy_type: data.proxy_type || 'http',
    source: String(data.source || 'imported-pool'),
    username_ref: data.username_ref ?? null,
    password_secret_ref: data.password_secret_ref ?? null,
    credential_secret_ref: data.credential_secret_ref ?? null,
    username_encrypted: data.username_encrypted ?? null,
    password_encrypted: data.password_encrypted ?? null
  };
}
