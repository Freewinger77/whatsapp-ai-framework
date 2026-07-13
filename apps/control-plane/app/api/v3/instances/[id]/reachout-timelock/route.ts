import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { getWorkerReachoutTimelock } from '../../../../../../lib/worker-client';
import { workerReachoutTimeLockFromResult } from '../../../../../../lib/worker-instance-state';
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
    const workerBody = await getWorkerReachoutTimelock(workerRequestInput(target, id));
    const fromBody = workerReachoutTimeLockFromResult(workerBody);
    const reachoutTimeLock =
      fromBody ||
      (workerBody && typeof workerBody === 'object' && (workerBody as any).reachoutTimeLock) ||
      null;
    const newChatMessageCap =
      workerBody && typeof workerBody === 'object' ? (workerBody as any).newChatMessageCap ?? null : null;
    const privacyTokenCount =
      typeof (workerBody as any)?.privacyTokenCount === 'number'
        ? (workerBody as any).privacyTokenCount
        : fromBody?.privacyTokenCount ?? null;

    if (reachoutTimeLock) {
      const syncedAt = new Date().toISOString();
      const existingMetadata =
        target.instance.metadata && typeof target.instance.metadata === 'object'
          ? target.instance.metadata
          : {};
      await supabase
        .from('instances')
        .update({
          metadata: {
            ...existingMetadata,
            reachoutTimeLock: {
              ...reachoutTimeLock,
              syncedAt
            }
          },
          updated_at: syncedAt
        })
        .eq('id', id)
        .eq('org_id', principal.orgId);
    }

    return NextResponse.json({
      success: true,
      reachoutTimeLock,
      newChatMessageCap,
      privacyTokenCount
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cached =
      target.instance.metadata && typeof target.instance.metadata === 'object'
        ? (target.instance.metadata as any).reachoutTimeLock
        : null;
    if (cached) {
      return NextResponse.json({
        success: true,
        reachoutTimeLock: cached,
        newChatMessageCap: null,
        privacyTokenCount: cached.privacyTokenCount ?? null,
        stale: true,
        warning: message
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
