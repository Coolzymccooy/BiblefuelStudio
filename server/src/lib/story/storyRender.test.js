import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildStoryFfmpegArgs, sceneSegmentsSec } from "./storyRender.js";

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
});
