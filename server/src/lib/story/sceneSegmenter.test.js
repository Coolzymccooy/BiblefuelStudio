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
