import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, updateProject, projectOutputDir } from "./store.js";
import { cartoonFromScript, estimateFilm } from "./model.js";
import { cartoonRenderBlockers } from "./renderStage.js";
import { startFilm, isFilming, cancelFilm, resumeFilm, filmLedgerKey, filmHoldKey, lastFrameOf } from "./filmStage.js";
import { readLibrary } from "../visualLibrary/store.js";
import { readLedger, reserveSpend, holdSpend, ledgerSummary, estimateTokens, usdForTokens } from "../videoGen/spend.js";
import { SEEDANCE_MODELS } from "../videoGen/providers/seedance.js";

const SCRIPT = `# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, curly dark hair. Voice: bright and eager.
- Pip: a small fluffy white lamb with one black ear. Voice: tiny and soft.

Scene: A rocky hillside at dusk
Eli: "Pip? Pip, where are you?"
Pip: "I'm stuck, Eli!"

Scene: Behind the rock, close-up
(Eli lifts Pip free of the thorns.)
Eli: "I came for you."
`;

const QUIET_START = `# The Lost Lamb
Verse: Luke 15:4
Style: 3D family film

Cast:
- Eli: a shepherd boy about eight, curly dark hair. Voice: bright and eager.

Scene: An empty hillside at dawn
(Wind moves through the long grass.)

Scene: The sheepfold
Eli: "Pip? Pip, where are you?"
`;

function fakeDeps({ submit, wait, heard = "", frameOk = true } = {}) {
  const calls = { submit: [], ffmpeg: [], transcribe: 0 };
  let n = 0;
  return {
    calls,
    deps: {
      retryDelayMs: 0,
      submit: async (args) => {
        calls.submit.push(args);
        if (submit) {
          const answer = await submit(args);
          if (answer) return answer;
        }
        n += 1;
        return { ok: true, taskId: `task-${n}`, mode: "image" };
      },
      wait: async (taskId) => (wait && (await wait(taskId))) || { ok: true, videoUrl: `https://example.com/${taskId}.mp4`, tokens: 100000 },
      download: async (_url, file) => fs.writeFileSync(file, "mp4"),
      ffmpeg: async (args) => {
        calls.ffmpeg.push(args);
        if (args.includes("-sseof") && !frameOk) return { ok: false };
        fs.writeFileSync(args.at(-1), "picture");
        return { ok: true };
      },
      probe: async () => 4,
      transcribe: async () => { calls.transcribe += 1; return { ok: true, text: heard }; },
      windows: async () => [{ from: 0.3, to: 2.1 }],
    },
  };
}

async function settle(id) {
  for (let i = 0; i < 400 && isFilming(id); i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(isFilming(id), false, "the run finished");
}

const shotOf = (project, args) => project.shots.find((s) => s.clip?.prompt === args.prompt)?.id;

describe("cartoon film stage", () => {
  let root;
  let ctx;
  let ledgerDir;

  function newProject(script = SCRIPT) {
    return createProject(ctx.dataDir, cartoonFromScript(script));
  }

  /** Give the named characters an approved portrait file, as the portrait step would. */
  function approve(id, names) {
    const dir = path.join(projectOutputDir(ctx.outputDir, id), "pictures");
    fs.mkdirSync(dir, { recursive: true });
    return updateProject(ctx.dataDir, id, (p) => {
      const cast = { ...p.cast };
      for (const name of names) {
        const file = `pictures/${name.toLowerCase()}-1.png`;
        fs.writeFileSync(path.join(projectOutputDir(ctx.outputDir, id), file), "png");
        cast[name] = { ...cast[name], approved: true, portrait: { file, url: `/x/${file}`, status: "done" } };
      }
      return { ...p, cast };
    });
  }

  const portraitPath = (id, name) => path.join(projectOutputDir(ctx.outputDir, id), "pictures", `${name.toLowerCase()}-1.png`);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-film-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    ledgerDir = path.join(root, "ledger");
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
  });
  afterEach(() => {
    delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("orders fresh shots at once with portrait references, and a chained shot after its parent from the parent's last frame", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps({ heard: "Pip? Pip, where are you?" });
    assert.ok(startFilm(ctx, project.id, { ledgerDir, deps }));
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.ok(done.shots.every((s) => s.clip.status === "done" && s.clip.libraryId), "every shot is done");

    const order = calls.submit.map((args) => shotOf(done, args));
    assert.deepEqual(new Set(order.slice(0, 2)), new Set(["sh1", "sh3"]));
    assert.ok(order.indexOf("sh2") > order.indexOf("sh1"));
    assert.ok(order.indexOf("sh4") > order.indexOf("sh3"));

    const byShot = Object.fromEntries(calls.submit.map((args) => [shotOf(done, args), args]));
    assert.deepEqual(byShot.sh1.referenceImagePaths, [portraitPath(project.id, "Eli"), portraitPath(project.id, "Pip")]);
    assert.equal(byShot.sh1.firstFramePath, undefined);
    assert.deepEqual(byShot.sh3.referenceImagePaths, [portraitPath(project.id, "Eli"), portraitPath(project.id, "Pip")]);
    for (const chained of ["sh2", "sh4"]) {
      assert.match(byShot[chained].firstFramePath, /-last\.png$/);
      assert.equal(byShot[chained].referenceImagePaths, undefined);
    }
    const frameCall = calls.ffmpeg.find((args) => args.includes("-sseof"));
    assert.deepEqual(frameCall.slice(frameCall.indexOf("-sseof"), frameCall.indexOf("-sseof") + 2), ["-sseof", "-0.1"]);

    const library = readLibrary(ctx.dataDir);
    assert.equal(library.length, 4);
    const first = library.find((c) => c.id === done.shots[0].clip.libraryId);
    assert.deepEqual(first.source, { kind: "cartoon", projectId: project.id, shotId: "sh1" });
    assert.deepEqual(first.tags, ["the lost lamb", "eli"], "the library keeps tags in lower case");
    assert.equal(first.lead, "a shepherd boy about eight, curly dark hair");
    assert.equal(first.prompt, done.shots[0].clip.prompt);
    const silent = library.find((c) => c.id === done.shots[2].clip.libraryId);
    assert.deepEqual(silent.tags, ["the lost lamb"]);
    assert.equal(silent.lead, "");

    assert.deepEqual(done.shots[0].clip.speech, { heard: "Pip? Pip, where are you?", score: 1, ok: true });
    assert.equal(done.shots[2].clip.speech, null, "a silent shot is not transcribed");
    assert.equal(calls.transcribe, 3);
    assert.ok(done.shots.every((s) => s.clip.windows.length === 1));

    const ledger = readLedger(ledgerDir);
    assert.equal(ledger.clips, 4);
    assert.deepEqual(ledger.reservations, {});
    assert.ok(done.spentUsd > 0);
  });

  test("sends generate_audio and never falls back to text", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps();
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    assert.equal(calls.submit.length, 4);
    for (const args of calls.submit) {
      assert.equal(args.generateAudio, true);
      assert.equal(args.allowTextFallback, false);
      assert.equal(args.seed, project.seed);
      assert.equal(args.model, SEEDANCE_MODELS.mini);
      assert.equal(args.resolution, "720p");
      assert.equal(args.durationSec, 4);
    }
  });

  test("a refused picture marks the shot refused and charges nothing", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps({
      submit: async (args) => (args.referenceImagePaths
        ? { ok: false, code: "PERSON_REFUSED", error: "BytePlus thinks this picture shows a real person." }
        : null),
    });
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "refused");
    assert.match(done.shots[0].clip.error, /real person/);
    assert.equal(done.shots[2].clip.status, "refused");
    assert.deepEqual(done.shots[1].clip, { ...done.shots[1].clip, status: "waiting", error: "Waiting for shot 1" });
    assert.equal(done.shots[3].clip.error, "Waiting for shot 3");
    assert.equal(calls.submit.length, 2, "the chained shots are never ordered");
    assert.equal(readLedger(ledgerDir).settledUsd, 0);
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
    assert.equal(done.spentUsd, 0);
  });

  test("a failed parent leaves its chained child waiting and unordered", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps({
      submit: async (args) => (args.prompt.includes("Pip? Pip") ? { ok: true, taskId: "doomed" } : null),
      wait: async (taskId) => (taskId === "doomed" ? { ok: false, code: "FAILED", error: "internal error" } : null),
    });
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "error");
    assert.equal(done.shots[1].clip.status, "waiting");
    assert.equal(done.shots[1].clip.error, "Waiting for shot 1");
    assert.equal(done.shots[1].clip.taskId, null);
    assert.equal(done.shots[3].clip.status, "done");
    assert.equal(calls.submit.length, 3, "sh1, sh3 and sh4 only");
    const ledger = readLedger(ledgerDir);
    assert.equal(ledger.clips, 2);
    assert.deepEqual(ledger.reservations, {});
  });

  test("charges each task once, even when collected again after a restart", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const project = newProject();
    const stuck = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p,
      shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "generating", taskId: "task-9", seconds: 4, prompt: "p" } } : s)),
    }));
    reserveSpend(ledgerDir, filmLedgerKey(project.id, "sh1"), 0.5);
    const { deps } = fakeDeps();
    const downloadFails = { ...deps, download: async () => { throw new Error("socket hang up"); } };
    assert.equal(await resumeFilm(ctx, [stuck], { ledgerDir, deps: downloadFails }), 1);
    assert.match(warn.mock.calls[0].arguments[0], /paid but not downloaded/);
    const once = readProject(ctx.dataDir, project.id);
    assert.equal(once.shots[0].clip.status, "error");
    assert.ok(once.spentUsd > 0);

    const again = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p, shots: p.shots.map((s) => (s.id === "sh1" ? { ...s, clip: { ...s.clip, status: "generating" } } : s)),
    }));
    await resumeFilm(ctx, [again], { ledgerDir, deps });
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "done");
    assert.equal(done.spentUsd, once.spentUsd);
    assert.equal(readLedger(ledgerDir).clips, 1);
  });

  test("resume collects ordered shots and fails never-ordered ones", async () => {
    const project = newProject();
    const stuck = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p,
      shots: p.shots.map((s, i) => ({
        ...s,
        clip: i === 0
          ? { status: "generating", taskId: "task-9", seconds: 4, prompt: "p" }
          : { status: "queued", taskId: null, seconds: 4, prompt: "p" },
      })),
    }));
    reserveSpend(ledgerDir, filmLedgerKey(project.id, "sh3"), 0.5);
    const { deps, calls } = fakeDeps();
    const count = await resumeFilm(ctx, [stuck], { ledgerDir, deps });
    assert.equal(count, 1);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "done");
    assert.equal(done.shots[1].clip.status, "error");
    assert.match(done.shots[1].clip.error, /restart/);
    assert.equal(done.shots[2].clip.status, "error");
    assert.equal(done.shots[3].clip.status, "waiting", "a chained shot never orders from a frame that is not there");
    assert.equal(done.shots[3].clip.error, "Waiting for shot 3");
    assert.equal(calls.submit.length, 0);
    assert.equal(readLedger(ledgerDir).reservations[filmLedgerKey(project.id, "sh3")], undefined);
  });

  test("a speech mismatch is flagged, never re-made", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps({ heard: "I am stuck" });
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    const sh2 = done.shots[1].clip;
    assert.equal(sh2.status, "done");
    assert.equal(sh2.speech.ok, false);
    assert.equal(sh2.speech.heard, "I am stuck");
    assert.ok(sh2.speech.score < 0.8);
    assert.equal(calls.submit.filter((args) => args.prompt === sh2.prompt).length, 1);
  });

  test("a transcription failure is stored and never blocks the clip", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps();
    const failing = {
      ...deps,
      transcribe: async () => ({ ok: false, error: "not configured" }),
      windows: async () => { throw new Error("ffmpeg missing"); },
    };
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: failing });
    await settle(project.id);
    const clip = readProject(ctx.dataDir, project.id).shots[0].clip;
    assert.equal(clip.status, "done");
    assert.deepEqual(clip.speech, { ok: null, error: "not configured" });
    assert.deepEqual(clip.windows, []);
  });

  test("re-making a shot marks the chained next shot stale", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    startFilm(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    const first = readProject(ctx.dataDir, project.id);
    const oldClip = first.shots[0].clip.libraryId;

    assert.ok(startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: fakeDeps().deps }));
    await settle(project.id);
    const remade = readProject(ctx.dataDir, project.id);
    assert.notEqual(remade.shots[0].clip.libraryId, oldClip);
    assert.equal(remade.shots[0].clip.previous.libraryId, oldClip);
    assert.equal(remade.shots[0].clip.previous.previous, undefined, "previous clips never nest");
    assert.equal(remade.shots[1].clip.stale, true);
    assert.equal(remade.shots[1].clip.libraryId, first.shots[1].clip.libraryId, "the stale shot is not re-made by itself");
    assert.equal(remade.shots[3].clip.stale, undefined);
    assert.ok(readLibrary(ctx.dataDir).some((c) => c.id === oldClip), "the old clip stays in the library");

    startFilm(ctx, project.id, { only: ["sh2"], ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    assert.equal(readProject(ctx.dataDir, project.id).shots[1].clip.stale, undefined);
  });

  test("a second start while running returns null", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps();
    const written = startFilm(ctx, project.id, { ledgerDir, deps });
    assert.ok(written);
    assert.equal(written.shots[0].clip.status, "queued");
    assert.equal(isFilming(project.id), true);
    assert.equal(startFilm(ctx, project.id, { ledgerDir, deps }), null);
    await settle(project.id);
    assert.equal(startFilm(ctx, project.id, { ledgerDir, deps }), null, "nothing left to order");
  });

  test("a fresh shot with a character but no approved portrait is not ordered", async () => {
    const project = newProject();
    const { deps, calls } = fakeDeps();
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "error");
    assert.equal(done.shots[0].clip.error, "Approve Eli's portrait first.");
    assert.equal(done.shots[2].clip.error, "Approve Eli's portrait first.");
    assert.equal(done.shots[1].clip.status, "waiting");
    assert.equal(calls.submit.length, 0);
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
  });

  test("a silent fresh shot with nobody in it goes from its prompt alone", async () => {
    const project = newProject(QUIET_START);
    const { deps, calls } = fakeDeps();
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps });
    await settle(project.id);
    assert.equal(readProject(ctx.dataDir, project.id).shots[0].clip.status, "done");
    assert.deepEqual(calls.submit[0].referenceImagePaths, []);
  });

  test("a chained shot whose starting picture cannot be made fails and costs nothing", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps({ frameOk: false });
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[1].clip.status, "error");
    assert.equal(done.shots[1].clip.error, "The starting picture for this shot could not be made. Make the shot before it again.");
    assert.equal(calls.submit.length, 2);
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
    assert.equal(readLedger(ledgerDir).clips, 2);
  });

  test("cancel stops the shots not yet ordered", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps();
    startFilm(ctx, project.id, { ledgerDir, deps });
    assert.equal(cancelFilm(project.id), true);
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.ok(done.shots.every((s) => s.clip.status === "error" && s.clip.error === "Stopped before this clip was ordered."));
    assert.equal(calls.submit.length, 0);
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
    assert.equal(cancelFilm(project.id), false, "nothing to stop once the run is over");
  });

  test("a timeout or auth error after submit charges the estimate and is an error, not a refusal", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps({
      wait: async (taskId) => ({
        "task-1": { ok: false, code: "TIMEOUT", error: "BytePlus took too long (last error: sensitive content check)" },
        "task-2": { ok: false, code: "HTTP_401", error: "BytePlus refused the request (HTTP 401)." },
      }[taskId] || null),
    });
    startFilm(ctx, project.id, { only: ["sh1", "sh3"], ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    for (const index of [0, 2]) {
      assert.equal(done.shots[index].clip.status, "error");
      assert.equal(done.shots[index].clip.chargedTaskId, done.shots[index].clip.taskId);
    }
    const estimate = usdForTokens({ model: SEEDANCE_MODELS.mini, resolution: "720p", tokens: estimateTokens({ durationSec: 4, ratio: "9:16", resolution: "720p" }) });
    const ledger = readLedger(ledgerDir);
    assert.equal(ledger.clips, 2);
    assert.deepEqual(ledger.reservations, {});
    assert.ok(Math.abs(ledger.settledUsd - 2 * estimate) < 1e-9);
    assert.ok(Math.abs(done.spentUsd - 2 * estimate) < 1e-9);
  });

  test("a refusal at wait marks the shot refused and releases the reservation", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps({
      wait: async (taskId) => ({
        "task-1": { ok: false, code: "REFUSED", error: "declined" },
        "task-2": { ok: false, code: "FAILED", error: "OutputVideoSensitiveContentDetected" },
      }[taskId] || null),
    });
    startFilm(ctx, project.id, { only: ["sh1", "sh3"], ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.equal(done.shots[0].clip.status, "refused");
    assert.equal(done.shots[2].clip.status, "refused");
    assert.match(done.shots[0].clip.error, /declined this shot/);
    const ledger = readLedger(ledgerDir);
    assert.equal(ledger.settledUsd, 0);
    assert.deepEqual(ledger.reservations, {});
    assert.equal(done.spentUsd, 0);
  });

  test("a crash while waiting on a submitted task settles its estimate instead of leaving the reservation stuck", async (t) => {
    t.mock.method(console, "warn", () => {});
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps({ wait: async () => { throw new Error("poller crashed"); } });
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps });
    await settle(project.id);
    const clip = readProject(ctx.dataDir, project.id).shots[0].clip;
    assert.equal(clip.status, "error");
    assert.equal(clip.error, "Something went wrong making this clip. Try again.");
    assert.equal(clip.chargedTaskId, "task-1");
    const ledger = readLedger(ledgerDir);
    assert.deepEqual(ledger.reservations, {});
    assert.equal(ledger.clips, 1);
  });

  test("cancel during a run still collects the shots already submitted", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps, calls } = fakeDeps({ submit: async () => { cancelFilm(project.id); return null; } });
    startFilm(ctx, project.id, { ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.ok(calls.submit.length >= 1);
    const submitted = new Set(calls.submit.map((args) => shotOf(done, args)));
    assert.ok(submitted.has("sh1"));
    for (const shot of done.shots) {
      if (submitted.has(shot.id)) assert.equal(shot.clip.status, "done", `${shot.id} was collected`);
      else assert.equal(shot.clip.error, "Stopped before this clip was ordered.");
    }
    assert.equal(done.shots[1].clip.error, "Stopped before this clip was ordered.", "a chained shot is not ordered after a stop");
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
  });

  test("a chained shot named alone, whose parent is already done, starts at once", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    startFilm(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    const log = [];
    const { deps, calls } = fakeDeps({
      submit: async () => { log.push("submit"); return null; },
      wait: async () => { await new Promise((r) => setTimeout(r, 20)); log.push("resolved"); return null; },
    });
    startFilm(ctx, project.id, { only: ["sh2", "sh3"], ledgerDir, deps });
    await settle(project.id);
    const done = readProject(ctx.dataDir, project.id);
    assert.deepEqual(log.slice(0, 2), ["submit", "submit"], "both shots were ordered before either finished");
    assert.equal(done.shots[1].clip.status, "done");
    assert.match(calls.submit.find((args) => shotOf(done, args) === "sh2").firstFramePath, /sh2-last\.png$/);
  });

  test("leaves nothing in the project's tmp folder", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    startFilm(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    assert.deepEqual(fs.readdirSync(path.join(projectOutputDir(ctx.outputDir, project.id), "tmp")), []);
  });

  test("lastFrameOf returns null when ffmpeg leaves no picture", async () => {
    const out = path.join(root, "frames", "x-last.png");
    const empty = { ffmpeg: async (args) => { fs.mkdirSync(path.dirname(args.at(-1)), { recursive: true }); fs.writeFileSync(args.at(-1), ""); return { ok: true }; } };
    assert.equal(await lastFrameOf(empty, "clip.mp4", out), null);
    const good = { ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "png"); return { ok: true }; } };
    assert.equal(await lastFrameOf(good, "clip.mp4", out), out);
    const broken = { ffmpeg: async () => { throw new Error("spawn failed"); } };
    assert.equal(await lastFrameOf(broken, "clip.mp4", out), null);
  });

  /** A project whose every shot has a done clip, as after a first full film run. */
  async function filmed() {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    startFilm(ctx, project.id, { ledgerDir, deps: fakeDeps().deps });
    await settle(project.id);
    return readProject(ctx.dataDir, project.id);
  }

  /** The shot kept its earlier paid clip after a re-make that made nothing, and says why. */
  function assertKeptEarlier(before, shotId, why) {
    const after = readProject(ctx.dataDir, before.id);
    const was = before.shots.find((s) => s.id === shotId).clip;
    const clip = after.shots.find((s) => s.id === shotId).clip;
    assert.equal(clip.status, "done", `${shotId} is still done`);
    assert.equal(clip.libraryId, was.libraryId, `${shotId} kept the clip it had`);
    assert.equal(clip.url, was.url);
    assert.match(clip.remakeError, why);
    assert.equal(estimateFilm(after).clips, 0, "nothing needs ordering again");
    const clipBlockers = cartoonRenderBlockers(ctx, after).filter((b) => /clip/.test(b));
    assert.deepEqual(clipBlockers, [], "every shot still has a clip to render");
    return after;
  }

  test("a refused re-make keeps the earlier clip and says why", async () => {
    const before = await filmed();
    const refusing = fakeDeps({ submit: async () => ({ ok: false, code: "PERSON_REFUSED", error: "real person" }) });
    startFilm(ctx, before.id, { only: ["sh1"], ledgerDir, deps: refusing.deps });
    await settle(before.id);
    const after = assertKeptEarlier(before, "sh1", /real person/);
    assert.equal(after.spentUsd, before.spentUsd, "nothing more was paid");
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
  });

  test("a re-make that BytePlus fails keeps the earlier clip, and the reservation is released", async () => {
    const before = await filmed();
    const failing = fakeDeps({ wait: async () => ({ ok: false, code: "FAILED", error: "internal error" }) });
    startFilm(ctx, before.id, { only: ["sh3"], ledgerDir, deps: failing.deps });
    await settle(before.id);
    assertKeptEarlier(before, "sh3", /did not return this clip/);
    const ledger = readLedger(ledgerDir);
    assert.deepEqual(ledger.reservations, {});
    assert.equal(ledger.clips, 4, "the failed re-make was not charged");
  });

  test("a re-make refused at the monthly cap orders nothing and keeps the earlier clip", async () => {
    const before = await filmed();
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = String(readLedger(ledgerDir).settledUsd + 0.01);
    const { deps, calls } = fakeDeps();
    const refused = startFilm(ctx, before.id, { only: ["sh1"], ledgerDir, deps });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "BUDGET");
    assert.equal(isFilming(before.id), false);
    assert.equal(calls.submit.length, 0);
    assert.deepEqual(readProject(ctx.dataDir, before.id).shots, before.shots, "the project is untouched");
    assert.deepEqual(readLedger(ledgerDir).reservations, {});
  });

  test("a stopped re-make keeps the earlier clip", async () => {
    const before = await filmed();
    const { deps, calls } = fakeDeps();
    startFilm(ctx, before.id, { only: ["sh1"], ledgerDir, deps });
    cancelFilm(before.id);
    await settle(before.id);
    assertKeptEarlier(before, "sh1", /Stopped/);
    assert.equal(calls.submit.length, 0);
  });

  test("a re-make cut off by a restart before it was ordered keeps the earlier clip", async () => {
    const before = await filmed();
    const done = before.shots[0].clip;
    const stuck = updateProject(ctx.dataDir, before.id, (p) => ({
      ...p,
      shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "queued", taskId: null, seconds: 4, prompt: "p", previous: done } } : s)),
    }));
    await resumeFilm(ctx, [stuck], { ledgerDir, deps: fakeDeps().deps });
    assertKeptEarlier(before, "sh1", /restart/);
  });

  test("a re-make paid for but not downloaded keeps the earlier clip and is fetched later at no cost", async (t) => {
    t.mock.method(console, "warn", () => {});
    const before = await filmed();
    const { deps } = fakeDeps();
    startFilm(ctx, before.id, { only: ["sh1"], ledgerDir, deps: { ...deps, download: async () => { throw new Error("socket hang up"); } } });
    await settle(before.id);
    const kept = assertKeptEarlier(before, "sh1", /paid for but could not be downloaded/);
    assert.ok(kept.spentUsd > before.spentUsd, "the re-make was paid for");
    const estimate = estimateFilm(kept, ["sh1"]);
    assert.equal(estimate.clips, 0);
    assert.equal(estimate.refetch, 1);
    assert.equal(estimate.usd, 0);

    const again = fakeDeps();
    assert.ok(startFilm(ctx, before.id, { only: ["sh1"], ledgerDir, deps: again.deps }));
    await settle(before.id);
    const fetched = readProject(ctx.dataDir, before.id);
    assert.equal(again.calls.submit.length, 0, "fetched again, never ordered again");
    assert.equal(fetched.shots[0].clip.status, "done");
    assert.notEqual(fetched.shots[0].clip.libraryId, before.shots[0].clip.libraryId);
    assert.equal(fetched.shots[0].clip.previous.libraryId, before.shots[0].clip.libraryId);
    assert.equal(fetched.shots[0].clip.remakeError, undefined);
    assert.equal(fetched.spentUsd, kept.spentUsd, "fetching it cost nothing");
    assert.equal(readLedger(ledgerDir).clips, 5);
  });

  test("a paid clip that failed to download is priced at $0", async (t) => {
    t.mock.method(console, "warn", () => {});
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps();
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: { ...deps, download: async () => { throw new Error("socket hang up"); } } });
    await settle(project.id);
    const failed = readProject(ctx.dataDir, project.id);
    assert.equal(failed.shots[0].clip.status, "error");
    const all = estimateFilm(failed);
    assert.equal(all.refetch, 1);
    assert.equal(all.clips, 3, "only the three unmade shots are priced");
    assert.equal(estimateFilm(failed, ["sh1"]).usd, 0);
  });

  test("a re-wait that ends in a definite failure orders anew next time", async (t) => {
    t.mock.method(console, "warn", () => {});
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps();
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: { ...deps, download: async () => { throw new Error("socket hang up"); } } });
    await settle(project.id);
    assert.equal(estimateFilm(readProject(ctx.dataDir, project.id), ["sh1"]).refetch, 1);

    const dead = fakeDeps({ wait: async () => ({ ok: false, code: "NO_VIDEO", error: "BytePlus finished the clip but sent no video." }) });
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: dead.deps });
    await settle(project.id);
    assert.equal(dead.calls.submit.length, 0, "the first Retry waits on the paid task again");
    const failed = readProject(ctx.dataDir, project.id);
    assert.equal(failed.shots[0].clip.status, "error");
    assert.equal(failed.shots[0].clip.refetchable, false);
    assert.equal(estimateFilm(failed, ["sh1"]).clips, 1, "the next Retry is a new, priced order");

    const fresh = fakeDeps();
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: fresh.deps });
    await settle(project.id);
    assert.equal(fresh.calls.submit.length, 1);
    assert.equal(readProject(ctx.dataDir, project.id).shots[0].clip.status, "done");
  });

  test("a refused fresh shot names the portraits to make again", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps({ submit: async () => ({ ok: false, code: "PERSON_REFUSED", error: "real person" }) });
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps });
    await settle(project.id);
    assert.equal(
      readProject(ctx.dataDir, project.id).shots[0].clip.error,
      "BytePlus thinks one of these portraits shows a real person: Eli and Pip. Make them again.",
    );
  });

  test("a speech check that throws stores a fixed sentence, never the error's text", async () => {
    const project = newProject();
    approve(project.id, ["Eli", "Pip"]);
    const { deps } = fakeDeps();
    const throwing = { ...deps, transcribe: async () => { throw new Error("ENOENT: no such file C:\\tmp\\cartoon-speech-1.wav"); } };
    startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: throwing });
    await settle(project.id);
    const { speech } = readProject(ctx.dataDir, project.id).shots[0].clip;
    assert.deepEqual(speech, { ok: null, error: "The speech check could not run." });
  });

  describe("the film hold (issue #124)", () => {
    const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
    const held = (id) => Number(readLedger(ledgerDir).reservations[filmHoldKey(id)]) || 0;
    const clipKeys = (id) => Object.keys(readLedger(ledgerDir).reservations).filter((k) => k.startsWith(`cartoon:${id}:`));

    /** Fake deps whose clips wait until `open()` is called. */
    function gatedDeps() {
      let open;
      const gate = new Promise((r) => { open = r; });
      return { ...fakeDeps({ wait: async () => { await gate; return null; } }), open };
    }

    async function submitted(calls, n) {
      for (let i = 0; i < 400 && calls.submit.length < n; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert.equal(calls.submit.length, n);
    }

    test("the whole remaining film is held when it starts, and each clip draws from the hold", async () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const fresh = readProject(ctx.dataDir, project.id);
      const whole = estimateFilm(fresh).usd;
      const { deps, calls, open } = gatedDeps();
      assert.ok(startFilm(ctx, project.id, { ledgerDir, deps }).shots);
      near(held(project.id), whole, "the whole film is held before any clip is ordered");
      near(ledgerSummary(ledgerDir).reservedUsd, whole, "reservedUsd counts the hold");

      await submitted(calls, 2);
      const reservations = readLedger(ledgerDir).reservations;
      const sh1 = reservations[filmLedgerKey(project.id, "sh1")];
      const sh3 = reservations[filmLedgerKey(project.id, "sh3")];
      near(sh1, estimateFilm(fresh, ["sh1"]).usd, "a clip reserves its own estimate");
      near(sh3, estimateFilm(fresh, ["sh3"]).usd, "a clip reserves its own estimate");
      near(held(project.id), whole - sh1 - sh3, "the hold shrinks by what the clips took");
      near(ledgerSummary(ledgerDir).reservedUsd, whole, "mid-film the hold plus the clips is still the film's estimate");

      open();
      await settle(project.id);
      assert.ok(readProject(ctx.dataDir, project.id).shots.every((s) => s.clip.status === "done"));
      assert.deepEqual(readLedger(ledgerDir).reservations, {}, "the hold is gone once the film is done");
    });

    test("two films started at once near the cap: exactly one starts and neither is half-made", async () => {
      const a = newProject();
      approve(a.id, ["Eli", "Pip"]);
      const b = newProject();
      approve(b.id, ["Eli", "Pip"]);
      const whole = estimateFilm(readProject(ctx.dataDir, a.id)).usd;
      process.env.VIDEO_GEN_MONTHLY_CAP_USD = String(whole * 1.5);
      const { deps, calls } = fakeDeps();
      const first = startFilm(ctx, a.id, { ledgerDir, deps });
      const second = startFilm(ctx, b.id, { ledgerDir, deps });
      assert.ok(first.shots, "the first film starts");
      assert.equal(second.ok, false);
      assert.equal(second.code, "BUDGET");
      assert.match(second.error, /AI video spend/);
      assert.equal(isFilming(b.id), false);
      assert.ok(readProject(ctx.dataDir, b.id).shots.every((s) => s.clip === null), "nothing of the second film was queued");
      await settle(a.id);
      assert.ok(readProject(ctx.dataDir, a.id).shots.every((s) => s.clip.status === "done"), "the first film is whole");
      assert.equal(calls.submit.length, 4);
      assert.deepEqual(readLedger(ledgerDir).reservations, {});
    });

    test("an order elsewhere after the film starts sees the hold", async () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const whole = estimateFilm(readProject(ctx.dataDir, project.id)).usd;
      process.env.VIDEO_GEN_MONTHLY_CAP_USD = String(whole + 0.1);
      const { deps, open } = gatedDeps();
      assert.ok(startFilm(ctx, project.id, { ledgerDir, deps }).shots);
      assert.equal(reserveSpend(ledgerDir, "scene:other:sh1", 0.2).ok, false, "a Human-mode clip cannot take the film's money");
      open();
      await settle(project.id);
      assert.ok(readProject(ctx.dataDir, project.id).shots.every((s) => s.clip.status === "done"));
    });

    test("a clip within the hold is never refused by the cap, even if the cap falls mid-film", async () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const { deps, calls } = fakeDeps();
      assert.ok(startFilm(ctx, project.id, { ledgerDir, deps }).shots);
      process.env.VIDEO_GEN_MONTHLY_CAP_USD = "0.01";
      await settle(project.id);
      assert.equal(calls.submit.length, 4);
      assert.ok(readProject(ctx.dataDir, project.id).shots.every((s) => s.clip.status === "done"), "no clip was refused part-way");
      assert.deepEqual(readLedger(ledgerDir).reservations, {});
    });

    test("the cap check can count more than is held, and a refusal holds and queues nothing", () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const fresh = readProject(ctx.dataDir, project.id);
      const one = estimateFilm(fresh, ["sh1"]).usd;
      const whole = estimateFilm(fresh).usd;
      process.env.VIDEO_GEN_MONTHLY_CAP_USD = String((one + whole) / 2);
      const refused = startFilm(ctx, project.id, { only: ["sh1"], budgetUsd: whole, ledgerDir, deps: fakeDeps().deps });
      assert.equal(refused.code, "BUDGET");
      assert.deepEqual(readProject(ctx.dataDir, project.id).shots, fresh.shots);
      assert.deepEqual(readLedger(ledgerDir).reservations, {});
    });

    test("a re-make holds only its own price", async () => {
      const before = await filmed();
      const one = estimateFilm(before, ["sh1"]).usd;
      const { deps, calls, open } = gatedDeps();
      assert.ok(startFilm(ctx, before.id, { only: ["sh1"], ledgerDir, deps }).shots);
      near(held(before.id), one, "the re-make's own price is held");
      await submitted(calls, 1);
      assert.equal(held(before.id), 0, "the clip took the whole hold");
      near(ledgerSummary(ledgerDir).reservedUsd, one, "reservedUsd is the re-make's price");
      open();
      await settle(before.id);
      assert.deepEqual(readLedger(ledgerDir).reservations, {});
    });

    test("a free re-fetch holds nothing", async (t) => {
      t.mock.method(console, "warn", () => {});
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps: { ...fakeDeps().deps, download: async () => { throw new Error("socket hang up"); } } });
      await settle(project.id);
      const { deps, calls, open } = gatedDeps();
      assert.ok(startFilm(ctx, project.id, { only: ["sh1"], ledgerDir, deps }).shots);
      assert.deepEqual(readLedger(ledgerDir).reservations, {}, "no hold for a clip already paid for");
      open();
      await settle(project.id);
      assert.equal(calls.submit.length, 0);
      assert.equal(readProject(ctx.dataDir, project.id).shots[0].clip.status, "done");
    });

    test("the hold is released when the film is stopped part-way", async () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const { deps, calls, open } = gatedDeps();
      startFilm(ctx, project.id, { ledgerDir, deps });
      await submitted(calls, 2);
      assert.ok(held(project.id) > 0);
      cancelFilm(project.id);
      open();
      await settle(project.id);
      assert.deepEqual(readLedger(ledgerDir).reservations, {});
      assert.equal(calls.submit.length, 2, "the chained shots were not ordered after the stop");
    });

    test("the hold is released when every clip fails", async () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const { deps } = fakeDeps({ submit: async () => ({ ok: false, code: "FAILED", error: "boom" }) });
      startFilm(ctx, project.id, { ledgerDir, deps });
      await settle(project.id);
      assert.deepEqual(readLedger(ledgerDir).reservations, {});
      assert.equal(readLedger(ledgerDir).settledUsd, 0);
    });

    test("resume releases a hold a restart left behind, even for a cartoon no longer listed", async () => {
      const project = newProject();
      holdSpend(ledgerDir, filmHoldKey(project.id), 1.2);
      holdSpend(ledgerDir, filmHoldKey("gone"), 0.5);
      reserveSpend(ledgerDir, "scene:other:sh1", 0.3);
      await resumeFilm(ctx, [project], { ledgerDir, deps: fakeDeps().deps });
      assert.deepEqual(readLedger(ledgerDir).reservations, { "scene:other:sh1": 0.3 });
      assert.equal(readLedger(ledgerDir).settledUsd, 0, "a hold is never charged");
    });

    test("resume leaves a running film's hold alone", async () => {
      const project = newProject();
      approve(project.id, ["Eli", "Pip"]);
      const { deps, open } = gatedDeps();
      startFilm(ctx, project.id, { ledgerDir, deps });
      const before = held(project.id);
      assert.ok(before > 0);
      await resumeFilm(ctx, [], { ledgerDir, deps: fakeDeps().deps });
      assert.equal(held(project.id), before);
      open();
      await settle(project.id);
      assert.deepEqual(clipKeys(project.id), []);
    });
  });
});
