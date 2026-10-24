/**
 * A Story project's music bed reaches ffmpeg at render, so it may only be a
 * library:/mylib: ref that resolves or a file in the caller's own media folder
 * (#112). PATCH /:id/music refuses anything else, and render checks again so
 * a project stored before the fix cannot read another account's file.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "story-music-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: storyRouter, _setRenderImpl, _resetRenderImpl } = await import("../../src/routes/story.js");
const { readProject, writeProject, createProject } = await import("../../src/lib/story/projectStore.js");
const { registerTrack } = await import("../../src/lib/musicLibraryStore.js");
const { defaultTrackRef } = await import("../../src/lib/musicLibrary.js");

const dataDir = path.join(root, "data", "users", "u1");
const outputDir = path.join(dataDir, "outputs");
const theirs = path.join(root, "data", "users", "u2", "outputs");
const door = path.join(outputDir, "door");
const ctx = { userId: "u1", dataDir, outputDir, isSuperAdmin: false, isOwner: false };
const bed = path.join(outputDir, "bed.mp3");
const secret = path.join(theirs, "private.mp3");
const calls = [];

function handlerFor(method, routePath) {
  const layer = storyRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function call(method, routePath, { params = {}, body = {} } = {}) {
  const res = {
    statusCode: 200, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  await handlerFor(method, routePath)({ params, body, ctx }, res);
  return res;
}

function readyProject(music) {
  const img = path.join(outputDir, "img.png"); fs.writeFileSync(img, "png");
  const audio = path.join(outputDir, "voice.mp3"); fs.writeFileSync(audio, "mp3");
  const scenes = [{ id: "s1", text: "t", imagePrompt: "", imagePath: img, imageUrl: "/x.png", imageStatus: "done", startMs: 0, endMs: 8000, promptEditedByUser: false }];
  const project = createProject(dataDir, { title: "music" });
  writeProject(dataDir, { ...project, status: "ready_to_render", scenes, source: { audioPath: audio, durationMs: 8000 }, music: { path: music, volume: 0.3, autoDuck: true } });
  return project.projectId;
}

const outsidePaths = () => [
  secret,
  path.join(process.env.OUTPUT_DIR, "owner-bed.mp3"),
  path.join(door, "private.mp3"),
  path.join(theirs, "missing.mp3"),
  "\\\\server\\share\\bed.mp3",
  "http://169.254.169.254/latest/meta-data/bed.mp3",
  "tcp://127.0.0.1:1",
];

before(() => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(bed, "mp3");
  fs.writeFileSync(secret, "mp3");
  fs.writeFileSync(path.join(process.env.OUTPUT_DIR, "owner-bed.mp3"), "mp3");
  fs.symlinkSync(theirs, door, "junction");
  _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
});

after(() => {
  _resetRenderImpl();
  try { fs.rmdirSync(door); } catch { /* already gone */ }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => { calls.length = 0; });

describe("PATCH /:id/music", () => {
  test("keeps the caller's own file, a bundled track and their own mylib track", async () => {
    const own = registerTrack(dataDir, { file: bed, label: "Bed" });
    for (const music of [bed, "/outputs/bed.mp3", defaultTrackRef(), `mylib:${own.id}`]) {
      const id = readyProject(null);
      const res = await call("patch", "/:id/music", { params: { id }, body: { path: music, volume: 0.4 } });
      assert.equal(res.statusCode, 200, `${music}: ${JSON.stringify(res.payload)}`);
      assert.ok(res.payload.project.music.path, music);
    }
  });

  test("refuses a path outside the caller's folder and leaves the project as it was", async () => {
    for (const music of outsidePaths()) {
      const id = readyProject(null);
      const res = await call("patch", "/:id/music", { params: { id }, body: { path: music } });
      assert.equal(res.statusCode, 403, `${music}: ${JSON.stringify(res.payload)}`);
      assert.equal(res.payload.error, "PATH_OUTSIDE_MEDIA", music);
      assert.equal(readProject(dataDir, id).music.path, null, music);
    }
  });

  test("refuses a library ref that does not resolve", async () => {
    const id = readyProject(null);
    const res = await call("patch", "/:id/music", { params: { id }, body: { path: "mylib:00000000-0000-0000-0000-000000000000" } });
    assert.equal(res.statusCode, 400);
    assert.equal(readProject(dataDir, id).music.path, null);
  });
});

describe("render re-checks a stored music path", () => {
  test("a project stored with an outside music path is refused before any job starts", async () => {
    for (const music of outsidePaths()) {
      const id = readyProject(music);
      const res = await call("post", "/:id/render", { params: { id } });
      assert.equal(res.statusCode, 403, `${music}: ${JSON.stringify(res.payload)}`);
      assert.equal(res.payload.error, "PATH_OUTSIDE_MEDIA", music);
      assert.equal(readProject(dataDir, id).status, "ready_to_render");
    }
    assert.equal(calls.length, 0);
  });

  test("the caller's own bed still reaches the renderer", async () => {
    const id = readyProject(bed);
    const res = await call("post", "/:id/render", { params: { id } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(calls[0].musicPath, fs.realpathSync(bed));
  });
});
