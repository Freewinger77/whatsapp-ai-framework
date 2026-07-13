export type WorkerAntibanV2Status = {
  enabled?: boolean;
  running?: boolean;
  preset?: string;
  overrides?: {
    maxPerHour?: number;
    maxPerDay?: number;
    messagesPerHour?: number;
    messagesPerDay?: number;
  };
  effectiveLimits?: {
    maxPerMinute?: number;
    maxPerHour?: number;
    maxPerDay?: number;
  };
  modules?: Record<string, { enabled?: boolean; day1Limit?: number }>;
  health?: { risk?: string; isPaused?: boolean; recommendation?: string } | null;
  warmup?: {
    phase?: string;
    day?: number;
    totalDays?: number;
    todayLimit?: number;
    todaySent?: number;
    progress?: number;
    complete?: boolean;
  } | null;
  rateLimiter?: {
    lastMinute?: number;
    lastHour?: number;
    lastDay?: number;
    limits?: {
      perMinute?: number;
      perHour?: number;
      perDay?: number;
      maxPerHour?: number;
      maxPerDay?: number;
    };
  } | null;
  config?: {
    overrides?: { maxPerHour?: number; maxPerDay?: number; messagesPerHour?: number; messagesPerDay?: number };
    modules?: Record<string, { enabled?: boolean; day1Limit?: number }>;
  };
};

/** Worker routes return `{ success, antibanV2 }` — unwrap for control-plane clients. */
export function unwrapWorkerAntibanV2(body: unknown): WorkerAntibanV2Status | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const nested = record.antibanV2;
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    if (inner.antibanV2 && typeof inner.antibanV2 === 'object') {
      return inner.antibanV2 as WorkerAntibanV2Status;
    }
    return nested as WorkerAntibanV2Status;
  }
  return record as WorkerAntibanV2Status;
}

export function rateLimitHour(status: WorkerAntibanV2Status | null) {
  const limits = status?.rateLimiter?.limits;
  return limits?.maxPerHour
    ?? limits?.perHour
    ?? status?.effectiveLimits?.maxPerHour
    ?? status?.overrides?.maxPerHour
    ?? status?.overrides?.messagesPerHour
    ?? status?.config?.overrides?.maxPerHour
    ?? status?.config?.overrides?.messagesPerHour;
}

export function rateLimitDay(status: WorkerAntibanV2Status | null) {
  const limits = status?.rateLimiter?.limits;
  return limits?.maxPerDay
    ?? limits?.perDay
    ?? status?.effectiveLimits?.maxPerDay
    ?? status?.overrides?.maxPerDay
    ?? status?.overrides?.messagesPerDay
    ?? status?.config?.overrides?.maxPerDay
    ?? status?.config?.overrides?.messagesPerDay;
}
