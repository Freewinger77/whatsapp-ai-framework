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
