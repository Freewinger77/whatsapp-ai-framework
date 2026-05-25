import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { deprovisionOrgDeployment } from '../../../../../lib/org-deployments';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  if (principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('id', id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: orgError?.message || 'Organization not found' }, { status: 404 });
  }

  const { data: instances, error: instancesError } = await supabase
    .from('instances')
    .select('id')
    .eq('org_id', id)
    .is('deleted_at', null);

  if (instancesError) {
    return NextResponse.json({ error: instancesError.message }, { status: 500 });
  }

  for (const instance of instances ?? []) {
    await supabase.rpc('release_proxy_for_instance', { p_instance_id: instance.id });
  }

  let deprovisioning;
  try {
    deprovisioning = await deprovisionOrgDeployment(id, principal.actorId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'VM deprovisioning failed' },
      { status: 502 }
    );
  }

  await supabase.from('audit_events').insert({
    org_id: id,
    actor_clerk_user_id: principal.actorId,
    action: 'organization.delete_requested',
    target_type: 'organization',
    target_id: id,
    metadata: { deprovisioning }
  });

  const { error: deleteError } = await supabase
    .from('organizations')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    organization: org,
    instancesReleased: instances?.length ?? 0,
    vmDeprovisioning: deprovisioning
  });
}
