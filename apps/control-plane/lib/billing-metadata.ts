import { getSupabaseAdmin } from './supabase-admin';

async function readEntitlementMetadata(orgId: string) {
  const supabase = getSupabaseAdmin() as any;
  const { data } = await supabase
    .from('billing_entitlements')
    .select('metadata')
    .eq('org_id', orgId)
    .maybeSingle();
  return (data?.metadata ?? {}) as Record<string, unknown>;
}

async function patchEntitlementMetadata(orgId: string, patch: Record<string, unknown>) {
  const supabase = getSupabaseAdmin() as any;
  const current = await readEntitlementMetadata(orgId);
  await supabase
    .from('billing_entitlements')
    .update({
      metadata: { ...current, ...patch },
      updated_at: new Date().toISOString()
    })
    .eq('org_id', orgId);
}

export { readEntitlementMetadata, patchEntitlementMetadata };
