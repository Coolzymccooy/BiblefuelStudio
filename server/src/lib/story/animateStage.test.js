import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, writeProject } from "./projectStore.js";
import { ledgerSummary } from "../videoGen/spend.js";
import {
  AI_QUALITY, sceneClipSec, animatePrompt, animatableScenes, estimateAnimation,
  startAnimation, isAnimating, cancelAnimation, resumeAnimations,
} from "./animateStage.js";

let dataDir, outputDir, ledgerDir, savedCap;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-out-"));
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-ledger-"));
  savedCap = process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_PRICE_MULTIPLIER;
});
afterEach(() => {
  if (savedCap === undefined) delete process.env.VIDEO_GEN_MONTHLY_CAP_USD; else process.env.VIDEO_GEN_MONTHLY_CAP_USD = savedCap;
  for (const d of [dataDir, outputDir, ledgerDir]) fs.rmSync(d, { recursive: true, force: true });
});

const ctx = () => ({ dataDir, outputDir });

function scene(i, over = {}) {
  const pic = path.join(outputDir, `pic-${i}.png`);
  fs.writeFileSync(pic, "png");
  return {
    id: `s${i}`, text: `Scene ${i}`, startMs: i * 5000, endMs: i * 5000 + 5000,
    imagePrompt: `prompt ${i}`, imagePath: pic, imageUrl: `/outputs/pic-${i}.png`,
    imageStatus: "done", promptEditedByUser: false, mediaKind: "image", ...over,
  };
}

function project(scenes, over = {}) {
  const p = createProject(dataDir, { title: "Philippians" });
  return writeProject(dataDir, { ...p, status: "ready_to_render", scenes, ...over });
}

async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Fake BytePlus + ffmpeg: every clip succeeds unless told otherwise. */
function fakeDeps(over = {}) {
  const calls = { submit: [], wait: [] };
  const deps = {
    submit: async (args) => { calls.submit.push(args); return { ok: true, taskId: `t-${calls.submit.length}`, mode: "image" }; },
    wait: async (taskId) => { calls.wait.push(taskId); return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 }; },
    download: async (_url, dest) => { fs.writeFileSync(dest, "mp4"); return 3; },
    resolveClip: async ({ outputDir: dir, uploadPath }) => {
      const posterPath = path.join(dir, `${uploadPath}-poster.jpg`);
      fs.writeFileSync(posterPath, "jpg");
      return {
        ok: true, videoPath: path.join(dir, uploadPath), videoUrl: `/outputs/${uploadPath}`,
        posterPath, posterUrl: "/p.jpg", durationSec: 5, width: 720, height: 1280,
      };
    },
    now: () => Date.now(),
    ...over,
  };
  return { deps, calls };
}

const MINI_5S_USD = 108000 / 1e6 * 3.5;

describe("pricing and choice of scenes", () => {
  test("clip length is the scene length clamped to 4–12 s", () => {
    assert.equal(sceneClipSec({ startMs: 0, endMs: 2000 }), 4);
    assert.equal(sceneClipSec({ startMs: 0, endMs: 7300 }), 8);
    assert.equal(sceneClipSec({ startMs: 0, endMs: 40000 }), 12);
  });
  test("the prompt is the picture's prompt plus a motion line", () => {
    assert.equal(animatePrompt({ imagePrompt: "A lamp." }), "A lamp. Slow push-in, gentle light shift, subtle natural movement.");
  });
  test("only scenes with a finished picture, not already moving, are animated", () => {
    const p = project([
      scene(0),
      scene(1, { imageStatus: "error", imagePath: null }),
      scene(2, { aiVideoStatus: "generating" }),
      scene(3, { aiVideoStatus: "done" }),
    ]);
    assert.deepEqual(animatableScenes(p).map((s) => s.id), ["s0"]);
    assert.deepEqual(animatableScenes(p, ["s3"]).map((s) => s.id), ["s3"], "an explicit re-roll includes an animated scene");
  });
  test("the estimate prices 5 s + 10 s of Mini at 720p portrait", () => {
    const p = project([scene(0), scene(1, { endMs: 15000 })]);
    const est = estimateAnimation(p, undefined, "standard");
    assert.equal(est.clips, 2);
    assert.equal(est.seconds, 15);
    assert.equal(est.usd.toFixed(4), (15 * 21600 / 1e6 * 3.5).toFixed(4));
    assert.equal(est.model, AI_QUALITY.standard.model);
    assert.deepEqual(est.sceneIds, ["s0", "s1"]);
  });
});

describe("startAnimation", () => {
  test("marks scenes queued at once, then puts each clip on its scene", async () => {
    const p = project([scene(0), scene(1)]);
    const { deps, calls } = fakeDeps();
    const written = startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    assert.deepEqual(written.scenes.map((s) => s.aiVideoStatus), ["queued", "queued"]);
    await waitFor(() => !isAnimating(p.projectId));
    const after = readProject(dataDir, p.projectId).scenes;
    for (const s of after) {
      assert.equal(s.aiVideoStatus, "done");
      assert.equal(s.mediaKind, "video");
      assert.match(s.videoUrl, /^\/outputs\/bg-video-[0-9a-f-]{36}\.mp4$/);
      assert.ok(s.imagePath.endsWith(`pic-${s.id.slice(1)}.png`), "the picture stays as the poster");
      assert.equal(s.aiVideoCostUsd.toFixed(5), MINI_5S_USD.toFixed(5));
    }
    assert.equal(calls.submit[0].firstFramePath, after[0].imagePath);
    assert.equal(calls.submit[0].durationSec, 5);
    assert.equal(calls.submit[0].aspect, "portrait");
    const sum = ledgerSummary(ledgerDir);
    assert.equal(sum.reservedUsd, 0);
    assert.equal(sum.spentUsd.toFixed(5), (2 * MINI_5S_USD).toFixed(5));
  });

  test("the task id is saved before waiting on BytePlus", async () => {
    const p = project([scene(0)]);
    let seenDuringWait = null;
    const { deps } = fakeDeps({
      wait: async (taskId) => {
        seenDuringWait = readProject(dataDir, p.projectId).scenes[0];
        return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(seenDuringWait.aiVideoStatus, "generating");
    assert.equal(seenDuringWait.aiVideoTaskId, "t-1");
    assert.equal(seenDuringWait.aiVideoMode, "image");
  });

  test("never more than 3 clips are ordered at once", async () => {
    const p = project([0, 1, 2, 3, 4].map((i) => scene(i)));
    let live = 0, peak = 0;
    const { deps } = fakeDeps({
      wait: async (taskId) => {
        live += 1; peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live -= 1;
        return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(peak, 3);
  });

  test("a failed clip leaves the picture and releases the reservation", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ wait: async () => ({ ok: false, code: "FAILED", error: "model busy" }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.equal(s.aiVideoError, "model busy");
    assert.equal(s.mediaKind, "image");
    assert.equal(s.videoPath, undefined);
    assert.deepEqual(ledgerSummary(ledgerDir).reservedUsd, 0);
    assert.deepEqual(ledgerSummary(ledgerDir).spentUsd, 0);
  });

  test("a clip BytePlus never returned (timeout) is still counted, in case it was charged", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ wait: async () => ({ ok: false, code: "TIMEOUT", error: "BytePlus took too long to make the clip." }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.match(s.aiVideoError, /^BytePlus did not return this clip/);
    const sum = ledgerSummary(ledgerDir);
    assert.ok(Math.abs(sum.spentUsd - MINI_5S_USD) < 1e-9, `spent ${sum.spentUsd}`);
    assert.equal(sum.reservedUsd, 0);
  });

  test("a clip that succeeds with 0 tokens is settled at the estimate, not free", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ wait: async (taskId) => ({ ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 0 }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, "done");
    assert.ok(Math.abs(ledgerSummary(ledgerDir).spentUsd - MINI_5S_USD) < 1e-9);
  });

  test("a downloaded clip that cannot be read is deleted", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ resolveClip: async () => ({ ok: false, error: "bad clip" }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoError, "bad clip");
    assert.deepEqual(fs.readdirSync(outputDir).filter((f) => f.startsWith("bg-video-")), []);
  });

  test("on success the clip's own poster is removed; the picture stays the poster", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps();
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const left = fs.readdirSync(outputDir).filter((f) => f.startsWith("bg-video-"));
    assert.equal(left.length, 1, "only the clip itself remains");
    assert.ok(left[0].endsWith(".mp4"));
    assert.ok(fs.existsSync(readProject(dataDir, p.projectId).scenes[0].imagePath));
  });

  test("a converted clip leaves only the converted file", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({
      resolveClip: async ({ outputDir: dir, uploadPath }) => {
        const converted = path.join(dir, `bg-video-${"c".repeat(8)}-converted.mp4`);
        fs.writeFileSync(converted, "mp4");
        return { ok: true, videoPath: converted, videoUrl: "/outputs/converted.mp4", posterPath: null };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const left = fs.readdirSync(outputDir).filter((f) => f.startsWith("bg-video-"));
    assert.deepEqual(left, [`bg-video-${"c".repeat(8)}-converted.mp4`]);
  });

  test("a refused order leaves the picture with BytePlus's reason", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ submit: async () => ({ ok: false, code: "REFUSED", error: "BytePlus declined this scene's prompt. Edit the prompt and try again." }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.match(s.aiVideoError, /declined/);
    assert.equal(ledgerSummary(ledgerDir).reservedUsd, 0);
  });

  test("when the cap is reached part-way, the rest fail with the budget message", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "0.5";
    const p = project([scene(0), scene(1), scene(2)]);
    const { deps, calls } = fakeDeps();
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const statuses = readProject(dataDir, p.projectId).scenes.map((s) => s.aiVideoStatus);
    assert.deepEqual(statuses, ["done", "error", "error"]);
    assert.match(readProject(dataDir, p.projectId).scenes[1].aiVideoError, /^This would take .* AI video spend to \$0\.76 of \$0\.50\.$/);
    assert.equal(calls.submit.length, 1);
  });

  test("a new picture chosen mid-flight is kept; the late clip is paid for but dropped", async () => {
    const p = project([scene(0)]);
    const newPic = path.join(outputDir, "new.png");
    fs.writeFileSync(newPic, "png");
    const { deps } = fakeDeps({
      wait: async (taskId) => {
        // What PUT /scenes/:sid/image does: new picture, AI fields reset.
        const fresh = readProject(dataDir, p.projectId);
        writeProject(dataDir, { ...fresh, scenes: fresh.scenes.map((s) => ({ ...s, imagePath: newPic, mediaKind: "image", videoPath: null, videoUrl: null, aiVideoStatus: "none", aiVideoTaskId: null, aiVideoError: null })) });
        return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.imagePath, newPic);
    assert.equal(s.mediaKind, "image");
    assert.equal(s.aiVideoStatus, "none");
    assert.equal(ledgerSummary(ledgerDir).spentUsd.toFixed(5), MINI_5S_USD.toFixed(5));
    assert.deepEqual(fs.readdirSync(outputDir).filter((f) => f.startsWith("bg-video-")), []);
  });

  test("Stop orders no more clips; clips already ordered still arrive", async () => {
    const p = project([0, 1, 2, 3].map((i) => scene(i)));
    const { deps, calls } = fakeDeps();
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    cancelAnimation(p.projectId);
    await waitFor(() => !isAnimating(p.projectId));
    const scenes = readProject(dataDir, p.projectId).scenes;
    assert.equal(calls.submit.length, 3);
    assert.deepEqual(scenes.map((s) => s.aiVideoStatus), ["done", "done", "done", "error"]);
    assert.equal(scenes[3].aiVideoError, "Stopped before this clip was ordered.");
  });

  test("a second run on the same project is refused while one is going", () => {
    const p = project([scene(0), scene(1)]);
    const { deps } = fakeDeps({ wait: () => new Promise(() => {}) });
    assert.ok(startAnimation(ctx(), p.projectId, { ledgerDir, deps, sceneIds: ["s0"] }));
    assert.equal(startAnimation(ctx(), p.projectId, { ledgerDir, deps, sceneIds: ["s1"] }), null);
  });

  test("nothing to animate returns null and writes nothing", () => {
    const p = project([scene(0, { imageStatus: "error", imagePath: null })]);
    const { deps } = fakeDeps();
    assert.equal(startAnimation(ctx(), p.projectId, { ledgerDir, deps }), null);
    assert.equal(isAnimating(p.projectId), false);
  });
});

describe("resumeAnimations (after a restart)", () => {
  test("collects a paid-for clip by its saved task id without ordering another", async () => {
    const now = Date.now();
    const p = project([scene(0, { aiVideoStatus: "generating", aiVideoTaskId: "t-old", aiVideoStartedAt: now - 3600_000, aiVideoModel: AI_QUALITY.standard.model, aiVideoResolution: "720p" })]);
    const { deps, calls } = fakeDeps();
    const n = await resumeAnimations(ctx(), { ledgerDir, deps });
    assert.equal(n, 1);
    assert.equal(calls.submit.length, 0);
    assert.deepEqual(calls.wait, ["t-old"]);
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "done");
    assert.equal(s.mediaKind, "video");
  });

  test("a scene queued but never ordered is marked failed and its reservation released", async () => {
    const p = project([scene(0, { aiVideoStatus: "queued", aiVideoTaskId: null })]);
    const { deps, calls } = fakeDeps();
    await resumeAnimations(ctx(), { ledgerDir, deps });
    assert.equal(calls.wait.length, 0);
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.equal(s.aiVideoError, "Interrupted by a server restart before the clip was ordered. Animate it again.");
  });

  test("a clip ordered more than 24 h ago is marked expired, not polled", async () => {
    const p = project([scene(0, { aiVideoStatus: "generating", aiVideoTaskId: "t-old", aiVideoStartedAt: Date.now() - 25 * 3600_000 })]);
    const { deps, calls } = fakeDeps();
    await resumeAnimations(ctx(), { ledgerDir, deps });
    assert.equal(calls.wait.length, 0);
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoError, "This clip expired at BytePlus. Animate it again.");
  });
});
