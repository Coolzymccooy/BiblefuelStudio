import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LONGFORM_TEMPLATES, longformTemplateById, wordBudget } from "./templates.js";

describe("longform templates", () => {
  test("ships sleep-30 and sleep-60 with landscape-safe scene policies", () => {
    const ids = LONGFORM_TEMPLATES.map((t) => t.id);
    assert.deepEqual(ids, ["sleep-30", "sleep-60"]);
    for (const t of LONGFORM_TEMPLATES) {
      assert.equal(t.kind, "sleep");
      assert.equal(t.scene.captions, "none");
      assert.ok(t.scene.maxScenes >= 8 && t.scene.maxScenes <= 16);
      assert.ok(t.voice.pauseMs >= 3000);
      assert.ok(t.voice.maxChunkChars >= 300 && t.voice.maxChunkChars <= 4500);
      assert.equal(t.music.autoDuck, false);
      // Long-form narration is ~20 provider calls; Azure answers in seconds where
      // CPU Chatterbox takes minutes per call. Chatterbox stays as a last resort.
      assert.deepEqual(t.voice.preferredProviders, ["azure", "edge", "chatterbox"]);
    }
  });
  test("sleep-60 is twice sleep-30", () => {
    assert.equal(longformTemplateById("sleep-30").targetSec, 1800);
    assert.equal(longformTemplateById("sleep-60").targetSec, 3600);
  });
  test("unknown id returns null", () => {
    assert.equal(longformTemplateById("nope"), null);
  });
  test("wordBudget follows wpm and target seconds", () => {
    const t = longformTemplateById("sleep-30");
    assert.equal(wordBudget(t), Math.round(1800 / 60 * t.wpm));
    assert.equal(wordBudget(t, 60), t.wpm);
  });
});
