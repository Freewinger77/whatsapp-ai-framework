import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { getWorkerAntibanV2 } from '../../../../../../lib/worker-client';
import { unwrapWorkerAntibanV2 } from '../../../../../../lib/worker-antiban-response';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../lib/worker-target';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(_req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409 });
  }

  try {
    const workerBody = await getWorkerAntibanV2(workerRequestInput(target, id));
    return NextResponse.json({ success: true, antibanV2: unwrapWorkerAntibanV2(workerBody) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
