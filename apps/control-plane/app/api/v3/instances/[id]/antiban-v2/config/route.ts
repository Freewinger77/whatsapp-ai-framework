import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../../../lib/supabase-admin';
import { updateWorkerAntibanV2 } from '../../../../../../../lib/worker-client';
import { loadWorkerTarget, workerRequestInput } from '../../../../../../../lib/worker-target';

const UpdateAntibanV2Schema = z.object({
  enabled: z.boolean().optional(),
  preset: z.enum(['conservative', 'moderate', 'aggressive', 'balanced']).optional(),
  overrides: z
    .object({
      maxPerMinute: z.number().int().positive().optional(),
      maxPerHour: z.number().int().positive().optional(),
      maxPerDay: z.number().int().positive().optional(),
      messagesPerHour: z.number().int().positive().optional(),
      messagesPerDay: z.number().int().positive().optional(),
      minDelayMs: z.number().int().nonnegative().optional(),
      maxDelayMs: z.number().int().nonnegative().optional()
    })
    .optional(),
  modules: z
    .record(
      z.object({
        enabled: z.boolean().optional(),
        warmupDays: z.number().int().positive().optional(),
        day1Limit: z.number().int().positive().optional(),
        growthFactor: z.number().positive().optional()
      })
    )
    .optional()
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const principal = await requireWasupPrincipal(req, {
    allowApiKey: true,
    requiredScope: 'instances:write'
  });
  if (isAuthError(principal)) return principal;

  const parsed = UpdateAntibanV2Schema.safeParse(await req.json().catch(() => ({})));
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

  const body = {
    ...parsed.data,
    preset: parsed.data.preset === 'balanced' ? 'moderate' : parsed.data.preset
  };

  try {
    const result = await updateWorkerAntibanV2(workerRequestInput(target, id), body);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
