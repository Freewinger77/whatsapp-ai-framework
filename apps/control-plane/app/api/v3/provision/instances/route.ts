import { NextResponse } from 'next/server';
import { z } from 'zod';
import { releasePaidInstanceSlot, reservePaidInstanceSlot } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const CreateInstanceSchema = z.object({
  orgId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(32).optional(),
  regionCode: z.string().min(2).max(32),
  webhookUrl: z.string().url().optional(),
  behaviorProfile: z.enum(['bot-native', 'notification-balanced', 'notification-max']).default('notification-balanced'),
  proxyPolicy: z.enum(['auto', 'imported-pool', 'dedicated-provider']).default('auto')
});

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = CreateInstanceSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const targetOrgId = body.orgId || principal.orgId;
  const supabase = getSupabaseAdmin() as any;
  const reservation = await reservePaidInstanceSlot(targetOrgId);

  if (!reservation.allowed) {
    return NextResponse.json(
      {
        error: 'No paid instance slots available',
        reason: reservation.reason,
        entitlement: reservation
      },
      { status: 402 }
    );
  }

  const { data: instance, error } = await supabase
    .from('instances')
    .insert({
      org_id: targetOrgId,
      name: body.name,
      phone: body.phone ?? null,
      region_code: body.regionCode,
      webhook_url: body.webhookUrl ?? null,
      behavior_profile: body.behaviorProfile,
      provisioning_state: 'desired',
      status: 'provisioning',
      proxy_policy: body.proxyPolicy
    })
    .select('*')
    .single();

  if (error) {
    await releasePaidInstanceSlot(targetOrgId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from('worker_events').insert({
    org_id: targetOrgId,
    instance_id: instance.id,
    event_type: 'instance.desired',
    summary: 'Paid instance slot reserved; provisioner should allocate proxy and worker.',
    payload: { entitlement: reservation }
  });

  return NextResponse.json({ success: true, instance, entitlement: reservation }, { status: 201 });
}
