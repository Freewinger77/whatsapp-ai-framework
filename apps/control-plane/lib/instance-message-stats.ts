type SupabaseAdmin = {
  from: (table: string) => any;
};

export function startOfUtcDayIso(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

export async function countMessagesTodayByInstance(
  supabase: SupabaseAdmin,
  orgId: string,
  instanceIds?: string[]
) {
  const since = startOfUtcDayIso();
  let query = supabase
    .from('instance_messages')
    .select('instance_id')
    .eq('org_id', orgId)
    .gte('created_at', since);

  if (instanceIds?.length) {
    query = query.in('instance_id', instanceIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const instanceId = row.instance_id as string | null;
    if (!instanceId) continue;
    counts[instanceId] = (counts[instanceId] ?? 0) + 1;
  }

  return counts;
}

export function attachMessagesToday<T extends { id: string }>(
  instances: T[],
  counts: Record<string, number>
) {
  return instances.map((instance) => ({
    ...instance,
    messages_today: counts[instance.id] ?? 0
  }));
}
