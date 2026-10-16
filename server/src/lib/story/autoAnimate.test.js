import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, writeProject } from "./projectStore.js";
import { reserveSpend } from "../videoGen/spend.js";
import { isAnimating } from "./animateStage.js";
import { autoAnimate, BUDGET_NOTE, BUSY_NOTE, NOT_CONFIGURED_NOTE } from "./autoAnimate.js";

let dataDir, outputDir, ledgerDir, saved;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-anim-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-anim-out-"));
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-anim-ledger-"));
  saved = {
    key: process.env.BYTEPLUS_ARK_API_KEY,
    cap: process.env.VIDEO_GEN_MONTHLY_CAP_USD,
    mult: process.env.VIDEO_GEN_PRICE_MULTIPLIER,
  };
  process.env.BYTEPLUS_ARK_API_KEY = "ark-test";
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_PRICE_MULTIPLIER;
});
afterEach(() => {
  for (const [k, v] of [
    ["BYTEPLUS_ARK_API_KEY", saved.key],
    ["VIDEO_GEN_MONTHLY_CAP_USD", saved.cap],
    ["VIDEO_GEN_PRICE_MULTIPLIER", saved.mult],
  ]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const d of [dataDir, outputDir, ledgerDir]) fs.rmSync(d, { recursive: true, force: true });
});

const ctx = () => ({ dataDir, outputDir });

// A 5 s portrait Standard clip is 108000 tokens at $3.50 a million: $0.378.
function project(sceneCount, aiMotion = true) {
  const p = createProject(dataDir, { title: "John 3 · Part 1", aiMotion });
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const pic = path.join(outputDir, `pic-${i}.png`);
    fs.writeFileSync(pic, "png");
    return {
      id: `s${i}`, text: `t${i}`, startMs: i * 5000, endMs: i * 5000 + 5000, imagePrompt: `p${i}`,
      imagePath: pic, imageUrl: `/outputs/pic-${i}.png`, imageStatus: "done", promptEditedByUser: false, mediaKind: "image",
    };
  });
  return writeProject(dataDir, { ...p, status: "ready_to_render", scenes });
}

function fakeDeps() {
  const submitted = [];
  const deps = {
    submit: async (args) => { submitted.push(args); return { ok: true, taskId: `t-${submitted.length}`, mode: "image" }; },
    wait: async () => ({ ok: true, videoUrl: "https://cdn/t.mp4", tokens: 108000 }),
    download: async (_u, dest) => { fs.writeFileSync(dest, "mp4"); return 3; },
    resolveClip: async ({ outputDir: dir, uploadPath }) => ({ ok: true, videoPath: path.join(dir, uploadPath), videoUrl: `/outputs/${uploadPath}`, posterPath: null }),
    now: () => Date.now(),
  };
  return { deps, submitted };
}

async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const statuses = (id) => readProject(dataDir, id).scenes.map((s) => s.aiVideoStatus);

describe("autoAnimate", () => {
  test("every scene fits: all are queued and there is no note", async () => {
    const p = project(3);
    const { deps, submitted } = fakeDeps();
    const before = Date.now();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    const after = readProject(dataDir, p.projectId);
    assert.equal(after.aiMotion.note, null);
    assert.ok(after.aiMotion.autoStartedAt >= before, "marked started");
    assert.equal(after.aiMotion.quality, "standard");
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(submitted.length, 3);
    assert.deepEqual(statuses(p.projectId), ["done", "done", "done"]);
  });

  test("the cap fits 2 of 3: two are queued and the note says so", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    const p = project(3);
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    assert.equal(readProject(dataDir, p.projectId).aiMotion.note, "2 of 3 scenes animated: monthly AI budget reached");
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(submitted.length, 2);
    assert.deepEqual(statuses(p.projectId), ["done", "done", undefined]);
  });

  test("a long scene that does not fit is skipped, and a later short one still animates", async () => {
    // 12 s is $0.9072 and 4 s is $0.3024; $0.50 left fits one short clip only.
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "0.5";
    const base = project(3);
    const lengths = [12000, 4000, 4000];
    let at = 0;
    const scenes = base.scenes.map((s, i) => {
      const scene = { ...s, startMs: at, endMs: at + lengths[i] };
      at += lengths[i];
      return scene;
    });
    const p = writeProject(dataDir, { ...base, scenes });
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(submitted.length, 1);
    assert.deepEqual(statuses(p.projectId), [undefined, "done", undefined]);
    assert.equal(readProject(dataDir, p.projectId).aiMotion.note, "1 of 3 scenes animated: monthly AI budget reached");
  });

  test("spend already counted this month, settled or reserved, shrinks what fits", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(ledgerDir, "other:s1", 0.5);
    const p = project(3);
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    assert.equal(readProject(dataDir, p.projectId).aiMotion.note, BUDGET_NOTE(1, 3));
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(submitted.length, 1);
  });

  test("nothing fits: the note says 0 of 3 and nothing starts", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "0.3";
    const p = project(3);
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    const after = readProject(dataDir, p.projectId);
    assert.equal(after.aiMotion.note, "0 of 3 scenes animated: monthly AI budget reached");
    assert.ok(after.aiMotion.autoStartedAt > 0);
    assert.equal(isAnimating(p.projectId), false);
    assert.equal(submitted.length, 0);
    assert.deepEqual(statuses(p.projectId), [undefined, undefined, undefined]);
  });

  test("it runs once: a second call (a resegment, say) spends nothing more", async () => {
    const p = project(2);
    const first = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps: first.deps });
    await waitFor(() => !isAnimating(p.projectId));
    const startedAt = readProject(dataDir, p.projectId).aiMotion.autoStartedAt;
    // New pictures arrive, as after a resegment.
    const fresh = readProject(dataDir, p.projectId);
    writeProject(dataDir, { ...fresh, scenes: fresh.scenes.map((s) => ({ ...s, mediaKind: "image", aiVideoStatus: "none", aiVideoClip: false })) });
    const second = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps: second.deps });
    assert.equal(isAnimating(p.projectId), false);
    assert.equal(second.submitted.length, 0);
    assert.equal(readProject(dataDir, p.projectId).aiMotion.autoStartedAt, startedAt);
  });

  test("without a BytePlus key it leaves a note and orders nothing", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const p = project(2);
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    const after = readProject(dataDir, p.projectId);
    assert.equal(after.aiMotion.note, "AI motion is not set up on the server.");
    assert.equal(NOT_CONFIGURED_NOTE, "AI motion is not set up on the server.");
    assert.ok(after.aiMotion.autoStartedAt > 0);
    assert.equal(isAnimating(p.projectId), false);
    assert.equal(submitted.length, 0);
  });

  test("a project without AI motion is left alone", async () => {
    const p = project(2, null);
    const { deps, submitted } = fakeDeps();
    const before = fs.readFileSync(path.join(dataDir, "story-projects", `${p.projectId}.json`), "utf8");
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    assert.equal(isAnimating(p.projectId), false);
    assert.equal(submitted.length, 0);
    assert.equal(fs.readFileSync(path.join(dataDir, "story-projects", `${p.projectId}.json`), "utf8"), before, "not rewritten");
  });

  test("a scene that is locked (being regenerated, say) is left out, and the rest animate", async () => {
    const p = project(3);
    const { deps, submitted } = fakeDeps();
    const sceneBlocked = (_proj, sceneId) => (sceneId === "s1" ? { status: 409, body: { code: "SCENE_REGENERATING" } } : null);
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps, sceneBlocked });
    const after = readProject(dataDir, p.projectId);
    assert.ok(after.aiMotion.autoStartedAt > 0);
    assert.equal(after.aiMotion.note, null, "a locked scene is skipped silently");
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(submitted.length, 2);
    assert.deepEqual(statuses(p.projectId), ["done", undefined, "done"]);
  });

  test("every scene locked: nothing starts and the one try is not used up", async () => {
    const p = project(2);
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps, sceneBlocked: () => ({ status: 409, body: {} }) });
    const after = readProject(dataDir, p.projectId);
    assert.equal(after.aiMotion.autoStartedAt, null);
    assert.equal(after.aiMotion.note, null);
    assert.equal(isAnimating(p.projectId), false);
    assert.equal(submitted.length, 0);
  });

  test("two projects picking at once never pick more than what is left of the budget", async () => {
    // $2 fits five $0.378 clips. A run reserves each clip only as it orders it
    // (three at a time), so the second project must not count A's fourth as free.
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "2";
    const a = project(4);
    const b = project(4);
    let open;
    const gate = new Promise((r) => { open = r; });
    const { deps, submitted } = fakeDeps();
    const gated = { ...deps, submit: async (args) => { await gate; return deps.submit(args); } };
    await Promise.all([
      autoAnimate(ctx(), a.projectId, { ledgerDir, deps: gated }),
      autoAnimate(ctx(), b.projectId, { ledgerDir, deps: gated }),
    ]);
    const queued = [a, b].flatMap((p) => statuses(p.projectId)).filter((s) => s === "queued").length;
    assert.equal(queued, 5, "five clips fit in the budget, across both projects");
    assert.equal(readProject(dataDir, a.projectId).aiMotion.note, null);
    assert.equal(readProject(dataDir, b.projectId).aiMotion.note, BUDGET_NOTE(1, 4));
    open();
    await waitFor(() => !isAnimating(a.projectId) && !isAnimating(b.projectId));
    assert.equal(submitted.length, 5);
    const errors = [a, b].flatMap((p) => readProject(dataDir, p.projectId).scenes).filter((s) => s.aiVideoStatus === "error");
    assert.deepEqual(errors, [], "no picked clip fails on the cap");
  });

  test("a project's picks stop counting once its run ends", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "2";
    const a = project(4);
    const first = fakeDeps();
    await autoAnimate(ctx(), a.projectId, { ledgerDir, deps: first.deps });
    await waitFor(() => !isAnimating(a.projectId));
    // A spent four clips ($1.512); $0.488 is left, so one more fits.
    const b = project(3);
    const second = fakeDeps();
    await autoAnimate(ctx(), b.projectId, { ledgerDir, deps: second.deps });
    assert.equal(readProject(dataDir, b.projectId).aiMotion.note, BUDGET_NOTE(1, 3));
    await waitFor(() => !isAnimating(b.projectId));
    assert.equal(second.submitted.length, 1);
  });

  test("High quality is priced and ordered at High", async () => {
    const p = project(1, { quality: "high" });
    const { deps, submitted } = fakeDeps();
    await autoAnimate(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].resolution, "1080p");
  });

  test("it never throws: a missing project or a failed start only warns and leaves a note", async () => {
    await autoAnimate(ctx(), "no-such-project", { ledgerDir });
    const p = project(1);
    const warn = console.warn;
    const warned = [];
    console.warn = (...a) => { warned.push(a.join(" ")); };
    try {
      await autoAnimate(ctx(), p.projectId, { ledgerDir, start: () => { throw new Error("disk full"); } });
    } finally {
      console.warn = warn;
    }
    assert.ok(warned.some((w) => /auto-animate/.test(w) && /disk full/.test(w)), warned.join("\n"));
    const after = readProject(dataDir, p.projectId);
    assert.ok(after.aiMotion.autoStartedAt > 0, "a failure still counts as the one try");
    assert.equal(after.aiMotion.note, "AI motion could not start: disk full. Use Animate to try again.");
    assert.equal(isAnimating(p.projectId), false);
  });

  test("a failure whose message ends a sentence still reads as one", async () => {
    const p = project(1);
    const warn = console.warn;
    console.warn = () => {};
    try {
      await autoAnimate(ctx(), p.projectId, { ledgerDir, start: () => { throw new Error("The disk is full."); } });
    } finally {
      console.warn = warn;
    }
    assert.equal(readProject(dataDir, p.projectId).aiMotion.note, "AI motion could not start: The disk is full. Use Animate to try again.");
  });

  test("another animation already running: the note says so instead of nothing", async () => {
    const p = project(2);
    await autoAnimate(ctx(), p.projectId, { ledgerDir, start: () => null });
    const after = readProject(dataDir, p.projectId);
    assert.equal(after.aiMotion.note, "AI motion could not start because another animation is running. Use Animate when it finishes.");
    assert.equal(BUSY_NOTE, after.aiMotion.note);
    assert.ok(after.aiMotion.autoStartedAt > 0);
  });
});
