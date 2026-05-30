import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectBackgroundsForScript,
  resolveAutoBackgrounds,
} from "../../src/lib/autoBackground.js";

// A small pool with clearly distinct moods so mood-matching is deterministic.
const mtn = { id: "mtn1", categories: ["mountain"] };
const mtn2 = { id: "mtn2", categories: ["mountain"] };
const sea = { id: "sea1", categories: ["ocean"] };
const sky = { id: "sky1", categories: ["sky", "hope"] };

test("returns one background per non-empty script beat", () => {
  const script = {
    hook: "mountain strength",
    verse: "still waters by the ocean",
    reflection: "morning light brings hope",
    cta: "pray today",
  };
  const { backgrounds, beats } = selectBackgroundsForScript({
    pool: [mtn, sea, sky, mtn2],
    script,
  });
  assert.equal(beats.length, 4, "four non-empty beats derived");
  assert.equal(backgrounds.length, 4, "one background picked per beat");
});

test("empty pool yields empty backgrounds (signals AI-generate fallback)", () => {
  const { backgrounds } = selectBackgroundsForScript({
    pool: [],
    script: { hook: "mountain strength" },
  });
  assert.deepEqual(backgrounds, []);
});

test("picks a mood-matched item for the beat", () => {
  const { backgrounds } = selectBackgroundsForScript({
    pool: [mtn, sea],
    script: { hook: "mountain strength courage" },
  });
  assert.equal(backgrounds[0].id, "mtn1", "mountain beat picks the mountain clip");
});

test("avoids immediately reusing the same clip when alternatives exist", () => {
  // Two same-category beats, two same-category clips: each beat must take a
  // distinct clip so the video doesn't sit on one background.
  const { backgrounds } = selectBackgroundsForScript({
    pool: [mtn, mtn2],
    script: { hook: "mountain", verse: "mountain summit" },
  });
  assert.equal(backgrounds.length, 2);
  assert.notEqual(backgrounds[0].id, backgrounds[1].id);
});

test("caps backgrounds at maxBackgrounds even with more beats", () => {
  const script = {
    hook: "mountain",
    verse: "ocean",
    reflection: "sky hope",
    cta: "pray",
  };
  const { backgrounds } = selectBackgroundsForScript({
    pool: [mtn, sea, sky, mtn2],
    script,
    maxBackgrounds: 2,
  });
  assert.equal(backgrounds.length, 2);
});

test("transcript-only (no script, text provided) picks one mood-matched background", () => {
  const { backgrounds } = selectBackgroundsForScript({
    pool: [mtn, sea],
    text: "ocean waves bring peace and rest",
  });
  assert.equal(backgrounds.length, 1, "flat transcript yields a single background");
  assert.equal(backgrounds[0].id, "sea1", "ocean transcript picks the ocean clip");
});

test("non-empty pool with no script and no text still picks one background", () => {
  const { backgrounds } = selectBackgroundsForScript({ pool: [mtn] });
  assert.equal(backgrounds.length, 1);
  assert.equal(backgrounds[0].id, "mtn1");
});

// resolveAutoBackgrounds: turns a pool + script into concrete background
// identifiers the render route can resolve, falling back to AI image
// generation when the pool is empty. generateImage is injected for testability.

test("resolveAutoBackgrounds returns library ids and does not generate when pool has items", async () => {
  let generateCalls = 0;
  const result = await resolveAutoBackgrounds({
    pool: [mtn, sea],
    script: { hook: "mountain strength" },
    generateImage: async () => {
      generateCalls += 1;
      return { ok: true, path: "/outputs/x.png" };
    },
  });
  assert.equal(result.source, "library");
  assert.deepEqual(result.backgroundIds, ["mtn1"]);
  assert.equal(generateCalls, 0, "must not spend money generating when pool is usable");
});

test("resolveAutoBackgrounds falls back to AI generation on empty pool", async () => {
  const result = await resolveAutoBackgrounds({
    pool: [],
    script: { hook: "mountain strength", verse: "be strong and courageous" },
    generateImage: async () => ({ ok: true, path: "/outputs/gen/part-1.png" }),
  });
  assert.equal(result.source, "generated");
  assert.deepEqual(result.backgroundIds, ["/outputs/gen/part-1.png"]);
});

test("resolveAutoBackgrounds reports an error when pool empty and generation unavailable", async () => {
  const result = await resolveAutoBackgrounds({
    pool: [],
    script: { hook: "mountain strength" },
    generateImage: async () => ({ ok: false, skipped: true, error: "image gen disabled" }),
  });
  assert.equal(result.source, "none");
  assert.deepEqual(result.backgroundIds, []);
  assert.match(result.error, /add a background|image gen/i);
});
