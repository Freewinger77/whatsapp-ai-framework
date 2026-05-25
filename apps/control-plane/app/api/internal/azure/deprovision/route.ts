import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteAzureVmResourceGroup } from '../../../../../lib/azure-vm-provisioner';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const DeprovisionSchema = z.object({
  orgId: z.string().uuid(),
  actorId: z.string(),
  deployment: z.object({
    id: z.string().optional(),
    azureResourceGroup: z.string().nullable().optional(),
    vmName: z.string().nullable().optional()
  })
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = DeprovisionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const resourceGroup = parsed.data.deployment.azureResourceGroup;
  if (!resourceGroup) {
    return NextResponse.json({ error: 'Deployment is missing azureResourceGroup' }, { status: 400 });
  }

  const result = await deleteAzureVmResourceGroup(resourceGroup);
  await (getSupabaseAdmin() as any)
    .from('org_deployments')
    .update({
      status: 'suspended',
      health: {
        azureDeprovisioning: result,
        lastDeprovisioningWebhookAt: new Date().toISOString(),
        requestedBy: parsed.data.actorId
      },
      updated_at: new Date().toISOString()
    })
    .eq('org_id', parsed.data.orgId)
    .eq('environment', 'production');

  return NextResponse.json({ success: true, ...result }, { status: 202 });
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
