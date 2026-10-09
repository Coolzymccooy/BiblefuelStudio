import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import zlib from "zlib";
import storyRouter, {
  _setImageGenImpl, _resetImageGenImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
} from "./story.js";
import { readProject, writeProject, createProject } from "../lib/story/projectStore.js";
import { registerImage, _setEmbedImpl, _resetEmbedImpl } from "../lib/imageGen/imageLibrary.js";
import { buildStoryFfmpegArgs } from "../lib/story/storyRender.js";

// When the free image quota runs out, a Story project can still be finished:
// each scene can take a picture of your own, uploaded or from your library.

function handlerFor(method, routePath) {
  const layer = storyRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method],
  );
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function call(method, routePath, { params = {}, body = {} } = {}) {
  const req = { params, body, ctx: { userId: "user-1", dataDir, outputDir } };
  const res = {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return Promise.resolve(handlerFor(method, routePath)(req, res)).then(() => res);
}

async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Stand-in for what POST /api/media/upload-background leaves on disk. */
function fakeUpload(bytes = PNG_1X1, name = `bg-image-${UUID}.png`, dir = outputDir) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file.replace(/\\/g, "/");
}

function scene(i, over = {}) {
  return {
    id: `s${i}`, text: `Scene ${i} words`, startMs: i * 5000, endMs: i * 5000 + 5000,
    imagePrompt: `prompt ${i}`, imagePath: null, imageUrl: null, imageStatus: "error",
    imageError: "Daily image limit reached", promptEditedByUser: false, ...over,
  };
}

/** A project left as the quota leaves it: some scenes failed, status still generating_images. */
function quotaHitProject() {
  const p = createProject(dataDir, { title: "Starting small" });
  const done = path.join(outputDir, "done.png");
  fs.writeFileSync(done, PNG_1X1);
  return writeProject(dataDir, {
    ...p,
    status: "generating_images",
    scenes: [
      scene(0, { imageStatus: "done", imagePath: done, imageUrl: "/outputs/done.png", imageError: null, imageSource: "generated" }),
      scene(1),
      scene(2),
    ],
  });
}

const putImage = (p, sid, body) =>
  call("put", "/:id/scenes/:sid/image", { params: { id: p.projectId, sid }, body });

let dataDir, outputDir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-img-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-img-out-"));
  _setEmbedImpl(async () => null);
});
afterEach(() => {
  _resetImageGenImpl();
  _resetImageLibraryImpl();
  _resetEmbedImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("PUT /api/story/:id/scenes/:sid/image", () => {
  test("an uploaded picture makes that scene ready, and only that scene", async () => {
    const p = quotaHitProject();
    const res = await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const [s0, s1, s2] = readProject(dataDir, p.projectId).scenes;
    assert.equal(s1.imageStatus, "done");
    assert.equal(s1.imageSource, "upload");
    assert.equal(s1.imageError, null);
    assert.ok(fs.existsSync(s1.imagePath), "the picture is kept on disk");
    assert.match(s1.imageUrl, /^\/outputs\//);
    assert.equal(s0.imageUrl, "/outputs/done.png", "other scenes are left alone");
    assert.equal(s2.imageStatus, "error");
  });

  test("a picture from your library can be chosen by id", async () => {
    const p = quotaHitProject();
    const src = path.join(outputDir, "old.png");
    fs.writeFileSync(src, PNG_1X1);
    const entry = await registerImage({ dataDir, outputDir, sourcePath: src, prompt: "earlier", style: "", aspect: "portrait", provider: "x", projectId: "other" });
    const res = await putImage(p, "s2", { libraryId: entry.id });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const s2 = readProject(dataDir, p.projectId).scenes[2];
    assert.equal(s2.imageStatus, "done");
    assert.equal(s2.imagePath, entry.path);
    assert.equal(s2.imageLibraryId, entry.id);
    assert.equal(s2.imageChosenByUser, true);
  });

  test("filling the last missing scene makes the project ready to render", async () => {
    const p = quotaHitProject();
    await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(readProject(dataDir, p.projectId).status, "generating_images", "one scene still has no picture");
    await putImage(p, "s2", { uploadPath: fakeUpload(PNG_1X1, `bg-image-${UUID.replace("0f8", "1a9")}.png`) });
    assert.equal(readProject(dataDir, p.projectId).status, "ready_to_render");
  });

  test("anything that isn't your own upload or library picture is refused", async () => {
    const p = quotaHitProject();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "story-img-elsewhere-"));
    try {
      const cases = [
        { uploadPath: fakeUpload(PNG_1X1, `bg-image-${UUID}.png`, elsewhere) },
        { uploadPath: fakeUpload(PNG_1X1, "anything.png") },
        { uploadPath: fakeUpload(Buffer.from("not an image at all, just text padding ".repeat(10)), `bg-image-${UUID}.png`) },
        { libraryId: "img_doesnotexist" },
        {},
      ];
      for (const body of cases) {
        const res = await putImage(p, "s1", body);
        assert.equal(res.statusCode, 400, `${JSON.stringify(body)} -> ${JSON.stringify(res.payload)}`);
      }
      assert.equal(readProject(dataDir, p.projectId).scenes[1].imageStatus, "error");
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("an unknown project or scene is a 404", async () => {
    const p = quotaHitProject();
    assert.equal((await putImage({ projectId: "nope" }, "s1", { uploadPath: fakeUpload() })).statusCode, 404);
    assert.equal((await putImage(p, "s9", { uploadPath: fakeUpload() })).statusCode, 404);
  });

  test("while images are being generated it waits, so the run can't overwrite it", async () => {
    const p = quotaHitProject();
    let release;
    const gate = new Promise((r) => { release = r; });
    let started = 0;
    _setImageLibraryImpl({ find: async () => [] });
    _setImageGenImpl(async () => { started += 1; await gate; return { ok: false, error: "Daily image limit reached" }; });
    await call("post", "/:id/images", { params: { id: p.projectId } });
    await waitFor(() => started > 0);

    const res = await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(res.statusCode, 409, JSON.stringify(res.payload));

    release();
    await waitFor(() => readProject(dataDir, p.projectId).scenes.every((s) => s.imageStatus !== "generating"));
    await new Promise((r) => setTimeout(r, 20));
    const after = await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(after.statusCode, 200, "once the run ends the picture goes in");
  });

  test("Retry failed images leaves your picture alone", async () => {
    const p = quotaHitProject();
    await putImage(p, "s1", { uploadPath: fakeUpload() });
    const mine = readProject(dataDir, p.projectId).scenes[1].imagePath;
    const asked = [];
    _setImageLibraryImpl({ find: async () => [] });
    _setImageGenImpl(async ({ partNumber }) => { asked.push(partNumber); return { ok: false, error: "quota" }; });
    await call("post", "/:id/images", { params: { id: p.projectId } });
    await waitFor(() => readProject(dataDir, p.projectId).scenes[2].imageStatus === "error" && asked.length > 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(asked, [3], "only the scene still missing a picture is retried");
    assert.equal(readProject(dataDir, p.projectId).scenes[1].imagePath, mine);
  });

  test("regenerating one scene doesn't undo a picture put on another meanwhile", async () => {
    const p = quotaHitProject();
    let release;
    const gate = new Promise((r) => { release = r; });
    const gen = path.join(outputDir, "gen.png");
    fs.writeFileSync(gen, PNG_1X1);
    _setImageGenImpl(async () => { await gate; return { ok: true, path: gen, publicUrl: "/outputs/gen.png" }; });
    const regen = call("post", "/:id/scenes/:sid/regenerate", { params: { id: p.projectId, sid: "s2" } });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await putImage(p, "s1", { uploadPath: fakeUpload() })).statusCode, 200);
    release();
    await regen;
    const scenes = readProject(dataDir, p.projectId).scenes;
    assert.equal(scenes[1].imageSource, "upload", "the upload survived");
    assert.equal(scenes[2].imagePath, gen);
  });
});

describe("GET /api/story/:id/library-images", () => {
  test("lists your pictures by id and URL, never by server path", async () => {
    const p = quotaHitProject();
    const src = path.join(outputDir, "old.png");
    fs.writeFileSync(src, PNG_1X1);
    const entry = await registerImage({ dataDir, outputDir, sourcePath: src, prompt: "earlier", style: "", aspect: "portrait", provider: "x", projectId: "other" });
    const res = await call("get", "/:id/library-images", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.images.map((i) => i.id), [entry.id]);
    assert.ok(!JSON.stringify(res.payload).includes(outputDir.replace(/\\/g, "\\\\")), "no server paths");
    assert.equal((await call("get", "/:id/library-images", { params: { id: "nope" } })).statusCode, 404);
  });
});

describe("a Story render with your own pictures", () => {
  const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

  test("draws the uploaded picture for its scene", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const ff = (args) => assert.equal(spawnSync(FF, ["-y", "-v", "error", ...args]).status, 0);
    // A phone-sized red photo and a blue one, as ChatGPT/Gemini would hand back.
    ff(["-f", "lavfi", "-i", "color=c=red:s=1024x1536", "-frames:v", "1", path.join(outputDir, `bg-image-${UUID}.png`)]);
    const blueName = `bg-image-${UUID.replace("0f8", "2b7")}.jpg`;
    ff(["-f", "lavfi", "-i", "color=c=blue:s=1080x1920", "-frames:v", "1", path.join(outputDir, blueName)]);
    const voice = path.join(outputDir, "voice.m4a");
    ff(["-f", "lavfi", "-i", "sine=d=4", "-c:a", "aac", voice]);

    const p = writeProject(dataDir, { ...createProject(dataDir, { title: "Mine" }), status: "generating_images", scenes: [
      scene(0, { startMs: 0, endMs: 2000 }), scene(1, { startMs: 2000, endMs: 4000 }),
    ] });
    assert.equal((await putImage(p, "s0", { uploadPath: `bg-image-${UUID}.png` })).statusCode, 200);
    assert.equal((await putImage(p, "s1", { uploadPath: blueName })).statusCode, 200);
    const ready = readProject(dataDir, p.projectId);
    assert.equal(ready.status, "ready_to_render");

    const out = path.join(outputDir, "mine.mp4");
    const { args } = buildStoryFfmpegArgs({
      scenes: ready.scenes, words: [], audioPath: voice, musicPath: null, width: 360, height: 640,
      outPath: out, audioDurationSec: 4, captions: "none",
    });
    const r = spawnSync(FF, ["-v", "error", ...args.filter((a, i) => !(a === "-y" && i === 0))]);
    assert.equal(r.status, 0, String(r.stderr).slice(-1500));
    const rgbAt = (t) => [...spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1",
      "-vf", "crop=1:1:180:320,format=rgb24", "-f", "rawvideo", "-"]).stdout.subarray(0, 3)];
    const [r1, , b1] = rgbAt(0.8);
    const [r2, , b2] = rgbAt(3.2);
    assert.ok(r1 > 180 && b1 < 80, `scene 1 should be the red photo, got ${r1},${b1}`);
    assert.ok(b2 > 180 && r2 < 80, `scene 2 should be the blue photo, got ${r2},${b2}`);
  });
});

/** A tiny PNG whose header claims `w`×`h`: what a decompression bomb looks like. */
function pngClaiming(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(64))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("your own picture, where it meets the rest of Story", () => {
  test("a picture claiming a huge canvas is refused before any render tries to decode it", async () => {
    const p = quotaHitProject();
    const res = await putImage(p, "s1", { uploadPath: fakeUpload(pngClaiming(20000, 20000)) });
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.error, /20000×20000/);
  });

  test("an animated WebP is refused: ffmpeg 5.1 can't decode it", async () => {
    const p = quotaHitProject();
    const vp8x = Buffer.alloc(30);
    vp8x.write("RIFF", 0, "ascii"); vp8x.writeUInt32LE(22, 4); vp8x.write("WEBP", 8, "ascii");
    vp8x.write("VP8X", 12, "ascii"); vp8x.writeUInt32LE(10, 16); vp8x[20] = 0x02;
    const res = await putImage(p, "s1", { uploadPath: fakeUpload(vp8x, `bg-image-${UUID}.webp`) });
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /animated/i);
  });

  test("a regenerated scene is no longer marked as yours", async () => {
    const p = quotaHitProject();
    await putImage(p, "s1", { uploadPath: fakeUpload() });
    const gen = path.join(outputDir, "gen.png");
    fs.writeFileSync(gen, PNG_1X1);
    _setImageGenImpl(async () => ({ ok: true, path: gen, publicUrl: "/outputs/gen.png" }));
    await call("post", "/:id/scenes/:sid/regenerate", { params: { id: p.projectId, sid: "s1" } });
    let s1 = readProject(dataDir, p.projectId).scenes[1];
    assert.equal(s1.imageSource, "generated");
    assert.equal(s1.imageChosenByUser, false);

    await putImage(p, "s1", { uploadPath: fakeUpload() });
    _setImageLibraryImpl({ find: async () => [] });
    await call("post", "/:id/images", { params: { id: p.projectId }, body: { force: true } });
    await waitFor(() => readProject(dataDir, p.projectId).scenes.every((s) => s.imageStatus === "done"));
    s1 = readProject(dataDir, p.projectId).scenes[1];
    assert.equal(s1.imageChosenByUser, false, "Regenerate all replaced it");
  });

  test("a scene being regenerated can't take a picture until that finishes", async () => {
    const p = quotaHitProject();
    let release;
    const gate = new Promise((r) => { release = r; });
    _setImageGenImpl(async () => { await gate; return { ok: false, error: "Daily image limit reached" }; });
    const regen = call("post", "/:id/scenes/:sid/regenerate", { params: { id: p.projectId, sid: "s1" } });
    await new Promise((r) => setTimeout(r, 20));
    const res = await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "SCENE_REGENERATING");
    assert.equal((await putImage(p, "s2", { uploadPath: fakeUpload() })).statusCode, 200, "other scenes are free");
    release();
    await regen;
    assert.equal((await putImage(p, "s1", { uploadPath: fakeUpload() })).statusCode, 200);
  });

  test("after a Cancel, filling every scene makes the project ready again", async () => {
    const p = quotaHitProject();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: "error", error: "Cancelled." });
    await putImage(p, "s1", { uploadPath: fakeUpload() });
    await putImage(p, "s2", { uploadPath: fakeUpload() });
    const after = readProject(dataDir, p.projectId);
    assert.equal(after.status, "ready_to_render");
    assert.equal(after.error, null);
  });

  test("a render that died in a restart doesn't lock the pictures", async () => {
    const p = quotaHitProject();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: "rendering", render: { jobId: "gone", outputPath: null, status: "running" } });
    assert.equal((await putImage(p, "s1", { uploadPath: fakeUpload() })).statusCode, 200);
  });

  test("a scene re-segmented away during the upload is a 404, not a silent ok", async () => {
    const p = quotaHitProject();
    _setImageLibraryImpl({
      register: async (args) => {
        writeProject(dataDir, { ...readProject(dataDir, p.projectId), scenes: [] });
        return registerImage(args);
      },
    });
    const res = await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(res.statusCode, 404, JSON.stringify(res.payload));
  });

  test("another account's library picture or upload can't be used", async () => {
    const p = quotaHitProject();
    const otherData = fs.mkdtempSync(path.join(os.tmpdir(), "story-img-other-data-"));
    const otherOut = fs.mkdtempSync(path.join(os.tmpdir(), "story-img-other-out-"));
    try {
      const src = path.join(otherOut, "theirs.png");
      fs.writeFileSync(src, PNG_1X1);
      const theirs = await registerImage({ dataDir: otherData, outputDir: otherOut, sourcePath: src, prompt: "x", style: "", aspect: "portrait", provider: "x", projectId: "o" });
      const theirUpload = fakeUpload(PNG_1X1, `bg-image-${UUID.replace("0f8", "3c4")}.png`, otherOut);
      assert.equal((await putImage(p, "s1", { libraryId: theirs.id })).statusCode, 400);
      assert.equal((await putImage(p, "s1", { uploadPath: theirUpload })).statusCode, 400);
      assert.equal(readProject(dataDir, p.projectId).scenes[1].imageStatus, "error");
    } finally {
      fs.rmSync(otherData, { recursive: true, force: true });
      fs.rmSync(otherOut, { recursive: true, force: true });
    }
  });
});
