import { test, describe, afterEach, beforeEach } from "node:test";
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
// Every test is offline, including cast-only tests (never use real API keys).
beforeEach(() => _setLlmImpl(async () => null));

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
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible", targetSec: 20 });
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
    const scenes = await segmentScenes({ words: WORDS, style: "heavenly-atmosphere", targetSec: 30 });
    assert.ok(scenes[0].imagePrompt.startsWith("a lamp"));
    assert.ok(/heavenly/i.test(scenes[0].imagePrompt));
  });

  test("rejects out-of-range word indices without clamping them into validity", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [{ text: "x", startWordIndex: -5, endWordIndex: 999, imagePrompt: "p" }] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes[0].startMs, WORDS[0].startMs);
    assert.equal(scenes.at(-1).endMs, WORDS.at(-1).endMs);
    assert.ok(scenes.every((s) => !s.imagePrompt.startsWith("p,")));
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
    assertPartition(scenes, longWords, 60);
    assert.ok(displaySpans(scenes).every((s) => s <= 1.5 * (1799.9 / 60) + 0.5));
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

  test("rejects an LLM split that stops early and leaves most of the audio without scenes", async () => {
    // A 14-minute narration (2000 words at 0.42 s each ≈ 840 s). The LLM,
    // told to cut ~150 s scenes, returns 10 tiny scenes over the first 2
    // minutes and simply stops — the operator's first long-form run. The old
    // code accepted it (10 <= cap) and the renderer then held the last image
    // for the remaining 12 minutes.
    const longWords = Array.from({ length: 2000 }, (_, i) => ({ text: `w${i}`, startMs: i * 420, endMs: i * 420 + 400 }));
    _setLlmImpl(async () => JSON.stringify({
      scenes: Array.from({ length: 10 }, (_, i) => ({ text: `s${i}`, startWordIndex: i * 30, endWordIndex: i * 30 + 29, imagePrompt: `p${i}` })),
    }));
    const scenes = await segmentScenes({ words: longWords, style: "cinematic-bible", targetSec: 150, maxScenes: 12 });
    assert.ok(scenes.length >= 5 && scenes.length <= 12, `expected 5-12 widened scenes, got ${scenes.length}`);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[scenes.length - 1].endMs, longWords[longWords.length - 1].endMs, "scenes cover the whole narration");
    for (let i = 1; i < scenes.length; i++) assert.ok(scenes[i].startMs >= scenes[i - 1].endMs, "scenes are in order");
  });

  test("tells the LLM the total word count and that every word must be covered", async () => {
    let prompt = "";
    _setLlmImpl(async (p) => { prompt = p; return null; });
    await segmentScenes({ words: WORDS, style: "cinematic-bible", targetSec: 10 });
    assert.match(prompt, /\b0\b.*\b29\b/s, "prompt states the full index range");
    assert.match(prompt, /every word|all \d+ words|cover/i);
  });

  test("short audio is unaffected — honours the LLM's scene split", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [
        { text: "a", startWordIndex: 0, endWordIndex: 14, imagePrompt: "p1" },
        { text: "b", startWordIndex: 15, endWordIndex: 29, imagePrompt: "p2" },
      ] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible", targetSec: 10 });
    assert.equal(scenes.length, 2);
  });

  test("parses clean JSON even when LLM wraps it in prose/fences", async () => {
    _setLlmImpl(async () =>
      "```json\n{\"scenes\":[{\"text\":\"x\",\"startWordIndex\":0,\"endWordIndex\":29,\"imagePrompt\":\"p\"}]}\n```",
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible", targetSec: 30 });
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

function regularWords(count, durationMs = count * 1000) {
  return Array.from({ length: count }, (_, i) => ({
    text: `w${i}`, startMs: i * durationMs / count, endMs: (i + 1) * durationMs / count,
  }));
}

function assertPartition(scenes, words, cap = Infinity) {
  assert.ok(scenes.length > 0 && scenes.length <= cap, `scene count ${scenes.length} <= ${cap}`);
  let next = 0;
  for (const s of scenes) {
    const tokens = s.text.split(" ");
    assert.equal(s.text, words.slice(next, next + tokens.length).map((w) => w.text).join(" "));
    assert.equal(s.startMs, words[next].startMs);
    next += tokens.length;
    assert.equal(s.endMs, words[next - 1].endMs);
  }
  assert.equal(next, words.length, "every input word appears exactly once and in order");
}

function displaySpans(scenes) {
  return scenes.map((s, i) => ((scenes[i + 1]?.startMs ?? s.endMs)
    - (i === 0 ? 0 : s.startMs)) / 1000);
}

function stubRanges(ranges) {
  _setLlmImpl(async () => JSON.stringify({ scenes: ranges.map(([startWordIndex, endWordIndex]) => ({
    startWordIndex, endWordIndex, text: "invented paraphrase", imagePrompt: "LLM_ACCEPTED_MARKER",
  })) }));
}

// 200 words: ten omitted interior words were only 5% of the recording, so
// the former 90%-duration check accepted them. Overlap could hide still more.
for (const [name, ranges] of [
  ["ten-word interior omission", [[0, 89], [100, 199]]],
  ["overlap masking a gap", [[0, 99], [90, 139], [150, 199]]],
  ["out-of-order ranges", [[100, 199], [0, 99]]],
  ["omitted tail within former five-percent tolerance", [[0, 194]]],
  ["negative index", [[-1, 199]]],
  ["index beyond final word", [[0, 200]]],
  ["fractional index", [[0, 99.5], [100, 199]]],
  ["numeric string index", [["0", 199]]],
  ["null index", [[null, 199]]],
  ["reversed range", [[0, 99], [150, 100], [151, 199]]],
]) {
  test(`rejects ${name} before normalization`, async () => {
    const words = regularWords(200);
    stubRanges(ranges);
    // Large target isolates partition validity from display-span rejection.
    const scenes = await segmentScenes({ words, style: "cinematic-bible", targetSec: 200 });
    assertPartition(scenes, words);
    assert.ok(scenes.every((s) => !s.imagePrompt.includes("LLM_ACCEPTED_MARKER")));
  });
}

test("valid LLM ranges use verbatim tokens, not paraphrased scene text", async () => {
  const words = regularWords(4, 4000).map((w, i) => ({ ...w, text: ["Don't", "CHANGE,", "café", "amen!"][i] }));
  stubRanges([[0, 1], [2, 3]]);
  const scenes = await segmentScenes({ words, style: "cinematic-bible" });
  assert.deepEqual(scenes.map((s) => s.text), ["Don't CHANGE,", "café amen!"]);
  assert.ok(scenes.every((s) => s.imagePrompt.includes("LLM_ACCEPTED_MARKER")));
});

test("rejects exact-coverage 8/8/8/76s split and balances the final scene", async () => {
  const words = regularWords(100);
  stubRanges([[0, 7], [8, 15], [16, 23], [24, 99]]);
  const scenes = await segmentScenes({ words, style: "cinematic-bible", maxScenes: 13 });
  assertPartition(scenes, words, 13);
  assert.ok(displaySpans(scenes).every((s) => s <= 12.5));
  assert.ok(scenes.every((s) => !s.imagePrompt.includes("LLM_ACCEPTED_MARKER")));
});

test("54.264s narration falls back to seven balanced scenes, none above 12.5s", async () => {
  const words = regularWords(140, 54264);
  stubRanges([[0, 19], [20, 39], [40, 59], [60, 79], [80, 99], [100, 104], [105, 139]]);
  const scenes = await segmentScenes({ words, style: "cinematic-bible", maxScenes: 7 });
  assertPartition(scenes, words, 7);
  assert.equal(scenes.length, 7);
  assert.ok(displaySpans(scenes).every((s) => s <= 12.5));
});

test("display bound includes inter-word silence, not just each scene's spoken span", async () => {
  const words = [
    { text: "w0", startMs: 0, endMs: 1000 },
    { text: "w1", startMs: 1000, endMs: 2000 },
    { text: "w2", startMs: 30000, endMs: 31000 },
    { text: "w3", startMs: 31000, endMs: 32000 },
  ];
  stubRanges([[0, 1], [2, 3]]); // first spoken span is 2s; display span is 30s
  const scenes = await segmentScenes({ words, style: "cinematic-bible" });
  assertPartition(scenes, words);
  assert.ok(scenes.every((s) => !s.imagePrompt.includes("LLM_ACCEPTED_MARKER")));
  for (const [i, span] of displaySpans(scenes).entries()) {
    if (span > 12.5) assert.equal(scenes[i].text, "w1", "only the indivisible silence cell may exceed bound");
  }
});

test("counts leading silence in display duration and isolates an indivisible long word", async () => {
  const words = [
    { text: "w0", startMs: 20000, endMs: 20100 },
    { text: "w1", startMs: 21000, endMs: 21100 },
    { text: "w2", startMs: 22000, endMs: 50000 },
  ];
  stubRanges([[0, 2]]);
  const scenes = await segmentScenes({ words, style: "cinematic-bible" });
  assertPartition(scenes, words);
  assert.deepEqual(scenes.map((s) => s.text), ["w0", "w1", "w2"]);
  assert.deepEqual(displaySpans(scenes), [21, 1, 28]);
});

test("fallback does not strand cap+1 final words on irregular timings", async () => {
  // Old fallback consumed two exact 8s windows, then emitted a third scene
  // for a final zero-duration word. Such words occur in imperfect transcripts.
  const words = [[0, 4000], [4000, 8000], [8000, 16000], [16000, 16000]]
    .map(([startMs, endMs], i) => ({ text: `w${i}`, startMs, endMs }));
  const scenes = await segmentScenes({ words, style: "cinematic-bible", targetSec: 8, maxScenes: 2 });
  assertPartition(scenes, words, 2);
  assert.ok(displaySpans(scenes).every((s) => s <= 12.5));
});

test("zero-duration transcript still requires an exact ordered word partition", async () => {
  const words = regularWords(10, 0);
  stubRanges([[0, 8]]);
  const scenes = await segmentScenes({ words, style: "cinematic-bible", maxScenes: 1 });
  assertPartition(scenes, words, 1);
  assert.ok(scenes.every((s) => !s.imagePrompt.includes("LLM_ACCEPTED_MARKER")));
});

test("valid LLM singleton silence exception is accepted without attaching neighbors", async () => {
  const words = [
    { text: "w0", startMs: 0, endMs: 1000 },
    { text: "w1", startMs: 30000, endMs: 31000 },
  ];
  stubRanges([[0, 0], [1, 1]]);
  const scenes = await segmentScenes({ words, style: "cinematic-bible" });
  assertPartition(scenes, words);
  assert.ok(scenes.every((s) => s.imagePrompt.includes("LLM_ACCEPTED_MARKER")));
  assert.deepEqual(displaySpans(scenes), [30, 1]);
});

test("sparse boundaries widen effective target minimally only when the budget requires it", async () => {
  const words = regularWords(5, 80000); // five indivisible 16s cells, four images
  let prompt;
  _setLlmImpl(async (p) => { prompt = p; return null; });
  const scenes = await segmentScenes({ words, style: "cinematic-bible", maxScenes: 4 });
  assertPartition(scenes, words, 4);
  assert.ok(displaySpans(scenes).every((s) => s <= 32));
  const effective = Number(prompt.match(/each about ([\d.]+) seconds/)[1]);
  assert.ok(effective > 20 && effective <= 21.000001);
});

test("deterministic dense and sparse fallback matrix preserves budget and all words", async () => {
  let seed = 84721;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let sample = 0; sample < 80; sample++) {
    const words = [];
    let time = 0;
    const count = 5 + Math.floor(random() * 150);
    for (let i = 0; i < count; i++) {
      const step = sample % 2 ? 100 + random() * 600 : 100 + random() * 40000;
      words.push({ text: `w${i}`, startMs: time, endMs: time + step });
      time += step;
    }
    const cap = 1 + sample % 12;
    let prompt;
    _setLlmImpl(async (p) => { prompt = p; return null; });
    const scenes = await segmentScenes({ words, style: "cinematic-bible", maxScenes: cap });
    assertPartition(scenes, words, cap);
    const effective = Number(prompt.match(/each about ([\d.]+) seconds/)[1]);
    for (const [i, span] of displaySpans(scenes).entries()) {
      if (span > 1.5 * effective + 0.500001) assert.equal(scenes[i].text.split(" ").length, 1);
    }
  }
});

test("maxScenes override widens scenes beyond the env cap", async () => {
  _setLlmImpl(async () => { throw new Error("no llm"); }); // force fallbackRanges
  const words = Array.from({ length: 600 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: (i + 1) * 1000 })); // 600s
  const scenes = await segmentScenes({ words, style: "cinematic-bible", targetSec: 8, maxScenes: 6 });
  assert.ok(scenes.length <= 6, `expected ≤6 scenes, got ${scenes.length}`);
});
