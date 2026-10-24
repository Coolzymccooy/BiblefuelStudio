import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, updateProject } from "./projectStore.js";
import { projectFromMarkdown } from "./model.js";
import { startShots, isOrderingShots, cancelShots, estimateShots, useLibraryClip, resumeShots, shotPrompt, ledgerKey } from "./shotStage.js";
import { readLibrary, addClip } from "../visualLibrary/store.js";
import { readLedger, reserveSpend } from "../videoGen/spend.js";

const SCRIPT = [
  "### Scene 1 — Opening (0:00–0:06)",
  "*Visual: A man standing alone in the darkness.*",
  "**Narrator:**",
  "\"Look at me today.\"",
  "### Scene 2 — Dawn (0:06–0:12)",
  "*Visual: A golden sunrise over the hills.*",
  "**Narrator:**",
  "\"Grace made me.\"",
].join("\n");

function fakeDeps({ refuse = false, failAfter = false } = {}) {
  const calls = { submit: [] };
  let n = 0;
  return {
    calls,
    deps: {
      submit: async (args) => {
        calls.submit.push(args);
        if (refuse) return { ok: false, code: "REFUSED", error: "declined" };
        n += 1;
        return { ok: true, taskId: `task-${n}`, mode: "text" };
      },
      wait: async () => (failAfter
        ? { ok: false, code: "FAILED", error: "may be related to copyright restrictions" }
        : { ok: true, videoUrl: "https://example.com/v.mp4", tokens: 108000 }),
      download: async (_url, file) => fs.writeFileSync(file, "mp4"),
      ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
      probe: async () => 7,
    },
  };
}

async function settle(id) {
  for (let i = 0; i < 300 && isOrderingShots(id); i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("shot stage", () => {
  let root;
  let ctx;
  let ledgerDir;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-shots-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    ledgerDir = path.join(root, "ledger");
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
  });
  afterEach(() => {
    delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("orders every shot, keeps each clip in the library and settles the ledger", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const { deps, calls } = fakeDeps();
    assert.ok(startShots(ctx, project.id, { ledgerDir, deps }));
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.ok(done.shots.every((s) => s.clip.status === "done" && s.clip.libraryId));
    assert.equal(readLibrary(ctx.dataDir).length, done.shots.length);
    assert.match(calls.submit[0].prompt, /Black Nigerian man/);
    const ledger = readLedger(ledgerDir);
    assert.equal(ledger.clips, done.shots.length);
    assert.deepEqual(ledger.reservations, {});
    assert.ok(done.spentUsd > 0);
  });

  test("a run is recorded on the project: when it started and ended, and whether it was stopped", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const marked = startShots(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    assert.equal(typeof marked.shotsRun.startedAt, "number");
    assert.equal(marked.shotsRun.finishedAt, null);
    await settle(project.id);
    const run = readProject(ctx.dataDir, project.id).shotsRun;
    assert.ok(run.finishedAt >= run.startedAt);
    assert.equal(run.cancelled, false);
  });

  test("a run stopped with cancelShots is recorded as cancelled", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { deps } = fakeDeps();
    startShots(ctx, project.id, { ledgerDir, deps: { ...deps, wait: async (...args) => { await gate; return deps.wait(...args); } } });
    cancelShots(project.id);
    release();
    await settle(project.id);
    assert.equal(readProject(ctx.dataDir, project.id).shotsRun.cancelled, true);
  });

  test("a refused prompt costs nothing and says how to fix it", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    startShots(ctx, project.id, { ledgerDir, deps: fakeDeps({ refuse: true }).deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.ok(done.shots.every((s) => s.clip.status === "error" && /Reword/.test(s.clip.error)));
    assert.equal(readLedger(ledgerDir).settledUsd, 0);
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
  });

  test("a clip refused after it was made is released, not charged", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    startShots(ctx, project.id, { ledgerDir, deps: fakeDeps({ failAfter: true }).deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.ok(done.shots.every((s) => /Reword/.test(s.clip.error)));
    assert.equal(readLedger(ledgerDir).settledUsd, 0);
  });

  test("a re-roll keeps the earlier clip in the library", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    startShots(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    const first = readProject(ctx.dataDir, project.id).shots[0].clip.libraryId;
    startShots(ctx, project.id, { only: ["sh1"], ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    const after = readProject(ctx.dataDir, project.id);
    assert.notEqual(after.shots[0].clip.libraryId, first);
    assert.ok(readLibrary(ctx.dataDir).some((c) => c.id === first));
  });

  test("a new clip starts unrefined, whether ordered or from the library", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    startShots(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    const refine = { in: 1, out: null, rate: null, flip: true, zoom: 1, x: 0, y: 0, grade: "warm" };
    updateProject(ctx.dataDir, project.id, (p) => ({ ...p, shots: p.shots.map((s) => ({ ...s, refine })) }));
    startShots(ctx, project.id, { only: ["sh1"], ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    const src = path.join(root, "x.mp4");
    fs.writeFileSync(src, "mp4");
    const clip = addClip(ctx, { file: src, prompt: "sunrise" });
    const used = useLibraryClip(ctx, project.id, "sh2", clip.id);
    assert.equal(used.project.shots[0].refine, null);
    assert.equal(used.project.shots[1].refine, null);
  });

  test("a library clip fills a shot for free and drops out of the estimate", () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const src = path.join(root, "x.mp4");
    fs.writeFileSync(src, "mp4");
    const clip = addClip(ctx, { file: src, prompt: "sunrise" });
    const before = estimateShots(project);
    const used = useLibraryClip(ctx, project.id, "sh2", clip.id);
    assert.ok(used.ok);
    const after = estimateShots(used.project);
    assert.equal(after.clips, before.clips - 1);
    assert.equal(after.fromLibrary, 1);
    assert.equal(used.project.shots[1].clip.costUsd, 0);
  });

  test("flags an estimate over the $10 benchmark", () => {
    const project = createProject(ctx.dataDir, { ...projectFromMarkdown(SCRIPT), spentUsd: 9.9 });
    const est = estimateShots(project);
    assert.equal(est.benchmarkUsd, 10);
    assert.equal(est.overBenchmark, true);
    assert.ok(est.totalUsd > 9.9);
  });

  test("the operator's own prompt wins over the built one", () => {
    const project = projectFromMarkdown(SCRIPT);
    assert.equal(shotPrompt(project, { ...project.shots[0], prompt: "My own words" }), "My own words");
  });

  test("after a restart, collects ordered clips and fails unordered ones", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const stuck = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p,
      shots: [
        { ...p.shots[0], clip: { status: "generating", taskId: "task-9", seconds: 6, prompt: "p" } },
        { ...p.shots[1], clip: { status: "queued", taskId: null, seconds: 6, prompt: "p" } },
      ],
    }));
    const count = await resumeShots(ctx, [stuck], { ledgerDir, deps: fakeDeps().deps });
    assert.equal(count, 1);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "done");
    assert.equal(done.shots[1].clip.status, "error");
    assert.equal(readLedger(ledgerDir).reservations[ledgerKey(project.id, "sh2")], undefined);
  });

  test("a paid clip that fails to download is fetched again for free", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const { deps, calls } = fakeDeps();
    let downloads = 0;
    const flaky = { ...deps, retryDelayMs: 0, download: async (url, file) => { downloads += 1; if (downloads <= 3) throw new Error("socket hang up"); return deps.download(url, file); } };
    startShots(ctx, project.id, { only: ["sh1"], ledgerDir, deps: flaky });
    await settle(project.id);
    const failed = readProject(ctx.dataDir, project.id);
    assert.equal(downloads, 3);
    assert.equal(failed.shots[0].clip.status, "error");
    assert.match(failed.shots[0].clip.error, /paid for/);
    const spent = failed.spentUsd;
    assert.ok(spent > 0);
    assert.equal(readLedger(ledgerDir).clips, 1);
    const estimate = estimateShots(failed, ["sh1"]);
    assert.equal(estimate.clips, 0);
    assert.equal(estimate.usd, 0);

    startShots(ctx, project.id, { only: ["sh1"], ledgerDir, deps: flaky });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "done");
    assert.equal(calls.submit.length, 1, "no second order");
    assert.equal(done.spentUsd, spent, "no second charge");
    assert.equal(readLedger(ledgerDir).clips, 1);
  });

  test("collecting the same task twice charges it once", async () => {
    const project = createProject(ctx.dataDir, projectFromMarkdown(SCRIPT));
    const stuck = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p,
      shots: [{ ...p.shots[0], clip: { status: "generating", taskId: "task-9", seconds: 6, prompt: "p" } }, p.shots[1]],
    }));
    reserveSpend(ledgerDir, ledgerKey(project.id, "sh1"), 0.5);
    const { deps } = fakeDeps();
    const crashAfterCharge = { ...deps, download: async () => { throw new Error("restart"); }, retryDelayMs: 0 };
    await resumeShots(ctx, [stuck], { ledgerDir, deps: crashAfterCharge });
    const once = readProject(ctx.dataDir, project.id).spentUsd;
    const again = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p, shots: p.shots.map((s) => (s.id === "sh1" ? { ...s, clip: { ...s.clip, status: "generating" } } : s)),
    }));
    await resumeShots(ctx, [again], { ledgerDir, deps });
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "done");
    assert.equal(done.spentUsd, once);
    assert.equal(readLedger(ledgerDir).clips, 1);
  });
});
