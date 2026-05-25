import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../../lib/supabase-admin';
import { fetchWorkerInstanceMedia } from '../../../../../../../lib/worker-client';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../../lib/worker-target';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;

  const { id, mediaId } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409, headers: NO_STORE_HEADERS });
  }

  try {
    const file = await fetchWorkerInstanceMedia(workerRequestInput(target, id), mediaId);
    return new NextResponse(file.buffer, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': file.contentType,
        'Content-Disposition': `inline; filename="${file.fileName.replace(/"/g, '')}"`,
        'Content-Length': String(file.buffer.length)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
