import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// story.js reads DATA_DIR at import time, so set it before importing the router.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "story-cancel-quota-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: storyRouter, isQuotaFreeStoryRequest } = await import("../../src/routes/story.js");
const { quota, QUOTAS } = await import("../../src/middleware/quota.js");
const { readUsage, incrementUsage } = await import("../../src/lib/usageStore.js");
const { createProject } = await import("../../src/lib/story/projectStore.js");

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

const LIMIT = QUOTAS.free.render;

function freeUserAtLimit(name, { isSuperAdmin = false } = {}) {
  const dataDir = path.join(root, "users", name);
  fs.mkdirSync(dataDir, { recursive: true });
  incrementUsage(dataDir, "render", LIMIT);
  return { userId: name, dataDir, plan: "free", outputDir: process.env.OUTPUT_DIR, isSuperAdmin, isOwner: false };
}

function appFor(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use("/api/story", quota("render", { skip: isQuotaFreeStoryRequest }), storyRouter);
  return app;
}

test("a free user at the render limit can still cancel a story, and the cancel counts nothing", async () => {
  const ctx = freeUserAtLimit("u_cancel");
  const project = createProject(ctx.dataDir, { title: "Cancel me" });
  const res = await request(appFor(ctx)).post(`/api/story/${project.projectId}/cancel`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.project.error, "Cancelled.");
  assert.equal(readUsage(ctx.dataDir).counts.render, LIMIT);
});

test("stopping AI motion spends no render quota either", async () => {
  const ctx = freeUserAtLimit("u_animate", { isSuperAdmin: true });
  const project = createProject(ctx.dataDir, { title: "Stop clips" });
  const res = await request(appFor(ctx)).post(`/api/story/${project.projectId}/animate/cancel`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(readUsage(ctx.dataDir).counts.render, LIMIT);
});

test("a story POST that does work is still refused at the limit", async () => {
  const ctx = freeUserAtLimit("u_render");
  const res = await request(appFor(ctx)).post("/api/story/some-id/render").send({});
  assert.equal(res.status, 429);
  assert.equal(res.body.error, "QUOTA_EXCEEDED");
});

test("only the two cancel POSTs are quota-free", () => {
  const req = (method, p) => ({ method, path: p });
  assert.equal(isQuotaFreeStoryRequest(req("POST", "/abc/cancel")), true);
  assert.equal(isQuotaFreeStoryRequest(req("POST", "/abc/animate/cancel")), true);
  assert.equal(isQuotaFreeStoryRequest(req("POST", "/abc/render")), false);
  assert.equal(isQuotaFreeStoryRequest(req("POST", "/abc/animate")), false);
  assert.equal(isQuotaFreeStoryRequest(req("POST", "/abc/process")), false);
  assert.equal(isQuotaFreeStoryRequest(req("POST", "/a/b/cancel")), false);
  assert.equal(isQuotaFreeStoryRequest(req("PATCH", "/abc/cancel")), false);
});

test("index.js mounts /api/story with the cancel skip", () => {
  const index = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.js"), "utf-8");
  const mount = index.split(/\r?\n/).find((l) => l.startsWith('app.use("/api/story"'));
  assert.match(mount, /quota\("render", \{ skip: isQuotaFreeStoryRequest \}\)/);
});
