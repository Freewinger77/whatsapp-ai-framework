import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const MarkReadSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional()
});

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = MarkReadSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, all } = parsed.data;
  if (!all && !ids?.length) {
    return NextResponse.json({ error: 'Provide ids or all=true.' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin() as any;
  let selectQuery = supabase
    .from('notification_events')
    .select('id, metadata')
    .eq('org_id', principal.orgId)
    .limit(100);

  if (!all) selectQuery = selectQuery.in('id', ids);

  const { data, error } = await selectQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const readAt = new Date().toISOString();
  const updates = await Promise.allSettled(
    (data ?? []).map((event: any) =>
      supabase
        .from('notification_events')
        .update({
          metadata: {
            ...(event.metadata || {}),
            readAt
          }
        })
        .eq('org_id', principal.orgId)
        .eq('id', event.id)
    )
  );

  const failed = updates.filter((result) => result.status === 'rejected' || (result.status === 'fulfilled' && result.value.error));
  if (failed.length > 0) {
    return NextResponse.json({ error: 'Could not mark all notifications as read.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated: data?.length ?? 0 });
}
