import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import storyRouter, {
  _setTranscribeImpl, _resetTranscribeImpl,
  _setImageGenImpl, _resetImageGenImpl,
} from "./story.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/story/sceneSegmenter.js";
import { readProject, writeProject } from "../lib/story/projectStore.js";

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

let dataDir, outputDir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-out-"));
});
afterEach(() => {
  _resetTranscribeImpl(); _resetImageGenImpl(); _resetLlmImpl();
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
    _setImageGenImpl(async () => { calls += 1; return { ok: true, path: "/new.png" }; });
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    assert.equal(res.payload.ok, true);
    assert.equal(calls, 1);
    const after = readProject(dataDir, id);
    assert.equal(after.scenes[1].imageStatus, "done");
    assert.equal(after.scenes[1].imagePath, "/new.png");
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
});
