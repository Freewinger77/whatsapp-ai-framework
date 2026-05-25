import { NextResponse } from 'next/server';
import { sweepBillingInstanceDeletion, sweepBillingLifecycle } from '../../../../../lib/billing-lifecycle';
import { getServerEnv } from '../../../../../lib/env';

export async function POST(req: Request) {
  const secret = req.headers.get('x-wasup-worker-secret');
  if (!secret || secret !== process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  void getServerEnv();
  const [lifecycle, instanceDeletion] = await Promise.all([
    sweepBillingLifecycle(),
    sweepBillingInstanceDeletion()
  ]);
  return NextResponse.json({ success: true, result: { lifecycle, instanceDeletion } });
}
