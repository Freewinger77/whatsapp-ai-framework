import assert from "node:assert/strict";
import test from "node:test";
import { latestFirst, type EnquiryRow } from "./dashboard-model";

test("latestFirst puts newest enquiries at the top", () => {
  const rows = [
    { smt_id: "1", name: "Old", phone: null, channel: "email", in_hours: true, enquired_at: "2026-06-01T10:00:00.000Z" },
    { smt_id: "2", name: "New", phone: null, channel: "phone", in_hours: false, enquired_at: "2026-09-06T10:00:00.000Z" },
    { smt_id: "3", name: "Mid", phone: null, channel: "email", in_hours: true, enquired_at: "2026-08-01T10:00:00.000Z" },
  ] as EnquiryRow[];
  assert.deepEqual(
    latestFirst(rows).map((r) => r.smt_id),
    ["2", "3", "1"],
  );
});
