import { readFileSync } from "node:fs";
import { bookingsFromCsv } from "../lib/smt/parse";
import { normPersonName } from "../lib/names";
import { listTable, stampCustomerBookingDates, upsertBooking } from "../lib/store";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/import-bookings.ts <csv>");
    process.exit(1);
  }

  const bookings = bookingsFromCsv(readFileSync(path, "utf8"));
  const customers = (await listTable("smt_customers")) as Array<{ smt_id: string; name: string | null }>;
  const byName = new Map<string, string[]>();
  for (const customer of customers) {
    const key = normPersonName(customer.name);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(customer.smt_id);
    byName.set(key, list);
  }

  let linked = 0;
  let ambiguous = 0;
  for (const booking of bookings) {
    const ids = byName.get(booking.customerKey) || [];
    if (ids.length === 1) {
      booking.customerSmtId = ids[0];
      linked += 1;
    } else if (ids.length > 1) {
      ambiguous += 1;
    }
  }

  let created = 0;
  let refreshed = 0;
  for (const booking of bookings) {
    const result = await upsertBooking(booking);
    if (result.isNew) created += 1;
    else refreshed += 1;
  }

  const latest = new Map<string, string>();
  for (const booking of bookings) {
    if (!booking.customerSmtId) continue;
    const at = booking.fittingAt || booking.createdAt;
    if (!at) continue;
    const prev = latest.get(booking.customerSmtId);
    if (!prev || at > prev) latest.set(booking.customerSmtId, at);
  }
  await stampCustomerBookingDates([...latest.entries()].map(([smtId, lastBookingAt]) => ({ smtId, lastBookingAt })));

  console.log(
    JSON.stringify({
      orders: bookings.length,
      created,
      refreshed,
      linked,
      ambiguous,
      stamped: latest.size,
      fitted: bookings.filter((b) => b.statusNorm === "fitted").length,
      abandoned: bookings.filter((b) => b.statusNorm === "abandoned").length,
      cancelled: bookings.filter((b) => b.statusNorm === "cancelled").length,
      open: bookings.filter((b) => b.statusNorm === "new").length,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
