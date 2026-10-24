// R50 for Story: a step a restart or deploy killed reads `interrupted`; one
// still running (here, or in another process that keeps beating) does not.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import storyRouter, {
  _setImageGenImpl, _resetImageGenImpl, _setImageLibraryImpl, _resetImageLibraryImpl,
  _setRenderImpl, _resetRenderImpl,
} from "./story.js";
import { createProject, readProject, writeProject } from "../lib/story/projectStore.js";
import { createJob } from "../lib/renderJobs.js";
import { _setStoryHeartbeatMsForTests } from "../lib/story/storyLiveness.js";

let dataDir;
let app;
let release = () => {};

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-restart-"));
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir: dataDir }; next(); });
  app.use("/api/story", storyRouter);
});
afterEach(() => {
  release();
  _resetImageGenImpl(); _resetImageLibraryImpl(); _resetRenderImpl();
  _setStoryHeartbeatMsForTests(null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const scene = (n, fields = {}) => ({
  id: `scene-00${n}`, text: `t${n}`, startMs: (n - 1) * 4000, endMs: n * 4000, imagePrompt: `p${n}`,
  imageStatus: "done", imagePath: `/img/${n}.png`, ...fields,
});

/** A project stored as a process last wrote it `agoMs` ago (its updatedAt, and its heartbeat if `beatAgoMs`). */
function storedAgo(fields, agoMs, beatAgoMs = null) {
  const project = createProject(dataDir, { title: "Psalm 23" });
  const file = path.join(dataDir, "story-projects", `${project.projectId}.json`);
  const heartbeat = beatAgoMs === null ? {} : { heartbeatAt: Date.now() - beatAgoMs };
  fs.writeFileSync(file, JSON.stringify({ ...project, ...fields, ...heartbeat, updatedAt: Date.now() - agoMs }));
  return project.projectId;
}

const interrupted = async (id) => (await request(app).get(`/api/story/${id}`)).body.interrupted;

async function waitFor(id, pred, ms = 3000) {
  const start = Date.now();
  for (;;) {
    const p = readProject(dataDir, id);
    if (p && pred(p)) return p;
    if (Date.now() - start > ms) return p;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const gated = () => {
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  release = open;
  return gate;
};

describe("GET /api/story/:id interrupted", () => {
  const BUSY = {
    rendering: { status: "rendering", render: { jobId: "gone", status: "running" }, scenes: [scene(1)] },
    transcribing: { status: "transcribing" },
    segmenting: { status: "segmenting" },
    generating_images: { status: "generating_images", scenes: [scene(1), scene(2, { imageStatus: "generating", imagePath: null })] },
    animating: { status: "ready_to_render", scenes: [scene(1, { aiVideoStatus: "generating" })] },
  };

  test("a busy step with nothing live here and no sign of life for over two minutes is interrupted", async () => {
    for (const [name, fields] of Object.entries(BUSY)) {
      const id = storedAgo(fields, 3 * 60_000);
      assert.equal(await interrupted(id), true, name);
      assert.equal(readProject(dataDir, id).status, fields.status, "the project itself is left as stored");
    }
  });

  test("idle projects are never interrupted, however old", async () => {
    const idle = [
      { status: "draft" }, { status: "ready_to_render", scenes: [scene(1)] }, { status: "done" }, { status: "error", error: "x" },
      { status: "generating_images", scenes: [scene(1, { imageStatus: "pending", imagePath: null })] },
      { status: "narrating" },
    ];
    for (const fields of idle) assert.equal(await interrupted(storedAgo(fields, 60 * 60_000)), undefined, JSON.stringify(fields));
  });

  test("a recent heartbeat (another process still running it) is not flagged; a stale one is", async () => {
    assert.equal(await interrupted(storedAgo(BUSY.rendering, 10 * 60_000, 30_000)), undefined);
    assert.equal(await interrupted(storedAgo(BUSY.rendering, 10 * 60_000, 3 * 60_000)), true);
    assert.equal(await interrupted(storedAgo(BUSY.transcribing, 30_000)), undefined, "a recent write counts too");
  });

  test("a render job live in this process is never flagged", async () => {
    const job = createJob("u1", { durationSec: 8 });
    const id = storedAgo({ ...BUSY.rendering, render: { jobId: job.jobId, status: "running" } }, 10 * 60_000);
    assert.equal(await interrupted(id), undefined);
  });

  test("an images run in this process is never flagged, and it beats as it goes", async () => {
    _setStoryHeartbeatMsForTests(15);
    const gate = gated();
    _setImageLibraryImpl({ find: async () => [], register: async () => null, mark: () => {} });
    _setImageGenImpl(async ({ partNumber }) => { await gate; return { ok: true, path: `/gen/${partNumber}.png` }; });
    const id = storedAgo({ status: "ready_to_render", scenes: [scene(1, { imageStatus: "pending", imagePath: null })] }, 10 * 60_000);
    const started = Date.now();
    await request(app).post(`/api/story/${id}/images`).send({});
    assert.ok(Number(readProject(dataDir, id).heartbeatAt) >= started, "the first beat is written at the start");
    const before = Number(readProject(dataDir, id).heartbeatAt);
    const beating = await waitFor(id, (p) => Number(p.heartbeatAt) > before, 2000);
    assert.ok(Number(beating.heartbeatAt) > before, "and again while it runs");
    const file = path.join(dataDir, "story-projects", `${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...beating, heartbeatAt: 1, updatedAt: 1 }));
    assert.equal(await interrupted(id), undefined);
    release();
    assert.equal((await waitFor(id, (p) => p.status === "ready_to_render")).status, "ready_to_render");
  });

  test("an image run's own writes keep the heartbeat fresh", async () => {
    const gate = gated();
    _setImageLibraryImpl({ find: async () => [], register: async () => null, mark: () => {} });
    let made = 0;
    _setImageGenImpl(async ({ partNumber }) => {
      made += 1;
      if (made > 1) await gate;
      return { ok: true, path: `/gen/${partNumber}.png` };
    });
    const pending = { imageStatus: "pending", imagePath: null };
    const id = storedAgo({ status: "ready_to_render", heartbeatAt: 5, scenes: [scene(1, pending), scene(2, pending)] }, 10 * 60_000);
    process.env.STORY_IMAGE_CONCURRENCY = "1";
    try {
      const before = Date.now();
      await request(app).post(`/api/story/${id}/images`).send({});
      const one = await waitFor(id, (p) => p.scenes[0].imageStatus === "done");
      assert.ok(Number(one.heartbeatAt) >= before, "a write from the run's own copy does not put an old heartbeat back");
    } finally {
      delete process.env.STORY_IMAGE_CONCURRENCY;
      release();
      await waitFor(id, (p) => p.status === "ready_to_render");
    }
  });

  test("a render beats while it runs", async () => {
    _setStoryHeartbeatMsForTests(15);
    const gate = gated();
    _setRenderImpl(async (args) => { await gate; return { ok: true, outputPath: args.outPath }; });
    // Render re-checks the narration is the caller's own existing file, so it must exist.
    const narration = path.join(dataDir, "narration.mp3");
    fs.writeFileSync(narration, "x");
    const id = storedAgo({ status: "ready_to_render", scenes: [scene(1)], source: { audioPath: narration } }, 10 * 60_000);
    const started = await request(app).post(`/api/story/${id}/render`).send({});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const beating = await waitFor(id, (p) => Number(p.heartbeatAt) > 0, 3000);
    assert.ok(Number(beating.heartbeatAt) > 0);
    assert.equal(await interrupted(id), undefined);
    release();
    assert.equal((await waitFor(id, (p) => p.status === "done")).status, "done");
  });

  test("a stopped render followed by a settings change still reads interrupted", async () => {
    const id = storedAgo(BUSY.rendering, 3 * 60_000);
    assert.equal((await request(app).patch(`/api/story/${id}/captions`).send({ captions: "static" })).status, 200);
    assert.equal(await interrupted(id), true);
  });
});
