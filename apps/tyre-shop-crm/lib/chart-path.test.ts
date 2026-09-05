import assert from "node:assert/strict";
import test from "node:test";
import { areaUnder, catmullRomPath } from "./chart-path";

test("catmull-rom starts at the first sample and ends at the last", () => {
  const d = catmullRomPath([0, 0, 1, 3, 0, 3, 0]);
  assert.match(d, /^M 0 /);
  assert.match(d, /640 /);
  assert.ok(d.includes(" C "));
});

test("area under closes to the baseline", () => {
  const d = areaUnder(catmullRomPath([1, 2, 1]));
  assert.match(d, /L 640 134 L 0 134 Z$/);
});
