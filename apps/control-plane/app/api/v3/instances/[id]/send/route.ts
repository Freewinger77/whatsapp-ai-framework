import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { sendWorkerInstanceMessage } from '../../../../../../lib/worker-client';

const SendMessageSchema = z
  .object({
    to: z.string().min(6).max(64),
    message: z.string().max(5000).optional(),
    text: z.string().max(5000).optional(),
    buttons: z.array(z.object({
      id: z.string().min(1).max(64),
      text: z.string().min(1).max(80)
    })).max(3).optional(),
    footer: z.string().max(240).optional(),
    typingSimulation: z.boolean().optional(),
    delayEnabled: z.boolean().optional()
  })
  .refine((value) => Boolean(value.message || value.text), {
    message: 'message or text is required',
    path: ['message']
  });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'messages:send'
  });
  if (isAuthError(principal)) return principal;

  const parsed = SendMessageSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409 });
  }

  try {
    const worker = await sendWorkerInstanceMessage(
      {
        endpoint: target.endpoint,
        publicIp: target.deployment?.public_ip ?? null,
        sharedSecret: process.env.WASUP_WORKER_SHARED_SECRET,
        instanceId: id
      },
      parsed.data
    );

    await supabase.from('worker_events').insert({
      org_id: principal.orgId,
      instance_id: id,
      event_type: 'message.playground_send',
      severity: 'info',
      summary: 'Message sent from dashboard playground.',
      payload: {
        to: parsed.data.to,
        hasButtons: Boolean(parsed.data.buttons?.length)
      }
    });

    return NextResponse.json({ success: true, worker });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function loadWorkerTarget(supabase: any, orgId: string, instanceId: string) {
  const { data: instance } = await supabase
    .from('instances')
    .select('id, org_id, status, worker_endpoint')
    .eq('org_id', orgId)
    .eq('id', instanceId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!instance) return { instance: null, deployment: null, endpoint: null };

  const { data: deployment } = await supabase
    .from('org_deployments')
    .select('id, base_url, public_ip, status')
    .eq('org_id', orgId)
    .eq('environment', 'production')
    .maybeSingle();

  return {
    instance,
    deployment,
    endpoint: instance.worker_endpoint || deployment?.base_url || null
  };
}
