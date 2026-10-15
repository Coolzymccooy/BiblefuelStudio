import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createStoryAnimateRouter } from "./storyAnimate.js";
import storyRouter from "./story.js";
import { createProject, readProject, writeProject } from "../lib/story/projectStore.js";
import { isAnimating, startAnimation, cancelAnimation } from "../lib/story/animateStage.js";
import { ledgerSummary, reserveSpend } from "../lib/videoGen/spend.js";

let dataDir, outputDir, ledgerDir, saved;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-route-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-route-out-"));
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-route-ledger-"));
  saved = { key: process.env.BYTEPLUS_ARK_API_KEY, cap: process.env.VIDEO_GEN_MONTHLY_CAP_USD };
  process.env.BYTEPLUS_ARK_API_KEY = "ark-test";
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
});
afterEach(() => {
  for (const [k, v] of [["BYTEPLUS_ARK_API_KEY", saved.key], ["VIDEO_GEN_MONTHLY_CAP_USD", saved.cap]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const d of [dataDir, outputDir, ledgerDir]) fs.rmSync(d, { recursive: true, force: true });
});

const fakeDeps = {
  submit: async () => ({ ok: true, taskId: "t-1", mode: "image" }),
  wait: async () => ({ ok: true, videoUrl: "https://cdn/t.mp4", tokens: 108000 }),
  download: async (_u, dest) => { fs.writeFileSync(dest, "mp4"); return 3; },
  resolveClip: async ({ outputDir: dir, uploadPath }) => ({ ok: true, videoPath: path.join(dir, uploadPath), videoUrl: `/outputs/${uploadPath}`, posterPath: null }),
  now: () => Date.now(),
};

function router(over = {}) {
  return createStoryAnimateRouter({ sceneBlocked: () => null, ledgerDir, deps: fakeDeps, ...over });
}

/** Run every handler on the matched route in order, as Express would. */
async function call(r, method, routePath, { params = {}, body = {}, admin = true } = {}) {
  const layer = r.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no route ${method} ${routePath}`);
  const req = { params, body, ctx: { userId: "u1", dataDir, outputDir, isSuperAdmin: admin, plan: admin ? "super_admin" : "premium" } };
  const res = {
    statusCode: 200, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  for (const h of layer.route.stack.map((s) => s.handle)) {
    let nextCalled = false;
    await h(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  return res;
}

function project(sceneCount = 2) {
  const p = createProject(dataDir, { title: "Philippians" });
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const pic = path.join(outputDir, `pic-${i}.png`);
    fs.writeFileSync(pic, "png");
    return { id: `s${i}`, text: `t${i}`, startMs: i * 5000, endMs: i * 5000 + 5000, imagePrompt: `p${i}`, imagePath: pic, imageUrl: `/outputs/pic-${i}.png`, imageStatus: "done", promptEditedByUser: false };
  });
  return writeProject(dataDir, { ...p, status: "ready_to_render", scenes });
}

async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("AI scene routes", () => {
  test("the super-admin gate refuses every other account, premium included", async () => {
    const p = project();
    const r = router();
    for (const [routePath, params] of [
      ["/:id/animate/estimate", { id: p.projectId }],
      ["/:id/animate", { id: p.projectId }],
      ["/:id/scenes/:sid/animate", { id: p.projectId, sid: "s0" }],
      ["/:id/animate/cancel", { id: p.projectId }],
    ]) {
      const res = await call(r, "post", routePath, { params, admin: false });
      assert.equal(res.statusCode, 403, routePath);
    }
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, undefined);
    assert.equal(ledgerSummary(ledgerDir).reservedUsd, 0);
  });

  test("the estimate prices the scenes and reports the month", async () => {
    const p = project(2);
    const res = await call(router(), "post", "/:id/animate/estimate", { params: { id: p.projectId }, body: { quality: "standard" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.configured, true);
    assert.equal(res.payload.clips, 2);
    assert.equal(res.payload.seconds, 10);
    assert.equal(res.payload.usd.toFixed(4), (2 * 108000 / 1e6 * 3.5).toFixed(4));
    assert.equal(res.payload.capUsd, 30);
    assert.equal(res.payload.spentUsd, 0);
    assert.equal(res.payload.quality, "standard");
  });

  test("animate all starts the run and marks the scenes queued", async () => {
    const p = project(2);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId }, body: {} });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.deepEqual(res.payload.project.scenes.map((s) => s.aiVideoStatus), ["queued", "queued"]);
    await waitFor(() => !isAnimating(p.projectId));
    assert.deepEqual(readProject(dataDir, p.projectId).scenes.map((s) => s.aiVideoStatus), ["done", "done"]);
  });

  test("one scene can be animated, and re-rolled once done", async () => {
    const p = project(2);
    const r = router();
    const first = await call(r, "post", "/:id/scenes/:sid/animate", { params: { id: p.projectId, sid: "s1" } });
    assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
    await waitFor(() => !isAnimating(p.projectId));
    const again = await call(r, "post", "/:id/scenes/:sid/animate", { params: { id: p.projectId, sid: "s1" } });
    assert.equal(again.statusCode, 200, JSON.stringify(again.payload));
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, undefined, "the other scene is untouched");
  });

  test("a batch that cannot fit under the cap is refused with BUDGET and nothing changes", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(ledgerDir, "other:s9", 0.9);
    const p = project(2);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "BUDGET");
    assert.match(res.payload.error, /^This would take .* AI video spend to \$1\.66 of \$1\.$/);
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, undefined);
  });

  test("without a BytePlus key the routes say so", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const p = project(1);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "NOT_CONFIGURED");
  });

  test("a scene locked by a live render or image run is refused with its reason", async () => {
    const p = project(1);
    const r = router({ sceneBlocked: () => ({ status: 409, body: { code: "RENDERING", error: "The video is rendering." } }) });
    const res = await call(r, "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "RENDERING");
  });

  test("nothing to animate is a 400", async () => {
    const p = project(0);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, "NOTHING_TO_ANIMATE");
  });

  test("an unknown project is a 404", async () => {
    const res = await call(router(), "post", "/:id/animate/estimate", { params: { id: "nope" } });
    assert.equal(res.statusCode, 404);
  });

  test("while clips are being made, the image, process and resegment runs are refused", async () => {
    const p = project(1);
    const stuck = { ...fakeDeps, wait: () => new Promise(() => {}) };
    const started = startAnimation({ dataDir, outputDir }, p.projectId, { sceneIds: ["s0"], ledgerDir, deps: stuck });
    assert.ok(started, "the run started");
    try {
      assert.equal(isAnimating(p.projectId), true);
      for (const routePath of ["/:id/images", "/:id/process", "/:id/resegment"]) {
        const layer = storyRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods.post);
        assert.ok(layer, `no route post ${routePath}`);
        const handler = layer.route.stack[layer.route.stack.length - 1].handle;
        const req = { params: { id: p.projectId }, body: { mediaPath: "x" }, query: {}, ctx: { userId: "u1", dataDir, outputDir } };
        const res = {
          statusCode: 200, payload: null,
          status(c) { this.statusCode = c; return this; },
          json(x) { this.payload = x; return this; },
        };
        await handler(req, res);
        assert.equal(res.statusCode, 409, routePath);
        assert.equal(res.payload.code, "ANIMATING", routePath);
      }
      await waitFor(() => readProject(dataDir, p.projectId).scenes[0].aiVideoTaskId === "t-1");
      const live = readProject(dataDir, p.projectId).scenes[0];
      assert.equal(live.aiVideoStatus, "generating", "the live clip was not touched");
      assert.equal(live.aiVideoTaskId, "t-1");
    } finally {
      cancelAnimation(p.projectId);
    }
  });
});
