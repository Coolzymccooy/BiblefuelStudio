// The Story side of AI music videos: the seam the lyric video router calls.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createStoryFromScenes, startStoryImages,
  _setImageGenImpl, _resetImageGenImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
  _setAutoAnimateImpl, _resetAutoAnimateImpl,
} from "./story.js";
import { readProject } from "../lib/story/projectStore.js";
import { anchorFor } from "../lib/story/styleAnchors.js";

let ctx;
let savedKey;
const SCENES = [
  { startMs: 0, endMs: 6000, kind: "instrumental", label: "Intro", text: "", imagePrompt: "an empty road at dawn" },
  { startMs: 6000, endMs: 16000, kind: "chorus", label: "Chorus", text: "Grace beyond the race", imagePrompt: "the singer on the road" },
];
const WORDS = [{ text: "Grace", startMs: 6200, endMs: 6800 }, { text: "beyond", startMs: 6800, endMs: 7400 }];
const args = (over = {}) => ({
  title: "Grace Beyond the Race · music video", style: "music-video", aspect: "landscape",
  audioPath: "/out/song.m4a", durationMs: 16500, words: WORDS, scenes: SCENES, aiMotion: false, ...over,
});

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-mv-"));
  ctx = { dataDir: dir, outputDir: dir };
  savedKey = process.env.BYTEPLUS_ARK_API_KEY;
  delete process.env.BYTEPLUS_ARK_API_KEY;
});
afterEach(() => {
  _resetImageGenImpl(); _resetImageLibraryImpl(); _resetAutoAnimateImpl();
  if (savedKey === undefined) delete process.env.BYTEPLUS_ARK_API_KEY; else process.env.BYTEPLUS_ARK_API_KEY = savedKey;
  fs.rmSync(ctx.dataDir, { recursive: true, force: true });
});

describe("createStoryFromScenes", () => {
  test("writes a Story project whose only sound is the song, ready for pictures", () => {
    const project = createStoryFromScenes(ctx, args());
    const saved = readProject(ctx.dataDir, project.projectId);
    assert.equal(saved.projectId, project.projectId);
    assert.deepEqual(saved.scenes, project.scenes);
    assert.equal(saved.title, "Grace Beyond the Race · music video");
    assert.equal(saved.style, "music-video");
    assert.equal(saved.aspect, "landscape");
    assert.equal(saved.captions, "none");
    assert.equal(saved.music, null);
    assert.equal(saved.status, "generating_images");
    assert.deepEqual(saved.source, { audioPath: "/out/song.m4a", durationMs: 16500 });
    assert.deepEqual(saved.transcript.words, WORDS);
    assert.equal(saved.aiMotion, null);
    assert.equal(saved.scenes.length, 2);
    assert.deepEqual(saved.scenes.map((s) => [s.id, s.startMs, s.endMs, s.text, s.imageStatus, s.imagePath]), [
      ["scene-001", 0, 6000, "", "pending", null],
      ["scene-002", 6000, 16000, "Grace beyond the race", "pending", null],
    ]);
    assert.equal(saved.scenes[1].imagePrompt, `the singer on the road, ${anchorFor("music-video")}`);
  });

  test("AI motion is kept only when the server has the Seedance key", () => {
    assert.equal(createStoryFromScenes(ctx, args({ aiMotion: true })).aiMotion, null);
    process.env.BYTEPLUS_ARK_API_KEY = "ark-test";
    assert.deepEqual(createStoryFromScenes(ctx, args({ aiMotion: true })).aiMotion, { quality: "standard", autoStartedAt: null, note: null });
    assert.equal(createStoryFromScenes(ctx, args({ aiMotion: { quality: "high" } })).aiMotion.quality, "high");
    assert.equal(createStoryFromScenes(ctx, args({ aiMotion: false })).aiMotion, null);
  });

  test("refuses a build with no scenes or no song", () => {
    assert.throws(() => createStoryFromScenes(ctx, args({ scenes: [] })), /scenes/);
    assert.throws(() => createStoryFromScenes(ctx, args({ audioPath: "" })), /audio/);
    assert.throws(() => createStoryFromScenes(ctx, args({ durationMs: 0 })), /duration/);
  });
});

describe("startStoryImages", () => {
  test("makes the pictures in the background, then hands the project to auto-animate", async () => {
    const generated = [];
    _setImageGenImpl(async ({ partNumber, rawPrompt, aspect }) => {
      generated.push({ partNumber, rawPrompt, aspect });
      return { ok: true, path: `/gen-${partNumber}.png`, publicUrl: `/o/gen-${partNumber}.png`, provider: "cloudflare" };
    });
    _setImageLibraryImpl({ find: async () => [], mark: () => {}, register: async () => null });
    const animated = [];
    _setAutoAnimateImpl(async (_ctx, id) => { animated.push(id); });
    const project = createStoryFromScenes(ctx, args());
    const run = startStoryImages(ctx, project.projectId);
    assert.ok(run instanceof Promise, "it returns at once with the detached run");
    await run;
    const done = readProject(ctx.dataDir, project.projectId);
    assert.equal(done.status, "ready_to_render");
    assert.deepEqual(done.scenes.map((s) => s.imageStatus), ["done", "done"]);
    assert.deepEqual(generated.map((g) => g.aspect), ["landscape", "landscape"]);
    assert.deepEqual(animated, [project.projectId]);
  });

  test("a run that cannot start never rejects", async () => {
    await startStoryImages(ctx, "no-such-project");
  });
});
