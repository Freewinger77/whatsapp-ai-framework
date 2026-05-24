import { getSupabaseAdmin } from './supabase-admin';

export type ProxyClaimResult =
  | {
      assigned: true;
      id: string;
      region_code: string;
      host: string;
      port: number;
      proxy_type: 'http' | 'https' | 'socks4' | 'socks5';
      source: string;
      username_ref?: string | null;
      password_secret_ref?: string | null;
      credential_secret_ref?: string | null;
      username_encrypted?: string | null;
      password_encrypted?: string | null;
    }
  | {
      assigned: false;
      reason: string;
      regionCode: string;
    };

export async function getProxyAvailability(regionCode?: string) {
  let query = (getSupabaseAdmin() as any)
    .from('proxy_pool_summary')
    .select('*')
    .order('region_code', { ascending: true });

  if (regionCode) {
    query = query.eq('region_code', regionCode);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function claimProxyForInstance(input: {
  orgId: string;
  instanceId: string;
  regionCode: string;
  actorId?: string;
}): Promise<ProxyClaimResult> {
  const { data, error } = await (getSupabaseAdmin() as any).rpc('claim_proxy_for_instance', {
    p_org_id: input.orgId,
    p_instance_id: input.instanceId,
    p_region_code: input.regionCode,
    p_assigned_by: input.actorId ?? null
  });

  if (error) throw new Error(error.message);
  return normalizeProxyClaim(data, input.regionCode);
}

export async function releaseProxyForInstance(instanceId: string) {
  const { data, error } = await (getSupabaseAdmin() as any).rpc('release_proxy_for_instance', {
    p_instance_id: instanceId
  });

  if (error) throw new Error(error.message);
  return data;
}

function normalizeProxyClaim(value: any, regionCode: string): ProxyClaimResult {
  if (value?.assigned === false) {
    return {
      assigned: false,
      reason: String(value.reason || 'no_proxy_available'),
      regionCode: String(value.regionCode || regionCode)
    };
  }

  return {
    assigned: true,
    id: String(value.id),
    region_code: String(value.region_code || regionCode),
    host: String(value.host),
    port: Number(value.port),
    proxy_type: value.proxy_type || 'http',
    source: String(value.source || 'imported-pool'),
    username_ref: value.username_ref ?? null,
    password_secret_ref: value.password_secret_ref ?? null,
    credential_secret_ref: value.credential_secret_ref ?? null,
    username_encrypted: value.username_encrypted ?? null,
    password_encrypted: value.password_encrypted ?? null
  };
}
