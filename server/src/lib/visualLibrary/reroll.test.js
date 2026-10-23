import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { addClip, readLibrary } from "./store.js";
import { rerollPrice, startReroll, listRerolls, resumeRerolls, isRerolling, rerollLedgerKey, refetchReroll, REROLL_STORE } from "./reroll.js";
import { readLedger } from "../videoGen/spend.js";

function fakeDeps({ refuse = false, fail = null, wait = null } = {}) {
  const calls = { submit: [], wait: [] };
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
      wait: async (taskId) => {
        calls.wait.push(taskId);
        if (wait) return wait(taskId);
        return fail ? { ok: false, ...fail } : { ok: true, videoUrl: "https://example.com/v.mp4", tokens: 108000 };
      },
      download: async (_url, file) => fs.writeFileSync(file, "mp4"),
      ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
      probe: async () => 7.9,
      retryDelayMs: 0,
    },
  };
}

async function settle(dataDir) {
  for (let i = 0; i < 400 && isRerolling(dataDir); i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("re-rolling a library clip", () => {
  let root;
  let ctx;
  let ledgerDir;
  let original;
  // The price the user agreed to; generous so only the price test trips it.
  const reroll = (id, opts = {}) => startReroll(ctx, id, { expectUsd: 5, ...opts });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-reroll-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    ledgerDir = path.join(root, "ledger");
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
    const src = path.join(root, "src.mp4");
    fs.writeFileSync(src, "mp4");
    original = addClip(ctx, {
      file: src, prompt: "A shepherd boy calls out at sunset", lead: "a shepherd boy", aspect: "landscape",
      durationSec: 8.04, tags: ["lamb"], costUsd: 0.61,
    });
  });
  afterEach(() => {
    delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("prices a clip of the original's length before anything is ordered", () => {
    const price = rerollPrice(original);
    assert.equal(price.seconds, 9);
    assert.ok(price.usd > 0.3 && price.usd < 2, `price ${price.usd}`);
    assert.equal(rerollPrice({ ...original, durationSec: null }).seconds, 8, "an unknown length gets the usual 8 s");
  });

  test("orders a new clip from the prompt and keeps it beside the original", async () => {
    const { deps, calls } = fakeDeps();
    const r = reroll(original.id, { prompt: "A shepherd boy calls out at dawn", ledgerDir, deps });
    assert.equal(r.ok, true);
    assert.equal(r.job.status, "queued");
    await settle(ctx.dataDir);
    assert.deepEqual(calls.submit[0], {
      prompt: "A shepherd boy calls out at dawn", aspect: "landscape", durationSec: 9,
      model: calls.submit[0].model, resolution: "720p",
    });
    const [job] = listRerolls(ctx.dataDir);
    assert.equal(job.status, "done");
    const library = readLibrary(ctx.dataDir);
    assert.equal(library.length, 2);
    const made = library.find((c) => c.id === job.clipId);
    assert.equal(made.prompt, "A shepherd boy calls out at dawn");
    assert.equal(made.lead, "a shepherd boy");
    assert.deepEqual(made.tags, ["lamb"]);
    assert.equal(made.durationSec, 7.9);
    assert.deepEqual(made.source, { kind: "reroll", fromClipId: original.id });
    assert.ok(made.posterUrl);
    assert.ok(made.costUsd > 0);
    const ledger = readLedger(ledgerDir);
    assert.equal(Object.keys(ledger.reservations).length, 0, "the reservation is settled");
    assert.ok(Math.abs(ledger.settledUsd - made.costUsd) < 1e-9);
    assert.ok(readLibrary(ctx.dataDir).some((c) => c.id === original.id), "the original stays");
  });

  test("uses the original prompt when none is given, and refuses a clip with no prompt at all", async () => {
    const { deps, calls } = fakeDeps();
    assert.equal(reroll(original.id, { ledgerDir, deps }).ok, true);
    await settle(ctx.dataDir);
    assert.equal(calls.submit[0].prompt, "A shepherd boy calls out at sunset");
    const blank = addClip(ctx, { file: (() => { const f = path.join(root, "b.mp4"); fs.writeFileSync(f, "x"); return f; })() });
    const r = reroll(blank.id, { prompt: "   ", ledgerDir, deps });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  test("a clip that is not in the library can't be re-rolled", () => {
    const r = reroll("0f8c2a4e-1b3d-4c5e-8f9a-000000000099", { ledgerDir, deps: fakeDeps().deps });
    assert.equal(r.status, 404);
  });

  test("refuses when the price went up since it was shown", () => {
    const r = reroll(original.id, { ledgerDir, deps: fakeDeps().deps, expectUsd: 0.01 });
    assert.equal(reroll(original.id, { ledgerDir, deps: fakeDeps().deps, expectUsd: Number.NaN }).code, "NO_PRICE");
    assert.equal(r.ok, false);
    assert.equal(r.code, "PRICE_CHANGED");
    assert.equal(listRerolls(ctx.dataDir).length, 0);
  });

  test("refuses when the month's budget would be passed, without ordering", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "0.05";
    const { deps, calls } = fakeDeps();
    const r = reroll(original.id, { ledgerDir, deps });
    assert.equal(r.ok, false);
    assert.equal(r.code, "BUDGET");
    assert.equal(calls.submit.length, 0);
  });

  test("a declined prompt costs nothing and says so", async () => {
    const { deps } = fakeDeps({ refuse: true });
    reroll(original.id, { prompt: "something", ledgerDir, deps });
    await settle(ctx.dataDir);
    const [job] = listRerolls(ctx.dataDir);
    assert.equal(job.status, "error");
    assert.match(job.error, /declined/);
    assert.equal(readLedger(ledgerDir).settledUsd, 0);
    assert.equal(Object.keys(readLedger(ledgerDir).reservations).length, 0);
  });

  test("a task that times out is counted, since BytePlus may still bill it", async () => {
    const { deps } = fakeDeps({ fail: { code: "TIMEOUT", error: "timed out" } });
    reroll(original.id, { ledgerDir, deps });
    await settle(ctx.dataDir);
    assert.equal(listRerolls(ctx.dataDir)[0].status, "error");
    assert.ok(readLedger(ledgerDir).settledUsd > 0);
    assert.equal(readLibrary(ctx.dataDir).length, 1);
  });

  test("a failure after ordering counts the estimate instead of holding the reservation all month", async () => {
    const { deps } = fakeDeps({ wait: async () => { throw new Error("socket hang up"); } });
    reroll(original.id, { ledgerDir, deps });
    await settle(ctx.dataDir);
    const [job] = listRerolls(ctx.dataDir);
    assert.equal(job.status, "error");
    const ledger = readLedger(ledgerDir);
    assert.equal(Object.keys(ledger.reservations).length, 0);
    assert.ok(Math.abs(ledger.settledUsd - job.estimateUsd) < 0.01);
  });

  test("allows a few at a time, not more", () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { deps } = fakeDeps({ wait: () => gate.then(() => ({ ok: false, code: "FAILED", error: "x" })) });
    const results = Array.from({ length: 4 }, (_, i) => reroll(original.id, { prompt: `take ${i}`, ledgerDir, deps }));
    assert.deepEqual(results.map((r) => r.ok), [true, true, true, false]);
    assert.equal(results[3].code, "BUSY");
    release();
    return settle(ctx.dataDir);
  });

  test("after a restart an ordered clip is collected, not ordered again; an unordered one is released", async () => {
    const { deps, calls } = fakeDeps();
    const store = path.join(ctx.dataDir, "visual-library-rerolls.json");
    const base = { fromClipId: original.id, prompt: "p", aspect: "landscape", seconds: 9, lead: "", tags: [], createdAt: Date.now(), estimateUsd: 0.6 };
    fs.writeFileSync(store, JSON.stringify({ jobs: [
      { ...base, id: "j-ordered", status: "generating", taskId: "task-old", startedAt: Date.now() },
      { ...base, id: "j-queued", status: "queued", taskId: null },
    ] }));
    const collected = await resumeRerolls(ctx, { ledgerDir, deps });
    assert.equal(collected, 1);
    assert.equal(calls.submit.length, 0, "nothing is ordered again");
    assert.deepEqual(calls.wait, ["task-old"]);
    const jobs = Object.fromEntries(listRerolls(ctx.dataDir).map((j) => [j.id, j]));
    assert.equal(jobs["j-ordered"].status, "done");
    assert.equal(jobs["j-queued"].status, "error");
    assert.equal(readLedger(ledgerDir).reservations[rerollLedgerKey("j-queued")], undefined);
  });

  test("collecting the same task twice charges once", async () => {
    const { deps } = fakeDeps();
    reroll(original.id, { ledgerDir, deps });
    await settle(ctx.dataDir);
    const once = readLedger(ledgerDir).settledUsd;
    const store = path.join(ctx.dataDir, "visual-library-rerolls.json");
    const saved = JSON.parse(fs.readFileSync(store, "utf8"));
    // As if the server stopped after paying but before the clip was saved.
    saved.jobs[0] = { ...saved.jobs[0], status: "generating", clipId: null };
    fs.writeFileSync(store, JSON.stringify(saved));
    await resumeRerolls(ctx, { ledgerDir, deps });
    assert.equal(readLedger(ledgerDir).settledUsd, once);
  });
  test("a second request for the same re-roll is refused, not paid for twice", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { deps, calls } = fakeDeps({ wait: () => gate.then(() => ({ ok: false, code: "FAILED", error: "x" })) });
    assert.equal(reroll(original.id, { prompt: "Same", ledgerDir, deps }).ok, true);
    const again = reroll(original.id, { prompt: "Same", ledgerDir, deps });
    assert.equal(again.code, "DUPLICATE");
    release();
    await settle(ctx.dataDir);
    assert.equal(calls.submit.length, 1);
  });

  test("if the job can't be saved, its reservation is released", () => {
    fs.mkdirSync(path.join(ctx.dataDir, REROLL_STORE), { recursive: true });
    assert.throws(() => reroll(original.id, { ledgerDir, deps: fakeDeps().deps }));
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
  });

  test("if saving the order fails after BytePlus took it, the estimate is counted and the server keeps running", async () => {
    const store = path.join(ctx.dataDir, REROLL_STORE);
    const { deps } = fakeDeps();
    const submit = deps.submit;
    deps.submit = async (args) => {
      const r = await submit(args);
      // From here every write to the job store fails.
      fs.rmSync(store, { force: true });
      fs.mkdirSync(store);
      return r;
    };
    reroll(original.id, { ledgerDir, deps });
    await settle(ctx.dataDir);
    const ledger = readLedger(ledgerDir);
    assert.deepEqual(ledger.reservations, {}, "nothing is held for the rest of the month");
    assert.ok(ledger.settledUsd > 0, "the ordered clip is counted");
  });

  test("a paid clip that could not be downloaded can be fetched again for free", async () => {
    const { deps } = fakeDeps();
    deps.download = async () => { throw new Error("connection reset"); };
    reroll(original.id, { ledgerDir, deps });
    await settle(ctx.dataDir);
    const [failed] = listRerolls(ctx.dataDir);
    assert.equal(failed.status, "error");
    assert.match(failed.error, /paid for/);
    const paid = readLedger(ledgerDir).settledUsd;
    assert.equal(readLibrary(ctx.dataDir).length, 1);
    const r = refetchReroll(ctx, failed.id, { ledgerDir, deps: fakeDeps().deps });
    assert.equal(r.ok, true);
    await settle(ctx.dataDir);
    assert.equal(listRerolls(ctx.dataDir)[0].status, "done");
    assert.equal(readLibrary(ctx.dataDir).length, 2);
    assert.equal(readLedger(ledgerDir).settledUsd, paid, "fetching again costs nothing");
    assert.equal(refetchReroll(ctx, failed.id, { ledgerDir }).code, "NOT_REFETCHABLE");
  });

  test("a clip whose poster or length can't be read is still kept", async () => {
    const { deps } = fakeDeps();
    deps.ffmpeg = async () => { throw new Error("ffmpeg crashed"); };
    deps.probe = async () => { throw new Error("ffprobe crashed"); };
    reroll(original.id, { ledgerDir, deps });
    await settle(ctx.dataDir);
    const [job] = listRerolls(ctx.dataDir);
    assert.equal(job.status, "done");
    assert.equal(readLibrary(ctx.dataDir).find((c) => c.id === job.clipId).durationSec, 9);
  });
});
