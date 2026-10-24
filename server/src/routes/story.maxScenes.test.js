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

// R44: an agent passes the scene count it was charged for as maxScenes; the segmenter makes no more.

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

// ---- maxScenes (R44): an agent's charged estimate is the most scenes the segmenter may make ----

const words = (n) => Array.from({ length: n }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: (i + 1) * 1000 }));
const llmScenes = (count, perScene) => JSON.stringify({
  scenes: Array.from({ length: count }, (_, i) => ({
    startWordIndex: i * perScene, endWordIndex: (i + 1) * perScene - 1, text: `s${i}`, imagePrompt: `prompt ${i}`,
  })),
});

function importedProject(wordCount) {
  const project = createProject(dataDir, { title: "Imported" });
  const audio = path.join(outputDir, "voice.mp3");
  fs.writeFileSync(audio, "x");
  return writeProject(dataDir, {
    ...project,
    status: "segmenting",
    source: { audioPath: audio, durationMs: wordCount * 1000 },
    transcript: { words: words(wordCount), hash: "h" },
  });
}

test("POST /:id/process with maxScenes makes no more scenes than that", async () => {
  const project = importedProject(40);
  // The AI split asks for 5 scenes of 8 words; the agent was charged for 2.
  _setLlmImpl(async () => llmScenes(5, 8));
  _setImageLibraryImpl({ find: async () => [], mark: () => {}, register: async () => null });
  _setImageGenImpl(async () => ({ ok: true, path: "/new.png" }));
  const res = await call("post", "/:id/process", { params: { id: project.projectId }, body: { mediaPath: path.join(outputDir, "voice.mp3"), maxScenes: 2 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  const done = await waitFor(project.projectId, (p) => p.status === "ready_to_render");
  assert.ok(done.scenes.length >= 1 && done.scenes.length <= 2, `got ${done.scenes.length} scenes`);
  // The limit is for this run only: the project's own scene policy is untouched.
  assert.equal(done.scene?.maxScenes, undefined);
});

test("POST /:id/process without maxScenes keeps the app's own split", async () => {
  const project = importedProject(40);
  _setLlmImpl(async () => llmScenes(5, 8));
  _setImageLibraryImpl({ find: async () => [], mark: () => {}, register: async () => null });
  _setImageGenImpl(async () => ({ ok: true, path: "/new.png" }));
  await call("post", "/:id/process", { params: { id: project.projectId }, body: { mediaPath: path.join(outputDir, "voice.mp3") } });
  const done = await waitFor(project.projectId, (p) => p.status === "ready_to_render");
  assert.equal(done.scenes.length, 5);
});

test("POST /:id/resegment with maxScenes makes no more scenes than that", async () => {
  const project = importedProject(40);
  writeProject(dataDir, { ...readProject(dataDir, project.projectId), status: "done", scenes: [sceneAt(1, { imageStatus: "done", imagePath: "/a.png" })] });
  _setLlmImpl(async () => llmScenes(5, 8));
  _setImageLibraryImpl({ find: async () => [], mark: () => {}, register: async () => null });
  _setImageGenImpl(async () => ({ ok: true, path: "/new.png" }));
  const res = await call("post", "/:id/resegment", { params: { id: project.projectId }, body: { maxScenes: 3 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  const done = await waitFor(project.projectId, (p) => p.status === "ready_to_render");
  assert.ok(done.scenes.length >= 1 && done.scenes.length <= 3, `got ${done.scenes.length} scenes`);
});

test("maxScenes must be a whole number from 1 to 60", async () => {
  const project = importedProject(10);
  for (const maxScenes of [0, 61, 2.5, "3", -1]) {
    const res = await call("post", "/:id/process", { params: { id: project.projectId }, body: { mediaPath: path.join(outputDir, "voice.mp3"), maxScenes } });
    assert.equal(res.statusCode, 400, String(maxScenes));
    const again = await call("post", "/:id/resegment", { params: { id: project.projectId }, body: { maxScenes } });
    assert.equal(again.statusCode, 400, String(maxScenes));
  }
});
