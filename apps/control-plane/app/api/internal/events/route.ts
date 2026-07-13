import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  applyInstanceConnectionStatus,
  connectionEventToInstanceStatus,
  isConnectionStatusEvent
} from '../../../../lib/sync-instance-worker-status';
import { resolveControlPlaneInstance } from '../../../../lib/worker-instance-id';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

const InternalEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('log'),
    orgId: z.string().uuid(),
    instanceId: z.string().uuid().optional(),
    workerInstanceId: z.string().min(3).max(120).optional(),
    eventType: z.string().min(1),
    severity: z.enum(['debug', 'info', 'warning', 'error', 'critical']).default('info'),
    summary: z.string().max(2000).optional(),
    payload: z.record(z.string(), z.unknown()).default({})
  }),
  z.object({
    kind: z.literal('message'),
    orgId: z.string().uuid(),
    instanceId: z.string().uuid().optional(),
    workerInstanceId: z.string().min(3).max(120).optional(),
    externalMessageId: z.string().min(1).max(200).optional(),
    direction: z.enum(['inbound', 'outbound']),
    phone: z.string().max(64).optional(),
    body: z.string().max(10000).optional(),
    status: z.string().max(64).optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
]);

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || bearerToken(req);

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = InternalEventSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const event = parsed.data;
  const supabase = getSupabaseAdmin() as any;
  const resolvedInstance = await resolveEventInstance(supabase, event.orgId, event);
  const instanceId = resolvedInstance?.id ?? event.instanceId ?? null;

  if (event.kind === 'log') {
    const { data, error } = await supabase.rpc('record_instance_event', {
      p_org_id: event.orgId,
      p_instance_id: instanceId,
      p_event_type: event.eventType,
      p_severity: event.severity,
      p_summary: event.summary ?? null,
      p_payload: {
        ...event.payload,
        workerInstanceId: event.workerInstanceId ?? null
      }
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (instanceId && isConnectionStatusEvent(event.eventType)) {
      const nextStatus = connectionEventToInstanceStatus(event.eventType, event.payload);
      if (nextStatus) {
        const payloadPhone = typeof event.payload.phone === 'string' ? event.payload.phone : null;
        await applyInstanceConnectionStatus(supabase, event.orgId, instanceId, nextStatus, {
          phone: nextStatus === 'connected' ? payloadPhone : null,
          existingMetadata: resolvedInstance?.metadata,
          syncKey: 'lastConnectionEvent'
        });
      }
    }

    return NextResponse.json({ success: true, eventId: data, instanceId }, { status: 202 });
  }

  const { data, error } = await supabase.rpc('record_message_event', {
    p_org_id: event.orgId,
    p_instance_id: instanceId,
    p_external_message_id: event.externalMessageId ?? crypto.randomUUID(),
    p_direction: event.direction,
    p_phone: event.phone ?? null,
    p_body: event.body ?? null,
    p_status: event.status ?? null,
    p_metadata: {
      ...event.metadata,
      workerInstanceId: event.workerInstanceId ?? null
    }
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, messageId: data, instanceId }, { status: 202 });
}

async function resolveEventInstance(
  supabase: { from: (table: string) => any },
  orgId: string,
  event: { instanceId?: string; workerInstanceId?: string }
) {
  if (event.instanceId) {
    const direct = await resolveControlPlaneInstance(supabase, orgId, event.instanceId);
    if (direct) return direct;
  }
  if (event.workerInstanceId) {
    return resolveControlPlaneInstance(supabase, orgId, event.workerInstanceId);
  }
  return null;
}

function bearerToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '';
}
