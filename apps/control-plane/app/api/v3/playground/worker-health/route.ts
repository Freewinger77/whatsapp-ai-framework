import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';
import { checkWorkerHealth } from '../../../../../lib/worker-client';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const supabase = getSupabaseAdmin() as any;
  const { data: deployment, error } = await supabase
    .from('org_deployments')
    .select('status, base_url, public_ip')
    .eq('org_id', principal.orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const baseUrl = deployment?.base_url ?? null;
  const worker = await checkWorkerHealth({
    endpoint: baseUrl,
    publicIp: deployment?.public_ip ?? null,
    sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET || null
  });

  return NextResponse.json({
    success: true,
    connection: {
      baseUrl,
      status: deployment?.status || 'not_started'
    },
    worker
  });
}
