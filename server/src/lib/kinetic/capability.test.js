import { test } from "node:test";
import assert from "node:assert/strict";
import { hasLibass, _setLibassForTest } from "./capability.js";

test("hasLibass answers a boolean and caches it", () => {
  _setLibassForTest(undefined);
  const first = hasLibass();
  assert.equal(typeof first, "boolean");
  assert.equal(hasLibass(), first);
});

test("the answer can be pinned for tests", () => {
  _setLibassForTest(false);
  assert.equal(hasLibass(), false);
  _setLibassForTest(true);
  assert.equal(hasLibass(), true);
  _setLibassForTest(undefined);
});
