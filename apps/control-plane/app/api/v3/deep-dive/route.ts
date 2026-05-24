import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'all';
  const instanceId = url.searchParams.get('instanceId');
  const search = url.searchParams.get('search');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
  const supabase = getSupabaseAdmin() as any;

  const [logs, messages] = await Promise.all([
    type === 'messages' ? Promise.resolve({ data: [], error: null }) : queryLogs({ supabase, orgId: principal.orgId, instanceId, search, from, to, limit }),
    type === 'logs' ? Promise.resolve({ data: [], error: null }) : queryMessages({ supabase, orgId: principal.orgId, instanceId, search, from, to, limit })
  ]);

  if (logs.error) return NextResponse.json({ error: logs.error.message }, { status: 500 });
  if (messages.error) return NextResponse.json({ error: messages.error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    logs: logs.data ?? [],
    messages: messages.data ?? []
  });
}

function queryLogs(input: QueryInput) {
  let query = input.supabase
    .from('worker_events')
    .select('id, instance_id, event_type, severity, summary, payload, created_at')
    .eq('org_id', input.orgId)
    .order('created_at', { ascending: false })
    .limit(input.limit);

  if (input.instanceId) query = query.eq('instance_id', input.instanceId);
  if (input.from) query = query.gte('created_at', input.from);
  if (input.to) query = query.lte('created_at', input.to);
  if (input.search) query = query.ilike('summary', `%${input.search}%`);

  return query;
}

function queryMessages(input: QueryInput) {
  let query = input.supabase
    .from('instance_messages')
    .select('id, instance_id, direction, phone, contact_name, body, status, metadata, sent_at, received_at, seen_at, created_at')
    .eq('org_id', input.orgId)
    .order('created_at', { ascending: false })
    .limit(input.limit);

  if (input.instanceId) query = query.eq('instance_id', input.instanceId);
  if (input.from) query = query.gte('created_at', input.from);
  if (input.to) query = query.lte('created_at', input.to);
  if (input.search) query = query.or(`phone.ilike.%${input.search}%,body.ilike.%${input.search}%`);

  return query;
}

type QueryInput = {
  supabase: any;
  orgId: string;
  instanceId: string | null;
  search: string | null;
  from: string | null;
  to: string | null;
  limit: number;
};
