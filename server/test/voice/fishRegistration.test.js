import { test } from "node:test";
import assert from "node:assert/strict";

import { get, list } from "../../src/lib/voice/index.js";

/**
 * voice/index.js registers the built-in providers as an import side-effect.
 * Registration order is the orchestrator's default fallback priority. Fish
 * sits in the premium tier (after ElevenLabs and Azure) and ahead of the free
 * Edge/Chatterbox tail.
 */

test("fish provider is registered via voice/index.js", () => {
  const fish = get("fish");
  assert.ok(fish, "fish provider should be registered");
  assert.equal(fish.id, "fish");
});

test("fish is in the premium tier — after elevenlabs, ahead of edge/chatterbox", () => {
  const ids = list().map((p) => p.id);
  const elevenIdx = ids.indexOf("elevenlabs");
  const fishIdx = ids.indexOf("fish");
  const edgeIdx = ids.indexOf("edge");
  assert.ok(elevenIdx >= 0, "elevenlabs should be registered");
  assert.ok(fishIdx > elevenIdx, "fish after elevenlabs");
  if (edgeIdx >= 0) assert.ok(fishIdx < edgeIdx, "fish ahead of edge");
});
