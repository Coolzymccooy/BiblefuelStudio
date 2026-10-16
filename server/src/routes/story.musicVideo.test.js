// The Story side of AI music videos: the seam the lyric video router calls.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import storyRouter, {
  createStoryFromScenes, startStoryImages, patchScenePrompts,
  _setImageGenImpl, _resetImageGenImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
  _setAutoAnimateImpl, _resetAutoAnimateImpl,
} from "./story.js";
import { readProject, writeProject } from "../lib/story/projectStore.js";
import { anchorFor } from "../lib/story/styleAnchors.js";

let ctx;
let songFile;
let savedKey;
const SCENES = [
  { startMs: 0, endMs: 6000, kind: "instrumental", label: "Intro", text: "", imagePrompt: "an empty road at dawn" },
  { startMs: 6000, endMs: 16000, kind: "chorus", label: "Chorus", text: "Grace beyond the race", imagePrompt: "the singer on the road" },
];
const WORDS = [{ text: "Grace", startMs: 6200, endMs: 6800 }, { text: "beyond", startMs: 6800, endMs: 7400 }];
const args = (over = {}) => ({
  title: "Grace Beyond the Race · music video", style: "music-video", aspect: "landscape",
  audioPath: songFile, durationMs: 16500, words: WORDS, scenes: SCENES, aiMotion: false, ...over,
});

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-mv-"));
  ctx = { dataDir: dir, outputDir: dir };
  songFile = path.join(dir, "lyric-song-1.m4a");
  fs.writeFileSync(songFile, "the song");
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
    assert.equal(saved.source.durationMs, 16500);
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
    assert.throws(() => createStoryFromScenes(ctx, args({ audioPath: path.join(ctx.outputDir, "missing.m4a") })), /audio/);
  });

  test("the project owns a copy of the song in its own folder, so the lyric project can lose its song", () => {
    const project = createStoryFromScenes(ctx, args());
    const own = project.source.audioPath;
    assert.equal(path.dirname(own), path.join(ctx.outputDir, "story", project.projectId));
    assert.equal(path.extname(own), ".m4a");
    assert.equal(fs.readFileSync(own, "utf8"), "the song");
    fs.rmSync(songFile);
    assert.equal(fs.existsSync(readProject(ctx.dataDir, project.projectId).source.audioPath), true);
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

/** Image gen and library stubs that record the prompts each picture was made from. */
function recordImages() {
  const prompts = [];
  _setImageGenImpl(async ({ partNumber, rawPrompt }) => {
    prompts.push(rawPrompt);
    return { ok: true, path: `/gen-${partNumber}.png`, publicUrl: `/o/gen-${partNumber}.png`, provider: "cloudflare" };
  });
  _setImageLibraryImpl({ find: async () => [], mark: () => {}, register: async () => null });
  _setAutoAnimateImpl(async () => {});
  return prompts;
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe("startStoryImages with a step before the pictures", () => {
  test("the pictures wait for the step, so they are made from the prompts it wrote", async () => {
    const made = recordImages();
    const project = createStoryFromScenes(ctx, args());
    const gate = deferred();
    const run = startStoryImages(ctx, project.projectId, {
      before: async () => {
        await gate.promise;
        patchScenePrompts(ctx, project.projectId, { "scene-001": "dawn, the singer alone", "scene-002": "the singer runs" });
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(made.length, 0, "no picture before the step is done");
    gate.resolve();
    await run;
    assert.deepEqual(made.sort(), [`dawn, the singer alone, ${anchorFor("music-video")}`, `the singer runs, ${anchorFor("music-video")}`].sort());
    assert.equal(readProject(ctx.dataDir, project.projectId).status, "ready_to_render");
  });

  test("a step that fails still makes the pictures, from the prompts already there", async () => {
    const made = recordImages();
    const project = createStoryFromScenes(ctx, args());
    await startStoryImages(ctx, project.projectId, { before: async () => { throw new Error("LLM down"); } });
    assert.equal(made.length, 2);
    assert.ok(made.includes(`an empty road at dawn, ${anchorFor("music-video")}`));
    assert.equal(readProject(ctx.dataDir, project.projectId).status, "ready_to_render");
  });

  test("while the step runs, Resume is a no-op and a new image run or re-segment is refused", async () => {
    const made = recordImages();
    const project = createStoryFromScenes(ctx, args());
    const song = path.join(ctx.outputDir, "song.m4a");
    fs.writeFileSync(song, "x");
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, project.projectId), source: { audioPath: song, durationMs: 16500 } });
    const gate = deferred();
    const run = startStoryImages(ctx, project.projectId, { before: () => gate.promise });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { userId: "u", ...ctx }; next(); });
    app.use("/api/story", storyRouter);
    const resumed = await request(app).post(`/api/story/${project.projectId}/process`).send({ mediaPath: song });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.ok, true);
    assert.equal((await request(app).post(`/api/story/${project.projectId}/images`).send({})).status, 409);
    assert.equal((await request(app).post(`/api/story/${project.projectId}/resegment`).send({})).status, 409);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(made.length, 0, "Resume did not start a second run");
    gate.resolve();
    await run;
    assert.equal(made.length, 2, "the one run made each picture once");
  });
});

describe("while the prompts are being written", () => {
  /** A project in its prompt step (held open by `gate`), with a Story router over it. */
  function preparing() {
    const made = recordImages();
    const project = createStoryFromScenes(ctx, args());
    const gate = deferred();
    const run = startStoryImages(ctx, project.projectId, { before: () => gate.promise });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { userId: "u", ...ctx }; next(); });
    app.use("/api/story", storyRouter);
    return { made, project, gate, run, app, id: project.projectId };
  }

  test("Cancel then Resume puts the queued pictures back on, instead of staying cancelled", async () => {
    const { made, gate, run, app, id } = preparing();
    assert.equal((await request(app).post(`/api/story/${id}/cancel`).send({})).status, 200);
    assert.equal(readProject(ctx.dataDir, id).status, "error");
    const resumed = await request(app).post(`/api/story/${id}/process`).send({ mediaPath: readProject(ctx.dataDir, id).source.audioPath });
    assert.equal(resumed.status, 200);
    const now = readProject(ctx.dataDir, id);
    assert.equal(now.status, "generating_images");
    assert.equal(now.error, null);
    gate.resolve();
    await run;
    assert.equal(made.length, 2, "the queued start made the pictures");
    assert.equal(readProject(ctx.dataDir, id).status, "ready_to_render");
  });

  test("Cancel without Resume still stops the pictures", async () => {
    const { made, gate, run, app, id } = preparing();
    await request(app).post(`/api/story/${id}/cancel`).send({});
    gate.resolve();
    await run;
    assert.equal(made.length, 0);
    assert.equal(readProject(ctx.dataDir, id).error, "Cancelled.");
  });

  test("regenerating a scene or putting a picture on one is refused", async () => {
    const { gate, run, app, id } = preparing();
    const regen = await request(app).post(`/api/story/${id}/scenes/scene-001/regenerate`).send({});
    assert.equal(regen.status, 409);
    assert.equal(regen.body.code, "PREPARING");
    const put = await request(app).put(`/api/story/${id}/scenes/scene-001/image`).send({ libraryId: "img_x" });
    assert.equal(put.status, 409);
    assert.equal(put.body.code, "PREPARING");
    gate.resolve();
    await run;
  });
});

describe("patchScenePrompts", () => {
  test("puts each new prompt on its scene with the style anchor, and keeps a prompt the user edited", () => {
    const project = createStoryFromScenes(ctx, args());
    writeProject(ctx.dataDir, {
      ...project,
      scenes: project.scenes.map((s) => (s.id === "scene-002" ? { ...s, imagePrompt: "my own words", promptEditedByUser: true } : s)),
    });
    const next = patchScenePrompts(ctx, project.projectId, { "scene-001": "a new dawn", "scene-002": "not this", "scene-999": "nobody" });
    assert.equal(next.scenes[0].imagePrompt, `a new dawn, ${anchorFor("music-video")}`);
    assert.equal(next.scenes[1].imagePrompt, "my own words");
    assert.deepEqual(readProject(ctx.dataDir, project.projectId).scenes, next.scenes);
  });

  test("an empty prompt leaves the scene as it is, and a deleted project gives null", () => {
    const project = createStoryFromScenes(ctx, args());
    const next = patchScenePrompts(ctx, project.projectId, { "scene-001": "  " });
    assert.equal(next.scenes[0].imagePrompt, project.scenes[0].imagePrompt);
    assert.equal(patchScenePrompts(ctx, "gone", { "scene-001": "x" }), null);
  });
});
