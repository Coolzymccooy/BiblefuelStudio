import { test } from "node:test";
import assert from "node:assert/strict";

import { get, list } from "../../src/lib/voice/index.js";

/**
 * voice/index.js registers the built-in providers as an import side-effect.
 * Registration order is the orchestrator's default fallback priority, so we
 * assert Fish slots in right after ElevenLabs (premium → premium-alternative).
 */

test("fish provider is registered via voice/index.js", () => {
  const fish = get("fish");
  assert.ok(fish, "fish provider should be registered");
  assert.equal(fish.id, "fish");
});

test("fish is ordered immediately after elevenlabs", () => {
  const ids = list().map((p) => p.id);
  const elevenIdx = ids.indexOf("elevenlabs");
  const fishIdx = ids.indexOf("fish");
  assert.ok(elevenIdx >= 0, "elevenlabs should be registered");
  assert.ok(fishIdx >= 0, "fish should be registered");
  assert.equal(fishIdx, elevenIdx + 1);
});
