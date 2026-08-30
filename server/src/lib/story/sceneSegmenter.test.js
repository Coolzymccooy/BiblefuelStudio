import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  segmentScenes,
  _setLlmImpl,
  _resetLlmImpl,
} from "./sceneSegmenter.js";

const WORDS = Array.from({ length: 30 }, (_, i) => ({
  text: `w${i}`,
  startMs: i * 1000,
  endMs: i * 1000 + 900,
}));

afterEach(() => _resetLlmImpl());

describe("segmentScenes", () => {
  test("derives scene timings from word indices, never from the LLM", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({
        scenes: [
          { text: "first", startWordIndex: 0, endWordIndex: 9, imagePrompt: "a sunrise" },
          { text: "second", startWordIndex: 10, endWordIndex: 29, imagePrompt: "a valley" },
        ],
      }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[0].endMs, WORDS[9].endMs);
    assert.equal(scenes[1].startMs, WORDS[10].startMs);
    assert.equal(scenes[1].endMs, WORDS[29].endMs);
  });

  test("appends the style anchor to every image prompt", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [{ text: "x", startWordIndex: 0, endWordIndex: 29, imagePrompt: "a lamp" }] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "heavenly-atmosphere" });
    assert.ok(scenes[0].imagePrompt.startsWith("a lamp"));
    assert.ok(/heavenly/i.test(scenes[0].imagePrompt));
  });

  test("clamps out-of-range word indices instead of crashing", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [{ text: "x", startWordIndex: -5, endWordIndex: 999, imagePrompt: "p" }] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes[0].startMs, WORDS[0].startMs);
    assert.equal(scenes[0].endMs, WORDS[WORDS.length - 1].endMs);
  });

  test("falls back to fixed windows when the LLM returns invalid JSON", async () => {
    _setLlmImpl(async () => "not json at all");
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible", targetSec: 8 });
    assert.ok(scenes.length >= 3 && scenes.length <= 5);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[scenes.length - 1].endMs, WORDS[WORDS.length - 1].endMs);
    for (const s of scenes) assert.ok(s.imagePrompt.length > 0);
  });

  test("falls back when the LLM throws", async () => {
    _setLlmImpl(async () => { throw new Error("network down"); });
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.ok(scenes.length >= 1);
  });

  test("each scene gets a unique id and covers contiguous words", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({
        scenes: [
          { text: "a", startWordIndex: 0, endWordIndex: 14, imagePrompt: "p1" },
          { text: "b", startWordIndex: 15, endWordIndex: 29, imagePrompt: "p2" },
        ],
      }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes[0].id, "scene-001");
    assert.equal(scenes[1].id, "scene-002");
    assert.equal(scenes[0].endMs <= scenes[1].startMs, true);
  });

  test("empty words -> empty scenes (no throw)", async () => {
    const scenes = await segmentScenes({ words: [], style: "cinematic-bible" });
    assert.deepEqual(scenes, []);
  });

  // Long audio (e.g. a 30-min sermon/voice memo) must NOT produce one ~8s
  // scene per beat — that would demand ~200 sequential AI image generations
  // (≈45min, and blows the daily image-gen quota). Scenes are widened so the
  // count stays bounded: fewer, longer scenes.
  test("caps scene count for long audio by widening scenes (fallback path)", async () => {
    const longWords = Array.from({ length: 1800 }, (_, i) => ({
      text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 900,
    })); // 30 minutes @ 1 word/sec
    _setLlmImpl(async () => null); // force the duration-based fallback
    const scenes = await segmentScenes({ words: longWords, style: "cinematic-bible" });
    assert.ok(scenes.length <= 60, `expected <= 60 scenes, got ${scenes.length}`);
    assert.ok(scenes.length >= 20, `expected scenes to still span the audio, got ${scenes.length}`);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[scenes.length - 1].endMs, longWords[longWords.length - 1].endMs);
  });

  test("rejects LLM output that exceeds the scene cap and uses bounded fallback", async () => {
    const longWords = Array.from({ length: 1800 }, (_, i) => ({
      text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 900,
    }));
    // LLM ignores the target and returns 200 tiny ~8s scenes — over the cap.
    _setLlmImpl(async () => JSON.stringify({
      scenes: Array.from({ length: 200 }, (_, i) => ({
        text: `s${i}`, startWordIndex: i * 9, endWordIndex: i * 9 + 8, imagePrompt: `p${i}`,
      })),
    }));
    const scenes = await segmentScenes({ words: longWords, style: "cinematic-bible" });
    assert.ok(scenes.length <= 60, `expected <= 60 scenes, got ${scenes.length}`);
  });

  test("short audio is unaffected — honours the LLM's scene split", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [
        { text: "a", startWordIndex: 0, endWordIndex: 14, imagePrompt: "p1" },
        { text: "b", startWordIndex: 15, endWordIndex: 29, imagePrompt: "p2" },
      ] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes.length, 2);
  });

  test("parses clean JSON even when LLM wraps it in prose/fences", async () => {
    _setLlmImpl(async () =>
      "```json\n{\"scenes\":[{\"text\":\"x\",\"startWordIndex\":0,\"endWordIndex\":29,\"imagePrompt\":\"p\"}]}\n```",
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[0].endMs, WORDS[WORDS.length - 1].endMs);
  });
});

describe("character anchors in scene prompts", () => {
  const words = [
    { text: "David", startMs: 0, endMs: 400 },
    { text: "faced", startMs: 400, endMs: 800 },
    { text: "the", startMs: 800, endMs: 1000 },
    { text: "giant", startMs: 1000, endMs: 1600 },
  ];

  test("appends the project cast so a recurring figure stays consistent", async () => {
    const scenes = await segmentScenes({ words, style: "cinematic-bible", cast: ["david_young"] });
    assert.ok(scenes.length > 0);
    for (const s of scenes) {
      assert.match(s.imagePrompt, /young shepherd boy/i,
        "every scene must carry the cast description, or the character drifts between scenes");
    }
  });

  test("still appends the style anchor alongside the cast", async () => {
    const scenes = await segmentScenes({ words, style: "cinematic-bible", cast: ["david_young"] });
    assert.match(scenes[0].imagePrompt, /cinematic biblical scene/i);
  });

  test("orders subject before character before style", async () => {
    const scenes = await segmentScenes({ words, style: "cinematic-bible", cast: ["david_young"] });
    const p = scenes[0].imagePrompt;
    assert.ok(p.indexOf("shepherd boy") < p.indexOf("cinematic biblical"),
      "style anchor must close the prompt");
  });

  test("behaves exactly as before when no cast is given", async () => {
    const withCast = await segmentScenes({ words, style: "cinematic-bible", cast: [] });
    const without = await segmentScenes({ words, style: "cinematic-bible" });
    assert.equal(withCast[0].imagePrompt, without[0].imagePrompt);
    assert.doesNotMatch(without[0].imagePrompt, /shepherd boy/i);
  });

  test("ignores unknown cast keys rather than injecting empty text", async () => {
    const scenes = await segmentScenes({ words, style: "cinematic-bible", cast: ["gandalf"] });
    assert.doesNotMatch(scenes[0].imagePrompt, /,\s*,/, "no empty prompt segments");
  });

  test("supports several characters in one scene", async () => {
    const scenes = await segmentScenes({ words, style: "cinematic-bible", cast: ["david_young", "goliath"] });
    assert.match(scenes[0].imagePrompt, /shepherd boy/i);
    assert.match(scenes[0].imagePrompt, /armoured warrior/i);
  });
});
