/**
 * POST /api/timeline/render takes asset paths inside the project body and the
 * renderer reads them (#112). A local asset must be the caller's own file (or
 * a shared tts-* voice file, or bundled/saved music); another tenant's file,
 * the owner's global files, relative server paths and non-http URLs are
 * refused with 403 PATH_OUTSIDE_MEDIA before any job is queued. Stock https
 * footage still passes (the renderer localises it through the SSRF guard).
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// paths.js reads DATA_DIR / OUTPUT_DIR at import time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-render-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const { default: express } = await import("express");
const { default: request } = await import("supertest");
const timelineModule = await import("../../src/routes/timeline.js");
const timelineRouter = timelineModule.default;
const { _resetTimelineRenderJobsForTest, _setTimelineRendererForTest } = timelineModule;
const { buildProofRenderCommand } = await import("../../src/lib/timelineRender/proofRenderer.js");

const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", plan: "premium", dataDir: userDir, outputDir: mine, isOwner: false };
const ownerCtx = { userId: "owner", plan: "super_admin", isSuperAdmin: true, dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isOwner: true };
const f = {};
let junction = null;
let renders = [];

before(() => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  f.own = path.join(mine, "main.mp4");
  f.theirs = path.join(theirs, "private.mp4");
  f.global = path.join(process.env.OUTPUT_DIR, "owner.mp4");
  f.tts = path.join(process.env.OUTPUT_DIR, "tts-edge-abc.mp3");
  f.stock = path.join(process.env.OUTPUT_DIR, "pexels-123.mp4");
  // Images Render lab generated for this caller, and for someone else (#112).
  f.genMine = path.join(process.env.OUTPUT_DIR, "genImg", "genvis-me-1", "bg.png");
  f.genOther = path.join(process.env.OUTPUT_DIR, "genImg", "genvis-them-1", "bg.png");
  for (const file of Object.values(f)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
  }
  try {
    junction = path.join(mine, "escape");
    fs.symlinkSync(theirs, junction, "junction");
  } catch {
    junction = null;
  }
  // The caller's saved library: one stock item, one planted local path.
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "501", url: "https://videos.example.com/stock.mp4", previewUrl: "https://videos.example.com/stock.mp4" },
    { id: "502", url: f.theirs, previewUrl: f.theirs },
    { id: "pexels_123", provider: "pexels", url: f.stock.split(path.sep).join("/"), previewUrl: "/outputs/pexels-123.mp4" },
  ] }));
});

after(() => {
  _resetTimelineRenderJobsForTest();
  if (junction) fs.unlinkSync(junction);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => {
  renders = [];
  // The reset also restores the real renderer, so the stub goes in after it.
  _resetTimelineRenderJobsForTest();
  _setTimelineRendererForTest(async (plan) => {
    renders.push(plan);
    return { ok: true, outputPath: path.join(root, "x.mp4"), publicUrl: "/outputs/timeline/x.mp4", ignoredPlaceholders: 0, generatedVoiceovers: [] };
  });
});

function appFor(scope) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = scope; next(); });
  a.use("/api/timeline", timelineRouter);
  return a;
}

/** One asset under test; an audio asset rides on a stock video so the plan has picture. */
function project(assetPath, kind = "video") {
  const assets = { a: { id: "a", kind, source: "upload", label: "Main", path: assetPath, durationSec: 5 } };
  const tracks = [{ id: "t", kind, label: "Main", clips: [{ id: "c", assetId: "a", startSec: 0, durationSec: 5 }] }];
  if (kind !== "video") {
    assets.v = { id: "v", kind: "video", source: "pexels", label: "Stock", path: "https://videos.example.com/v.mp4", durationSec: 5 };
    tracks.unshift({ id: "tv", kind: "video", label: "Stock", clips: [{ id: "cv", assetId: "v", startSec: 0, durationSec: 5 }] });
  }
  return {
    id: "scope-test",
    title: "Scope",
    template: "worship-documentary",
    aspect: "16:9",
    targetDurationSec: 10,
    assets,
    scenes: [],
    tracks,
    renderSettings: { quality: "proof_720p" },
  };
}

const render = (scope, assetPath, kind) => request(appFor(scope)).post("/api/timeline/render").send({ project: project(assetPath, kind) });
/** Wait for the queued job to reach the stub renderer. */
async function settle() {
  for (let i = 0; i < 40 && renders.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}
const renderedPath = () => renders[0].tracks.flatMap((t) => t.clips).find((c) => c.assetId === "a").path;

describe("/api/timeline/render asset scope", () => {
  test("refuses assets outside the caller's folder and queues nothing", async () => {
    const system = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    const bad = [
      f.theirs,
      f.global,
      "/outputs/owner.mp4",
      "/outputs/../../them/outputs/private.mp4",
      "data/users/them/outputs/private.mp4",
      "package.json",
      system,
      "\\\\evil-host\\share\\a.mp4",
      "tcp://127.0.0.1:9/x",
      "502",
    ];
    if (junction) bad.push(path.join(junction, "private.mp4"));
    for (const p of bad) {
      const res = await render(ctx, p);
      assert.ok([403, 400].includes(res.status), `${p}: ${res.status} ${JSON.stringify(res.body)}`);
      assert.ok(["PATH_OUTSIDE_MEDIA", "FILE_NOT_FOUND"].includes(res.body.error), `${p}: ${JSON.stringify(res.body)}`);
    }
    await settle();
    assert.deepEqual(renders, []);
  });

  test("another tenant's file and the owner's global file are PATH_OUTSIDE_MEDIA", async () => {
    for (const p of [f.theirs, f.global]) {
      const res = await render(ctx, p);
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(res.body.error, "PATH_OUTSIDE_MEDIA");
    }
  });

  test("renders the caller's own upload, by path and by alias, with the real path in the plan", async () => {
    for (const p of [f.own, "/outputs/main.mp4"]) {
      renders = [];
      const res = await render(ctx, p);
      assert.equal(res.status, 202, JSON.stringify(res.body));
      await settle();
      assert.equal(renderedPath(), fs.realpathSync(f.own));
    }
  });

  test("shared voice files, bundled music and stock https footage still render", async () => {
    for (const [p, kind] of [[f.tts, "audio"], ["library:peaceful-worship", "audio"], ["501", "video"], ["https://videos.example.com/b.mp4", "video"]]) {
      renders = [];
      const res = await render(ctx, p, kind);
      assert.equal(res.status, 202, `${p}: ${JSON.stringify(res.body)}`);
      await settle();
      assert.equal(renders.length, 1, p);
    }
  });

  test("downloaded Pexels/Pixabay stock in the global folder renders, by item and by alias", async () => {
    for (const p of ["pexels_123", "/outputs/pexels-123.mp4", f.stock]) {
      renders = [];
      const res = await render(ctx, p, "video");
      assert.equal(res.status, 202, `${p}: ${JSON.stringify(res.body)}`);
      await settle();
      assert.equal(path.resolve(renderedPath()), path.resolve(fs.realpathSync(f.stock)), p);
    }
  });

  test("the caller's own generated images render; another user's are refused", async () => {
    const res = await render(ctx, f.genMine);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await settle();
    assert.equal(path.resolve(renderedPath()), path.resolve(fs.realpathSync(f.genMine)));
    const other = await render(ctx, f.genOther);
    assert.equal(other.status, 403, JSON.stringify(other.body));
    assert.equal(other.body.error, "PATH_OUTSIDE_MEDIA");
  });

  test("a non-owner's shared voice file and own generated image reach the renderer's command from the global folder (R48)", async () => {
    // The real command builder with the options the job hands the renderer: the caller's own
    // outputDir as its root, and the global OUTPUT_DIR (outside the server root here) for shared files.
    let built = null;
    _setTimelineRendererForTest(async (plan, opts) => {
      built = buildProofRenderCommand(plan, opts);
      renders.push(plan);
      return { ok: true, outputPath: path.join(root, "x.mp4"), publicUrl: "/outputs/timeline/x.mp4", ignoredPlaceholders: 0, generatedVoiceovers: [] };
    });
    const body = project(f.own);
    body.assets.vo = { id: "vo", kind: "voiceover", source: "upload", label: "Voice", path: "/outputs/tts-edge-abc.mp3", durationSec: 5 };
    body.assets.img = { id: "img", kind: "broll", source: "upload", label: "Picture", path: f.genMine, durationSec: 5 };
    body.tracks.push(
      { id: "tvo", kind: "voiceover", label: "Voice", clips: [{ id: "cvo", assetId: "vo", startSec: 0, durationSec: 5 }] },
      { id: "tb", kind: "broll", label: "Pictures", clips: [{ id: "cb", assetId: "img", startSec: 1, durationSec: 3 }] },
    );
    const res = await request(appFor(ctx)).post("/api/timeline/render").send({ project: body });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await settle();
    assert.ok(built?.ok, JSON.stringify(built));
    const inputs = built.args.filter((_, i) => built.args[i - 1] === "-i").map((p) => path.resolve(p));
    assert.ok(inputs.includes(path.resolve(fs.realpathSync(f.tts))), `voice missing from ${inputs}`);
    assert.ok(inputs.includes(path.resolve(fs.realpathSync(f.genMine))), `picture missing from ${inputs}`);
    assert.ok(inputs.includes(path.resolve(fs.realpathSync(f.own))), `main missing from ${inputs}`);
    // Another user's picture is still refused before anything is queued.
    const other = project(f.own);
    other.assets.img = { ...body.assets.img, path: f.genOther };
    other.tracks.push(body.tracks[2]);
    const refused = await request(appFor(ctx)).post("/api/timeline/render").send({ project: other });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.error, "PATH_OUTSIDE_MEDIA");
  });

  test("the owner still renders files in the global output folder", async () => {
    const res = await render(ownerCtx, "/outputs/owner.mp4");
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await settle();
    assert.equal(renderedPath(), fs.realpathSync(f.global));
  });
});
