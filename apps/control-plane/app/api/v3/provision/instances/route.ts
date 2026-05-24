import { NextResponse } from 'next/server';
import { z } from 'zod';
import { releasePaidInstanceSlot } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { ensureOrgDeployment } from '../../../../../lib/org-deployments';
import { recordAppNotification, recordDeploymentStatusNotification } from '../../../../../lib/notifications';
import { claimProxyForInstance, releaseProxyForInstance } from '../../../../../lib/proxy-pool';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { checkWorkerHealth, createWorkerInstance } from '../../../../../lib/worker-client';

const CreateInstanceSchema = z.object({
  orgId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(32).optional(),
  regionCode: z.string().min(2).max(32),
  webhookUrl: z.string().url().optional(),
  webhookSigningSecret: z.string().max(256).nullable().optional(),
  behaviorProfile: z.enum(['bot-native', 'notification-balanced', 'notification-max']).default('notification-balanced'),
  proxyPolicy: z.enum(['auto', 'imported-pool', 'dedicated-provider']).default('auto')
});

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const parsed = CreateInstanceSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const targetOrgId = body.orgId || principal.orgId;
  const webhookSigningSecret = body.webhookSigningSecret?.trim() || null;
  if (targetOrgId !== principal.orgId && principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = getSupabaseAdmin() as any;
  const { data: entitlementData, error: entitlementError } = await supabase.rpc('ensure_org_entitlement_or_trial', {
    p_org_id: targetOrgId,
    p_trial_days: Number(process.env.WASUP_TRIAL_DAYS || 14)
  });

  if (entitlementError) {
    return NextResponse.json({ error: entitlementError.message }, { status: 500 });
  }

  const reservation = normalizeReservation(entitlementData);

  if (!reservation.allowed) {
    return NextResponse.json(
      {
        error: entitlementErrorMessage(reservation),
        reason: reservation.reason,
        entitlement: reservation
      },
      { status: 402 }
    );
  }

  let deploymentResult;
  try {
    deploymentResult = await ensureOrgDeployment(targetOrgId);
  } catch (deploymentError) {
    if (reservation.mode === 'billing') await releasePaidInstanceSlot(targetOrgId);
    return NextResponse.json(
      { error: deploymentError instanceof Error ? deploymentError.message : 'Could not ensure org deployment' },
      { status: 500 }
    );
  }

  const { data: instance, error } = await supabase
    .from('instances')
    .insert({
      org_id: targetOrgId,
      name: body.name,
      phone: body.phone ?? null,
      region_code: body.regionCode,
      webhook_url: body.webhookUrl ?? null,
      webhook_secret_ref: webhookSigningSecret ? 'configured-on-worker' : null,
      behavior_profile: body.behaviorProfile,
      provisioning_state: 'desired',
      status: 'provisioning',
      proxy_policy: body.proxyPolicy,
      worker_endpoint: deploymentResult.deployment.base_url,
      worker_name: deploymentResult.deployment.vm_name,
      worker_namespace: deploymentResult.deployment.azure_resource_group,
      metadata: {
        deploymentId: deploymentResult.deployment.id,
        deploymentStatus: deploymentResult.deployment.status,
        entitlement: reservation
      }
    })
    .select('*')
    .single();

  if (error) {
    if (reservation.mode === 'billing') await releasePaidInstanceSlot(targetOrgId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let proxy = null;
  let worker = null;
  let responseInstance = instance;

  try {
    proxy = await claimProxyForInstance({
      orgId: targetOrgId,
      instanceId: instance.id,
      regionCode: body.regionCode,
      actorId: principal.actorId
    });

    if (deploymentResult.deployment.status === 'ready') {
      const health = await checkWorkerHealth({
        endpoint: deploymentResult.deployment.base_url,
        publicIp: deploymentResult.deployment.public_ip,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null
      });

      if (health.reachable) {
        try {
          worker = await createWorkerInstance({
            endpoint: deploymentResult.deployment.base_url,
            publicIp: deploymentResult.deployment.public_ip,
            sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null,
            instance: { ...instance, webhook_signing_secret: webhookSigningSecret },
            proxy
          });
        } catch (workerError) {
          const message = workerError instanceof Error ? workerError.message : String(workerError);
          if (!/Worker unreachable/i.test(message)) throw workerError;
          worker = { attempted: false, reason: 'worker_unreachable', error: message };
        }
      } else {
        worker = { attempted: false, reason: 'worker_health_pending', health };
        await supabase
          .from('org_deployments')
          .update({
            status: 'dns_pending',
            last_error: health.error || 'Worker health is not reachable yet.',
            health: {
              ...(deploymentResult.deployment.health || {}),
              publicReadinessCheck: {
                checkedAt: new Date().toISOString(),
                ...health
              }
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', deploymentResult.deployment.id);
        deploymentResult.deployment.status = 'dns_pending';
        await recordDeploymentStatusNotification({
          orgId: targetOrgId,
          deploymentId: deploymentResult.deployment.id,
          status: 'dns_pending',
          baseUrl: deploymentResult.deployment.base_url,
          message: health.error || 'Worker health is not reachable yet.'
        });
      }
    } else {
      worker = await createWorkerInstance({
        endpoint: null,
        publicIp: deploymentResult.deployment.public_ip,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null,
        instance: { ...instance, webhook_signing_secret: webhookSigningSecret },
        proxy
      });
    }
  } catch (provisionError) {
    await releaseProxyForInstance(instance.id);
    if (reservation.mode === 'billing') await releasePaidInstanceSlot(targetOrgId);
    await supabase
      .from('instances')
      .update({
        status: 'error',
        provisioning_state: 'failed',
        metadata: {
          deploymentId: deploymentResult.deployment.id,
          deploymentStatus: deploymentResult.deployment.status,
          entitlement: reservation,
          error: provisionError instanceof Error ? provisionError.message : String(provisionError)
        }
      })
      .eq('id', instance.id);
    const message = provisionError instanceof Error ? provisionError.message : String(provisionError);
    await recordAppNotification({
      orgId: targetOrgId,
      eventType: 'instance.failed',
      kind: 'instance',
      severity: 'error',
      title: 'Instance creation failed',
      body: message,
      idempotencyKey: `in-app:instance-create-failed:${instance.id}`,
      metadata: {
        instanceId: instance.id,
        instanceName: instance.name,
        deploymentId: deploymentResult.deployment.id,
        deploymentStatus: deploymentResult.deployment.status
      },
      error: message
    });
    return NextResponse.json(
      { error: message || 'Provisioning failed' },
      { status: 500 }
    );
  }

  await supabase.from('worker_events').insert({
    org_id: targetOrgId,
    instance_id: instance.id,
    event_type: 'instance.desired',
    summary: worker?.attempted
      ? 'Instance desired state created on org worker.'
      : 'Instance queued; org VM is not ready yet.',
    payload: {
      entitlement: reservation,
      deployment: deploymentResult.deployment,
      proxy,
      worker
    }
  });

  if (!worker?.attempted) {
    await recordAppNotification({
      orgId: targetOrgId,
      eventType: 'instance.queued',
      kind: 'instance',
      severity: 'info',
      title: 'Instance queued for provisioning',
      body: 'Your instance is queued until the workspace worker is reachable.',
      idempotencyKey: `in-app:instance-queued:${instance.id}`,
      metadata: {
        instanceId: instance.id,
        instanceName: instance.name,
        deploymentId: deploymentResult.deployment.id,
        deploymentStatus: deploymentResult.deployment.status
      }
    });
  }

  if (worker?.attempted) {
    const { data: provisionedInstance, error: provisionedError } = await supabase
      .from('instances')
      .update({
        status: 'disconnected',
        provisioning_state: 'provisioned',
        metadata: {
          ...(instance.metadata || {}),
          deploymentId: deploymentResult.deployment.id,
          deploymentStatus: deploymentResult.deployment.status,
          entitlement: reservation,
          lastWorkerReconcile: {
            attempted: true,
            reconciledAt: new Date().toISOString(),
            result: worker
          },
          last_error: null
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', instance.id)
      .select('*')
      .single();

    if (!provisionedError && provisionedInstance) {
      responseInstance = provisionedInstance;
      await recordAppNotification({
        orgId: targetOrgId,
        eventType: 'instance.ready',
        kind: 'instance',
        severity: 'success',
        title: 'Instance created',
        body: `${provisionedInstance.name} was created on your workspace worker.`,
        idempotencyKey: `in-app:instance-ready:${provisionedInstance.id}`,
        metadata: {
          instanceId: provisionedInstance.id,
          instanceName: provisionedInstance.name,
          deploymentId: deploymentResult.deployment.id
        }
      });
    }
  }

  return NextResponse.json(
    {
      success: true,
      instance: responseInstance,
      entitlement: reservation,
      deployment: deploymentResult.deployment,
      proxy,
      worker
    },
    { status: worker?.attempted ? 201 : 202 }
  );
}

function normalizeReservation(value: any) {
  if (value?.allowed) {
    return {
      allowed: true as const,
      mode: String(value.mode || 'billing'),
      paidInstanceLimit: value.paidInstanceLimit === undefined ? undefined : Number(value.paidInstanceLimit),
      activeInstanceCount: Number(value.activeInstanceCount ?? 0),
      reservedInstanceCount: value.reservedInstanceCount === undefined ? undefined : Number(value.reservedInstanceCount),
      trialInstanceLimit: value.trialInstanceLimit === undefined ? undefined : Number(value.trialInstanceLimit),
      trialEndsAt: value.trialEndsAt ?? null
    };
  }

  return {
    allowed: false as const,
    mode: String(value?.mode || 'billing'),
    reason: String(value?.reason || 'entitlement_check_failed'),
    paidInstanceLimit: value?.paidInstanceLimit === undefined ? undefined : Number(value.paidInstanceLimit),
    activeInstanceCount: value?.activeInstanceCount === undefined ? undefined : Number(value.activeInstanceCount),
    reservedInstanceCount: value?.reservedInstanceCount === undefined ? undefined : Number(value.reservedInstanceCount),
    trialInstanceLimit: value?.trialInstanceLimit === undefined ? undefined : Number(value.trialInstanceLimit),
    trialEndsAt: value?.trialEndsAt ?? null
  };
}

function entitlementErrorMessage(reservation: ReturnType<typeof normalizeReservation>) {
  if (reservation.reason === 'trial_expired') return 'Your free trial has expired. Upgrade to create another instance.';
  if (reservation.reason === 'trial_instance_limit_reached') return 'Your free trial instance slot is already in use.';
  if (reservation.reason === 'instance_limit_reached') return 'No paid instance slots are available.';
  if (reservation.reason?.startsWith('billing_status_')) return 'Billing is not active for this workspace.';
  if (reservation.reason === 'organization_not_found') return 'No workspace is linked to this account.';
  return 'This workspace is not entitled to create an instance.';
}
