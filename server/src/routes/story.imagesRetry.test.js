import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import storyRouter, {
  _setImageGenImpl, _resetImageGenImpl, _setImageLibraryImpl, _resetImageLibraryImpl,
} from "./story.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/story/sceneSegmenter.js";
import { readProject, writeProject, createProject } from "../lib/story/projectStore.js";

// A retried images run, as an agent waiting on the story sees it right after the request.

function handlerFor(method, routePath) {
  const layer = storyRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function call(method, routePath, { params = {}, body = {} } = {}) {
  const req = { params, body, query: {}, ctx: { userId: "user-1", dataDir, outputDir } };
  const res = {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return Promise.resolve(handlerFor(method, routePath)(req, res)).then(() => res);
}

async function waitFor(id, pred, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const p = readProject(dataDir, id);
    if (p && pred(p)) return p;
    if (Date.now() - start > timeoutMs) return readProject(dataDir, id);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let dataDir;
let outputDir;
let release = () => {};
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-fix-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-fix-out-"));
});
afterEach(() => {
  release();
  _resetImageGenImpl();
  _resetImageLibraryImpl();
  _resetLlmImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
});

const sceneAt = (n, fields) => ({
  id: `scene-00${n}`, text: `t${n}`, startMs: (n - 1) * 8000, endMs: n * 8000, imagePrompt: `p${n}`, promptEditedByUser: false, ...fields,
});

test("a retried images run shows the failed scenes as generating at once, not their old error", async () => {
  const project = createProject(dataDir, { title: "Retry" });
  writeProject(dataDir, {
    ...project,
    status: "generating_images",
    scenes: [
      sceneAt(1, { imageStatus: "done", imagePath: "/done.png" }),
      sceneAt(2, { imageStatus: "error", imagePath: null, imageError: "Daily free image quota used up." }),
    ],
  });
  // Hold the run on its library lookup, so the state right after the request is what is read.
  const held = new Promise((resolve) => { release = () => resolve([]); });
  _setImageLibraryImpl({ find: () => held, mark: () => {}, register: async () => null });
  _setImageGenImpl(async () => ({ ok: true, path: "/new.png", publicUrl: "/outputs/new.png" }));
  const res = await call("post", "/:id/images", { params: { id: project.projectId } });
  assert.equal(res.payload.ok, true);
  const now = readProject(dataDir, project.projectId);
  assert.equal(now.status, "generating_images");
  assert.equal(now.error, null);
  assert.equal(now.scenes[1].imageStatus, "generating");
  assert.equal(res.payload.project.scenes[1].imageStatus, "generating");
  release();
  const done = await waitFor(project.projectId, (p) => p.status === "ready_to_render");
  assert.equal(done.scenes[1].imageStatus, "done");
});
