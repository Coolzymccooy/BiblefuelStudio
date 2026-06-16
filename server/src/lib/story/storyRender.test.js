import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildStoryFfmpegArgs, sceneSegmentsSec, groupWordsIntoCues, buildSubtitleDrawtext, wrapCue } from "./storyRender.js";

function countDrawtext(args) {
  const fc = args[args.indexOf("-filter_complex") + 1] || "";
  return (fc.match(/drawtext=/g) || []).length;
}
function makeWords(n, totalSec) {
  const step = totalSec / n;
  return Array.from({ length: n }, (_, i) => ({
    text: `w${i}`, startMs: Math.round(i * step * 1000), endMs: Math.round((i + 1) * step * 1000),
  }));
}

const SCENES = [
  { id: "scene-001", startMs: 0, endMs: 8000, imagePath: "/tmp/a.png" },
  { id: "scene-002", startMs: 8000, endMs: 16000, imagePath: "/tmp/b.png" },
  { id: "scene-003", startMs: 16000, endMs: 20000, imagePath: "/tmp/c.png" },
];
const WORDS = [
  { text: "hello", startMs: 0, endMs: 500 },
  { text: "world", startMs: 600, endMs: 1200 },
];

describe("storyRender arg building", () => {
  test("sceneSegmentsSec converts scene ms windows to second durations", () => {
    const segs = sceneSegmentsSec(SCENES);
    assert.deepEqual(segs.map((s) => s.durationSec), [8, 8, 4]);
    assert.equal(segs.length, 3);
  });

  test("builds one -i per scene image plus the audio input", () => {
    const { args } = buildStoryFfmpegArgs({
      scenes: SCENES, words: WORDS, audioPath: "/tmp/voice.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/tmp/out.mp4",
    });
    const inputCount = args.filter((a) => a === "-i").length;
    assert.equal(inputCount, SCENES.length + 1);
    assert.ok(args.includes("/tmp/voice.mp3"));
    assert.ok(args.includes("/tmp/out.mp4"));
  });

  test("adds a music input when musicPath is provided", () => {
    const { args } = buildStoryFfmpegArgs({
      scenes: SCENES, words: WORDS, audioPath: "/tmp/voice.mp3", musicPath: "/tmp/music.mp3",
      width: 1080, height: 1920, outPath: "/tmp/out.mp4",
    });
    assert.ok(args.includes("/tmp/music.mp3"));
  });

  test("output is capped to the audio/scene length via a single OUTPUT -t", () => {
    const { args, totalDurationSec } = buildStoryFfmpegArgs({
      scenes: SCENES, words: WORDS, audioPath: "/tmp/voice.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/tmp/out.mp4",
    });
    assert.equal(totalDurationSec, 20);
    // Exactly one -t, and it must be an OUTPUT option (immediately before the
    // output path) — NOT an input option, or it only caps the first input.
    const tPositions = args.reduce((acc, a, i) => (a === "-t" ? [...acc, i] : acc), []);
    assert.equal(tPositions.length, 1);
    const tIdx = tPositions[0];
    assert.equal(args[tIdx + 1], "20.000");
    assert.equal(args[tIdx + 2], "/tmp/out.mp4"); // -t is the last flag before output
  });

  test("each scene collapses its looped still to ONE frame (trim) — guards against the zoompan runaway", () => {
    const { args } = buildStoryFfmpegArgs({
      scenes: SCENES, words: WORDS, audioPath: "/tmp/voice.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/tmp/out.mp4",
    });
    const fcIdx = args.indexOf("-filter_complex");
    const graph = args[fcIdx + 1];
    // One trim=end_frame=1 per scene — without this, `-loop 1` + zoompan never EOFs.
    const trimCount = (graph.match(/trim=end_frame=1/g) || []).length;
    assert.equal(trimCount, SCENES.length);
  });

  test("throws when a scene is missing its image", () => {
    const bad = [{ id: "scene-001", startMs: 0, endMs: 8000, imagePath: null }];
    assert.throws(
      () => buildStoryFfmpegArgs({
        scenes: bad, words: WORDS, audioPath: "/tmp/voice.mp3", musicPath: null,
        width: 1080, height: 1920, outPath: "/tmp/out.mp4",
      }),
      /missing image/i,
    );
  });

  const GAPPY = [
    { id: "scene-001", startMs: 500, endMs: 7000, imagePath: "/a.png" },
    { id: "scene-002", startMs: 9000, endMs: 15000, imagePath: "/b.png" },
    { id: "scene-003", startMs: 17000, endMs: 20000, imagePath: "/c.png" },
  ];

  test("sceneSegmentsSec makes scenes contiguous and covers the full audio length", () => {
    const segs = sceneSegmentsSec(GAPPY, 25);
    assert.deepEqual(segs.map((s) => s.durationSec), [9, 8, 8]);
    const sum = segs.reduce((a, s) => a + s.durationSec, 0);
    assert.equal(Number(sum.toFixed(3)), 25);
  });

  test("output -t uses the audio length when provided, scene-end as fallback", () => {
    const withAudio = buildStoryFfmpegArgs({
      scenes: GAPPY, words: WORDS, audioPath: "/v.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/o.mp4", audioDurationSec: 25,
    });
    const tIdx1 = withAudio.args.indexOf("-t");
    assert.equal(withAudio.args[tIdx1 + 1], "25.000");

    const noAudio = buildStoryFfmpegArgs({
      scenes: GAPPY, words: WORDS, audioPath: "/v.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/o.mp4",
    });
    const tIdx2 = noAudio.args.indexOf("-t");
    assert.equal(noAudio.args[tIdx2 + 1], "20.000");
  });

  test("autoduck builds a sidechaincompress chain; without it a plain amix", () => {
    const fcOf = (extra) => {
      const { args } = buildStoryFfmpegArgs({
        scenes: GAPPY, words: WORDS, audioPath: "/v.mp3", musicPath: "/m.mp3",
        width: 1080, height: 1920, outPath: "/o.mp4", audioDurationSec: 25, ...extra,
      });
      return args[args.indexOf("-filter_complex") + 1];
    };
    const ducked = fcOf({ autoDuck: true, musicVolume: 0.25 });
    assert.match(ducked, /sidechaincompress/);
    assert.match(ducked, /volume=0\.25/);
    const flat = fcOf({ autoDuck: false, musicVolume: 0.4 });
    assert.doesNotMatch(flat, /sidechaincompress/);
    assert.match(flat, /amix=inputs=2/);
    assert.match(flat, /volume=0\.4/);
  });

  test("long transcript switches to compact subtitle captions (few filters, lower-third)", () => {
    process.env.STORY_KINETIC_MAX_WORDS = "100";
    try {
      const words = makeWords(1000, 60);
      const { args } = buildStoryFfmpegArgs({
        scenes: GAPPY, words, audioPath: "/v.mp3", musicPath: null,
        width: 720, height: 1280, outPath: "/o.mp4", audioDurationSec: 60,
      });
      const fc = args[args.indexOf("-filter_complex") + 1];
      const n = (fc.match(/drawtext=/g) || []).length;
      assert.ok(n > 0 && n < 400, `expected grouped subtitle captions (<400 drawtext), got ${n}`);
      assert.doesNotMatch(fc, /box=1/); // outline/shadow, not a per-line filled box
      assert.match(fc, /shadowcolor=black/);
    } finally {
      delete process.env.STORY_KINETIC_MAX_WORDS;
    }
  });

  test("short transcript keeps per-word kinetic captions (default ~10-min threshold)", () => {
    const words = makeWords(400, 120); // ~well under 1500-word default
    const { args } = buildStoryFfmpegArgs({
      scenes: GAPPY, words, audioPath: "/v.mp3", musicPath: null,
      width: 720, height: 1280, outPath: "/o.mp4", audioDurationSec: 120,
    });
    assert.ok(countDrawtext(args) >= 400, "per-word path should draw at least one filter per word");
  });
});

describe("buildSubtitleDrawtext", () => {
  test("wrapCue never drops words and respects the char budget", () => {
    const lines = wrapCue("one two three four five six seven eight nine ten", 12);
    assert.ok(lines.length >= 2);
    assert.equal(lines.join(" "), "one two three four five six seven eight nine ten");
    for (const l of lines) assert.ok(l.length <= 12 || !l.includes(" "), `line too long: "${l}"`);
  });

  test("packs words into single-line lower-third cues (no clipping, no box)", () => {
    const words = makeWords(40, 30).map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 }));
    const out = buildSubtitleDrawtext(words, 720, 1280);
    assert.match(out, /drawtext=/);
    assert.doesNotMatch(out, /box=1/); // outline + shadow, not a costly filled box
    assert.match(out, /shadowcolor=black/);
    // single line, lower third: y ≈ 0.80*1280 = 1024
    const ys = [...out.matchAll(/:y=(\d+):/g)].map((m) => Number(m[1]));
    assert.ok(ys.length >= 1 && ys.every((y) => y > 700), `captions should sit low, got y=${ys}`);
    assert.match(out, /fontsize=33/); // compact ~2.6% of height @1280
    // far fewer drawtext than words (packed into lines)
    const n = (out.match(/drawtext=/g) || []).length;
    assert.ok(n < words.length, `expected packing (<${words.length} drawtext), got ${n}`);
  });

  test("apostrophes are normalised (drawtext lexer safety)", () => {
    const out = buildSubtitleDrawtext([{ text: "John's", start: 0, end: 1 }, { text: "word", start: 1, end: 2 }], 720, 1280);
    assert.doesNotMatch(out, /[a-z]'[a-z]/i); // no raw ASCII apostrophes inside words
  });
});

describe("groupWordsIntoCues", () => {
  test("groups by word count", () => {
    const cues = groupWordsIntoCues(makeWords(16, 16).map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 })), { maxWords: 8, maxSec: 999 });
    assert.equal(cues.length, 2);
  });
  test("splits when a cue would span longer than maxSec", () => {
    const cues = groupWordsIntoCues([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
      { text: "c", start: 10, end: 11 },
    ], { maxWords: 99, maxSec: 4 });
    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, "a b");
    assert.equal(cues[1].text, "c");
  });
});
