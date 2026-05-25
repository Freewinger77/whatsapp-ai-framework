import { NextResponse } from 'next/server';
import { reconcileAzureVmDeployment, standardizeWorkerRuntime } from '../../../../../lib/azure-vm-provisioner';
import { getServerEnv } from '../../../../../lib/env';
import { recordDeploymentStatusNotification } from '../../../../../lib/notifications';
import { markDeploymentPublicIp, reconcileQueuedWorkerInstances } from '../../../../../lib/org-deployments';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { checkWorkerHealth } from '../../../../../lib/worker-client';
import { checkWorkerSurfaceMarkers } from '../../../../../lib/worker-surface';

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: deployments, error } = await supabase
    .from('org_deployments')
    .select('id, org_id, azure_resource_group, vm_name, status, health, base_url, public_ip')
    .in('status', ['queued', 'provisioning', 'dns_pending', 'ready']);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const deployment of deployments ?? []) {
    if (deployment.status === 'ready') {
      try {
        const health = await checkWorkerHealth({
          endpoint: deployment.base_url,
          publicIp: deployment.public_ip,
          sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null
        });

        if (!health.reachable) {
          await supabase
            .from('org_deployments')
            .update({
              status: 'dns_pending',
              last_error: health.error || 'Worker health is not reachable.',
              health: {
                ...(deployment.health || {}),
                publicReadinessCheck: {
                  checkedAt: new Date().toISOString(),
                  ...health
                }
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', deployment.id);
          await recordDeploymentStatusNotification({
            orgId: deployment.org_id,
            deploymentId: deployment.id,
            status: 'dns_pending',
            baseUrl: deployment.base_url,
            message: health.error || 'Worker health is not reachable.'
          });
          results.push({ id: deployment.id, ready: false, downgraded: true, health });
          continue;
        }

        const workerReconcile = await reconcileQueuedWorkerInstances(deployment.org_id, deployment);
        const surface = await checkWorkerSurfaceMarkers(deployment.base_url);
        let standardized = null;
        if (!surface.ok && deployment.azure_resource_group && deployment.vm_name) {
          const env = getServerEnv();
          standardized = await standardizeWorkerRuntime({
            resourceGroup: deployment.azure_resource_group,
            vmName: deployment.vm_name,
            workerGitRepo: env.WASUP_WORKER_GIT_REPO,
            workerGitRef: env.WASUP_WORKER_GIT_REF
          });
        }
        results.push({ id: deployment.id, ready: true, health, workerReconcile, surface, standardized });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id: deployment.id, ready: true, workerReconcileError: message });
      }
      continue;
    }

    if (!deployment.azure_resource_group || !deployment.vm_name) {
      results.push({ id: deployment.id, skipped: true, reason: 'missing_azure_metadata' });
      continue;
    }

    try {
      // VM already has a public IP but health/DNS verification failed earlier — retry directly.
      if (deployment.status === 'dns_pending' && deployment.public_ip) {
        const ready = await markDeploymentPublicIp({
          orgId: deployment.org_id,
          publicIp: deployment.public_ip,
          deployedVersion: process.env.WASUP_WORKER_GIT_REF
        });
        results.push({
          id: deployment.id,
          ready: ready.deployment.status === 'ready',
          publicIp: deployment.public_ip,
          deployment: ready.deployment,
          dnsPendingRetry: true
        });
        continue;
      }

      const state = await reconcileAzureVmDeployment({
        resourceGroup: deployment.azure_resource_group,
        vmName: deployment.vm_name
      });

      if (state.ready && state.publicIp) {
        const ready = await markDeploymentPublicIp({
          orgId: deployment.org_id,
          publicIp: state.publicIp,
          deployedVersion: process.env.WASUP_WORKER_GIT_REF
        });
        results.push({ id: deployment.id, ready: true, publicIp: state.publicIp, deployment: ready.deployment });
      } else {
        await supabase
          .from('org_deployments')
          .update({
            health: {
              ...(deployment.health || {}),
              azureReconcile: state,
              lastReconciledAt: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', deployment.id);
        results.push({ id: deployment.id, ready: false, state });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase
        .from('org_deployments')
        .update({
          last_error: message,
          updated_at: new Date().toISOString()
        })
        .eq('id', deployment.id);
      results.push({ id: deployment.id, error: message });
    }
  }

  return NextResponse.json({ success: true, checked: results.length, results });
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
