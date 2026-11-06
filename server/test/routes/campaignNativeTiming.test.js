import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { toAlignmentContract } from "../../src/lib/voice/alignmentContract.js";
import { annotatePhrasedTiers, groupWordsByBeat } from "../../src/lib/captions.js";
import { cleanCaptionLine, cleanSpeakableText, sanitizeScriptObject } from "../../src/lib/speakableScript.js";
import { buildLineDrawtext, buildSceneGraph, resolveTypographyPreset, resolveCaptionMotion, resolveKineticAnimation } from "../../src/lib/videoFilters.js";
import { splitCaptionLines } from "../../src/lib/captionLines.js";
import { prepareScriptureForSpeech } from "../../src/lib/voice/scripture.js";

// Exercise the actual campaign function without importing the job worker or any
// provider modules. Inject all I/O and stop at the render boundary: no network,
// files, FFmpeg, publishing, quota or real TTS calls are possible in this harness.
const source = fs.readFileSync(new URL("../../src/routes/jobs.js", import.meta.url), "utf8");
const start = source.indexOf("async function runCampaignAutoPost(");
const end = source.indexOf("\nexport function validatePayloadForEnqueue", start);
assert.ok(start >= 0 && end > start, "campaign source boundaries must exist");
assert.match(source, /import \{ toAlignmentContract \} from "\.\.\/lib\/voice\/alignmentContract\.js"/);
const campaignSource = source.slice(start, end);
const narrationSource = source.slice(source.indexOf("async function prepareShortNarration("), source.indexOf("function clampDuration("));
const helperSource = source.slice(source.indexOf("function getDims("), source.indexOf("\nlet running ="));
const coreSource = source.slice(source.indexOf("async function renderVideoCore("), source.indexOf("async function augmentPayloadWithKineticCaptions("));
const advancedSource = source.slice(source.indexOf("async function renderAdvancedVideo("), start);
const script = { hook: "Peace comes.", verse: "Trust God.", reflection: "Rest now.", cta: "Share hope." };
const native = [
  { text: "Peace", startMs: 600, endMs: 900 },
  { text: "comes.", startMs: 1000, endMs: 1020 },
  { text: "Trust", startMs: 2000, endMs: 2400 },
  { text: "God.", startMs: 2500, endMs: 2900 },
  { text: "Rest", startMs: 4000, endMs: 4400 },
  { text: "now.", startMs: 4500, endMs: 4900 },
  { text: "Share", startMs: 5500, endMs: 5800 },
  { text: "hope.", startMs: 6000, endMs: 6500 },
];
const charTiming = (text) => ({
  characters: [...text],
  starts: [...text].map((_, i) => 0.5 + i * 0.1),
  ends: [...text].map((_, i) => 0.55 + i * 0.1),
});

async function run(tts, { category = false, generated = false, generatedImage, probeFails = false, audioDuration = 9, scriptOverride = script, realRenderer = false, refuse = false } = {}) {
  const updates = [];
  const synthesis = [];
  const stop = new Error("render boundary reached");
  let rendered;
  let drawn;
  const synth = (kind) => async (args) => {
    synthesis.push({ kind, args });
    return { file: "synthetic-voice.wav", provider: "azure", ...tts };
  };
  const deps = {
    toAlignmentContract, annotatePhrasedTiers, groupWordsByBeat,
    cleanCaptionLine, cleanSpeakableText, sanitizeScriptObject, splitCaptionLines, prepareScriptureForSpeech,
    buildSceneGraph, resolveTypographyPreset, resolveCaptionMotion, resolveKineticAnimation,
    localiseJobInputs: async (p) => { rendered = p; return p; },
    resolveAssetPath: (p) => p,
    isLocalOrRemote: () => true,
    isFileTooLarge: () => false,
    isRemoteUrl: () => false,
    isStudioLook: () => false,
    currentOutDir: () => "fixture-out",
    uuid: () => "fixture-id",
    path: { join: (...p) => p.join("/") },
    MAX_RENDER_SECONDS: 30,
    prepareStudioCaptions: () => ({ mode: "drawtext" }),
    buildLineDrawtext: (args) => {
      drawn = { args, filter: buildLineDrawtext(args) };
      throw stop;
    },
    defaultTrackRef: () => "fixture-bed",
    safeUpdateJob: (_id, value) => updates.push(value),
    readLibrary: () => ({ items: [{ id: "fixture-bg" }] }),
    currentDataDir: () => "fixture-data",
    pickableLibraryItems: (lib) => lib,
    synthesizeTts: synth("direct"),
    synthesizeForCategory: synth("category"),
    resolveProfile: () => ({ recommendedTypographyPreset: "fixture-preset" }),
    fs: { existsSync: () => true, statSync: () => ({ size: 4096 }) },
    probeAudioDuration: async () => {
      if (probeFails) throw new Error("synthetic probe failure");
      return audioDuration;
    },
    probeAudioMaxVolume: async () => -12,
    console: { log() {}, warn() {} },
    classifyText: () => [],
    pickBestBackground: (pool) => pool[0],
    clampDuration: (n) => n,
    generateScripts: async () => [scriptOverride],
    pickScriptType: () => "peace",
    nextScriptTypeIndex: () => 0,
    renderVideoCore: async (payload) => { rendered = payload; throw stop; },
  };
  if (realRenderer) delete deps.renderVideoCore;
  const campaign = new Function(...Object.keys(deps), `${narrationSource}\n${helperSource}\n${realRenderer ? coreSource + advancedSource : ""}\nreturn (${campaignSource});`)(...Object.values(deps));
  await assert.rejects(campaign({
    ...(generated ? {} : { prebuiltScript: scriptOverride }),
    ...(category ? { narrationCategory: "encouragement" } : {}),
    generatedImage, durationSec: 2, destination: "none",
  }, "fixture-job"), (err) => {
    if (probeFails || audioDuration > 30) {
      assert.equal(err.code, probeFails ? "NARRATION_DURATION_UNVERIFIABLE" : "NARRATION_EXCEEDS_RENDER_CAP");
      assert.equal(rendered, undefined);
      assert.equal(drawn, undefined);
      return true;
    }
    if (!refuse) return err === stop;
    assert.equal(err.code, "CAPTION_SCRIPT_TOO_LARGE");
    assert.equal(err.details.maxWrappedLines, 80);
    assert.match(err.message, /Split this script into smaller Series parts/);
    return true;
  });
  if (probeFails || audioDuration > 30) return { updates, synthesis };
  if (refuse) {
    assert.equal(synthesis.length, 0, "refuse before any paid voice/alignment work");
    assert.equal(rendered, undefined, "refuse before render/localisation work");
    assert.equal(drawn, undefined);
    return { updates, synthesis };
  }
  assert.equal(synthesis.length, 1);
  assert.equal(synthesis[0].args.withTimestamps, true);
  assert.equal(synthesis[0].kind, category ? "category" : "direct");
  assert.equal(rendered.audioPath, tts.file ?? "synthetic-voice.wav");
  const clean = sanitizeScriptObject(scriptOverride);
  assert.equal(synthesis[0].args.text,
    cleanSpeakableText(`${clean.hook}\n${clean.verse}\n${clean.reflection}\n${clean.cta}`));
  return { rendered, updates, synthesis, drawn };
}

function bare(words) {
  return words.map(({ text, start, end }) => ({ text, start, end }));
}
function expected(words) {
  return words.map(({ text, startMs, endMs }) => ({ text, start: startMs / 1000, end: endMs / 1000 }));
}
function assertAligned({ rendered, updates }, words) {
  assert.deepEqual(bare(rendered.words), expected(words));
  assert.ok(rendered.scenes.length > 0);
  assert.equal(rendered.lines, undefined);
  assert.ok(!updates.some((p) => p.captionFallback));
}

for (const category of [false, true]) {
  test(`native Azure words use aligned campaign rendering (${category ? "category" : "direct"} synthesis)`, async () => {
    const result = await run({ words: native }, { category, generated: !category });
    assertAligned(result, native);
    assert.equal(result.rendered.durationSec, 9, "actual audio extent, not requested 2s or last word 6.5s");
    assert.deepEqual(result.rendered.scenes.map((s) => s.duration), [2.5, 2.5, 5]);
    const tiled = result.rendered.scenes.reduce((sum, s) => sum + s.duration, 0)
      - 0.5 * (result.rendered.scenes.length - 1);
    assert.equal(tiled, 9, "crossfaded scenes cover leading and trailing silence");
    assert.equal(result.rendered.words[1].end, 1.02, "do not pad valid short native windows");
  });
}

test("valid native words win over conflicting character timings", async () => {
  assertAligned(await run({ words: native, alignment: charTiming("Wrong.") }), native);
});

for (const words of [undefined, [], [{ text: "invalid", startMs: NaN, endMs: 10 }]]) {
  test(`character timings recover when native words are ${words === undefined ? "absent" : words.length ? "invalid" : "empty"}`, async () => {
    const alignment = charTiming("Grâce, 愛! 🙏");
    const result = await run({ words, alignment }, { scriptOverride: { verse: "Grâce, 愛! 🙏" } });
    assertAligned(result, toAlignmentContract({ alignment }).words);
    assert.deepEqual(result.rendered.words.map((w) => w.text), ["Grâce,", "愛!", "🙏"]);
  });
}

test("native Unicode/punctuation survive when they cover the actual spoken script", async () => {
  const words = [{ text: "Grâce—愛!", startMs: 100, endMs: 125 }];
  assertAligned(await run({ words }, { scriptOverride: { verse: "Grâce—愛!" } }), words);
});

function assertCompleteFallback({ rendered, updates }, original = script) {
  assert.equal(rendered.words, undefined);
  const clean = sanitizeScriptObject(original);
  assert.deepEqual(rendered.lines,
    splitCaptionLines([clean.hook, clean.verse, clean.reflection, clean.cta], 140));
  assert.equal(updates.filter((p) => p.captionFallback).length, 1);
  assert.match(updates.find((p) => p.captionFallback).captionFallback, /complete spoken script.*static captions were used/);
}

for (const category of [false, true]) {
  for (const [label, words] of [
    ["beginning only", native.slice(0, 2)],
    ["middle only", native.slice(2, 6)],
    ["end only", native.slice(6)],
    ["missing beginning", native.slice(1)],
    ["missing middle", native.filter((_, i) => i !== 3)],
    ["missing end", native.slice(0, -1)],
    ["same-count substitution", native.map((w, i) => i === 3 ? { ...w, text: "fear." } : w)],
    ["reordered words", native.map((w, i) => ({ ...w, text: native[(i + 1) % native.length].text }))],
    ["unrelated Unicode", [{ text: "Grâce—愛!", startMs: 100, endMs: 125 }]],
  ]) {
    test(`${label} keeps complete static script (${category ? "category" : "direct"})`, async () => {
      assertCompleteFallback(await run({ words }, { category, generated: !category }));
    });
  }
}

test("partial character alignment cannot replace the complete script either", async () => {
  assertCompleteFallback(await run({ alignment: charTiming("Trust God.") }));
});

test("mismatched native words do not silently promote conflicting character timing", async () => {
  assertCompleteFallback(await run({ words: native.slice(0, 2),
    alignment: charTiming("Peace comes. Trust God. Rest now. Share hope.") }));
});

const timedText = (text) => text.split(/\s+/u).map((text, i) => ({ text, startMs: i * 100, endMs: i * 100 + 50 }));
for (const category of [false, true]) {
  test(`coverage uses exact known spoken reference expansion (${category ? "category" : "direct"})`, async () => {
    const original = { hook: "Read Psalm 91:1.", verse: "Rest in hope.", reference: "Isaiah 40:31", cta: "" };
    const words = timedText(prepareScriptureForSpeech("Read Psalm 91:1. Rest in hope."));
    const result = await run({ words }, { category, scriptOverride: original });
    assertAligned(result, words);
    assert.ok(!result.synthesis[0].args.text.includes("Isaiah"), "visual reference is not spoken");
    assert.ok(result.synthesis[0].args.text.includes("Psalm 91:1"));
    assertCompleteFallback(await run({ words: timedText("Read Psalm 91:1. Rest in hope.") },
      { category, scriptOverride: original }), original);
  });
}

test("Unicode normalization permits canonical composition but rejects changed Unicode text", async () => {
  const original = { verse: "Grâce 愛 🙏" };
  const words = timedText("Gra\u0302ce 愛 🙏");
  assertAligned(await run({ words }, { scriptOverride: original }), words);
  assertCompleteFallback(await run({ words: timedText("Grâce 惡 🙏") }, { scriptOverride: original }), original);
});

test("long partial timings preserve every static-caption line for generated-image fallback", async () => {
  const original = { verse: "Hope remains with us through every season. ".repeat(20), cta: "Share hope." };
  const result = await run({ words: native.slice(0, 2) }, { scriptOverride: original, generatedImage: "fixture.png" });
  assertCompleteFallback(result, original);
  assert.ok(result.rendered.lines.length > 2);
  assert.ok(result.rendered.lines.every((line) => line.length <= 140));
  assert.equal(result.rendered.lines.at(-1), "Share hope.");
});

for (const [label, timing] of [
  ["absent", {}],
  ["empty", { words: [], alignment: { characters: [], starts: [], ends: [] } }],
  ["invalid native", { words: [{ text: "bad", startMs: 20, endMs: 10 }] }],
  ["partly invalid native", { words: [native[0], { text: "bad", startMs: 1000, endMs: Infinity }] }],
  ["incomplete character arrays", { alignment: { characters: ["x"], starts: [0], ends: [] } }],
  ["backwards characters", { alignment: { characters: ["a", "b"], starts: [1, 0], ends: [2, 1] } }],
]) {
  test(`${label} timings retain explicit static-caption fallback`, async () => {
    const { rendered, updates } = await run(timing);
    assert.equal(rendered.words, undefined);
    assert.equal(rendered.scenes, undefined);
    assert.equal(rendered.backgroundPath, "fixture-bg");
    assert.ok(rendered.lines.join(" ").includes("Peace comes."));
    assert.equal(updates.filter((p) => p.captionFallback).length, 1);
    assert.match(updates.find((p) => p.captionFallback).captionFallback, /static captions were used/);
  });
}

test("empty timings keep the generated-image fallback without inventing words", async () => {
  const { rendered, updates } = await run({}, { generatedImage: "fixture.png" });
  assert.equal(rendered.words, undefined);
  assert.deepEqual(rendered.scenes, [{ backgroundPath: "fixture.png", duration: 2, kind: "image" }]);
  assert.ok(rendered.lines.length > 0);
  assert.ok(updates.some((p) => p.captionFallback));
});

const shortHelpers = new Function("cleanCaptionLine", "splitCaptionLines", `${helperSource}; return { wrapTextLines, prepareShortCaptionLines };`)(cleanCaptionLine, splitCaptionLines);

for (const generatedImage of [undefined, "fixture.png"]) {
  test(`real ${generatedImage ? "advanced" : "legacy"} fallback wraps all accepted text through drawtext including Unicode CTA`, async () => {
    const original = { verse: "Hope remains with us through every season. ".repeat(20), cta: "Share Grâce 愛 🙏 today." };
    const { drawn } = await run({ words: native.slice(0, 2) }, { scriptOverride: original, generatedImage, realRenderer: true });
    assert.ok(drawn.args.lines.length > 12, "exercise wrapping beyond the old short-form limit");
    assert.ok(drawn.args.lines.length <= 80);
    assert.equal(drawn.args.lines.join(" "), `${original.verse.trim()} ${original.cta}`);
    assert.ok(drawn.filter.includes("Grâce 愛 🙏 today."), "CTA reaches the real drawtext filter, not just campaign payload");
  });

  test(`121-line-scale script refuses before synthesis (${generatedImage ? "image" : "library"})`, async () => {
    await run({}, { scriptOverride: { verse: "Hope remains with us through every season. ".repeat(63), cta: "Share Grâce 愛 🙏 today." }, generatedImage, realRenderer: true, refuse: true });
  });
}

for (const generated of [false, true]) {
  test(`extreme ${generated ? "generated" : "prebuilt"} script refuses before voice/render work`, async () => {
    await run({}, { generated, scriptOverride: { verse: "Hope ".repeat(100000), cta: "Share hope." }, refuse: true });
  });
}

test("wrapping accepts exactly 80 lines, but refuses the 81st rather than dropping its CTA", () => {
  const lines = Array(79).fill("Hope");
  assert.deepEqual(shortHelpers.wrapTextLines([...lines, "Grâce 愛 🙏 CTA"], 25, 80), [...lines, "Grâce 愛 🙏 CTA"]);
  assert.throws(() => shortHelpers.wrapTextLines([...lines, "Hope", "Grâce 愛 🙏 CTA"], 25, 80), { code: "CAPTION_SCRIPT_TOO_LARGE" });
});

test("direct short render refuses oversized input before downloads, alignment or FFmpeg", async () => {
  let localisations = 0;
  const core = new Function("cleanCaptionLine", "splitCaptionLines", "localiseJobInputs", `${helperSource}\n${coreSource}\nreturn renderVideoCore;`)(
    cleanCaptionLine, splitCaptionLines, async (p) => { localisations++; return p; },
  );
  for (const payload of [
    { backgroundPath: "fixture.mp4", lines: ["Hope ".repeat(100000)] },
    { scenes: [{ backgroundPath: "fixture.png" }], kineticCaptions: true, lines: Array(81).fill("Hope") },
  ]) {
    await assert.rejects(core(payload, "fixture"), { code: "CAPTION_SCRIPT_TOO_LARGE" });
  }
  assert.equal(localisations, 0);
});

test("long Unicode token refuses explicitly instead of being sliced through a code point", () => {
  assert.throws(() => shortHelpers.prepareShortCaptionLines(["🙏".repeat(71)]), { code: "CAPTION_SCRIPT_TOO_LARGE" });
});

test("failed duration probe refuses rather than guessing last-word extent", async () => {
  await run({ words: native }, { probeFails: true });
});

for (const category of [false, true]) {
  test(`over-cap narration refuses campaign before rendering (${category ? "category" : "direct"})`, async () => {
    await run({ words: native, durationMs: 2000 }, { category, audioDuration: 57.459833 });
  });
}
