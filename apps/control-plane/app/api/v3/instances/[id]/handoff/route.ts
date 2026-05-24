import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';

const HandoffSchema = z.object({
  phone: z.string().min(6).max(64),
  label: z.string().max(120).optional()
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;

  const { data, error } = await (getSupabaseAdmin() as any)
    .from('handoff_numbers')
    .select('*')
    .eq('org_id', principal.orgId)
    .eq('instance_id', id)
    .neq('status', 'released')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, numbers: data ?? [] });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;
  const parsed = HandoffSchema.safeParse(await req.json());

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await (getSupabaseAdmin() as any)
    .from('handoff_numbers')
    .upsert({
      org_id: principal.orgId,
      instance_id: id,
      phone: parsed.data.phone,
      label: parsed.data.label ?? null,
      status: 'active',
      updated_at: new Date().toISOString()
    }, { onConflict: 'org_id,instance_id,phone' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, number: data }, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;
  const { id } = await params;
  const phone = new URL(req.url).searchParams.get('phone');

  if (!phone) return NextResponse.json({ error: 'phone query parameter is required' }, { status: 400 });

  const { error } = await (getSupabaseAdmin() as any)
    .from('handoff_numbers')
    .update({ status: 'released', updated_at: new Date().toISOString() })
    .eq('org_id', principal.orgId)
    .eq('instance_id', id)
    .eq('phone', phone);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
