import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import storyRouter, {
  _setTranscribeImpl, _resetTranscribeImpl,
  _setImageGenImpl, _resetImageGenImpl,
  _setTtsImpl, _resetTtsImpl,
  _setRenderImpl, _resetRenderImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
} from "./story.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/story/sceneSegmenter.js";
import { _setLlmImpl as _setScriptLlmImpl, _resetLlmImpl as _resetScriptLlmImpl } from "../lib/story/scriptRefine.js";
import { readProject, writeProject, createProject } from "../lib/story/projectStore.js";

function handlerFor(method, routePath) {
  const layer = storyRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method],
  );
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockReqRes({ params = {}, body = {}, dataDir, outputDir }) {
  const req = { params, body, ctx: { userId: "user-1", dataDir, outputDir } };
  const res = {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return { req, res };
}

// Poll a detached pipeline (e.g. /images, /process) until `pred(project)` holds.
async function waitForProject(dataDir, id, pred, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const p = readProject(dataDir, id);
    if (p && pred(p)) return p;
    if (Date.now() - start > timeoutMs) return readProject(dataDir, id);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let dataDir, outputDir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-out-"));
});
afterEach(() => {
  _resetTranscribeImpl(); _resetImageGenImpl(); _resetLlmImpl(); _resetScriptLlmImpl(); _resetTtsImpl(); _resetRenderImpl();
  _resetImageLibraryImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("story routes", () => {
  test("POST / creates a draft project", async () => {
    const { req, res } = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(req, res);
    assert.equal(res.payload.ok, true);
    assert.ok(res.payload.project.projectId);
    assert.equal(res.payload.project.status, "draft");
  });

  test("segment populates scenes and advances status", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      source: { audioPath: "/tmp/voice.mp3", durationMs: 20000 },
      transcript: {
        words: Array.from({ length: 20 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 900 })),
        hash: "abc",
      },
    });
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [
        { text: "a", startWordIndex: 0, endWordIndex: 9, imagePrompt: "p1" },
        { text: "b", startWordIndex: 10, endWordIndex: 19, imagePrompt: "p2" },
      ] }),
    );
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/segment")(req, res);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.project.scenes.length, 2);
    assert.equal(res.payload.project.status, "generating_images");
  });

  test("a scene reuses a library image instead of generating, and never twice in one video", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [
        { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "still waters", imagePath: null, imageStatus: "pending", promptEditedByUser: false },
        { id: "scene-002", text: "b", startMs: 8000, endMs: 16000, imagePrompt: "still waters at dusk", imagePath: null, imageStatus: "pending", promptEditedByUser: false },
      ],
    });
    const generated = [];
    _setImageGenImpl(async ({ partNumber }) => { generated.push(partNumber); return { ok: true, path: `/gen-${partNumber}.png`, publicUrl: `/o/gen-${partNumber}.png`, provider: "cloudflare" }; });
    const claimed = [];
    _setImageLibraryImpl({
      // One library image that matches everything: the second scene must not get it.
      find: async ({ excludeIds }) => (excludeIds.includes("img_a") ? [] : [{ entry: { id: "img_a", path: "/lib/a.png", publicUrl: "/outputs/imageLib/a.png" }, score: 0.91 }]),
      mark: ({ id: libId }) => claimed.push(libId),
      register: async () => null,
    });
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    const after = await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    const fromLibrary = after.scenes.filter((s) => s.imageSource === "library");
    const fromGen = after.scenes.filter((s) => s.imageSource === "generated");
    assert.equal(fromLibrary.length, 1, "exactly one scene reused the single library image");
    assert.equal(fromGen.length, 1, "the other scene had to generate");
    assert.equal(fromLibrary[0].imageUrl, "/outputs/imageLib/a.png");
    assert.equal(fromLibrary[0].imagePath, "/lib/a.png");
    assert.equal(fromLibrary[0].imageReuseScore, 0.91);
    assert.equal(fromLibrary[0].imageLibraryId, "img_a");
    assert.deepEqual(claimed, ["img_a"], "the reuse was recorded once");
    assert.equal(generated.length, 1, "only one scene cost image quota");
  });

  test("a generated scene is harvested, and a harvest failure still leaves it done", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      aspect: "landscape",
      scenes: [{ id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "a candle burning", imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
    });
    _setImageGenImpl(async () => ({ ok: true, path: "/gen-1.png", publicUrl: "/o/gen-1.png", provider: "cloudflare" }));
    const harvested = [];
    _setImageLibraryImpl({
      find: async () => [],
      mark: () => {},
      register: async (args) => { harvested.push(args); throw new Error("disk full"); },
    });
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    const after = await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    assert.equal(after.scenes[0].imageStatus, "done", "a harvest failure never fails the scene");
    assert.equal(after.scenes[0].imageSource, "generated");
    assert.equal(harvested.length, 1);
    assert.equal(harvested[0].prompt, "a candle burning");
    assert.equal(harvested[0].style, "cinematic-bible");
    assert.equal(harvested[0].aspect, "landscape");
    assert.equal(harvested[0].provider, "cloudflare");
  });

  test("the library is asked about the scene's own words, and learns whether the picture is watermark-free", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    const composed = "an apostle writing by lamplight, cinematic biblical scene, dramatic warm lighting, film still, photorealistic, vertical 9:16, no text, no watermark";
    writeProject(dataDir, {
      ...proj,
      scenes: [{ id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: composed, imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
    });
    const sentToGen = [];
    _setImageGenImpl(async ({ rawPrompt }) => { sentToGen.push(rawPrompt); return { ok: true, path: "/gen-1.png", publicUrl: "/o/gen-1.png", provider: "pollinations", watermarkFree: true }; });
    const asked = [];
    const harvested = [];
    _setImageLibraryImpl({
      find: async (args) => { asked.push(args.prompt); return []; },
      mark: () => {},
      register: async (args) => { harvested.push(args); return null; },
    });
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    assert.deepEqual(asked, ["an apostle writing by lamplight"], "matched on the scene, not the style text every scene shares");
    assert.deepEqual(sentToGen, [composed], "the picture is still made from the full prompt");
    assert.equal(harvested[0].prompt, "an apostle writing by lamplight");
    assert.equal(harvested[0].watermarkFree, true);
  });

  test("PATCH /:id/captions stores the look and motion, ignoring nonsense values", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;

    const { req, res } = mockReqRes({
      params: { id },
      body: { captions: "static", captionPreset: "marker", captionMotion: "block", captionLayout: "bottom-left", captionDepth: "soft", captionStagger: true, captionHighlight: true },
      dataDir, outputDir,
    });
    await handlerFor("patch", "/:id/captions")(req, res);
    assert.equal(res.payload.ok, true);
    const p1 = res.payload.project;
    assert.equal(p1.captions, "static");
    assert.equal(p1.captionPreset, "marker");
    assert.equal(p1.captionMotion, "block");
    assert.equal(p1.captionLayout, "bottom-left");
    assert.equal(p1.captionDepth, "soft");
    assert.equal(p1.captionStagger, true);
    assert.equal(p1.captionHighlight, true);

    // A bogus motion/layout is dropped rather than persisted, and fields the
    // body omits keep their current value.
    const second = mockReqRes({ params: { id }, body: { captionMotion: "sideways", captionLayout: "diagonal" }, dataDir, outputDir });
    await handlerFor("patch", "/:id/captions")(second.req, second.res);
    const p2 = second.res.payload.project;
    assert.equal(p2.captionMotion, undefined);
    assert.equal(p2.captionLayout, undefined);
    assert.equal(p2.captionPreset, "marker", "an omitted field is preserved");
    assert.equal(p2.captions, "static");
  });

  test("images stage is idempotent — already-done scenes are skipped", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [
        { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: "/already.png", imageStatus: "done", promptEditedByUser: false },
        { id: "scene-002", text: "b", startMs: 8000, endMs: 16000, imagePrompt: "p2", imagePath: null, imageStatus: "pending", promptEditedByUser: false },
      ],
    });
    let calls = 0;
    _setImageGenImpl(async () => { calls += 1; return { ok: true, path: "/new.png", publicUrl: "/outputs/genImg/p/part-2.png" }; });
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    assert.equal(res.payload.ok, true);
    const after = await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    assert.equal(calls, 1);
    assert.equal(after.scenes[1].imageStatus, "done");
    assert.equal(after.scenes[1].imagePath, "/new.png");
    assert.equal(after.scenes[1].imageUrl, "/outputs/genImg/p/part-2.png");
  });

  test("images stage doesn't hang on a stuck generator — times out and marks the scene error", async () => {
    process.env.STORY_IMAGE_TIMEOUT_MS = "50";
    try {
      const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
      await handlerFor("post", "/")(create.req, create.res);
      const id = create.res.payload.project.projectId;
      const proj = readProject(dataDir, id);
      writeProject(dataDir, {
        ...proj,
        scenes: [
          { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: null, imageStatus: "pending", promptEditedByUser: false },
        ],
      });
      // Generator never resolves — without a timeout this would hang forever.
      _setImageGenImpl(() => new Promise(() => {}));
      const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
      await handlerFor("post", "/:id/images")(req, res);
      assert.equal(res.payload.ok, true);
      const after = await waitForProject(dataDir, id, (p) => p.scenes[0].imageStatus === "error");
      assert.equal(after.scenes[0].imageStatus, "error");
      assert.match(after.scenes[0].imageError || "", /timed out/i); // reason surfaced
      assert.equal(after.status, "generating_images"); // not all done -> stays for resume
    } finally {
      delete process.env.STORY_IMAGE_TIMEOUT_MS;
    }
  });

  test("images stage surfaces a quota error as a friendly reason", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [{ id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
    });
    _setImageGenImpl(async () => ({ ok: false, error: "Cloudflare 429: code 10000 quota exceeded for the day" }));
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    const after = await waitForProject(dataDir, id, (p) => p.scenes[0].imageStatus === "error");
    assert.equal(after.scenes[0].imageStatus, "error");
    assert.match(after.scenes[0].imageError, /quota/i);
  });

  test("force regenerate reruns even already-done scenes", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [
        { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: "/old1.png", imageUrl: "/o/old1.png", imageStatus: "done", promptEditedByUser: false },
        { id: "scene-002", text: "b", startMs: 8000, endMs: 16000, imagePrompt: "p2", imagePath: "/old2.png", imageUrl: "/o/old2.png", imageStatus: "done", promptEditedByUser: false },
      ],
    });
    let calls = 0;
    _setImageGenImpl(async ({ partNumber }) => { calls += 1; return { ok: true, path: `/new-${partNumber}.png`, publicUrl: `/o/new-${partNumber}.png` }; });
    const { req, res } = mockReqRes({ params: { id }, body: { force: true }, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    const after = await waitForProject(dataDir, id, (p) => p.scenes.every((s) => s.imagePath?.startsWith("/new-")));
    assert.equal(calls, 2, "both done scenes regenerated under force");
    assert.equal(after.scenes[0].imagePath, "/new-1.png");
  });

  test("cancel stops a long image run and marks the project cancelled", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    const scenes = Array.from({ length: 8 }, (_, i) => ({
      id: `scene-${String(i + 1).padStart(3, "0")}`, text: `t${i}`, startMs: i * 8000, endMs: (i + 1) * 8000,
      imagePrompt: `p${i}`, imagePath: null, imageStatus: "pending", promptEditedByUser: false,
    }));
    writeProject(dataDir, { ...proj, scenes });
    let calls = 0;
    _setImageGenImpl(async ({ partNumber }) => { calls += 1; await new Promise((r) => setTimeout(r, 40)); return { ok: true, path: `/i-${partNumber}.png`, publicUrl: `/o/i-${partNumber}.png` }; });
    const start = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(start.req, start.res);
    await new Promise((r) => setTimeout(r, 25)); // let a couple begin
    const cancel = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/cancel")(cancel.req, cancel.res);
    assert.equal(cancel.res.payload.ok, true);
    const after = await waitForProject(dataDir, id, (p) => p.status === "error");
    assert.equal(after.status, "error");
    assert.match(after.error || "", /cancel/i);
    assert.ok(calls < scenes.length, `cancel should stop early: ${calls}/${scenes.length} generated`);
  });

  test("images stage generates many scenes concurrently and finishes", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    const scenes = Array.from({ length: 12 }, (_, i) => ({
      id: `scene-${String(i + 1).padStart(3, "0")}`, text: `t${i}`, startMs: i * 8000, endMs: (i + 1) * 8000,
      imagePrompt: `p${i}`, imagePath: null, imageStatus: "pending", promptEditedByUser: false,
    }));
    writeProject(dataDir, { ...proj, scenes });
    let active = 0; let peak = 0;
    _setImageGenImpl(async ({ partNumber }) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return { ok: true, path: `/img-${partNumber}.png`, publicUrl: `/o/img-${partNumber}.png` };
    });
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    const after = await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    assert.equal(after.status, "ready_to_render");
    assert.equal(after.scenes.every((s) => s.imageStatus === "done"), true);
    assert.ok(peak > 1, `expected concurrent generation, peak was ${peak}`);
  });

  test("GET /:id returns the project; unknown id 404s", async () => {
    const { req, res } = mockReqRes({ params: { id: "missing" }, dataDir, outputDir });
    await handlerFor("get", "/:id")(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.ok, false);
  });

  test("PATCH /:id/scenes/:sid edits prompt and marks promptEditedByUser", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [{ id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
    });
    const { req, res } = mockReqRes({ params: { id, sid: "scene-001" }, body: { imagePrompt: "edited prompt" }, dataDir, outputDir });
    await handlerFor("patch", "/:id/scenes/:sid")(req, res);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.project.scenes[0].imagePrompt, "edited prompt");
    assert.equal(res.payload.project.scenes[0].promptEditedByUser, true);
  });

  test("script-to-audio sanitizes pasted markdown and hashtags before TTS", async () => {
    let spokenText = "";
    _setScriptLlmImpl(async () => '*"I can do all things through Christ who strengthens me."* — Philippians 4:13\n\n#Faith');
    _setTtsImpl(async ({ text }) => {
      spokenText = text;
      const file = path.join(outputDir, "story-source.mp3");
      fs.writeFileSync(file, "fake mp3");
      return { ok: true, file };
    });

    const { req, res } = mockReqRes({
      body: { idea: '*"God gives the strongest battles"*\n#Faith', templateId: "short", voiceId: "en-US-JennyNeural" },
      dataDir,
      outputDir,
    });
    await handlerFor("post", "/script-to-audio")(req, res);

    assert.equal(res.payload.ok, true);
    assert.equal(spokenText.includes("#"), false);
    assert.equal(spokenText.includes("*"), false);
    assert.equal(spokenText, "I can do all things through Christ who strengthens me. — Philippians 4:13");
    assert.equal(res.payload.script, spokenText);
  });

  test("PATCH /:id/scenes/:sid sanitizes edited scene text", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [{ id: "scene-001", text: "old", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
    });
    const { req, res } = mockReqRes({
      params: { id, sid: "scene-001" },
      body: { text: '*"So God created mankind in His own image."* — Genesis 1:27\n#Faith' },
      dataDir,
      outputDir,
    });
    await handlerFor("patch", "/:id/scenes/:sid")(req, res);

    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.project.scenes[0].text, "So God created mankind in His own image. — Genesis 1:27");
  });

  test("PATCH /:id/music stores path/volume/autoDuck and clamps; null path clears", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;

    const set = mockReqRes({ params: { id }, body: { path: "/out/music.mp3", volume: 5, autoDuck: true }, dataDir, outputDir });
    await handlerFor("patch", "/:id/music")(set.req, set.res);
    assert.equal(set.res.payload.ok, true);
    assert.equal(set.res.payload.project.music.path, "/out/music.mp3");
    assert.equal(set.res.payload.project.music.volume, 1);
    assert.equal(set.res.payload.project.music.autoDuck, true);

    const clear = mockReqRes({ params: { id }, body: { path: null }, dataDir, outputDir });
    await handlerFor("patch", "/:id/music")(clear.req, clear.res);
    assert.equal(clear.res.payload.project.music.path, null);
  });

  test("regenerate updates only the targeted scene's image", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [
        { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: "/old1.png", imageStatus: "done", promptEditedByUser: false },
        { id: "scene-002", text: "b", startMs: 8000, endMs: 16000, imagePrompt: "p2", imagePath: "/old2.png", imageStatus: "done", promptEditedByUser: false },
      ],
    });
    _setImageGenImpl(async () => ({ ok: true, path: "/regenerated.png" }));
    const { req, res } = mockReqRes({ params: { id, sid: "scene-002" }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/scenes/:sid/regenerate")(req, res);
    assert.equal(res.payload.ok, true);
    const after = readProject(dataDir, id);
    assert.equal(after.scenes[0].imagePath, "/old1.png");        // untouched
    assert.equal(after.scenes[1].imagePath, "/regenerated.png"); // updated
  });

  test("regenerate on a landscape project requests a landscape image", async () => {
    const project = writeProject(dataDir, {
      ...createProject(dataDir, { title: "L", aspect: "landscape" }),
      scenes: [
        { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: "/old1.png", imageStatus: "done", promptEditedByUser: false },
      ],
    });
    const seen = [];
    _setImageGenImpl(async (args) => { seen.push(args); return { ok: true, path: "/regenerated.png" }; });
    const { req, res } = mockReqRes({ params: { id: project.projectId, sid: "scene-001" }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/scenes/:sid/regenerate")(req, res);
    assert.equal(res.payload.ok, true);
    assert.equal(seen[0].aspect, "landscape");
  });

  test("transcribe rejects an empty mediaPath with 400", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const { req, res } = mockReqRes({ params: { id }, body: { mediaPath: "" }, dataDir, outputDir });
    await handlerFor("post", "/:id/transcribe")(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
  });

  test("transcribe rejects a mediaPath outside the user's dirs with 403 (path traversal)", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const evil = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd";
    const { req, res } = mockReqRes({ params: { id }, body: { mediaPath: evil }, dataDir, outputDir });
    await handlerFor("post", "/:id/transcribe")(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.ok, false);
  });

  test("transcribe accepts a path inside outputDir but 400s when the file is missing", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const inside = path.join(outputDir, "does-not-exist.mp3");
    const { req, res } = mockReqRes({ params: { id }, body: { mediaPath: inside }, dataDir, outputDir });
    await handlerFor("post", "/:id/transcribe")(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
  });

  test("DELETE /:id removes the project; 404 for unknown id", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;

    const del = mockReqRes({ params: { id }, dataDir, outputDir });
    await handlerFor("delete", "/:id")(del.req, del.res);
    assert.equal(del.res.payload.ok, true);
    assert.equal(readProject(dataDir, id), null);

    const again = mockReqRes({ params: { id }, dataDir, outputDir });
    await handlerFor("delete", "/:id")(again.req, again.res);
    assert.equal(again.res.statusCode, 404);
    assert.equal(again.res.payload.ok, false);
  });

  test("POST /script-to-audio refines + synthesizes + returns an in-scope audio path", async () => {
    const { _setLlmImpl, _resetLlmImpl } = await import("../lib/story/scriptRefine.js");
    const { _setTtsImpl, _resetTtsImpl } = await import("./story.js");
    _setLlmImpl(async () => "Refined narration.");
    const fakeFs = await import("fs");
    const fakeOs = await import("os");
    const fakePath = await import("path");
    const fakeSrc = fakePath.join(fakeOs.tmpdir(), `fake-tts-${Date.now()}.mp3`);
    fakeFs.writeFileSync(fakeSrc, "ID3fake");
    _setTtsImpl(async () => ({ ok: true, file: fakeSrc, provider: "edge", voice: "x" }));
    try {
      const { req, res } = mockReqRes({ body: { idea: "trust God", templateId: "devotional-30" }, dataDir, outputDir });
      await handlerFor("post", "/script-to-audio")(req, res);
      assert.equal(res.payload.ok, true);
      assert.equal(res.payload.script, "Refined narration.");
      assert.ok(res.payload.file.startsWith(outputDir.replace(/\\/g, "/")) || res.payload.file.startsWith(outputDir));
      assert.ok(fakeFs.existsSync(res.payload.file));
    } finally {
      _resetLlmImpl(); _resetTtsImpl();
    }
  });

  test("POST /script-to-audio 400s on empty idea", async () => {
    const { req, res } = mockReqRes({ body: { idea: "  ", templateId: "custom" }, dataDir, outputDir });
    await handlerFor("post", "/script-to-audio")(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
  });

  test("runStoryPipeline drives a project from a transcript to ready_to_render", async () => {
    const { runStoryPipeline } = await import("./story.js");
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const ffs = await import("fs");
    const fpath = await import("path");
    const audio = fpath.join(outputDir, "voice.mp3");
    ffs.writeFileSync(audio, "ID3");
    _setTranscribeImpl(async () => ({ words: Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })) }));
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 5, imagePrompt: "p" }, { text: "b", startWordIndex: 6, endWordIndex: 11, imagePrompt: "q" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/outputs/img.png" }));
    try {
      await runStoryPipeline({ dataDir, outputDir }, id, audio);
      const p = readProject(dataDir, id);
      assert.equal(p.status, "ready_to_render");
      assert.equal(p.scenes.length, 2);
      assert.equal(p.scenes.every((s) => s.imageStatus === "done"), true);
    } finally {
      _resetTranscribeImpl(); _resetLlmImpl(); _resetImageGenImpl();
    }
  });

  test("runStoryPipeline is re-entrant — skips transcription when a transcript exists", async () => {
    const { runStoryPipeline } = await import("./story.js");
    const fpath = await import("path");
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, { ...proj, transcript: { words: Array.from({ length: 8 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })), hash: "h" } });
    let transcribeCalls = 0;
    _setTranscribeImpl(async () => { transcribeCalls += 1; return { words: [] }; });
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 7, imagePrompt: "p" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/o/img.png" }));
    try {
      await runStoryPipeline({ dataDir, outputDir }, id, fpath.join(outputDir, "nope.mp3"));
      assert.equal(transcribeCalls, 0);
      assert.equal(readProject(dataDir, id).status, "ready_to_render");
    } finally {
      _resetTranscribeImpl(); _resetLlmImpl(); _resetImageGenImpl();
    }
  });

  test("POST /:id/resegment discards old scenes and rebuilds from the existing transcript", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const audio = path.join(outputDir, "voice.mp3");
    fs.writeFileSync(audio, "ID3");
    const proj = readProject(dataDir, id);
    // Simulate a stuck project: a transcript plus a pile of stale scenes.
    writeProject(dataDir, {
      ...proj,
      source: { audioPath: audio, durationMs: 240000 },
      transcript: { words: Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 900 })), hash: "h" },
      scenes: Array.from({ length: 30 }, (_, i) => ({
        id: `scene-${String(i + 1).padStart(3, "0")}`, text: `old${i}`, startMs: i, endMs: i + 1,
        imagePrompt: `old-p${i}`, imagePath: `/old-${i}.png`, imageStatus: "done", promptEditedByUser: false,
      })),
      status: "generating_images",
    });
    let transcribeCalls = 0;
    _setTranscribeImpl(async () => { transcribeCalls += 1; return { words: [] }; });
    _setLlmImpl(async () => JSON.stringify({ scenes: [
      { text: "new-a", startWordIndex: 0, endWordIndex: 19, imagePrompt: "np1" },
      { text: "new-b", startWordIndex: 20, endWordIndex: 39, imagePrompt: "np2" },
    ] }));
    _setImageGenImpl(async ({ partNumber }) => ({ ok: true, path: `/new-${partNumber}.png`, publicUrl: `/o/new-${partNumber}.png` }));

    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/resegment")(req, res);
    assert.equal(res.payload.ok, true);

    // The pipeline runs detached; give the microtasks a moment to settle.
    await new Promise((r) => setTimeout(r, 50));
    const after = readProject(dataDir, id);
    assert.equal(transcribeCalls, 0, "must reuse the existing transcript, not re-transcribe");
    assert.equal(after.scenes.length, 2, "scenes rebuilt with the new (capped) segmentation");
    assert.equal(after.scenes[0].text, "new-a");
    assert.equal(after.status, "ready_to_render");
    assert.equal(after.scenes.every((s) => s.imageStatus === "done"), true);
  });

  test("POST /:id/resegment 400s when there is no transcript to rebuild from", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/resegment")(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.ok, false);
  });

  test("POST /:id/resegment 404s for an unknown project", async () => {
    const { req, res } = mockReqRes({ params: { id: "nope" }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/resegment")(req, res);
    assert.equal(res.statusCode, 404);
  });

  test("landscape projects request landscape images", async () => {
    const seen = [];
    _setImageGenImpl(async (args) => { seen.push(args); return { ok: true, path: path.join(outputDir, "x.png"), publicUrl: "/x.png" }; });
    fs.writeFileSync(path.join(outputDir, "x.png"), "img");
    const project = writeProject(dataDir, {
      ...createProject(dataDir, { title: "L", aspect: "landscape" }),
      scenes: [{ id: "s1", text: "t", startMs: 0, endMs: 1000, imagePrompt: "p", imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
      status: "generating_images",
    });
    const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    await waitForProject(dataDir, project.projectId, (p) => p.scenes[0].imageStatus === "done");
    assert.equal(seen[0].aspect, "landscape");
  });

  test("POST /:id/process returns ok immediately and rejects an out-of-scope mediaPath", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const evil = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd";
    const bad = mockReqRes({ params: { id }, body: { mediaPath: evil }, dataDir, outputDir });
    await handlerFor("post", "/:id/process")(bad.req, bad.res);
    assert.equal(bad.res.statusCode, 403);
  });

  test("POST /:id/process keeps the source's display name and trimmed flag, through transcription", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const audio = path.join(outputDir, "upload.mp3");
    fs.writeFileSync(audio, "ID3");
    _setTranscribeImpl(async () => ({ words: Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })) }));
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 11, imagePrompt: "p" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/outputs/img.png" }));
    const { req, res } = mockReqRes({
      params: { id },
      body: { mediaPath: audio, sourceName: "C:\\fakepath\\My Song (1).mp3", sourceTrimmed: true },
      dataDir, outputDir,
    });
    await handlerFor("post", "/:id/process")(req, res);
    assert.equal(res.payload.ok, true);
    const done = await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    assert.equal(done.status, "ready_to_render");
    assert.equal(done.source.name, "My Song (1).mp3");
    assert.equal(done.source.trimmed, true);
    assert.equal(done.source.audioPath, audio);
    assert.ok(done.source.durationMs > 0);
  });

  test("POST /:id/process sent no display facts (a resume) keeps the ones already stored", async () => {
    const created = createProject(dataDir, { title: "T", style: "cinematic-bible" });
    const id = created.projectId;
    const audio = path.join(outputDir, "narration.mp3");
    fs.writeFileSync(audio, "ID3");
    writeProject(dataDir, { ...created, source: { audioPath: audio, durationMs: 4000, name: "Song.mp3", trimmed: true } });
    _setTranscribeImpl(async () => ({ words: Array.from({ length: 4 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })) }));
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 3, imagePrompt: "p" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/outputs/img.png" }));
    const { req, res } = mockReqRes({ params: { id }, body: { mediaPath: audio }, dataDir, outputDir });
    await handlerFor("post", "/:id/process")(req, res);
    const done = await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
    assert.equal(done.source.name, "Song.mp3");
    assert.equal(done.source.trimmed, true);
  });

  test("POST /:id/process resumes an imported script whose narration is in the shared outputs folder", async () => {
    const { OUTPUT_DIR } = await import("../lib/paths.js");
    const { randomUUID } = await import("crypto");
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const narration = path.join(OUTPUT_DIR, `tts-edge-${randomUUID()}.mp3`);
    fs.writeFileSync(narration, "ID3");
    try {
      const created = createProject(dataDir, { title: "Series part", style: "cinematic-bible" });
      writeProject(dataDir, {
        ...created,
        status: "segmenting",
        source: { audioPath: narration, durationMs: 4000 },
        transcript: { words: Array.from({ length: 4 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })), hash: "imported" },
      });
      _setTranscribeImpl(async () => { throw new Error("an imported script is never transcribed"); });
      _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 3, imagePrompt: "p" }] }));
      _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/outputs/img.png" }));
      const { req, res } = mockReqRes({ params: { id: created.projectId }, body: { mediaPath: narration }, dataDir, outputDir });
      await handlerFor("post", "/:id/process")(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
      const done = await waitForProject(dataDir, created.projectId, (p) => p.status === "ready_to_render");
      assert.equal(done.status, "ready_to_render");
    } finally {
      fs.rmSync(narration, { force: true });
    }
  });

  test("POST /:id/process with a name that cleans to nothing stores no name", async () => {
    const created = createProject(dataDir, { title: "T", style: "cinematic-bible" });
    const audio = path.join(outputDir, "n.mp3");
    fs.writeFileSync(audio, "ID3");
    _setTranscribeImpl(async () => ({ words: [{ text: "w", startMs: 0, endMs: 800 }] }));
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 0, imagePrompt: "p" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/outputs/img.png" }));
    const { req, res } = mockReqRes({ params: { id: created.projectId }, body: { mediaPath: audio, sourceName: "\u0001  ", sourceTrimmed: "yes" }, dataDir, outputDir });
    await handlerFor("post", "/:id/process")(req, res);
    const done = await waitForProject(dataDir, created.projectId, (p) => p.status === "ready_to_render");
    assert.equal("name" in done.source, false);
    assert.equal(done.source.trimmed, false);
  });

  test("render re-cuts a long-form project into visual beats when scene.beatSec is set, and leaves other projects alone", async () => {
    const img = path.join(outputDir, "img.png"); fs.writeFileSync(img, "png");
    const audio = path.join(outputDir, "voice.mp3"); fs.writeFileSync(audio, "mp3");
    const mkScene = (i, startMs, endMs) => ({ id: `s${i}`, text: `t${i}`, imagePrompt: "", imagePath: img, imageUrl: "/x.png", imageStatus: "done", startMs, endMs, promptEditedByUser: false });
    const scenes = [mkScene(1, 0, 150_000), mkScene(2, 150_000, 300_000), mkScene(3, 300_000, 450_000)];
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });

    const lf = createProject(dataDir, { title: "beats", aspect: "landscape", captions: "none", scene: { targetSceneSec: 150, maxScenes: 12, beatSec: 40 } });
    writeProject(dataDir, { ...lf, status: "ready_to_render", scenes, source: { audioPath: audio, durationMs: 450_000 } });
    const a = mockReqRes({ params: { id: lf.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(a.req, a.res);
    assert.equal(a.res.statusCode, 200, JSON.stringify(a.res.payload));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scenes.length, 11, "450 s at 40 s beats");
    assert.equal(calls[0].scenes[calls[0].scenes.length - 1].endMs, 450_000);
    assert.equal(calls[0].width, 1280);
    assert.equal(calls[0].captions, "none");

    const plain = createProject(dataDir, { title: "short" });
    writeProject(dataDir, { ...plain, status: "ready_to_render", scenes, source: { audioPath: audio, durationMs: 450_000 } });
    const b = mockReqRes({ params: { id: plain.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(b.req, b.res);
    assert.equal(b.res.statusCode, 200, JSON.stringify(b.res.payload));
    assert.deepEqual(calls[1].scenes, scenes, "no beatSec: the scenes go through untouched");
  });

  // Finding 2 regression: a forgotten/deleted mylib: track (or a stale
  // library: id) must degrade the render to no music, not crash the whole
  // video. Before the fix, story.js fell back to the literal ref string
  // (`project.music?.path`), which reached buildStoryFfmpegArgs as a
  // nonexistent `-i mylib:<uuid>` and killed the entire render.
  test("render drops the music bed instead of failing when the project's mylib ref no longer resolves", async () => {
    const img = path.join(outputDir, "img.png"); fs.writeFileSync(img, "png");
    const audio = path.join(outputDir, "voice.mp3"); fs.writeFileSync(audio, "mp3");
    const mkScene = (i, startMs, endMs) => ({ id: `s${i}`, text: `t${i}`, imagePrompt: "", imagePath: img, imageUrl: "/x.png", imageStatus: "done", startMs, endMs, promptEditedByUser: false });
    const scenes = [mkScene(1, 0, 8000)];
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });

    const project = createProject(dataDir, { title: "gone-track" });
    writeProject(dataDir, {
      ...project,
      status: "ready_to_render",
      scenes,
      source: { audioPath: audio, durationMs: 8000 },
      // Never registered in this tenant's musicLibrary.json (forgotten, or
      // simply never existed) — resolveTenantTrack must return null for it.
      music: { path: "mylib:00000000-0000-0000-0000-000000000000", volume: 0.3, autoDuck: true },
    });
    const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(req, res);

    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].musicPath, null, "an unresolved mylib ref must not reach the renderer as a raw string");
  });

  // ffmpeg fetches a URL input itself with no SSRF check, so a music path the
  // user stored as a URL must be localised through the guard, and a private
  // or metadata address refused before any job starts.
  function remoteProject({ music, audioPath }) {
    const img = path.join(outputDir, "img.png"); fs.writeFileSync(img, "png");
    const audio = path.join(outputDir, "voice.mp3"); fs.writeFileSync(audio, "mp3");
    const scenes = [{ id: "s1", text: "t", imagePrompt: "", imagePath: img, imageUrl: "/x.png", imageStatus: "done", startMs: 0, endMs: 8000, promptEditedByUser: false }];
    const project = createProject(dataDir, { title: "remote" });
    writeProject(dataDir, {
      ...project,
      status: "ready_to_render",
      scenes,
      source: { audioPath: audioPath ?? audio, durationMs: 8000 },
      ...(music ? { music: { path: music, volume: 0.3, autoDuck: true } } : {}),
    });
    return project;
  }

  test("render refuses a private music URL with 400 before any job starts", async () => {
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
    const project = remoteProject({ music: "http://169.254.169.254/latest/meta-data/bed.mp3" });
    const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.ok(String(res.payload.error).startsWith("URL_PRIVATE: "), res.payload.error);
    assert.equal(calls.length, 0);
    assert.equal(readProject(dataDir, project.projectId).status, "ready_to_render");
  });

  test("render refuses a project whose source audio is a URL", async () => {
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
    const project = remoteProject({ audioPath: "http://127.0.0.1:1/voice.mp3" });
    const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(req, res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.payload));
    assert.match(res.payload.error, /audio/i);
    assert.equal(calls.length, 0);
    assert.equal(readProject(dataDir, project.projectId).status, "ready_to_render");
  });

  test("render refuses stored audio that is a URL in any form, or another account's file", async () => {
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-other-"));
    const theirs = path.join(other, "their-voice.mp3"); fs.writeFileSync(theirs, "mp3");
    for (const audioPath of ["http:/127.0.0.1:1/voice.mp3", "tcp://127.0.0.1:1", theirs]) {
      const project = remoteProject({ audioPath });
      const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
      await handlerFor("post", "/:id/render")(req, res);
      assert.equal(res.statusCode, 400, `${audioPath}: ${JSON.stringify(res.payload)}`);
      assert.match(res.payload.error, /audio/i);
      assert.equal(readProject(dataDir, project.projectId).status, "ready_to_render");
    }
    assert.equal(calls.length, 0);
    fs.rmSync(other, { recursive: true, force: true });
  });

  test("resegment refuses stored audio outside the caller's folders", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-other-"));
    const theirs = path.join(other, "their-voice.mp3"); fs.writeFileSync(theirs, "mp3");
    for (const audioPath of ["tcp://127.0.0.1:1", theirs]) {
      const project = remoteProject({ audioPath });
      writeProject(dataDir, { ...readProject(dataDir, project.projectId), transcript: { words: [{ text: "hi", startMs: 0, endMs: 500 }] } });
      const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
      await handlerFor("post", "/:id/resegment")(req, res);
      assert.equal(res.statusCode, 400, `${audioPath}: ${JSON.stringify(res.payload)}`);
      assert.match(res.payload.error, /audio/i);
      assert.equal(readProject(dataDir, project.projectId).scenes.length, 1, "scenes left as they were");
    }
    fs.rmSync(other, { recursive: true, force: true });
  });

  test("render passes the confined audio path on to the renderer", async () => {
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
    const project = remoteProject({});
    const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(calls[0].audioPath, path.resolve(outputDir, "voice.mp3"));
  });

  test("a local music path still reaches the renderer unchanged", async () => {
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
    const bed = path.join(outputDir, "bed.mp3"); fs.writeFileSync(bed, "mp3");
    const project = remoteProject({ music: bed });
    const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(calls[0].musicPath, bed);
  });
});

describe("output frame", () => {
  const readyProject = (over = {}) => {
    const img = path.join(outputDir, "img.png"); fs.writeFileSync(img, "png");
    const audio = path.join(outputDir, "voice.mp3"); fs.writeFileSync(audio, "mp3");
    const scenes = [{ id: "s1", text: "t", imagePrompt: "", imagePath: img, imageUrl: "/x.png", imageStatus: "done", startMs: 0, endMs: 4000, promptEditedByUser: false }];
    const p = createProject(dataDir, { title: "frame", ...over });
    return writeProject(dataDir, { ...p, status: "ready_to_render", scenes, source: { audioPath: audio, durationMs: 4000 } });
  };

  test("a square project renders a square video", async () => {
    const calls = [];
    _setRenderImpl(async (args) => { calls.push(args); return { ok: true, outputPath: args.outPath }; });
    const p = readyProject({ aspect: "square" });
    const { req, res } = mockReqRes({ params: { id: p.projectId }, dataDir, outputDir });
    await handlerFor("post", "/:id/render")(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(calls[0].width, 1080);
    assert.equal(calls[0].height, 1080);
  });

  test("PATCH /:id/aspect changes the frame of an existing project", () => {
    const p = readyProject();
    const { req, res } = mockReqRes({ params: { id: p.projectId }, body: { aspect: "landscape" }, dataDir, outputDir });
    handlerFor("patch", "/:id/aspect")(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.equal(res.payload.project.aspect, "landscape");
    assert.equal(readProject(dataDir, p.projectId).aspect, "landscape");
    assert.match(res.payload.note, /1 scene image/);
  });

  test("PATCH /:id/aspect refuses an unknown frame", () => {
    const p = readyProject();
    const { req, res } = mockReqRes({ params: { id: p.projectId }, body: { aspect: "wide" }, dataDir, outputDir });
    handlerFor("patch", "/:id/aspect")(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(readProject(dataDir, p.projectId).aspect, "portrait");
  });

  test("PATCH /:id/aspect waits while the video is rendering", () => {
    const p = writeProject(dataDir, { ...readyProject(), status: "rendering" });
    const { req, res } = mockReqRes({ params: { id: p.projectId }, body: { aspect: "square" }, dataDir, outputDir });
    handlerFor("patch", "/:id/aspect")(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(readProject(dataDir, p.projectId).aspect, "portrait");
  });

  for (const status of ["transcribing", "segmenting", "generating_images", "narrating"]) {
    test(`PATCH /:id/aspect waits while the project is ${status}`, () => {
      const p = writeProject(dataDir, { ...readyProject(), status });
      const { req, res } = mockReqRes({ params: { id: p.projectId }, body: { aspect: "landscape" }, dataDir, outputDir });
      handlerFor("patch", "/:id/aspect")(req, res);
      assert.equal(res.statusCode, 409);
      assert.equal(readProject(dataDir, p.projectId).aspect, "portrait");
    });
  }

  test("PATCH /:id/aspect on a finished video says to render again", () => {
    const p = writeProject(dataDir, { ...readyProject(), status: "done" });
    const { req, res } = mockReqRes({ params: { id: p.projectId }, body: { aspect: "square" }, dataDir, outputDir });
    handlerFor("patch", "/:id/aspect")(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.payload.note, /render again/i);
  });

  test("PATCH /:id/aspect on a missing project is 404", () => {
    const { req, res } = mockReqRes({ params: { id: "nope" }, body: { aspect: "square" }, dataDir, outputDir });
    handlerFor("patch", "/:id/aspect")(req, res);
    assert.equal(res.statusCode, 404);
  });
});

describe("auto-animate hook after the images stage", () => {
  const scenesWith = (statuses) => statuses.map((st, i) => ({
    id: `scene-${i}`, text: "a", startMs: i * 5000, endMs: i * 5000 + 5000, imagePrompt: `p${i}`,
    imagePath: st === "done" ? `/done-${i}.png` : null, imageStatus: st, promptEditedByUser: false,
  }));

  async function runImages(statuses, imageResult) {
    const { _setAutoAnimateImpl, sceneImageBlocked } = await import("./story.js");
    const p = createProject(dataDir, { title: "T", aiMotion: true });
    writeProject(dataDir, { ...p, scenes: scenesWith(statuses) });
    const calls = [];
    _setAutoAnimateImpl(async (ctx, projectId) => {
      // The image run has let go of the scenes before animation starts.
      calls.push({ ctx, projectId, blocked: sceneImageBlocked(readProject(ctx.dataDir, projectId), "scene-0") });
    });
    _setImageGenImpl(async () => imageResult);
    const { req, res } = mockReqRes({ params: { id: p.projectId }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    assert.equal(res.payload.ok, true);
    return { id: p.projectId, calls };
  }

  test("a run that finishes every picture hands over to auto-animate, after the run lets go", async () => {
    const { _resetAutoAnimateImpl } = await import("./story.js");
    try {
      const { id, calls } = await runImages(["done", "pending"], { ok: true, path: "/new.png", publicUrl: "/o/new.png" });
      await waitForProject(dataDir, id, (p) => p.status === "ready_to_render");
      const start = Date.now();
      while (!calls.length && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 5));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].projectId, id);
      assert.equal(calls[0].ctx.dataDir, dataDir);
      assert.equal(calls[0].ctx.outputDir, outputDir);
      assert.equal(calls[0].blocked, null, "no IMAGES_RUNNING lock is left when animation starts");
    } finally {
      _resetAutoAnimateImpl();
    }
  });

  test("a run that leaves a picture missing does not auto-animate", async () => {
    const { _resetAutoAnimateImpl } = await import("./story.js");
    try {
      const { id, calls } = await runImages(["pending"], { ok: false, error: "quota exceeded" });
      await waitForProject(dataDir, id, (p) => p.scenes[0].imageStatus === "error");
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(readProject(dataDir, id).status, "generating_images");
      assert.equal(calls.length, 0);
    } finally {
      _resetAutoAnimateImpl();
    }
  });

  test("two image runs at once: auto-animate waits for the last one, and fires once", async () => {
    const { _setAutoAnimateImpl, _resetAutoAnimateImpl } = await import("./story.js");
    const p = createProject(dataDir, { title: "T", aiMotion: true });
    writeProject(dataDir, { ...p, scenes: scenesWith(["pending"]) });
    const calls = [];
    _setAutoAnimateImpl(async (ctx, projectId) => { calls.push(projectId); });
    _setImageLibraryImpl({ find: async () => [], register: async () => null });
    const gates = [];
    _setImageGenImpl(() => new Promise((resolve) => {
      gates.push(() => resolve({ ok: true, path: `/n-${gates.length}.png`, publicUrl: "/o/n.png" }));
    }));
    const settle = () => new Promise((r) => setTimeout(r, 30));
    try {
      const first = mockReqRes({ params: { id: p.projectId }, body: {}, dataDir, outputDir });
      await handlerFor("post", "/:id/images")(first.req, first.res);
      const second = mockReqRes({ params: { id: p.projectId }, body: {}, dataDir, outputDir });
      await handlerFor("post", "/:id/images")(second.req, second.res);
      const start = Date.now();
      while (gates.length < 2 && Date.now() - start < 2000) await settle();
      assert.equal(gates.length, 2, "both runs are generating");
      gates[0]();
      await waitForProject(dataDir, p.projectId, (x) => x.status === "ready_to_render");
      await settle();
      assert.equal(calls.length, 0, "the other run still holds the scenes");
      gates[1]();
      const t = Date.now();
      while (!calls.length && Date.now() - t < 2000) await settle();
      await settle();
      assert.deepEqual(calls, [p.projectId]);
    } finally {
      _resetAutoAnimateImpl();
    }
  });

  test("a scene being regenerated is not queued by auto-animate", async () => {
    const { _setAutoAnimateImpl, _resetAutoAnimateImpl } = await import("./story.js");
    const { autoAnimate } = await import("../lib/story/autoAnimate.js");
    const { isAnimating } = await import("../lib/story/animateStage.js");
    const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-ledger-"));
    const savedKey = process.env.BYTEPLUS_ARK_API_KEY;
    process.env.BYTEPLUS_ARK_API_KEY = "ark-test";
    const pics = [0, 1].map((i) => { const f = path.join(outputDir, `pic-${i}.png`); fs.writeFileSync(f, "png"); return f; });
    const p = createProject(dataDir, { title: "T", aiMotion: true });
    writeProject(dataDir, {
      ...p,
      scenes: [
        { id: "scene-0", text: "a", startMs: 0, endMs: 5000, imagePrompt: "p0", imagePath: null, imageStatus: "pending", promptEditedByUser: false },
        { id: "scene-1", text: "b", startMs: 5000, endMs: 10000, imagePrompt: "p1", imagePath: pics[1], imageStatus: "done", promptEditedByUser: false },
      ],
    });
    const submitted = [];
    const deps = {
      submit: async (args) => { submitted.push(args); return { ok: true, taskId: `t-${submitted.length}`, mode: "image" }; },
      wait: async () => ({ ok: true, videoUrl: "https://cdn/t.mp4", tokens: 108000 }),
      download: async (_u, dest) => { fs.writeFileSync(dest, "mp4"); return 3; },
      resolveClip: async ({ outputDir: dir, uploadPath }) => ({ ok: true, videoPath: path.join(dir, uploadPath), videoUrl: `/outputs/${uploadPath}`, posterPath: null }),
      now: () => Date.now(),
    };
    let hooked = false;
    _setAutoAnimateImpl(async (ctx, projectId, opts) => {
      await autoAnimate(ctx, projectId, { ...opts, ledgerDir, deps });
      hooked = true;
    });
    _setImageLibraryImpl({ find: async () => [], register: async () => null });
    let releaseRegen;
    _setImageGenImpl(({ rawPrompt }) => (rawPrompt === "p1"
      ? new Promise((resolve) => { releaseRegen = () => resolve({ ok: true, path: pics[1], publicUrl: "/o/pic-1.png" }); })
      : Promise.resolve({ ok: true, path: pics[0], publicUrl: "/o/pic-0.png" })));
    try {
      const regen = mockReqRes({ params: { id: p.projectId, sid: "scene-1" }, body: {}, dataDir, outputDir });
      const regenDone = handlerFor("post", "/:id/scenes/:sid/regenerate")(regen.req, regen.res);
      const images = mockReqRes({ params: { id: p.projectId }, body: {}, dataDir, outputDir });
      await handlerFor("post", "/:id/images")(images.req, images.res);
      const start = Date.now();
      while (!hooked && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 5));
      assert.ok(hooked, "the hook ran");
      const after = readProject(dataDir, p.projectId);
      assert.ok(after.scenes[0].aiVideoStatus, "the finished scene is animated");
      assert.equal(after.scenes[1].aiVideoStatus, undefined, "the scene being regenerated is left alone");
      releaseRegen();
      await regenDone;
      const t = Date.now();
      while (isAnimating(p.projectId) && Date.now() - t < 2000) await new Promise((r) => setTimeout(r, 5));
      assert.equal(submitted.length, 1);
    } finally {
      _resetAutoAnimateImpl();
      if (savedKey === undefined) delete process.env.BYTEPLUS_ARK_API_KEY; else process.env.BYTEPLUS_ARK_API_KEY = savedKey;
      fs.rmSync(ledgerDir, { recursive: true, force: true });
    }
  });

  test("an auto-animate that throws never fails the images stage", async () => {
    const { _setAutoAnimateImpl, _resetAutoAnimateImpl, runStoryPipeline } = await import("./story.js");
    const p = createProject(dataDir, { title: "T", aiMotion: true });
    writeProject(dataDir, { ...p, transcript: { words: [{ text: "w", startMs: 0, endMs: 500 }], hash: "h" }, scenes: scenesWith(["pending"]) });
    _setAutoAnimateImpl(async () => { throw new Error("boom"); });
    _setImageGenImpl(async () => ({ ok: true, path: "/n.png", publicUrl: "/o/n.png" }));
    const warn = console.warn;
    console.warn = () => {};
    try {
      await runStoryPipeline({ dataDir, outputDir }, p.projectId, path.join(outputDir, "x.mp3"));
      assert.equal(readProject(dataDir, p.projectId).status, "ready_to_render");
    } finally {
      console.warn = warn;
      _resetAutoAnimateImpl();
    }
  });
});
