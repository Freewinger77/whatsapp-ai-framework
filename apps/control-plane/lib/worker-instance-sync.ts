import { getWorkerInstanceId, isLegacyWorkerInstanceId, isUuid, resolveControlPlaneInstance } from './worker-instance-id';
import {
  applyInstanceConnectionStatus,
  syncInstanceFromWorker
} from './sync-instance-worker-status';
import { mapWorkerInstanceStatus, workerPhoneFromResult } from './worker-instance-state';
import {
  deleteWorkerInstance,
  getWorkerInstance,
  listWorkerInstances,
  migrateWorkerInstanceId
} from './worker-client';

type SupabaseAdmin = { from: (table: string) => any };

type DeploymentRecord = {
  id: string;
  org_id: string;
  status: string;
  base_url: string | null;
  public_ip: string | null;
  vm_name: string | null;
  azure_resource_group: string | null;
  azure_region?: string | null;
};

type WorkerInstanceSummary = {
  id: string;
  name?: string;
  status?: string;
  webhookUrl?: string | null;
  connectedPhone?: string | null;
  phone?: string | null;
};

export type SyncOrgWorkerInstancesOptions = {
  cleanupOrphanWorkers?: boolean;
  importOrphanWorkers?: boolean;
  linkSuggestions?: Array<{ controlPlaneInstanceId: string; workerInstanceId: string }>;
};

export type SyncOrgWorkerInstancesResult = {
  orgId: string;
  deploymentId: string;
  synced: number;
  imported: number;
  linked: number;
  renamed: number;
  cleaned: number;
  markedMissing: number;
  results: Array<Record<string, unknown>>;
};

export async function syncOrgWorkerInstances(
  supabase: SupabaseAdmin,
  orgId: string,
  deployment: DeploymentRecord,
  options: SyncOrgWorkerInstancesOptions = {}
): Promise<SyncOrgWorkerInstancesResult> {
  const sharedSecret = process.env.WASUP_WORKER_SHARED_SECRET || null;
  const endpoint = deployment.base_url;
  const result: SyncOrgWorkerInstancesResult = {
    orgId,
    deploymentId: deployment.id,
    synced: 0,
    imported: 0,
    linked: 0,
    renamed: 0,
    cleaned: 0,
    markedMissing: 0,
    results: []
  };

  if (deployment.status !== 'ready' || !endpoint || !sharedSecret) {
    result.results.push({ skipped: true, reason: 'deployment_not_ready' });
    return result;
  }

  const workerList = await listWorkerInstances({
    endpoint,
    publicIp: deployment.public_ip,
    sharedSecret
  });

  const workerById = new Map<string, WorkerInstanceSummary>();
  for (const worker of workerList.instances) {
    workerById.set(worker.id, worker);
  }

  const { data: controlPlaneInstances, error } = await supabase
    .from('instances')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  const cpInstances = controlPlaneInstances ?? [];
  const linkedWorkerIds = new Set<string>();

  for (const suggestion of options.linkSuggestions ?? []) {
    const cpInstance = cpInstances.find((row: any) => row.id === suggestion.controlPlaneInstanceId);
    const worker = workerById.get(suggestion.workerInstanceId);
    if (!cpInstance || !worker) {
      result.results.push({
        action: 'link',
        controlPlaneInstanceId: suggestion.controlPlaneInstanceId,
        workerInstanceId: suggestion.workerInstanceId,
        success: false,
        reason: 'missing_cp_or_worker'
      });
      continue;
    }

    const linked = await linkControlPlaneToWorkerInstance(supabase, orgId, deployment, cpInstance, worker, {
      renameOnWorker: true,
      sharedSecret
    });
    if (linked.linked) result.linked += 1;
    if (linked.renamed) result.renamed += 1;
    linkedWorkerIds.add(getWorkerInstanceId(linked.instance));
    result.results.push({ action: 'link', ...linked });
  }

  for (const instance of cpInstances) {
    const workerId = getWorkerInstanceId(instance);
    const worker = workerById.get(workerId) ?? workerById.get(instance.id);

    if (!worker && instance.legacy_instance_id && workerById.has(instance.legacy_instance_id)) {
      linkedWorkerIds.add(instance.legacy_instance_id);
      const synced = await syncInstanceFromWorker(supabase, orgId, instance, deployment);
      if (synced) {
        result.synced += 1;
        result.results.push({ action: 'sync', instanceId: instance.id, workerInstanceId: instance.legacy_instance_id });
      }
      continue;
    }

    if (worker) {
      linkedWorkerIds.add(worker.id);
      if (!instance.legacy_instance_id && isLegacyWorkerInstanceId(worker.id) && worker.id !== instance.id) {
        await supabase
          .from('instances')
          .update({
            legacy_instance_id: worker.id,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(instance.metadata || {}),
              autoLinkedAt: new Date().toISOString(),
              autoLinkSource: 'worker-sync'
            }
          })
          .eq('id', instance.id)
          .eq('org_id', orgId);
        instance.legacy_instance_id = worker.id;
        result.linked += 1;
      }

      const synced = await syncInstanceFromWorker(supabase, orgId, instance, deployment);
      if (synced) {
        result.synced += 1;
        result.results.push({
          action: 'sync',
          instanceId: instance.id,
          workerInstanceId: getWorkerInstanceId(instance),
          status: synced.status
        });
      }
      continue;
    }

    if (instance.provisioning_state === 'desired' || instance.status === 'provisioning') {
      continue;
    }

    const missingAt = new Date().toISOString();
    await supabase
      .from('instances')
      .update({
        status: 'disconnected',
        metadata: {
          ...(instance.metadata || {}),
          lastWorkerStatusSync: {
            status: 'missing_on_worker',
            syncedAt: missingAt
          }
        },
        updated_at: missingAt
      })
      .eq('id', instance.id)
      .eq('org_id', orgId);
    result.markedMissing += 1;
    result.results.push({ action: 'missing_on_worker', instanceId: instance.id, workerInstanceId: workerId });
  }

  if (options.importOrphanWorkers !== false) {
    for (const worker of workerList.instances) {
      if (linkedWorkerIds.has(worker.id)) continue;
      if (cpInstances.some((row: any) => row.id === worker.id || row.legacy_instance_id === worker.id)) continue;

      const imported = await importWorkerInstance(supabase, orgId, deployment, worker);
      if (imported) {
        result.imported += 1;
        linkedWorkerIds.add(worker.id);
        result.results.push({ action: 'import', instanceId: imported.id, workerInstanceId: worker.id, name: worker.name });
      }
    }
  }

  if (options.cleanupOrphanWorkers !== false) {
    for (const worker of workerList.instances) {
      if (linkedWorkerIds.has(worker.id)) continue;
      if (worker.status === 'connected' || worker.status === 'connecting') continue;
      if (isUuid(worker.id)) continue;

      try {
        await deleteWorkerInstance({
          endpoint,
          publicIp: deployment.public_ip,
          sharedSecret,
          instanceId: worker.id
        });
        result.cleaned += 1;
        result.results.push({ action: 'cleanup_worker_orphan', workerInstanceId: worker.id, name: worker.name });
      } catch (cleanupError) {
        result.results.push({
          action: 'cleanup_worker_orphan',
          workerInstanceId: worker.id,
          success: false,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
    }
  }

  return result;
}

export async function linkControlPlaneToWorkerInstance(
  supabase: SupabaseAdmin,
  orgId: string,
  deployment: DeploymentRecord,
  cpInstance: Record<string, any>,
  worker: WorkerInstanceSummary,
  options: { renameOnWorker?: boolean; sharedSecret: string | null }
) {
  const endpoint = deployment.base_url;
  const sharedSecret = options.sharedSecret;
  let renamed = false;
  let instance = cpInstance;

  if (options.renameOnWorker && isLegacyWorkerInstanceId(worker.id) && isUuid(cpInstance.id) && endpoint && sharedSecret) {
    try {
      await migrateWorkerInstanceId({
        endpoint,
        publicIp: deployment.public_ip,
        sharedSecret,
        instanceId: worker.id,
        newId: cpInstance.id
      });
      renamed = true;
      worker = { ...worker, id: cpInstance.id };
    } catch {
      // Fall back to legacy_instance_id linking below.
    }
  }

  const legacyId = renamed ? null : isLegacyWorkerInstanceId(worker.id) ? worker.id : null;
  const workerStatus = mapWorkerInstanceStatus(worker.status || 'disconnected');
  const phone =
    workerStatus === 'connected'
      ? workerPhoneFromResult(worker)
      : null;

  const updatePayload: Record<string, unknown> = {
    legacy_instance_id: legacyId,
    status: workerStatus,
    provisioning_state: 'provisioned',
    worker_endpoint: endpoint,
    worker_name: deployment.vm_name,
    worker_namespace: deployment.azure_resource_group,
    webhook_url: worker.webhookUrl ?? cpInstance.webhook_url ?? null,
    phone,
    metadata: {
      ...(cpInstance.metadata || {}),
      linkedWorkerAt: new Date().toISOString(),
      linkedWorkerId: worker.id,
      workerRenamedToControlPlaneId: renamed
    },
    updated_at: new Date().toISOString()
  };

  const { data: updated } = await supabase
    .from('instances')
    .update(updatePayload)
    .eq('id', cpInstance.id)
    .eq('org_id', orgId)
    .select('*')
    .single();

  instance = updated ?? cpInstance;

  await supabase.from('worker_events').insert({
    org_id: orgId,
    instance_id: cpInstance.id,
    event_type: renamed ? 'instance.worker_renamed' : 'instance.worker_linked',
    summary: renamed
      ? `Worker instance ${worker.id} was renamed to the control-plane UUID.`
      : `Worker instance ${worker.id} linked via legacy_instance_id.`,
    payload: {
      workerInstanceId: worker.id,
      renamed
    }
  });

  return {
    linked: true,
    renamed,
    instance,
    workerInstanceId: getWorkerInstanceId(instance)
  };
}

async function importWorkerInstance(
  supabase: SupabaseAdmin,
  orgId: string,
  deployment: DeploymentRecord,
  worker: WorkerInstanceSummary
) {
  const regionCode = mapAzureRegionToRegionCode(deployment.azure_region);
  const workerStatus = mapWorkerInstanceStatus(worker.status || 'disconnected');
  const phone = workerStatus === 'connected' ? workerPhoneFromResult(worker) : null;
  const now = new Date().toISOString();
  const legacyId = isLegacyWorkerInstanceId(worker.id) ? worker.id : null;
  const id = isUuid(worker.id) ? worker.id : crypto.randomUUID();

  const payload = {
    id,
    org_id: orgId,
    legacy_instance_id: legacyId,
    name: worker.name?.trim() || `Imported ${worker.id}`,
    phone,
    status: workerStatus,
    provisioning_state: 'imported',
    region_code: regionCode,
    worker_namespace: deployment.azure_resource_group,
    worker_name: deployment.vm_name,
    worker_endpoint: deployment.base_url,
    webhook_url: worker.webhookUrl ?? null,
    behavior_profile: 'notification-balanced',
    proxy_policy: 'auto',
    metadata: {
      importedFromWorkerAt: now,
      importedWorkerId: worker.id,
      importSource: 'worker-sync'
    },
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase.from('instances').insert(payload).select('*').single();
  if (error) {
    if (error.code === '23505') {
      return resolveControlPlaneInstance(supabase, orgId, worker.id);
    }
    throw new Error(error.message);
  }

  await supabase.from('worker_events').insert({
    org_id: orgId,
    instance_id: data.id,
    event_type: 'instance.imported_from_worker',
    summary: `Imported worker-only instance ${worker.id} into the control plane.`,
    payload: { workerInstanceId: worker.id }
  });

  return data;
}

export async function registerWorkerInstanceWithControlPlane(input: {
  orgId: string;
  workerInstanceId: string;
  name?: string;
  webhookUrl?: string | null;
  status?: string;
  phone?: string | null;
  controlPlaneInstanceId?: string | null;
}) {
  const supabase = (await import('./supabase-admin')).getSupabaseAdmin() as SupabaseAdmin;
  const existing = await resolveControlPlaneInstance(supabase, input.orgId, input.workerInstanceId);
  if (existing) {
    await applyInstanceConnectionStatus(supabase, input.orgId, existing.id, input.status || existing.status, {
      phone: input.phone,
      existingMetadata: existing.metadata,
      syncKey: 'lastWorkerRegister'
    });
    return { created: false, instance: existing };
  }

  if (input.controlPlaneInstanceId && isUuid(input.controlPlaneInstanceId)) {
    const { data: cpInstance } = await supabase
      .from('instances')
      .select('*')
      .eq('org_id', input.orgId)
      .eq('id', input.controlPlaneInstanceId)
      .is('deleted_at', null)
      .maybeSingle();

    if (cpInstance) {
      const linked = await linkControlPlaneToWorkerInstance(
        supabase,
        input.orgId,
        await loadDeployment(supabase, input.orgId),
        cpInstance,
        {
          id: input.workerInstanceId,
          name: input.name,
          status: input.status,
          webhookUrl: input.webhookUrl,
          connectedPhone: input.phone
        },
        { renameOnWorker: false, sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null }
      );
      return { created: false, instance: linked.instance, linked: true };
    }
  }

  const deployment = await loadDeployment(supabase, input.orgId);
  if (!deployment) throw new Error('Org deployment is not ready');

  const imported = await importWorkerInstance(supabase, input.orgId, deployment, {
    id: input.workerInstanceId,
    name: input.name,
    status: input.status,
    webhookUrl: input.webhookUrl,
    connectedPhone: input.phone,
    phone: input.phone
  });

  if (isLegacyWorkerInstanceId(input.workerInstanceId) && deployment.base_url) {
    const linked = await linkControlPlaneToWorkerInstance(
      supabase,
      input.orgId,
      deployment,
      imported,
      {
        id: input.workerInstanceId,
        name: input.name,
        status: input.status,
        webhookUrl: input.webhookUrl,
        connectedPhone: input.phone
      },
      { renameOnWorker: true, sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null }
    );
    return { created: true, instance: linked.instance, renamed: linked.renamed };
  }

  return { created: true, instance: imported };
}

async function loadDeployment(supabase: SupabaseAdmin, orgId: string) {
  const { data } = await supabase
    .from('org_deployments')
    .select('id, org_id, status, base_url, public_ip, vm_name, azure_resource_group, azure_region')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();
  return data;
}

function mapAzureRegionToRegionCode(azureRegion?: string | null) {
  const normalized = String(azureRegion || '').toLowerCase();
  if (normalized.includes('uksouth') || normalized.includes('ukwest')) return 'uk-south';
  if (normalized.includes('northeurope')) return 'fi';
  if (normalized.includes('swedencentral')) return 'se';
  return 'fi';
}

export async function syncAllReadyOrgWorkers(
  supabase: SupabaseAdmin,
  options: SyncOrgWorkerInstancesOptions = {}
) {
  const { data: deployments, error } = await supabase
    .from('org_deployments')
    .select('id, org_id, status, base_url, public_ip, vm_name, azure_resource_group, azure_region')
    .eq('status', 'ready');

  if (error) throw new Error(error.message);

  const results = [];
  for (const deployment of deployments ?? []) {
    results.push(await syncOrgWorkerInstances(supabase, deployment.org_id, deployment, options));
  }
  return results;
}
