import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startAzureVmProvisioning } from '../../../../../lib/azure-vm-provisioner';
import { recordAppNotification, recordDeploymentStatusNotification } from '../../../../../lib/notifications';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const ProvisionSchema = z.object({
  org: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string()
  }),
  deployment: z.object({
    id: z.string().uuid(),
    azure_resource_group: z.string().nullable().optional(),
    azure_region: z.string().nullable().optional(),
    vm_name: z.string().nullable().optional(),
    vm_size: z.string().nullable().optional(),
    base_url: z.string().nullable().optional(),
    fqdn: z.string().nullable().optional()
  })
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = ProvisionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await startAzureVmProvisioning(parsed.data);
    await (getSupabaseAdmin() as any)
      .from('org_deployments')
      .update({
        status: 'provisioning',
        health: {
          azureProvisioning: result,
          lastProvisioningWebhookAt: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', parsed.data.deployment.id);

    await recordDeploymentStatusNotification({
      orgId: parsed.data.org.id,
      deploymentId: parsed.data.deployment.id,
      status: 'provisioning',
      baseUrl: parsed.data.deployment.base_url ?? null,
      message: 'Azure resources are being prepared for your workspace.'
    });

    return NextResponse.json({ success: true, ...result }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await (getSupabaseAdmin() as any)
      .from('org_deployments')
      .update({
        status: 'failed',
        last_error: message,
        updated_at: new Date().toISOString()
      })
      .eq('id', parsed.data.deployment.id);
    await recordAppNotification({
      orgId: parsed.data.org.id,
      eventType: 'deployment.failed',
      kind: 'deployment',
      severity: 'error',
      title: 'Workspace provisioning failed',
      body: message,
      idempotencyKey: `in-app:deployment-failed:${parsed.data.deployment.id}`,
      metadata: {
        deploymentId: parsed.data.deployment.id,
        baseUrl: parsed.data.deployment.base_url ?? null
      },
      error: message
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
