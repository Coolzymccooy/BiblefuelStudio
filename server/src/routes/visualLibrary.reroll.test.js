import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { createVisualLibraryRouter } from "./visualLibrary.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { addClip, readLibrary } from "../lib/visualLibrary/store.js";
import { isRerolling } from "../lib/visualLibrary/reroll.js";

describe("re-roll routes", () => {
  let root;
  let ctx;
  let app;
  let clip;
  const submitted = [];
  let downloadFails = false;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-reroll-route-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    process.env.BYTEPLUS_ARK_API_KEY = "test-key";
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
    const src = path.join(root, "src.mp4");
    fs.writeFileSync(src, "mp4");
    clip = addClip(ctx, { file: src, prompt: "Hills at sunset", aspect: "portrait", durationSec: 6 });
    const reroll = {
      submit: async (args) => { submitted.push(args); return { ok: true, taskId: `t${submitted.length}` }; },
      wait: async () => ({ ok: true, videoUrl: "https://example.com/v.mp4", tokens: 90000 }),
      download: async (_url, file) => { if (downloadFails) throw new Error("reset"); fs.writeFileSync(file, "mp4"); },
      ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
      probe: async () => 6,
    };
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { ...ctx, isSuperAdmin: true }; next(); });
    app.use("/api/visual-library", requireSuperAdmin, createVisualLibraryRouter({ ledgerDir: path.join(root, "ledger"), deps: { reroll } }));
  });
  after(() => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("shows the price and the month's spend before anything is ordered", async () => {
    const r = await request(app).get(`/api/visual-library/${clip.id}/reroll-price`);
    assert.equal(r.status, 200);
    assert.equal(r.body.price.seconds, 6);
    assert.ok(r.body.price.usd > 0);
    assert.equal(r.body.month.capUsd, 100);
    assert.equal(r.body.seedance, true);
    assert.equal(submitted.length, 0);
    assert.equal((await request(app).get("/api/visual-library/not-a-clip/reroll-price")).status, 404);
  });

  test("won't order without the price the user saw", async () => {
    const r = await request(app).post(`/api/visual-library/${clip.id}/reroll`).send({ prompt: "Hills at dawn" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "NO_PRICE");
    assert.equal(submitted.length, 0);
  });

  test("orders at the agreed price and lists the job until the clip is in the library", async () => {
    const { body: { price } } = await request(app).get(`/api/visual-library/${clip.id}/reroll-price`);
    const r = await request(app).post(`/api/visual-library/${clip.id}/reroll`).send({ prompt: "Hills at dawn", expectUsd: price.usd });
    assert.equal(r.status, 200);
    assert.equal(r.body.job.prompt, "Hills at dawn");
    for (let i = 0; i < 400 && isRerolling(ctx.dataDir); i += 1) await new Promise((res) => setTimeout(res, 5));
    const jobs = await request(app).get("/api/visual-library/rerolls");
    assert.equal(jobs.body.jobs[0].status, "done");
    assert.ok(readLibrary(ctx.dataDir).some((c) => c.id === jobs.body.jobs[0].clipId));
    assert.ok(jobs.body.month.spentUsd > 0);
  });

  test("a paid clip that failed to download is fetched again for free, and BytePlus's URL never reaches the page", async () => {
    downloadFails = true;
    const { body: { price } } = await request(app).get(`/api/visual-library/${clip.id}/reroll-price`);
    await request(app).post(`/api/visual-library/${clip.id}/reroll`).send({ prompt: "Hills in the rain", expectUsd: price.usd });
    for (let i = 0; i < 400 && isRerolling(ctx.dataDir); i += 1) await new Promise((res) => setTimeout(res, 5));
    downloadFails = false;
    const listed = (await request(app).get("/api/visual-library/rerolls")).body.jobs[0];
    assert.equal(listed.status, "error");
    assert.equal(listed.refetchable, true);
    assert.equal("videoUrl" in listed, false);
    const ordered = submitted.length;
    const r = await request(app).post(`/api/visual-library/rerolls/${listed.id}/refetch`);
    assert.equal(r.status, 200);
    for (let i = 0; i < 400 && isRerolling(ctx.dataDir); i += 1) await new Promise((res) => setTimeout(res, 5));
    const after = (await request(app).get("/api/visual-library/rerolls")).body.jobs[0];
    assert.equal(after.status, "done");
    assert.equal(submitted.length, ordered, "nothing is ordered again");
    assert.equal((await request(app).post(`/api/visual-library/rerolls/${listed.id}/refetch`)).status, 409);
  });

  test("the job list always includes running and fetchable jobs, however many newer ones there are", async () => {
    const store = path.join(ctx.dataDir, "visual-library-rerolls.json");
    const saved = fs.readFileSync(store, "utf8");
    const base = { fromClipId: clip.id, prompt: "p", aspect: "portrait", seconds: 6, lead: "", tags: [], estimateUsd: 0.5, createdAt: 1 };
    const newer = Array.from({ length: 25 }, (_, i) => ({ ...base, id: `n${i}`, status: "done" }));
    const paid = { ...base, id: "paid-old", status: "error", taskId: "t", chargedTaskId: "t", videoUrl: "https://example.com/x.mp4", startedAt: Date.now() };
    const running = { ...base, id: "running-old", status: "generating", taskId: "t2", startedAt: Date.now() };
    fs.writeFileSync(store, JSON.stringify({ jobs: [...newer, paid, running] }));
    try {
      const ids = (await request(app).get("/api/visual-library/rerolls")).body.jobs.map((j) => j.id);
      assert.ok(ids.includes("paid-old"));
      assert.ok(ids.includes("running-old"));
      assert.equal(ids.length, 22);
    } finally {
      fs.writeFileSync(store, saved);
    }
  });

  test("a price that went up is refused with the new price", async () => {
    const r = await request(app).post(`/api/visual-library/${clip.id}/reroll`).send({ expectUsd: 0.01 });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "PRICE_CHANGED");
    assert.ok(r.body.price.usd > 0.01);
  });

  test("says so when AI video is not set up", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const r = await request(app).post(`/api/visual-library/${clip.id}/reroll`).send({ expectUsd: 5 });
    process.env.BYTEPLUS_ARK_API_KEY = "test-key";
    assert.equal(r.status, 503);
  });
});
