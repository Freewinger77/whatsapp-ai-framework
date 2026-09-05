import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardSeries,
  lastLondonDays,
  londonDateKey,
  londonDayLabel,
  pct,
  pctChange,
  shiftDateKey,
} from "./analytics-series";

describe("london calendar helpers", () => {
  it("keys a BST afternoon as the London calendar day", () => {
    assert.equal(londonDateKey("2026-09-04T17:02:00+01:00"), "2026-09-04");
  });

  it("labels weekdays from a date key", () => {
    assert.equal(londonDayLabel("2026-09-05"), "Sat");
    assert.equal(londonDayLabel("2026-08-30"), "Sun");
  });

  it("fills the last 7 London days ending today", () => {
    const days = lastLondonDays(7, new Date("2026-09-05T12:00:00+01:00"));
    assert.deepEqual(days, [
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("shifts a date key across month boundaries", () => {
    assert.equal(shiftDateKey("2026-09-01", -1), "2026-08-31");
  });
});

describe("percent helpers", () => {
  it("rounds one decimal and returns null when the whole is zero", () => {
    assert.equal(pct(8, 19), 42.1);
    assert.equal(pct(0, 0), null);
  });

  it("computes period change", () => {
    assert.equal(pctChange(12, 10), 20);
    assert.equal(pctChange(0, 0), 0);
    assert.equal(pctChange(5, 0), null);
  });
});

describe("buildDashboardSeries", () => {
  it("buckets leads, phones, emails, customers and after-hours share", () => {
    const now = new Date("2026-09-05T18:00:00+01:00");
    const built = buildDashboardSeries(
      7,
      [
        { at: "2026-09-01T10:00:00+01:00", inHours: true, channel: "email" },
        { at: "2026-09-01T20:00:00+01:00", inHours: false, channel: "phone" },
        { at: "2026-09-02T21:00:00+01:00", inHours: false, channel: "email" },
        { at: "2026-08-25T11:00:00+01:00", inHours: true, channel: "email" },
      ],
      [
        { firstSeenAt: "2026-09-03T09:30:00+01:00" },
        { firstSeenAt: "2026-08-26T09:30:00+01:00" },
      ],
      275,
      now,
    );

    assert.equal(built.mix.leads, 3);
    assert.equal(built.mix.email, 2);
    assert.equal(built.mix.phone, 1);
    assert.equal(built.mix.customers, 1);
    assert.equal(built.mix.inHours, 1);
    assert.equal(built.mix.outHours, 2);
    assert.equal(built.pct.afterHours, 66.7);
    assert.equal(built.pct.phoneOfLeads, 33.3);
    assert.equal(built.pct.vsPrevious.leads, 200);
    assert.equal(built.pct.vsPrevious.customers, 0);
    assert.equal(built.series.find((d) => d.date === "2026-09-01")?.phone, 1);
    assert.equal(built.series.length, 7);
  });
});
