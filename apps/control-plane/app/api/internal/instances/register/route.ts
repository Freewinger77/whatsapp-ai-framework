import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { registerWorkerInstanceWithControlPlane } from '../../../../../lib/worker-instance-sync';

const RegisterSchema = z.object({
  orgId: z.string().uuid(),
  workerInstanceId: z.string().min(3).max(120),
  controlPlaneInstanceId: z.string().uuid().nullable().optional(),
  name: z.string().max(120).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  status: z.string().max(32).optional(),
  phone: z.string().max(32).nullable().optional()
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = RegisterSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await registerWorkerInstanceWithControlPlane(parsed.data);
    return NextResponse.json({ success: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
