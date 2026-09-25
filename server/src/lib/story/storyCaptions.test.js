import test from "node:test";
import assert from "node:assert/strict";
import { buildStoryFfmpegArgs } from "./storyRender.js";

// Story Video was locked to one caption look: buildWordDrawtext with no
// preset, no layout and no depth, so every long-form video rendered
// cinematic-default, centred, word-by-word — whatever the operator picked.
// These tests pin the controls the Studio path has always had.

const scenes = [
  { id: "s1", imagePath: "C:/img/a.png", startMs: 0, endMs: 4000 },
  { id: "s2", imagePath: "C:/img/b.png", startMs: 4000, endMs: 8000 },
];
const words = [
  { text: "Be", startMs: 0, endMs: 400 },
  { text: "still", startMs: 400, endMs: 900 },
  { text: "and", startMs: 1000, endMs: 1300 },
  { text: "know", startMs: 1300, endMs: 1800 },
  { text: "that", startMs: 4000, endMs: 4300 },
  { text: "I", startMs: 4300, endMs: 4500 },
  { text: "am", startMs: 4500, endMs: 4800 },
  { text: "God", startMs: 4800, endMs: 5400 },
];
const base = {
  scenes, words, audioPath: "C:/a.mp3", width: 1280, height: 720,
  outPath: "C:/out.mp4", audioDurationSec: 8,
};
const filterOf = (built) => {
  const i = built.args.indexOf("-filter_complex");
  return i >= 0 ? built.args[i + 1] : built.args.join(" ");
};

test("per-line motion draws timed lines, not one word at a time", () => {
  const out = filterOf(buildStoryFfmpegArgs({ ...base, captions: "kinetic", captionMotion: "lines" }));
  // Words are grouped into phrases that keep their own windows, so a line
  // appears when it is actually spoken rather than on an even split.
  assert.match(out, /drawtext/);
  assert.doesNotMatch(out, /\[object Object\]/);
  const windows = [...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(windows.length > 0, "captions were drawn");
  assert.ok(windows.length < words.length, "lines, not one filter per word");
  assert.ok(windows.some((w) => w >= 4), "a line starts in the second half, following the voice");
});

test("the chosen preset, layout and depth reach the filter", () => {
  const plain = filterOf(buildStoryFfmpegArgs({ ...base, captions: "kinetic" }));
  const styled = filterOf(buildStoryFfmpegArgs({
    ...base, captions: "kinetic", captionPreset: "marker", captionLayout: "bottom-left", captionDepth: "soft",
  }));
  assert.notEqual(styled, plain, "the preset/layout/depth changed the output");
});

test("captions 'static' means line captions, not a word-count accident", () => {
  const staticOut = filterOf(buildStoryFfmpegArgs({ ...base, captions: "static" }));
  const kineticOut = filterOf(buildStoryFfmpegArgs({ ...base, captions: "kinetic" }));
  assert.notEqual(staticOut, kineticOut, "static and kinetic render differently");
  const staticWindows = [...staticOut.matchAll(/between\(t,/g)].length;
  const kineticWindows = [...kineticOut.matchAll(/between\(t,/g)].length;
  assert.ok(staticWindows < kineticWindows, "static draws fewer, longer captions");
});

test("captions 'none' still draws nothing", () => {
  const out = filterOf(buildStoryFfmpegArgs({ ...base, captions: "none" }));
  assert.doesNotMatch(out, /drawtext/);
});

test("a very long transcript still falls back to the cheap subtitle chain in word mode", () => {
  // Per-word drawtext is ~2 filters per word; thousands of them stall ffmpeg.
  const many = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, startMs: i * 100, endMs: i * 100 + 90 }));
  const out = filterOf(buildStoryFfmpegArgs({
    ...base, words: many, captions: "kinetic", captionMotion: "words", kineticMaxWords: 10,
  }));
  assert.match(out, /drawtext/);
  // The subtitle fallback packs several words into one cue, so far fewer
  // filters than two per word.
  assert.ok([...out.matchAll(/drawtext/g)].length < many.length, "the cheap chain was used");
});

test("line mode is NOT subject to the word-count fallback — it is already cheap", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, startMs: i * 100, endMs: i * 100 + 90 }));
  const out = filterOf(buildStoryFfmpegArgs({
    ...base, words: many, captions: "kinetic", captionMotion: "lines", kineticMaxWords: 10,
  }));
  const windows = [...out.matchAll(/between\(t,([\d.]+),/g)].map((m) => Number(m[1]));
  assert.ok(windows.some((w) => w > 1), "lines follow the real timings across the video");
});
