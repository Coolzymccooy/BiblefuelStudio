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

test("R43: a free user at the limit can still create, edit, import without starting, and delete", async () => {
  const ctx = freeUserAtLimit("u_edit");
  const app = appFor(ctx);
  const made = await request(app).post("/api/story").send({ title: "Free edits" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.project.projectId;
  const captions = await request(app).patch(`/api/story/${id}/captions`).send({ captions: "static" });
  assert.equal(captions.status, 200, JSON.stringify(captions.body));
  const cast = await request(app).patch(`/api/story/${id}/cast`).send({ cast: ["moses"] });
  assert.equal(cast.status, 200, JSON.stringify(cast.body));
  const music = await request(app).patch(`/api/story/${id}/music`).send({ path: null });
  assert.equal(music.status, 200, JSON.stringify(music.body));
  // The narration must be the caller's own file: /import-script confines audioPath (#112).
  const voice = path.join(ctx.outputDir, "voice.mp3");
  fs.mkdirSync(ctx.outputDir, { recursive: true });
  fs.writeFileSync(voice, "x");
  const imported = await request(app).post("/api/story/import-script").send({ script: "The Lord is my shepherd", audioPath: voice, durationMs: 8000 });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  const gone = await request(app).delete(`/api/story/${id}`);
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(readUsage(ctx.dataDir).counts.render, LIMIT);
});

test("R43: work-starting story POSTs are still refused at the limit", async () => {
  const ctx = freeUserAtLimit("u_work");
  const app = appFor(ctx);
  const project = createProject(ctx.dataDir, { title: "Work" });
  for (const route of ["render", "process", "images", "resegment"]) {
    const res = await request(app).post(`/api/story/${project.projectId}/${route}`).send({});
    assert.equal(res.status, 429, route);
    assert.equal(res.body.error, "QUOTA_EXCEEDED", route);
  }
  const started = await request(app).post("/api/story/import-script").send({ script: "abc def", audioPath: "/x/v.mp3", durationMs: 8000, autoStart: true });
  assert.equal(started.status, 429);
});

test("only work-starting story requests count plan quota (R43)", () => {
  const req = (method, p, body) => ({ method, path: p, body });
  const free = (method, p, body) => assert.equal(isQuotaFreeStoryRequest(req(method, p, body)), true, `${method} ${p}`);
  const counted = (method, p, body) => assert.equal(isQuotaFreeStoryRequest(req(method, p, body)), false, `${method} ${p}`);
  for (const p of ["/abc/process", "/abc/render", "/abc/images", "/abc/resegment", "/abc/transcribe", "/abc/animate",
    "/abc/scenes/scene-001/regenerate", "/abc/scenes/scene-001/animate", "/script-to-audio"]) counted("POST", p);
  counted("POST", "/import-script", { autoStart: true });
  free("POST", "/import-script", {});
  free("POST", "/import-script", { autoStart: "true" });
  free("POST", "/import-script");
  for (const p of ["/", "/abc/cancel", "/abc/animate/cancel", "/abc/animate/estimate", "/abc/segment"]) free("POST", p);
  for (const p of ["/abc/captions", "/abc/music", "/abc/cast", "/abc/aspect", "/abc/scenes/scene-001"]) free("PATCH", p);
  free("PUT", "/abc/scenes/scene-001/image");
  free("DELETE", "/abc");
  // Express routing ignores case and a trailing slash, so the check must too.
  counted("POST", "/abc/scenes/scene-001/regenerate/");
  counted("POST", "/abc/Render");
  counted("POST", "/Import-Script/", { autoStart: true });
});

test("index.js mounts /api/story with the cancel skip", () => {
  const index = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.js"), "utf-8");
  const mount = index.split(/\r?\n/).find((l) => l.startsWith('app.use("/api/story"'));
  assert.match(mount, /quota\("render", \{ skip: isQuotaFreeStoryRequest \}\)/);
});
