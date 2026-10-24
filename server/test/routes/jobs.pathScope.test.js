/**
 * Queued renders read the paths in their stored payload (#112). For anyone
 * but the owner every path field (audio, music, background, scenes,
 * generatedImage) must be in the caller's scope: refused with 403
 * PATH_OUTSIDE_MEDIA at enqueue and retry (nothing queued), and refused again
 * when the job runs, so a payload stored before this fix cannot read another
 * tenant's file. Own uploads, library refs, stock links, tts-* files and the
 * owner keep working.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

// jobs.js and paths.js read DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const jobs = await import("../../src/routes/jobs.js");
const { captureFfmpegReports } = await import("../helpers/ffreport.js");

const OUT = process.env.OUTPUT_DIR;
const FF_BIN = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const spawnFfmpegOk = () => spawnSync(FF_BIN, ["-version"]).status === 0;
const JOBS_FILE = path.join(process.env.DATA_DIR, "jobs.json");
const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", plan: "premium", dataDir: userDir, outputDir: mine, isSuperAdmin: false, isOwner: false };
const ownerCtx = { userId: "owner", plan: "super_admin", dataDir: process.env.DATA_DIR, outputDir: OUT, isSuperAdmin: true, isOwner: true };
const f = {};
let junction = null;

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  f.bg = path.join(mine, "bg.mp4");
  f.voice = path.join(mine, "voice.mp3");
  f.theirs = path.join(theirs, "private.mp4");
  f.global = path.join(OUT, "owner.mp4");
  f.tts = path.join(OUT, "tts-edge-abc.mp3");
  for (const file of Object.values(f)) fs.writeFileSync(file, "x");
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "801", url: "https://videos.example.com/stock.mp4" },
    { id: "802", url: f.theirs, previewUrl: f.theirs },
  ] }));
});

after(() => {
  if (junction) fs.unlinkSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

function appFor(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/jobs", jobs.default);
  return a;
}

const readJobs = () => (fs.existsSync(JOBS_FILE) ? JSON.parse(fs.readFileSync(JOBS_FILE, "utf-8")).jobs : []);
const seed = (list) => fs.writeFileSync(JOBS_FILE, JSON.stringify({ jobs: list }, null, 2));

function outsideValues() {
  const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
  const list = [f.theirs, f.global, "/outputs/../../them/outputs/private.mp4",
    path.join(mine, "..", "..", "them", "outputs", "private.mp4"), "data/users/them/outputs/private.mp4",
    system, "\\\\evil-host\\share\\a.mp4", "802"];
  if (junction) list.push(path.join(junction, "private.mp4"));
  return list;
}

/** Payloads that each name `bad` in one path field. */
function badPayloads(bad) {
  const lines = ["Peace be with you"];
  return [
    ["render_video", { backgroundPath: bad, lines }],
    ["render_video", { backgroundPath: f.bg, audioPath: bad, lines }],
    ["render_video", { backgroundPath: f.bg, musicPath: bad, lines }],
    ["render_video", { scenes: [{ backgroundPath: f.bg }, { backgroundPath: bad }], lines }],
    ["render_waveform", { audioPath: bad }],
    ["render_waveform", { audioPath: f.voice, backgroundPath: bad }],
    ["campaign_auto_post", { generatedImage: bad }],
    ["campaign_auto_post", { musicPath: bad }],
  ];
}

function assertOutside(res, label) {
  assert.equal(res.status, 403, `${label}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA", label);
}

describe("enqueue refuses a non-owner's paths outside their folder", () => {
  test("every job type and path field", async () => {
    seed([]);
    for (const bad of outsideValues()) {
      for (const [type, payload] of badPayloads(bad)) {
        const res = await request(appFor(ctx)).post("/api/jobs/enqueue").send({ type, payload });
        assertOutside(res, `${type} ${JSON.stringify(payload)}`);
      }
    }
    assert.deepEqual(readJobs(), [], "nothing may be queued");
  });

  test("the /outputs/ alias of a global file looks only in the caller's own folder", async () => {
    seed([]);
    const res = await request(appFor(ctx)).post("/api/jobs/enqueue")
      .send({ type: "render_waveform", payload: { audioPath: "/outputs/owner.mp4" } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.deepEqual(readJobs(), []);
  });

  test("own uploads (by path and alias), shared voice files, library refs and stock links are accepted", () => {
    jobs._setJobCtxForTest(ctx);
    try {
      for (const payload of [
        { backgroundPath: f.bg, audioPath: f.voice, lines: ["Peace"] },
        { backgroundPath: "/outputs/bg.mp4", audioPath: f.tts, musicPath: "library:peaceful-worship", lines: ["Peace"] },
        { backgroundPath: "801", lines: ["Peace"] },
        { scenes: [{ backgroundPath: "https://videos.example.com/x.mp4" }, { backgroundPath: f.bg }], lines: ["Peace"] },
      ]) {
        const result = jobs.validatePayloadForEnqueue("render_video", payload);
        assert.equal(result.ok, true, `${JSON.stringify(payload)}: ${JSON.stringify(result)}`);
      }
    } finally {
      jobs._resetJobCtxForTest();
    }
  });

  test("the owner keeps today's behaviour", async () => {
    seed([]);
    const res = await request(appFor(ownerCtx)).post("/api/jobs/enqueue")
      .send({ type: "render_waveform", payload: { audioPath: f.theirs } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});

describe("retry and run time re-check the stored payload", () => {
  const stored = (payload, jobCtx, status = "failed") => ({
    id: "job_stored", type: "render_waveform", payload, ownerId: jobCtx.userId, ctx: jobCtx, status, createdAt: "2026-10-23T10:00:00.000Z",
  });

  test("retrying a stored payload that names another tenant's file is refused", async () => {
    seed([stored({ audioPath: f.theirs }, ctx)]);
    const res = await request(appFor(ctx)).post("/api/jobs/job_stored/retry");
    assertOutside(res, "retry");
    assert.equal(readJobs().length, 1, "nothing new may be queued");
  });

  test("executing a stored payload outside the job's scope fails before ffmpeg runs", async () => {
    const cap = captureFfmpegReports(path.join(root, "reports-run"));
    jobs._setJobCtxForTest(ctx);
    try {
      for (const bad of outsideValues()) {
        for (const [type, payload] of badPayloads(bad).filter(([t]) => t !== "campaign_auto_post")) {
          await assert.rejects(() => jobs._executeJobForTest({ id: "job_run", type, payload }), /PATH_OUTSIDE_MEDIA/, `${type} ${bad}`);
        }
      }
      await assert.rejects(() => jobs._executeJobForTest({ id: "job_run", type: "campaign_auto_post", payload: { generatedImage: f.theirs } }), /PATH_OUTSIDE_MEDIA/);
    } finally {
      jobs._resetJobCtxForTest();
      cap.stop();
    }
    assert.deepEqual(cap.commands().filter((c) => !c.tokens.includes("-version")), []);
  });

  test("the worker fails a queued pre-fix payload instead of reading the file", async () => {
    seed([stored({ audioPath: f.theirs }, ctx, "queued")]);
    let job;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = readJobs().find((j) => j.id === "job_stored");
      if (job?.status === "failed" || job?.status === "done") break;
    }
    assert.equal(job.status, "failed", JSON.stringify(job));
    assert.match(job.error, /PATH_OUTSIDE_MEDIA/);
  });
});

// Review finding (HIGH): library ids picked at RUN time (auto backgrounds,
// campaign scenes) never pass the payload check, and the resolver handed back
// a saved item's local link unchecked.
describe("library item links resolved at run time are confined", () => {
  const planted = () => fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "evil", files: [{ link: f.theirs, quality: "hd", width: 1 }] },
  ] }));
  const restore = () => fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "801", url: "https://videos.example.com/stock.mp4" },
    { id: "802", url: f.theirs, previewUrl: f.theirs },
  ] }));

  test("resolveAssetPath refuses a saved item whose link is another tenant's file", () => {
    jobs._setJobCtxForTest(ctx);
    try {
      for (const id of ["evil", "802"]) {
        if (id === "evil") planted(); else restore();
        assert.throws(() => jobs.resolveAssetPath(id), /PATH_OUTSIDE_MEDIA/, id);
      }
      restore();
      assert.equal(jobs.resolveAssetPath("801"), "https://videos.example.com/stock.mp4");
    } finally {
      restore();
      jobs._resetJobCtxForTest();
    }
  });

  test("the owner's library links resolve as before", () => {
    planted();
    jobs._setJobCtxForTest({ ...ownerCtx, dataDir: userDir });
    try {
      assert.equal(jobs.resolveAssetPath("evil"), f.theirs);
    } finally {
      restore();
      jobs._resetJobCtxForTest();
    }
  });

  test("an auto-background render picking the planted item fails with PATH_OUTSIDE_MEDIA and never reads it", async () => {
    planted();
    const cap = captureFfmpegReports(path.join(root, "reports-auto"));
    jobs._setJobCtxForTest(ctx);
    try {
      await assert.rejects(
        () => jobs._executeJobForTest({ id: "job_auto", type: "render_video", payload: { autoBackground: true, lines: ["Peace be with you"], durationSec: 2 } }),
        /PATH_OUTSIDE_MEDIA/,
      );
    } finally {
      jobs._resetJobCtxForTest();
      cap.stop();
      restore();
    }
    const readSecret = cap.commands().filter((c) => c.tokens.some((t) => path.resolve(t) === path.resolve(f.theirs)));
    assert.deepEqual(readSecret, []);
  });
});

describe("jobs.resolveAssetPath follows the job's ctx", () => {
  test("a non-owner's /outputs/ alias resolves into their own folder, never the global one", () => {
    jobs._setJobCtxForTest(ctx);
    try {
      assert.equal(jobs.resolveAssetPath("/outputs/bg.mp4"), fs.realpathSync(f.bg));
      const global = jobs.resolveAssetPath("/outputs/owner.mp4");
      assert.ok(!global || path.resolve(global) !== path.resolve(f.global), String(global));
      assert.equal(jobs.resolveAssetPath("/outputs/tts-edge-abc.mp3"), fs.realpathSync(f.tts));
      assert.equal(jobs.resolveAssetPath("package.json"), null);
    } finally {
      jobs._resetJobCtxForTest();
    }
  });

  test("the owner's alias still maps to the global folder", () => {
    jobs._setJobCtxForTest(ownerCtx);
    try {
      assert.equal(path.resolve(jobs.resolveAssetPath("/outputs/owner.mp4")), path.resolve(f.global));
    } finally {
      jobs._resetJobCtxForTest();
    }
  });
});

// Re-review finding (MEDIUM): a stored item whose id looks like a path was
// checked as a path (not by its own links), and a path id came back through
// the direct branch unchecked.
describe("stored library ids that look like paths", () => {
  const theirGenDir = () => path.join(OUT, "genImg", "genvis-them-1");
  const restore = () => fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "801", url: "https://videos.example.com/stock.mp4" },
    { id: "802", url: f.theirs, previewUrl: f.theirs },
  ] }));

  test("an item whose id names the caller's own file still has its links confined", () => {
    const relOwn = path.relative(root, f.bg).split(path.sep).join("/");
    fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
      { id: relOwn, files: [{ link: f.theirs, quality: "hd", width: 1 }] },
    ] }));
    const cwd = process.cwd();
    process.chdir(root);
    jobs._setJobCtxForTest(ctx);
    try {
      assert.throws(() => jobs.resolveAssetPath(relOwn), /PATH_OUTSIDE_MEDIA/);
    } finally {
      jobs._resetJobCtxForTest();
      process.chdir(cwd);
      restore();
    }
  });

  test("a path id, or any direct path outside the caller's scope, is refused rather than returned", () => {
    fs.mkdirSync(theirGenDir(), { recursive: true });
    const theirGen = path.join(theirGenDir(), "a.png");
    fs.writeFileSync(theirGen, "x");
    fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [{ id: f.theirs }] }));
    jobs._setJobCtxForTest(ctx);
    try {
      for (const value of [f.theirs, theirGen, f.global]) {
        assert.throws(() => jobs.resolveAssetPath(value), /PATH_OUTSIDE_MEDIA/, value);
      }
      assert.equal(jobs.resolveAssetPath(f.bg), fs.realpathSync(f.bg));
      assert.equal(path.resolve(jobs.resolveAssetPath(f.tts)), path.resolve(fs.realpathSync(f.tts)));
    } finally {
      jobs._resetJobCtxForTest();
      restore();
    }
  });

  test("the owner's direct paths resolve as before", () => {
    jobs._setJobCtxForTest(ownerCtx);
    try {
      assert.equal(path.resolve(jobs.resolveAssetPath(f.theirs)), path.resolve(f.theirs));
    } finally {
      jobs._resetJobCtxForTest();
    }
  });

  test("auto background never picks a pool item whose id is not a plain name", async () => {
    fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [{ id: f.theirs, tags: ["peace"] }] }));
    const cap = captureFfmpegReports(path.join(root, "reports-pathid"));
    jobs._setJobCtxForTest(ctx);
    try {
      await assert.rejects(
        () => jobs._executeJobForTest({ id: "job_pathid", type: "render_video", payload: { autoBackground: true, lines: ["Peace be with you"], durationSec: 2 } }),
        (err) => !/PATH_OUTSIDE_MEDIA/.test(String(err?.message)),
        "the item is skipped, not picked and then refused",
      );
    } finally {
      jobs._resetJobCtxForTest();
      cap.stop();
      restore();
    }
    const readSecret = cap.commands().filter((c) => c.tokens.some((t) => path.resolve(t) === path.resolve(f.theirs)));
    assert.deepEqual(readSecret, []);
  });
});

describe("a remote input the job downloaded itself", () => {
  test("its cached copy in the shared cache is used, not refused as outside the caller's folder", { skip: !spawnFfmpegOk() && "ffmpeg not installed" }, async () => {
    // A cache hit needs no network: the host does not resolve, and a lookup
    // that merely fails is not a refusal (remoteCache.vetBeforeCacheUse).
    const url = "https://stock.invalid/voice.mp3";
    const cacheDir = path.join(OUT, "cache", "remote-bg");
    fs.mkdirSync(cacheDir, { recursive: true });
    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
    const cached = path.join(cacheDir, `${hash}.mp3`);
    spawnSync(FF_BIN, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=1", cached]);
    jobs._setJobCtxForTest(ctx);
    try {
      await jobs._executeJobForTest({ id: "job_cached", type: "render_waveform", payload: { audioPath: url, lines: ["x"] } });
    } catch (err) {
      assert.doesNotMatch(String(err?.message), /PATH_OUTSIDE_MEDIA/);
    } finally {
      jobs._resetJobCtxForTest();
    }
  });
});

describe("a job's own downloads are its own", () => {
  test("another account's ctx cannot resolve a copy a finished job downloaded", { skip: !spawnFfmpegOk() && "ffmpeg not installed" }, async () => {
    const url = "https://stock.invalid/a-private.mp3";
    const cacheDir = path.join(OUT, "cache", "remote-bg");
    fs.mkdirSync(cacheDir, { recursive: true });
    const cached = path.join(cacheDir, `${crypto.createHash("sha1").update(url).digest("hex").slice(0, 16)}.mp3`);
    spawnSync(FF_BIN, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=1", cached]);
    const otherDir = path.join(process.env.DATA_DIR, "users", "other");
    const other = { userId: "other", plan: "premium", dataDir: otherDir, outputDir: path.join(otherDir, "outputs"), isSuperAdmin: false, isOwner: false };
    fs.mkdirSync(other.outputDir, { recursive: true });
    // User A's job localises the URL, then fails on a missing background.
    jobs._setJobCtxForTest({ ...ctx });
    try {
      await jobs._executeJobForTest({ id: "job_a", type: "render_waveform", payload: { audioPath: url, lines: ["x"], backgroundPath: "/outputs/missing.mp4" } });
    } catch { /* expected to fail */ } finally {
      jobs._resetJobCtxForTest();
    }
    jobs._setJobCtxForTest(other);
    try {
      assert.throws(() => jobs.resolveAssetPath(cached), /PATH_OUTSIDE_MEDIA/);
    } finally {
      jobs._resetJobCtxForTest();
    }
  });
});
