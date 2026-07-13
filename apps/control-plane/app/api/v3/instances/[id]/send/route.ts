import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { sendWorkerInstanceMessage } from '../../../../../../lib/worker-client';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../lib/worker-target';

const SendMessageSchema = z
  .object({
    to: z.string().min(6).max(64),
    message: z.string().max(5000).optional(),
    text: z.string().max(5000).optional(),
    buttons: z.array(z.object({
      id: z.string().min(1).max(64),
      text: z.string().min(1).max(80)
    })).max(3).optional(),
    ctaUrl: z.union([
      z.string().url(),
      z.object({
        url: z.string().url(),
        label: z.string().max(25).optional()
      })
    ]).optional(),
    link: z.union([
      z.string().url(),
      z.object({
        url: z.string().url(),
        label: z.string().max(120).optional()
      })
    ]).optional(),
    linkPreview: z.boolean().optional(),
    footer: z.string().max(240).optional(),
    typingSimulation: z.boolean().optional(),
    delayEnabled: z.boolean().optional(),
    skipContactSave: z.boolean().optional()
  })
  .refine((value) => Boolean(
    value.message ||
    value.text ||
    value.ctaUrl ||
    value.link ||
    (value.buttons && value.buttons.length > 0)
  ), {
    message: 'message, text, link, ctaUrl, or buttons is required',
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
    const worker = await sendWorkerInstanceMessage(workerRequestInput(target, target.instance), parsed.data);

    await supabase.from('worker_events').insert({
      org_id: principal.orgId,
      instance_id: id,
      event_type: 'message.playground_send',
      severity: 'info',
      summary: 'Message sent from dashboard playground.',
      payload: {
        to: parsed.data.to,
        hasButtons: Boolean(parsed.data.buttons?.length),
        hasCtaUrl: Boolean(parsed.data.ctaUrl),
        hasLink: Boolean(parsed.data.link)
      }
    });

    return NextResponse.json({ success: true, worker });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
