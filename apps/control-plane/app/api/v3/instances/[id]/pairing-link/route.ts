import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { buildPairingLinkUrl, createPairingLinkToken } from '../../../../../../lib/pairing-link';

const PairingLinkSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const parsed = PairingLinkSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const { data: instance } = await supabase
    .from('instances')
    .select('id, org_id, name, status, deleted_at')
    .eq('org_id', principal.orgId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  try {
    const ttlSeconds = (parsed.data.expiresInDays ?? 7) * 24 * 60 * 60;
    const minted = createPairingLinkToken({
      instanceId: id,
      orgId: principal.orgId,
      ttlSeconds
    });

    return NextResponse.json({
      success: true,
      instanceId: id,
      instanceName: instance.name,
      url: buildPairingLinkUrl(id, minted.token),
      token: minted.token,
      expiresAt: minted.expiresAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
