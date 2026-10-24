/**
 * Pexels and Pixabay downloads are saved flat in the global outputs folder
 * (pexels-<id>.mp4, pixabay-<id>.mp4, thumb-<provider>-<id>.jpg) for every
 * account, and the library item links that global path. They are public stock,
 * so they are shared like tts-* voice files (#112 regression found in review):
 * a non-owner's downloaded item must still enqueue, resolve at run time
 * (auto background) and keep its thumbnail in GET /api/library. Nothing else
 * in the global folder opens up.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-stock-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const jobs = await import("../../src/routes/jobs.js");
const { default: libraryRouter } = await import("../../src/routes/library.js");
const { scopeMediaInput } = await import("../../src/lib/mediaInputScope.js");
const { captureFfmpegReports } = await import("../helpers/ffreport.js");

const OUT = process.env.OUTPUT_DIR;
const JOBS_FILE = path.join(process.env.DATA_DIR, "jobs.json");
const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", plan: "premium", dataDir: userDir, outputDir: mine, isSuperAdmin: false, isOwner: false };
const pexels = path.join(OUT, "pexels-123.mp4");
const pixabay = path.join(OUT, "pixabay-456.mp4");
const pexelsThumb = path.join(OUT, "thumb-pexels-123.jpg");
const slash = (p) => p.split(path.sep).join("/");

function app(router, mount) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = ctx; next(); });
  a.use(mount, router);
  return a;
}

const library = () => [
  { id: "pexels_123", provider: "pexels", url: slash(pexels), previewUrl: "/outputs/pexels-123.mp4", image: "/outputs/thumb-pexels-123.jpg", tags: ["peace"] },
  { id: "pixabay_456", provider: "pixabay", url: slash(pixabay), previewUrl: "/outputs/pixabay-456.mp4" },
];

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  for (const file of [pexels, pixabay]) {
    if (noFfmpeg) fs.writeFileSync(file, "x");
    else spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x568:d=3", "-pix_fmt", "yuv420p", file]);
  }
  fs.writeFileSync(pexelsThumb, "jpg");
  // Look-alikes that must stay closed.
  fs.writeFileSync(path.join(OUT, "pexels-abc.mp4"), "x");
  fs.writeFileSync(path.join(OUT, "owner.mp4"), "x");
  fs.mkdirSync(path.join(OUT, "sub"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "sub", "pexels-9.mp4"), "x");
  fs.writeFileSync(path.join(theirs, "pexels-77.mp4"), "x");
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: library() }));
});

after(() => {
  // A finished render can hold a handle in the folder for a moment on Windows.
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir, best effort */ }
});

describe("downloaded stock in the global outputs folder is shared", () => {
  test("enqueue accepts a downloaded item and its file", async () => {
    fs.writeFileSync(JOBS_FILE, JSON.stringify({ jobs: [] }));
    for (const backgroundPath of ["pexels_123", "pixabay_456", pexels, "/outputs/pexels-123.mp4"]) {
      const res = await request(app(jobs.default, "/api/jobs")).post("/api/jobs/enqueue")
        .send({ type: "render_video", payload: { backgroundPath, lines: ["Peace"] } });
      assert.equal(res.status, 200, `${backgroundPath}: ${JSON.stringify(res.body)}`);
    }
  });

  test("resolveAssetPath hands back the stock file at run time", () => {
    jobs._setJobCtxForTest(ctx);
    try {
      assert.equal(path.resolve(jobs.resolveAssetPath("pexels_123")), path.resolve(pexels));
      assert.equal(path.resolve(jobs.resolveAssetPath("pixabay_456")), path.resolve(pixabay));
    } finally {
      jobs._resetJobCtxForTest();
    }
  });

  test("an auto-background render uses the downloaded clip", { skip: noFfmpeg }, async () => {
    const cap = captureFfmpegReports(path.join(root, "reports-auto"));
    jobs._setJobCtxForTest(ctx);
    try {
      await jobs._executeJobForTest({ id: "job_auto", type: "render_video", payload: { autoBackground: true, lines: ["Peace be with you"], durationSec: 2 } });
    } catch (err) {
      assert.doesNotMatch(String(err?.message), /PATH_OUTSIDE_MEDIA/);
    } finally {
      jobs._resetJobCtxForTest();
      cap.stop();
    }
    const readStock = cap.commands().filter((c) => c.tokens.some((t) => [pexels, pixabay].map((p) => path.resolve(p)).includes(path.resolve(t))));
    assert.ok(readStock.length > 0, "ffmpeg read a downloaded clip");
  });

  test("GET /api/library keeps the stock thumbnail", async () => {
    const res = await request(app(libraryRouter, "/api/library")).get("/api/library");
    assert.equal(res.status, 200);
    const item = res.body.library.items.find((x) => x.id === "pexels_123");
    assert.equal(item.image, "/outputs/thumb-pexels-123.jpg");
  });

  test("only flat stock names in the global folder are shared", () => {
    for (const bad of [path.join(OUT, "pexels-abc.mp4"), path.join(OUT, "owner.mp4"), path.join(OUT, "sub", "pexels-9.mp4"), path.join(theirs, "pexels-77.mp4"), "/outputs/owner.mp4"]) {
      assert.throws(() => scopeMediaInput(bad, ctx), (err) => err.code === "PATH_OUTSIDE_MEDIA" || err.code === "FILE_NOT_FOUND", bad);
    }
  });
});
