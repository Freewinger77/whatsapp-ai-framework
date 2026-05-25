import { NextResponse } from 'next/server';
import { z } from 'zod';
import { markDeploymentPublicIp } from '../../../../../lib/org-deployments';

const DeploymentReadySchema = z.object({
  orgId: z.string().uuid(),
  publicIp: z.string().min(3).max(64),
  deployedVersion: z.string().optional()
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = DeploymentReadySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await markDeploymentPublicIp(parsed.data);
  return NextResponse.json({ success: true, ...result });
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
