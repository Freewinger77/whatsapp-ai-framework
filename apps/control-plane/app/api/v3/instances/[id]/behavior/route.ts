import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../lib/supabase-admin';
import { getWorkerBehavior, updateWorkerBehavior } from '../../../../../../lib/worker-client';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../lib/worker-target';

const UpdateBehaviorSchema = z.object({
  behaviorProfile: z.enum(['bot-native', 'notification-balanced', 'notification-max']).optional(),
  typingSimulation: z.boolean().optional(),
  delayEnabled: z.boolean().optional(),
  phoneNotificationsEnabled: z.boolean().optional(),
  notificationGraceMs: z.number().int().nonnegative().optional(),
  multiDeviceCoexist: z.boolean().optional(),
  webhookTypingEvents: z.boolean().optional(),
  groupAlertMode: z.boolean().optional(),
  proactiveTcTokenCapture: z.boolean().optional(),
  coldOptInGate: z.boolean().optional(),
  blockColdWithoutToken: z.boolean().optional(),
  optInCtaOnce: z.boolean().optional(),
  skipOutboundAckWait: z.boolean().optional()
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(_req, {
    allowApiKey: true,
    requiredScope: 'instances:read'
  });
  if (isAuthError(principal)) return principal;

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409 });
  }

  try {
    const workerBody = await getWorkerBehavior(workerRequestInput(target, target.instance));
    return NextResponse.json({
      success: true,
      behaviorSettings: (workerBody as { behaviorSettings?: unknown })?.behaviorSettings
        ?? (workerBody as { instance?: { behaviorSettings?: unknown } })?.instance?.behaviorSettings
        ?? workerBody
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const parsed = UpdateBehaviorSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseAdmin() as any;
  const target = await loadWorkerTarget(supabase, principal.orgId, id);
  if (!target.instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  if (!target.endpoint || !process.env.WASUP_WORKER_SHARED_SECRET) {
    return NextResponse.json({ error: 'Worker deployment is not ready yet.' }, { status: 409 });
  }

  try {
    const workerBody = await updateWorkerBehavior(workerRequestInput(target, target.instance), parsed.data);
    const behaviorSettings = (workerBody as { behaviorSettings?: unknown })?.behaviorSettings
      ?? (workerBody as { instance?: { behaviorSettings?: unknown } })?.instance?.behaviorSettings
      ?? workerBody;

    // Mirror flags into CP metadata for list/detail without worker roundtrip.
    const metaPatch: Record<string, unknown> = {};
    if (parsed.data.multiDeviceCoexist !== undefined) {
      metaPatch.multiDeviceCoexist = !!parsed.data.multiDeviceCoexist;
    }
    if (parsed.data.phoneNotificationsEnabled !== undefined) {
      metaPatch.phoneNotificationsEnabled = !!parsed.data.phoneNotificationsEnabled;
    }
    if (parsed.data.webhookTypingEvents !== undefined) {
      metaPatch.webhookTypingEvents = !!parsed.data.webhookTypingEvents;
    }
    if (parsed.data.groupAlertMode !== undefined) {
      metaPatch.groupAlertMode = !!parsed.data.groupAlertMode;
    }
    if (parsed.data.proactiveTcTokenCapture !== undefined) {
      metaPatch.proactiveTcTokenCapture = !!parsed.data.proactiveTcTokenCapture;
    }
    if (parsed.data.coldOptInGate !== undefined) {
      metaPatch.coldOptInGate = !!parsed.data.coldOptInGate;
    }
    if (parsed.data.blockColdWithoutToken !== undefined) {
      metaPatch.blockColdWithoutToken = !!parsed.data.blockColdWithoutToken;
    }
    if (parsed.data.optInCtaOnce !== undefined) {
      metaPatch.optInCtaOnce = !!parsed.data.optInCtaOnce;
    }
    if (parsed.data.skipOutboundAckWait !== undefined) {
      metaPatch.skipOutboundAckWait = !!parsed.data.skipOutboundAckWait;
    }
    if (Object.keys(metaPatch).length > 0) {
      await supabase
        .from('instances')
        .update({
          metadata: {
            ...(target.instance.metadata || {}),
            ...metaPatch
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('org_id', principal.orgId);
    }

    return NextResponse.json({ success: true, behaviorSettings, worker: workerBody });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
