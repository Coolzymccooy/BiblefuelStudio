import { test } from "node:test";
import assert from "node:assert/strict";

import { get, list } from "../../src/lib/voice/index.js";

/**
 * Azure registers as the timestamp-primary provider. It sits after ElevenLabs
 * (which stays the flagship default for plain renders) and before Fish in the
 * registration chain; the orchestrator promotes Azure ahead of ElevenLabs only
 * when withTimestamps is requested (word > char ranking).
 */

test("azure provider is registered via voice/index.js", () => {
  const azure = get("azure");
  assert.ok(azure, "azure provider should be registered");
  assert.equal(azure.id, "azure");
});

test("registration order: elevenlabs < azure < fish", () => {
  const ids = list().map((p) => p.id);
  assert.ok(ids.indexOf("elevenlabs") >= 0, "elevenlabs registered");
  assert.ok(ids.indexOf("azure") > ids.indexOf("elevenlabs"), "azure after elevenlabs");
  assert.ok(ids.indexOf("fish") > ids.indexOf("azure"), "fish after azure");
});
