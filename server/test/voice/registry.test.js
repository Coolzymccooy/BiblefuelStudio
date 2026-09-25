import { test } from "node:test";
import assert from "node:assert/strict";

import {
  register,
  get,
  list,
  listAvailable,
  _reset,
} from "../../src/lib/voice/registry.js";

function makeFakeProvider(overrides = {}) {
  return {
    id: "fake",
    isAvailable: () => true,
    capabilities: () => ({
      wordTimestamps: false,
      charTimestamps: false,
      emotionControls: false,
      ssml: false,
      streaming: false,
    }),
    synthesize: async () => ({
      ok: true,
      file: "/tmp/x.mp3",
      provider: "fake",
      voice: "v",
    }),
    ...overrides,
  };
}

test("register + get round-trip", () => {
  _reset();
  const p = makeFakeProvider({ id: "a" });
  register(p);
  assert.equal(get("a"), p);
});

test("list preserves registration order", () => {
  _reset();
  register(makeFakeProvider({ id: "a" }));
  register(makeFakeProvider({ id: "b" }));
  register(makeFakeProvider({ id: "c" }));
  assert.deepEqual(
    list().map((p) => p.id),
    ["a", "b", "c"],
  );
});

test("listAvailable filters by isAvailable()", () => {
  _reset();
  register(makeFakeProvider({ id: "yes", isAvailable: () => true }));
  register(makeFakeProvider({ id: "no", isAvailable: () => false }));
  register(makeFakeProvider({ id: "throws", isAvailable: () => { throw new Error("boom"); } }));
  assert.deepEqual(
    listAvailable().map((p) => p.id),
    ["yes"],
  );
});

test("re-registering same id replaces existing entry", () => {
  _reset();
  const first = makeFakeProvider({ id: "x", capabilities: () => ({
    wordTimestamps: false, charTimestamps: false, emotionControls: false, ssml: false, streaming: false,
  }) });
  const second = makeFakeProvider({ id: "x", capabilities: () => ({
    wordTimestamps: true, charTimestamps: false, emotionControls: false, ssml: false, streaming: false,
  }) });
  register(first);
  register(second);
  assert.equal(list().length, 1);
  assert.equal(get("x"), second);
});

test("register rejects malformed provider", () => {
  _reset();
  assert.throws(() => register(null), /provider must be an object/);
  assert.throws(
    () => register({ isAvailable: () => true, capabilities: () => ({}), synthesize: () => {} }),
    /provider\.id required/,
  );
  assert.throws(
    () => register({ id: "x", capabilities: () => ({}), synthesize: () => {} }),
    /isAvailable\(\) required/,
  );
  assert.throws(
    () => register({ id: "x", isAvailable: () => true, synthesize: () => {} }),
    /capabilities\(\) required/,
  );
  assert.throws(
    () => register({ id: "x", isAvailable: () => true, capabilities: () => ({
      wordTimestamps: false, charTimestamps: false, emotionControls: false, ssml: false, streaming: false,
    }) }),
    /synthesize\(\) required/,
  );
});

test("register rejects invalid capabilities shape", () => {
  _reset();
  assert.throws(
    () => register(makeFakeProvider({ capabilities: () => ({ wordTimestamps: "yes" }) })),
    /invalid capabilities/,
  );
});
