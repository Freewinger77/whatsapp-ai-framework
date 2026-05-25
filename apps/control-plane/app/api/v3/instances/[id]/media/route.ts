import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { listWorkerInstanceMedia } from '../../../../../../lib/worker-client';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../lib/worker-target';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

type MediaItem = {
  id: string;
  instanceId?: string;
  mediaType?: string;
  direction?: string;
  mimeType?: string | null;
  fileName?: string | null;
  publicUrl?: string | null;
  size?: number;
  createdAt?: string;
  downloadUrl?: string | null;
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409, headers: NO_STORE_HEADERS });
  }

  const url = new URL(req.url);
  const mediaType = url.searchParams.get('type') || url.searchParams.get('mediaType') || undefined;
  const limit = Number(url.searchParams.get('limit') || 50);

  try {
    const worker = (await listWorkerInstanceMedia(workerRequestInput(target, id), {
      mediaType,
      limit: Number.isFinite(limit) ? limit : 50
    })) as { success?: boolean; count?: number; media?: MediaItem[] };

    const apiBase = process.env.WASUP_CONTROL_PLANE_PUBLIC_URL || 'https://control-plane.wasup.co';
    const media = (worker.media || []).map((item) => ({
      ...item,
      downloadUrl: item.id ? `${apiBase}/api/v3/instances/${encodeURIComponent(id)}/media/${encodeURIComponent(item.id)}` : null
    }));

    return NextResponse.json(
      {
        success: true,
        count: media.length,
        media
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
