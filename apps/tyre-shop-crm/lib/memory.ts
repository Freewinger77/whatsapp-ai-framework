/** In-process fallback so SMT_MODE=mock can run the UI before Supabase tables exist. */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  smt_customers: [],
  smt_enquiries: [],
  smt_bookings: [],
  smt_nps: [],
  smt_testimonials: [],
  smt_events: [],
  smt_poll_runs: [],
  smt_settings: [],
};

function now() {
  return new Date().toISOString();
}

export function memoryEnabled(): boolean {
  return (process.env.SMT_MODE || "").toLowerCase() === "mock";
}

export const memory = {
  all(table: string): Row[] {
    return tables[table] || [];
  },
  find(table: string, key: string, value: string): Row | undefined {
    return (tables[table] || []).find((r) => r[key] === value);
  },
  upsert(table: string, key: string, row: Row): boolean {
    const list = tables[table] || (tables[table] = []);
    const idx = list.findIndex((r) => r[key] === row[key]);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...row, updated_at: now() };
      return false;
    }
    list.unshift({ ...row, created_at: now(), updated_at: now() });
    return true;
  },
  insert(table: string, row: Row): Row {
    const withId = { id: row.id || crypto.randomUUID(), created_at: now(), ...row };
    tables[table] = tables[table] || [];
    tables[table].unshift(withId);
    return withId;
  },
  update(table: string, key: string, value: string, patch: Row): void {
    const list = tables[table] || [];
    const idx = list.findIndex((r) => r[key] === value);
    if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  },
};
