import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutOk } from "./toolResult.js";

test("withoutOk drops the ok flag and keeps the rest", () => {
  assert.deepEqual(withoutOk({ ok: true, file: "a.mp3", durationSec: 2 }), { file: "a.mp3", durationSec: 2 });
});

test("withoutOk tolerates null and undefined", () => {
  assert.deepEqual(withoutOk(null), {});
  assert.deepEqual(withoutOk(undefined), {});
});

test("withoutOk returns a copy and does not mutate its input", () => {
  const body = Object.freeze({ ok: true, items: [1] });
  const result = withoutOk(body);
  assert.notEqual(result, body);
  assert.equal(body.ok, true);
  assert.equal("ok" in result, false);
});
