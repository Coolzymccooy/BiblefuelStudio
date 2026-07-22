import assert from "node:assert/strict";
import test from "node:test";
import { planBeatSyncedHighlights } from "./beatSync.js";

test("planBeatSyncedHighlights picks high-energy windows with spacing", () => {
  const windows = [
    { startSec: 0, durationSec: 4, energy: 0.2 },
    { startSec: 4, durationSec: 4, energy: 0.95 },
    { startSec: 8, durationSec: 4, energy: 0.93 },
    { startSec: 20, durationSec: 4, energy: 0.8 },
    { startSec: 32, durationSec: 4, energy: 0.7 },
  ];

  const plan = planBeatSyncedHighlights(windows, { count: 3, minSpacingSec: 8 });

  assert.deepEqual(plan.map((w) => w.startSec), [4, 20, 32]);
  assert.ok(plan[0].label.includes("high-energy"));
});
