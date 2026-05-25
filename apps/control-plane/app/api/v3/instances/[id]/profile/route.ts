import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';

const ProfileSchema = z.object({
  displayName: z.string().max(120).optional(),
  about: z.string().max(240).optional(),
  pictureUrl: z.string().url().nullable().optional(),
  pictureStatus: z.string().max(64).default('pending')
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;

  const { data, error } = await (getSupabaseAdmin() as any)
    .from('instance_profiles')
    .select('*')
    .eq('org_id', principal.orgId)
    .eq('instance_id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, profile: data });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;
  const parsed = ProfileSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const { data, error } = await (getSupabaseAdmin() as any)
    .from('instance_profiles')
    .upsert({
      org_id: principal.orgId,
      instance_id: id,
      display_name: body.displayName,
      about: body.about,
      picture_url: body.pictureUrl,
      picture_status: body.pictureStatus,
      updated_at: new Date().toISOString()
    }, { onConflict: 'instance_id' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, profile: data });
}
