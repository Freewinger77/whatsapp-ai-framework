import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

const UsageEventSchema = z.object({
  orgId: z.string().uuid().optional(),
  instanceId: z.string().uuid().optional(),
  eventType: z.enum([
    'message.sent',
    'message.received',
    'message.seen',
    'message.outbound',
    'message.inbound',
    'webhook.delivered',
    'webhook.failed'
  ]),
  quantity: z.number().positive().default(1),
  unit: z.string().min(1).max(32).default('count'),
  creditCost: z.number().int().min(0).optional(),
  idempotencyKey: z.string().min(8).max(160),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = UsageEventSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const event = parsed.data;
  const supabase = getSupabaseAdmin() as any;
  const orgId = event.orgId || await resolveOrgIdForInstance(event.instanceId);

  if (!orgId) {
    return NextResponse.json({ error: 'orgId or a known instanceId is required' }, { status: 400 });
  }

  const creditCost = event.creditCost ?? defaultCreditCost(event.eventType, event.quantity);
  const { data, error } = await supabase.rpc('record_metered_usage', {
    p_org_id: orgId,
    p_instance_id: event.instanceId ?? null,
    p_event_type: event.eventType,
    p_quantity: event.quantity,
    p_unit: event.unit,
    p_credit_cost: creditCost,
    p_idempotency_key: event.idempotencyKey,
    p_metadata: event.metadata
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const status = data?.accepted === false ? 402 : 202;
  return NextResponse.json({ success: data?.accepted !== false, result: data }, { status });
}

async function resolveOrgIdForInstance(instanceId?: string) {
  if (!instanceId) return null;
  const { data } = await (getSupabaseAdmin() as any)
    .from('instances')
    .select('org_id')
    .eq('id', instanceId)
    .single();
  return data?.org_id ?? null;
}

function defaultCreditCost(eventType: string, quantity: number) {
  if (eventType === 'message.sent' || eventType === 'message.received' || eventType === 'message.outbound' || eventType === 'message.inbound') {
    return Math.ceil(quantity);
  }
  return 0;
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
