import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// render.js reads DATA_DIR at import time, so set it before importing the router.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "render-cancel-quota-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const { default: renderRouter, isQuotaFreeRenderRequest } = await import("../../src/routes/render.js");
const { quota, QUOTAS } = await import("../../src/middleware/quota.js");
const { readUsage, incrementUsage } = await import("../../src/lib/usageStore.js");

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

const LIMIT = QUOTAS.free.render;

function freeUserAtLimit() {
  const dataDir = path.join(root, "users", "u_free");
  fs.mkdirSync(dataDir, { recursive: true });
  incrementUsage(dataDir, "render", LIMIT);
  return { userId: "u_free", dataDir, plan: "free", outputDir: process.env.OUTPUT_DIR, isSuperAdmin: false, isOwner: false };
}

function appFor(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use("/api/render", quota("render", { skip: isQuotaFreeRenderRequest }), renderRouter);
  return app;
}

test("a free user at the render limit can still cancel a render, and the cancel counts nothing", async () => {
  const ctx = freeUserAtLimit();
  const res = await request(appFor(ctx)).post("/api/render/captioned-video/cap_unknown/cancel");
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(res.body.error, "job not found");
  assert.equal(readUsage(ctx.dataDir).counts.render, LIMIT);
});

test("a render POST at the limit is still refused with QUOTA_EXCEEDED", async () => {
  const ctx = freeUserAtLimit();
  const res = await request(appFor(ctx)).post("/api/render/captioned-video").send({});
  assert.equal(res.status, 429);
  assert.equal(res.body.error, "QUOTA_EXCEEDED");
});

test("only the cancel POST is quota-free", () => {
  const req = (method, p) => ({ method, path: p });
  assert.equal(isQuotaFreeRenderRequest(req("POST", "/captioned-video/abc/cancel")), true);
  assert.equal(isQuotaFreeRenderRequest(req("POST", "/captioned-video")), false);
  assert.equal(isQuotaFreeRenderRequest(req("POST", "/video")), false);
  assert.equal(isQuotaFreeRenderRequest(req("POST", "/waveform")), false);
  assert.equal(isQuotaFreeRenderRequest(req("POST", "/captioned-video/a/b/cancel")), false);
});

test("index.js mounts /api/render with the cancel skip", () => {
  const index = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.js"), "utf-8");
  const mount = index.split(/\r?\n/).find((l) => l.startsWith('app.use("/api/render"'));
  assert.match(mount, /quota\("render", \{ skip: isQuotaFreeRenderRequest \}\)/);
});
