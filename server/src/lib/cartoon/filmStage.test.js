import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, updateProject, projectOutputDir } from "./store.js";
import { cartoonFromScript } from "./model.js";
import { startFilm, isFilming, cancelFilm, resumeFilm, filmLedgerKey, lastFrameOf } from "./filmStage.js";
import { readLibrary } from "../visualLibrary/store.js";
import { readLedger, reserveSpend } from "../videoGen/spend.js";
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

  test("charges each task once, even when collected again after a restart", async () => {
    const project = newProject();
    const stuck = updateProject(ctx.dataDir, project.id, (p) => ({
      ...p,
      shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "generating", taskId: "task-9", seconds: 4, prompt: "p" } } : s)),
    }));
    reserveSpend(ledgerDir, filmLedgerKey(project.id, "sh1"), 0.5);
    const { deps } = fakeDeps();
    const crashAfterCharge = { ...deps, download: async () => { throw new Error("restart"); } };
    assert.equal(await resumeFilm(ctx, [stuck], { ledgerDir, deps: crashAfterCharge }), 1);
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

  test("lastFrameOf returns null when ffmpeg leaves no picture", async () => {
    const out = path.join(root, "frames", "x-last.png");
    const empty = { ffmpeg: async (args) => { fs.mkdirSync(path.dirname(args.at(-1)), { recursive: true }); fs.writeFileSync(args.at(-1), ""); return { ok: true }; } };
    assert.equal(await lastFrameOf(empty, "clip.mp4", out), null);
    const good = { ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "png"); return { ok: true }; } };
    assert.equal(await lastFrameOf(good, "clip.mp4", out), out);
    const broken = { ffmpeg: async () => { throw new Error("spawn failed"); } };
    assert.equal(await lastFrameOf(broken, "clip.mp4", out), null);
  });
});
