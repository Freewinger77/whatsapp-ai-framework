type AnyRecord = Record<string, any>;

export function workerStatusFromResult(result: unknown) {
  for (const record of collectWorkerRecords(result)) {
    if (typeof record.status === 'string' && record.status.trim()) {
      return record.status;
    }
  }

  return null;
}

export function mapWorkerInstanceStatus(status: unknown) {
  if (status === 'connected') return 'connected';
  if (status === 'connecting') return 'connecting';
  if (status === 'error') return 'error';
  return 'disconnected';
}

export function workerPhoneFromResult(result: unknown) {
  for (const record of collectWorkerRecords(result)) {
    const phone = normalizeWorkerPhone(
      record.connectedPhone ??
        record.phone ??
        record.connected_phone ??
        record.connectedJid ??
        record.connected_jid ??
        record.jid
    );

    if (phone) return phone;
  }

  return null;
}

export type WorkerReachoutTimeLock = {
  isActive: boolean;
  timeEnforcementEnds: string | null;
  enforcementType: string;
  checkedAt: string | null;
  source: string | null;
  privacyTokenCount: number | null;
};

export function workerReachoutTimeLockFromResult(result: unknown): WorkerReachoutTimeLock | null {
  for (const record of collectWorkerRecords(result)) {
    const lock = record.reachoutTimeLock ?? record.reachout_time_lock;
    if (!lock || typeof lock !== 'object') continue;
    const raw = lock as Record<string, unknown>;
    const ends =
      typeof raw.timeEnforcementEnds === 'string'
        ? raw.timeEnforcementEnds
        : typeof raw.time_enforcement_ends === 'string'
          ? raw.time_enforcement_ends
          : null;
    return {
      isActive: Boolean(raw.isActive ?? raw.is_active),
      timeEnforcementEnds: ends,
      enforcementType: String(raw.enforcementType ?? raw.enforcement_type ?? 'DEFAULT'),
      checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : typeof raw.checked_at === 'string' ? raw.checked_at : null,
      source: typeof raw.source === 'string' ? raw.source : null,
      privacyTokenCount:
        typeof record.privacyTokenCount === 'number'
          ? record.privacyTokenCount
          : typeof record.privacy_token_count === 'number'
            ? record.privacy_token_count
            : null
    };
  }
  return null;
}

export function normalizeWorkerPhone(value: unknown) {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw || /^unknown$/i.test(raw) || /not\s+linked/i.test(raw) || /@lid\b/i.test(raw)) {
    return null;
  }

  const localPart = raw.split('@')[0]?.split(':')[0] ?? '';
  const digits = localPart.replace(/[^\d]/g, '');

  return digits.length >= 6 && digits.length <= 20 ? digits : null;
}

function collectWorkerRecords(value: unknown, records: AnyRecord[] = [], seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return records;

  seen.add(value);
  const record = value as AnyRecord;
  records.push(record);

  for (const key of ['instance', 'result', 'worker', 'account', 'user', 'me']) {
    collectWorkerRecords(record[key], records, seen);
  }

  return records;
}
