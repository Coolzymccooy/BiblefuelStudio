import { test } from "node:test";
import assert from "node:assert/strict";

const { capMessage } = await import("./registry.js");
const { joinSplitReference } = await import("./prompts.js");

test("a fractional cap prints rounded amounts", () => {
  const text = capMessage({ bucket: "aiVideoUsd", scope: "key", used: 1.7, limit: 2, needed: 0.9 });
  assert.equal(text, "Daily aiVideoUsd cap: this call needs 0.9 but this agent has 0.3 left (1.7 of 2 used).");
});

test("a cap with nothing left says reached, for the account scope too", () => {
  assert.equal(
    capMessage({ bucket: "renders", scope: "user", used: 5, limit: 5, needed: 1 }),
    "Daily renders cap reached for your account across all agents (5 of 5).",
  );
});

test("a split reference is rejoined only when the book part has no number of its own", () => {
  assert.deepEqual(joinSplitReference({ reference: "Romans", voice: "8:28" }), { reference: "Romans 8:28", voice: undefined, publish: undefined });
  assert.deepEqual(joinSplitReference({ reference: "1 John", voice: "4:8" }), { reference: "1 John 4:8", voice: undefined, publish: undefined });
  assert.deepEqual(joinSplitReference({ reference: "Psalm 23", voice: "2" }), { reference: "Psalm 23", voice: "2", publish: undefined });
  assert.deepEqual(joinSplitReference({ reference: "John 3:16", voice: "2" }), { reference: "John 3:16", voice: "2", publish: undefined });
  assert.deepEqual(joinSplitReference({ reference: "John 3:16", voice: "en-US-GuyNeural" }), { reference: "John 3:16", voice: "en-US-GuyNeural", publish: undefined });
});
