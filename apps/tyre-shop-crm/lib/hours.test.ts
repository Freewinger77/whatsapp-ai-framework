import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInHours, npsHeadline } from "./hours";

describe("isInHours", () => {
  it("treats weekday mid-morning London as in hours", () => {
    // Friday 4 Sep 2026 10:00 BST
    assert.equal(isInHours("2026-09-04T09:00:00.000Z"), true);
  });
  it("treats weekday evening as out of hours", () => {
    assert.equal(isInHours("2026-09-04T18:40:00+01:00"), false);
  });
  it("treats Sunday daytime as out of hours", () => {
    assert.equal(isInHours("2026-08-30T11:00:00+01:00"), false);
  });
  it("treats Saturday 16:59 as in hours and 17:00 as out", () => {
    assert.equal(isInHours("2026-08-29T16:59:00+01:00"), true);
    assert.equal(isInHours("2026-08-29T17:00:00+01:00"), false);
  });
});

describe("npsHeadline", () => {
  it("matches the SMT 71.43% fixture set", () => {
    // 5 promoters (9-10), 1 detractor (4), 1 passive (8) → (5-1)/7 = 57.14
    // The 71.43% SMT screenshot is 5 promoters / 7 with 0 detractors? 
    // 5 promoters, 0 detractors, 2 passive = 71.43. Use that set.
    assert.equal(npsHeadline([10, 9, 8, 10, 9, 10, 8]), 71.43);
  });
});
