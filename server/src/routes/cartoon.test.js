import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { createCartoonRouter, resumeCartoonFilms, isMakingPortraits } from "./cartoon.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { createProject, readProject, updateProject } from "../lib/cartoon/store.js";
import { cartoonFromScript, estimateFilm } from "../lib/cartoon/model.js";
import { isFilming, filmHoldKey } from "../lib/cartoon/filmStage.js";
import { isRenderingCartoon } from "../lib/cartoon/renderStage.js";
import { EXAMPLES } from "../lib/cartoon/examples.js";
import { ledgerSummary, holdSpend, readLedger } from "../lib/videoGen/spend.js";

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

const LONG_LINE = "I have walked over every hill and through every valley in the dark tonight looking for you because you matter so much to me";
const TOO_LONG = `# The Long Walk
Verse: Luke 15:4

Cast:
- Eli: a shepherd boy about eight, curly dark hair. Voice: bright and eager.

Scene: A rocky hillside at dusk, wide
Eli: "${LONG_LINE}"
Eli: "${LONG_LINE}"

Scene: Behind the rock, close-up
Eli: "${LONG_LINE}"
Eli: "${LONG_LINE}"
Eli: "${LONG_LINE}"
Eli: "${LONG_LINE}"
`;

const VERSE = "What man of you, having an hundred sheep, if he lose one of them, doth not leave the ninety and nine?";

async function until(fn) {
  for (let i = 0; i < 400 && fn(); i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("/api/cartoon", () => {
  let root;
  let app;
  let admin = true;
  let llmImpl;
  let lookupImpl;
  let waitImpl;
  let imageImpl;
  let submitted = 0;
  let renderImpl;
  const renders = [];
  const defaultRender = async (args) => { renders.push(args); fs.writeFileSync(args.outputLocation, "raw"); };
  const ctx = () => ({ dataDir: path.join(root, "data"), outputDir: path.join(root, "out") });

  const defaultImage = async ({ partNumber }) => {
    const file = path.join(root, `portrait-${partNumber}-${Math.random()}.png`);
    fs.writeFileSync(file, "png");
    return { ok: true, path: file };
  };

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-routes-"));
    process.env.BYTEPLUS_ARK_API_KEY = "test-key";
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ctx = { ...ctx(), isSuperAdmin: admin };
      next();
    });
    const deps = {
      image: (args) => imageImpl(args),
      llm: (prompt) => llmImpl(prompt),
      lookup: (ref) => lookupImpl(ref),
      film: {
        submit: async () => { submitted += 1; return { ok: true, taskId: `task-${submitted}` }; },
        wait: (taskId) => waitImpl(taskId),
        download: async (_url, file) => fs.writeFileSync(file, "mp4"),
        ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "picture"); return { ok: true }; },
        probe: async () => 4,
        transcribe: async () => ({ ok: true, text: "" }),
        windows: async () => [],
      },
      render: {
        ffmpeg: async (args) => {
          if (args.at(-1) !== "-") fs.writeFileSync(args.at(-1), "media");
          return { ok: true, stderr: "" };
        },
        probe: async () => 20,
        serveUrl: async () => "http://bundle.invalid",
        render: (args) => renderImpl(args),
      },
    };
    app.use("/api/cartoon", requireSuperAdmin, createCartoonRouter({ ledgerDir: path.join(root, "ledger"), deps, writeTimeoutMs: 200 }));
  });

  beforeEach(() => {
    admin = true;
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
    llmImpl = async () => SCRIPT;
    lookupImpl = async (ref) => ({ ok: true, canonical: ref, verses: [{ text: VERSE }] });
    waitImpl = async (taskId) => ({ ok: true, videoUrl: `https://example.com/${taskId}.mp4`, tokens: 100000 });
    imageImpl = defaultImage;
    renderImpl = defaultRender;
  });

  after(() => {
    for (const k of ["BYTEPLUS_ARK_API_KEY", "VIDEO_GEN_MONTHLY_CAP_USD", "SCENE_SCRIPT_BENCHMARK_USD"]) delete process.env[k];
    fs.rmSync(root, { recursive: true, force: true });
  });

  const create = (markdown = SCRIPT) => request(app).post("/api/cartoon").send({ markdown });

  /** Set the monthly cap to what is already spent or reserved plus `extraUsd`. */
  function capAbove(extraUsd) {
    const month = ledgerSummary(path.join(root, "ledger"));
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = String(month.spentUsd + month.reservedUsd + extraUsd);
  }

  async function makePortraits(id, only) {
    const r = await request(app).post(`/api/cartoon/${id}/portraits`).send(only ? { only } : {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await until(() => isMakingPortraits(id));
    return r;
  }

  /** A cartoon with every portrait approved and the shot list approved: ready to film. */
  async function readyCartoon(markdown = SCRIPT) {
    const id = (await create(markdown)).body.project.id;
    await makePortraits(id);
    for (const name of Object.keys(readProject(ctx().dataDir, id).cast)) {
      const r = await request(app).post(`/api/cartoon/${id}/cast/${encodeURIComponent(name)}/approve`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const approved = await request(app).post(`/api/cartoon/${id}/shots/approve`);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    return id;
  }

  test("non-admins are refused", async () => {
    admin = false;
    assert.equal((await request(app).get("/api/cartoon")).status, 403);
    assert.equal((await create()).status, 403);
  });

  test("lists styles and examples with the placeholder", async () => {
    const styles = await request(app).get("/api/cartoon/styles");
    assert.ok(styles.body.styles.some((s) => s.id === "family3d" && s.label));
    const examples = await request(app).get("/api/cartoon/examples");
    assert.equal(examples.body.examples.length, EXAMPLES.length);
    assert.deepEqual(Object.keys(examples.body.examples[0]).sort(), ["blurb", "id", "markdown", "title", "verse"]);
    assert.equal(examples.body.placeholder, EXAMPLES[0].markdown);
  });

  test("parse previews without saving", async () => {
    const r = await request(app).post("/api/cartoon/parse").send({ markdown: SCRIPT });
    assert.equal(r.status, 200);
    assert.equal(r.body.preview.shots.length, 4);
    assert.equal(r.body.check.ok, true);
    assert.equal(r.body.estimate.clips, 4);
    assert.equal(r.body.preview.source.markdown, undefined);
    assert.equal((await request(app).post("/api/cartoon/parse").send({ markdown: " " })).status, 400);
    assert.equal((await request(app).post("/api/cartoon/parse").send({ markdown: "x".repeat(8001) })).status, 413);
  });

  test("creating an over-40 s script is refused with the scene to trim", async () => {
    const before = (await request(app).get("/api/cartoon")).body.projects.length;
    const r = await create(TOO_LONG);
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.code, "TOO_LONG_FILM");
    assert.equal(r.body.check.ok, false);
    assert.equal(r.body.check.trimScene.place, "Behind the rock");
    assert.match(r.body.error, /Behind the rock/);
    assert.equal((await request(app).get("/api/cartoon")).body.projects.length, before, "nothing was saved");
  });

  test("creating a script looks up the verse text and shows the derived fields", async () => {
    const r = await create();
    assert.equal(r.status, 201);
    const p = r.body.project;
    assert.equal(p.meta.verse.text, VERSE);
    assert.equal(p.fits, true);
    assert.equal(p.estimate.clips, 4);
    assert.deepEqual(p.running, { pictures: false, film: false, render: false });
    assert.ok(p.blockers.some((b) => /Eli and Pip/.test(b)));
    assert.ok(p.blockers.some((b) => /shot list/i.test(b)));
    assert.equal(p.source.markdown, SCRIPT, "the editor gets the script back");
    const list = await request(app).get("/api/cartoon");
    assert.ok(list.body.projects.some((row) => row.id === p.id && row.mode === "cartoon"));
  });

  test("a verse lookup that fails still creates the cartoon", async () => {
    lookupImpl = async () => { throw new Error("offline"); };
    const r = await create();
    assert.equal(r.status, 201);
    assert.equal(r.body.project.meta.verse.text, "");
  });

  test("creating from an example copies its cast", async () => {
    const example = EXAMPLES[1];
    const r = await request(app).post("/api/cartoon").send({ exampleId: example.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const expected = cartoonFromScript(example.markdown).cast;
    assert.deepEqual(Object.keys(r.body.project.cast), Object.keys(expected));
    for (const [name, member] of Object.entries(expected)) assert.equal(r.body.project.cast[name].look, member.look);
    assert.equal(r.body.project.source.markdown, example.markdown);
    const unknown = await request(app).post("/api/cartoon").send({ exampleId: "no-such-example" });
    assert.equal(unknown.status, 404);
  });

  test("editing the script is locked once a clip was ordered", async () => {
    const id = (await create()).body.project.id;
    await makePortraits(id, ["Eli"]);
    await request(app).post(`/api/cartoon/${id}/cast/Eli/approve`);

    const edited = SCRIPT.replace("I came for you.", "I came for you, Pip.");
    const ok = await request(app).patch(`/api/cartoon/${id}`).send({ markdown: edited });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.project.shots[3].line, "I came for you, Pip.");
    assert.equal(ok.body.project.cast.Eli.approved, true, "an unchanged look keeps its approved portrait");
    assert.ok(ok.body.project.cast.Eli.portrait.url);

    const tooLong = await request(app).patch(`/api/cartoon/${id}`).send({ markdown: TOO_LONG });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.code, "TOO_LONG_FILM");

    updateProject(ctx().dataDir, id, (p) => ({
      ...p, shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "error", taskId: "task-x", error: "x" } } : s)),
    }));
    const locked = await request(app).patch(`/api/cartoon/${id}`).send({ markdown: SCRIPT });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.code, "LOCKED");
    assert.equal(readProject(ctx().dataDir, id).shots[3].line, "I came for you, Pip.");
  });

  test("a film order that would pass the monthly cap orders nothing", async () => {
    const id = await readyCartoon();
    const project = readProject(ctx().dataDir, id);
    const whole = estimateFilm(project).usd;
    const one = estimateFilm(project, ["sh1"]).usd;
    // One shot fits under the cap, but the whole film does not: nothing is ordered.
    capAbove((one + whole) / 2);
    const r = await request(app).post(`/api/cartoon/${id}/film`).send({ only: ["sh1"], confirmOverBenchmark: true });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "BUDGET");
    assert.match(r.body.error, /AI video spend/);
    assert.equal(isFilming(id), false);
    assert.ok(readProject(ctx().dataDir, id).shots.every((s) => s.clip === null));
  });

  test("two films ordered at once near the cap: exactly one starts, the other is BUDGET, and neither is half-made", async () => {
    const a = await readyCartoon();
    const b = await readyCartoon();
    const whole = estimateFilm(readProject(ctx().dataDir, a)).usd;
    capAbove(whole * 1.6);
    let release;
    const gate = new Promise((r) => { release = r; });
    waitImpl = async (taskId) => { await gate; return { ok: true, videoUrl: `https://example.com/${taskId}.mp4`, tokens: 100000 }; };
    const answers = await Promise.all([a, b].map((id) => request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true })));
    const statuses = answers.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify(answers.map((r) => r.body.code)));
    const refused = answers.find((r) => r.status === 409);
    assert.equal(refused.body.code, "BUDGET");
    assert.match(refused.body.error, /AI video spend/);
    const [startedId, refusedId] = answers[0].status === 200 ? [a, b] : [b, a];
    assert.equal(isFilming(refusedId), false);
    assert.ok(readProject(ctx().dataDir, refusedId).shots.every((s) => s.clip === null), "nothing of the refused film was queued");
    const month = ledgerSummary(path.join(root, "ledger"));
    assert.ok(Math.abs(month.reservedUsd - whole) < 1e-9, "the started film's whole estimate is reserved");
    release();
    await until(() => isFilming(startedId));
    assert.ok(readProject(ctx().dataDir, startedId).shots.every((s) => s.clip?.status === "done"), "the started film is whole");
    assert.equal(ledgerSummary(path.join(root, "ledger")).reservedUsd, 0, "its hold is released");
  });

  test("deleting a cartoon releases a hold left on the ledger", async () => {
    const id = (await create()).body.project.id;
    const ledgerDir = path.join(root, "ledger");
    holdSpend(ledgerDir, filmHoldKey(id), 0.75);
    assert.equal((await request(app).delete(`/api/cartoon/${id}`)).status, 200);
    assert.equal(readLedger(ledgerDir).reservations[filmHoldKey(id)], undefined);
  });

  test("a paid re-make of a done shot counts toward the cap", async () => {
    const id = await readyCartoon();
    const first = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await until(() => isFilming(id));
    const project = readProject(ctx().dataDir, id);
    assert.ok(project.shots.every((s) => s.clip?.status === "done"));
    // Nothing is left unmade, so only the re-make itself can pass the cap.
    capAbove(estimateFilm(project, ["sh1"]).usd / 2);
    const r = await request(app).post(`/api/cartoon/${id}/film`).send({ only: ["sh1"], confirmOverBenchmark: true });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "BUDGET");
    assert.equal(isFilming(id), false);
    assert.equal(readProject(ctx().dataDir, id).shots[0].clip.status, "done");
  });

  test("a free re-fetch of a paid clip passes the cap and the benchmark, and orders nothing", async () => {
    process.env.SCENE_SCRIPT_BENCHMARK_USD = "0.01";
    try {
      const id = await readyCartoon();
      updateProject(ctx().dataDir, id, (p) => ({
        ...p,
        spentUsd: 1,
        shots: p.shots.map((s, i) => (i === 0
          ? { ...s, clip: { status: "error", taskId: "task-paid", chargedTaskId: "task-paid", startedAt: Date.now(), seconds: 4, prompt: "p", error: "not downloaded" } }
          : s)),
      }));
      const project = readProject(ctx().dataDir, id);
      assert.equal(estimateFilm(project, ["sh1"]).usd, 0);
      assert.equal(estimateFilm(project, ["sh1"]).refetch, 1);
      capAbove(0);
      const before = submitted;
      const r = await request(app).post(`/api/cartoon/${id}/film`).send({ only: ["sh1"] });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      await until(() => isFilming(id));
      assert.equal(submitted, before, "nothing was ordered");
      assert.equal(readProject(ctx().dataDir, id).shots[0].clip.status, "done");
    } finally {
      delete process.env.SCENE_SCRIPT_BENCHMARK_USD;
    }
  });

  test("Start over: a locked cartoon's script makes a new cartoon, and the old one keeps its clips", async () => {
    const id = (await create()).body.project.id;
    updateProject(ctx().dataDir, id, (p) => ({
      ...p, shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "done", taskId: "task-old", libraryId: "lib-1", url: "/x.mp4" } } : s)),
    }));
    const old = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    assert.equal((await request(app).patch(`/api/cartoon/${id}`).send({ markdown: old.source.markdown })).body.code, "LOCKED");
    const fresh = await request(app).post("/api/cartoon").send({ markdown: old.source.markdown });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    assert.notEqual(fresh.body.project.id, id);
    assert.ok(fresh.body.project.shots.every((s) => s.clip === null));
    assert.equal(readProject(ctx().dataDir, id).shots[0].clip.libraryId, "lib-1", "the old cartoon is untouched");
  });

  test("a portrait drawn in the old style can't be approved until it is made again", async () => {
    const id = await readyCartoon();
    const before = readProject(ctx().dataDir, id);
    assert.equal(before.cast.Eli.portrait.style, "family3d", "a portrait records the style it was drawn in");
    const styled = await request(app).patch(`/api/cartoon/${id}`).send({ style: "Claymation" });
    assert.equal(styled.status, 200);

    const refused = await request(app).post(`/api/cartoon/${id}/cast/Eli/approve`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "STYLE_CHANGED");
    assert.equal(refused.body.error, "This portrait was drawn in the old style. Make it again first.");
    assert.equal(readProject(ctx().dataDir, id).cast.Eli.approved, false);

    await makePortraits(id, ["Eli"]);
    assert.equal(readProject(ctx().dataDir, id).cast.Eli.portrait.style, "clay");
    assert.equal((await request(app).post(`/api/cartoon/${id}/cast/Eli/approve`)).status, 200);

    // Approved in the old style, as before this rule: still not ready to film.
    updateProject(ctx().dataDir, id, (p) => ({ ...p, cast: { ...p.cast, Pip: { ...p.cast.Pip, approved: true } } }));
    const shots = await request(app).post(`/api/cartoon/${id}/shots/approve`);
    assert.equal(shots.status, 409);
    assert.equal(shots.body.code, "CAST_NOT_READY");
    assert.deepEqual(shots.body.waiting, ["Pip"]);
    updateProject(ctx().dataDir, id, (p) => ({ ...p, shotListApproved: true }));
    const film = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    assert.equal(film.body.code, "CAST_NOT_READY");

    // A portrait with no recorded style counts as drawn in the current one.
    updateProject(ctx().dataDir, id, (p) => {
      const { style: _style, ...portrait } = p.cast.Pip.portrait;
      return { ...p, cast: { ...p.cast, Pip: { ...p.cast.Pip, approved: false, portrait } } };
    });
    assert.equal((await request(app).post(`/api/cartoon/${id}/cast/Pip/approve`)).status, 200);
  });

  test("the film re-checks the cast even when the shot list says approved", async () => {
    const id = (await create()).body.project.id;
    updateProject(ctx().dataDir, id, (p) => ({ ...p, shotListApproved: true }));
    const r = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "CAST_NOT_READY");
    assert.deepEqual(r.body.waiting, ["Eli", "Pip"]);
  });

  test("a style that names no style changes nothing, and /write refuses it", async () => {
    const id = await readyCartoon();
    for (const style of ["constructor", "__proto__", "garbage"]) {
      const r = await request(app).patch(`/api/cartoon/${id}`).send({ style });
      assert.equal(r.status, 200, style);
      assert.equal(r.body.project.meta.style, "family3d", style);
      assert.ok(Object.values(r.body.project.cast).every((m) => m.approved === true), style);
      assert.equal(r.body.project.shotListApproved, true, style);
    }
    const bad = await request(app).post("/api/cartoon/write").send({ theme: "kindness", style: "constructor" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, "BAD_STYLE");
  });

  test("a speaker with a reserved name is refused, never dropped", async () => {
    const r = await create(SCRIPT.replace('Pip: "I\'m stuck, Eli!"', 'constructor: "I\'m stuck, Eli!"'));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "BAD_NAME");
    assert.match(r.body.error, /constructor/);
  });

  test("a script edit is refused when a run starts during the verse lookup", async () => {
    const id = (await create()).body.project.id;
    let release;
    const gate = new Promise((r) => { release = r; });
    lookupImpl = async (ref) => { await gate; return { ok: true, canonical: ref, verses: [{ text: VERSE }] }; };
    const pending = request(app).patch(`/api/cartoon/${id}`).send({ markdown: SCRIPT.replace("Luke 15:4", "Luke 15:5") }).then((r) => r);
    await new Promise((r) => setTimeout(r, 30));
    let imageGate;
    const imageHeld = new Promise((r) => { imageGate = r; });
    imageImpl = async (args) => { await imageHeld; return defaultImage(args); };
    assert.equal((await request(app).post(`/api/cartoon/${id}/portraits`).send({ only: ["Eli"] })).status, 200);
    release();
    const r = await pending;
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "RUNNING");
    assert.equal(readProject(ctx().dataDir, id).meta.verse.reference, "Luke 15:4");
    imageGate();
    await until(() => isMakingPortraits(id));
  });

  test("over the benchmark needs confirmation", async () => {
    process.env.SCENE_SCRIPT_BENCHMARK_USD = "0.01";
    try {
      const id = await readyCartoon();
      const r = await request(app).post(`/api/cartoon/${id}/film`).send({});
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "OVER_BENCHMARK");
      assert.ok(r.body.estimate.totalUsd > 0.01);
      assert.equal(isFilming(id), false);
      const ok = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      await until(() => isFilming(id));
      const done = (await request(app).get(`/api/cartoon/${id}`)).body.project;
      assert.ok(done.shots.every((s) => s.clip?.status === "done"), JSON.stringify(done.shots.map((s) => s.clip)));
      assert.equal((await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true })).body.code, "NOTHING_TO_ORDER");
    } finally {
      delete process.env.SCENE_SCRIPT_BENCHMARK_USD;
    }
  });

  test("the film waits for the shot list and for AI video to be set up", async () => {
    const id = (await create()).body.project.id;
    const notApproved = await request(app).post(`/api/cartoon/${id}/film`).send({});
    assert.equal(notApproved.status, 409);
    assert.equal(notApproved.body.code, "SHOTS_NOT_APPROVED");
    delete process.env.BYTEPLUS_ARK_API_KEY;
    try {
      const off = await request(app).post(`/api/cartoon/${id}/film`).send({});
      assert.equal(off.status, 503);
      assert.equal(off.body.code, "NOT_CONFIGURED");
    } finally {
      process.env.BYTEPLUS_ARK_API_KEY = "test-key";
    }
    const est = await request(app).post(`/api/cartoon/${id}/film/estimate`).send({ only: ["sh2"] });
    assert.equal(est.status, 200);
    assert.equal(est.body.estimate.clips, 1);
    assert.equal(typeof est.body.month.capUsd, "number");
  });

  test("the shot list waits for every character to be approved", async () => {
    const id = (await create()).body.project.id;
    const early = await request(app).post(`/api/cartoon/${id}/shots/approve`);
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "CAST_NOT_READY");

    await makePortraits(id);
    const notMade = await request(app).post(`/api/cartoon/${id}/cast/Nobody/approve`);
    assert.equal(notMade.status, 404);
    await request(app).post(`/api/cartoon/${id}/cast/Eli/approve`);
    const half = await request(app).post(`/api/cartoon/${id}/shots/approve`);
    assert.equal(half.status, 409);
    assert.equal(half.body.code, "CAST_NOT_READY");
    assert.match(half.body.error, /Pip/);

    await request(app).post(`/api/cartoon/${id}/cast/Pip/approve`);
    const ok = await request(app).post(`/api/cartoon/${id}/shots/approve`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.project.shotListApproved, true);
    assert.deepEqual(ok.body.project.blockers, []);

    const noted = await request(app).patch(`/api/cartoon/${id}`).send({ shots: [{ id: "sh2", note: "close-up", firstFrame: "fresh" }] });
    assert.equal(noted.body.project.shotListApproved, false, "a changed shot needs approving again");
    assert.equal(noted.body.project.shots[1].note, "close-up");
    assert.equal(noted.body.project.shots[1].firstFrame, "fresh");

    await request(app).post(`/api/cartoon/${id}/shots/approve`);
    const titled = await request(app).patch(`/api/cartoon/${id}`).send({ title: "Found", captions: { enabled: false } });
    assert.equal(titled.body.project.shotListApproved, true, "a title change keeps the approval");
    assert.equal(titled.body.project.meta.title, "Found");
    assert.equal(titled.body.project.captions.enabled, false);
  });

  test("a second film order while one runs is 409 RUNNING", async () => {
    const id = await readyCartoon();
    let release;
    const gate = new Promise((r) => { release = r; });
    waitImpl = async (taskId) => { await gate; return { ok: true, videoUrl: `https://example.com/${taskId}.mp4`, tokens: 100000 }; };
    const first = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.project.running.film, true);
    const second = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, "RUNNING");
    const busy = await request(app).delete(`/api/cartoon/${id}`);
    assert.equal(busy.status, 409);
    assert.equal((await request(app).post(`/api/cartoon/${id}/film/cancel`)).status, 200);
    release();
    await until(() => isFilming(id));
  });

  test("a changed look clears the portrait approval", async () => {
    const id = await readyCartoon();
    const r = await request(app).patch(`/api/cartoon/${id}`).send({ cast: { Eli: { look: "a shepherd boy about ten, straight black hair" }, Pip: { voice: "a tiny squeak" } } });
    assert.equal(r.status, 200);
    const { Eli, Pip } = r.body.project.cast;
    assert.equal(Eli.approved, false);
    assert.equal(Eli.portrait, null);
    assert.equal(Eli.look, "a shepherd boy about ten, straight black hair");
    assert.equal(Pip.approved, true, "a voice change keeps the portrait");
    assert.equal(Pip.voice, "a tiny squeak");
    assert.equal(r.body.project.shotListApproved, false);
  });

  test("PATCH ignores bad values and changing the style clears every approval", async () => {
    const id = await readyCartoon();
    const r = await request(app).patch(`/api/cartoon/${id}`).send(JSON.parse(
      '{"cast":{"__proto__":{"look":"x"},"constructor":{"look":"y"},"Nobody":{"look":"z"}},"shots":[{"id":"sh2","firstFrame":"sideways"}],"bed":"../../etc/passwd","hacker":true}',
    ));
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.project.cast), ["Eli", "Pip"]);
    assert.equal(r.body.project.shots[1].firstFrame, "chain");
    assert.notEqual(r.body.project.music.bed, "../../etc/passwd");
    assert.equal(r.body.project.hacker, undefined);
    assert.equal(r.body.project.shotListApproved, true, "nothing that matters changed");

    const styled = await request(app).patch(`/api/cartoon/${id}`).send({ style: "Claymation" });
    assert.equal(styled.body.project.meta.style, "clay");
    assert.ok(Object.values(styled.body.project.cast).every((m) => m.approved === false && m.portrait?.url));
    assert.equal(styled.body.project.shotListApproved, false);
  });

  test("portraits run in the background, refuse a second run and never show file paths", async () => {
    const id = (await create()).body.project.id;
    let release;
    const gate = new Promise((r) => { release = r; });
    imageImpl = async (args) => { await gate; return defaultImage(args); };
    const r = await request(app).post(`/api/cartoon/${id}/portraits`).send({});
    assert.equal(r.status, 200);
    assert.equal(r.body.project.running.pictures, true);
    assert.equal(r.body.project.cast.Eli.portrait.status, "making");
    const again = await request(app).post(`/api/cartoon/${id}/portraits`).send({ only: ["Pip"] });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "RUNNING");
    release();
    await until(() => isMakingPortraits(id));
    const p = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    assert.equal(p.cast.Eli.portrait.status, "done");
    assert.match(p.cast.Eli.portrait.url, /^\/outputs\/cartoons\//);
    assert.equal(p.cast.Eli.portrait.file, undefined);
    assert.equal((await request(app).post(`/api/cartoon/${id}/portraits`).send({ only: ["Nobody"] })).status, 404);
  });

  test("a portrait stuck in making after a restart shows as interrupted", async () => {
    const id = (await create()).body.project.id;
    updateProject(ctx().dataDir, id, (p) => ({ ...p, cast: { ...p.cast, Eli: { ...p.cast.Eli, portrait: { file: null, url: null, status: "making", error: null } } } }));
    const p = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    assert.equal(p.cast.Eli.portrait.status, "error");
    assert.equal(p.cast.Eli.portrait.error, "Interrupted by a restart. Make it again.");
    await makePortraits(id, ["Eli"]);
    assert.equal(readProject(ctx().dataDir, id).cast.Eli.portrait.status, "done");
  });

  test("write maps the writer's results and times out", async () => {
    const ok = await request(app).post("/api/cartoon/write").send({ verse: "Luke 15:4", style: "storybook" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.markdown, /Verse: Luke 15:4/);

    const none = await request(app).post("/api/cartoon/write").send({});
    assert.equal(none.status, 400);
    assert.equal(none.body.code, "NO_VERSE");

    llmImpl = async () => "Not a script at all.";
    const bad = await request(app).post("/api/cartoon/write").send({ theme: "kindness" });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.code, "WRITE_FAILED");
    assert.equal(bad.body.reasons, undefined);

    llmImpl = () => new Promise(() => {});
    const slow = await request(app).post("/api/cartoon/write").send({ theme: "kindness" });
    assert.equal(slow.status, 504);
    assert.equal(slow.body.code, "TIMEOUT");
  });

  test("the character shelf maps its errors and pulls a character in approved", async () => {
    const id = (await create()).body.project.id;
    const unapproved = await request(app).post(`/api/cartoon/${id}/cast/Eli/shelve`);
    assert.equal(unapproved.status, 400);
    assert.equal(unapproved.body.code, "INVALID");
    assert.equal((await request(app).post(`/api/cartoon/${id}/cast/Nobody/shelve`)).status, 404);

    await makePortraits(id, ["Eli"]);
    await request(app).post(`/api/cartoon/${id}/cast/Eli/approve`);
    const shelved = await request(app).post(`/api/cartoon/${id}/cast/Eli/shelve`);
    assert.equal(shelved.status, 200, JSON.stringify(shelved.body));
    const characterId = shelved.body.character.id;
    assert.ok((await request(app).get("/api/cartoon/shelf")).body.characters.some((c) => c.id === characterId));

    const other = (await create()).body.project.id;
    const pulled = await request(app).post(`/api/cartoon/${other}/cast/from-shelf`).send({ characterId, asName: "Eli" });
    assert.equal(pulled.status, 200, JSON.stringify(pulled.body));
    assert.equal(pulled.body.project.cast.Eli.approved, true);
    assert.equal(pulled.body.project.cast.Eli.portrait.file, undefined);
    assert.equal((await request(app).post(`/api/cartoon/${other}/cast/from-shelf`).send({ characterId: "nope" })).status, 404);
    assert.equal((await request(app).post(`/api/cartoon/${other}/cast/from-shelf`).send({ characterId, asName: "__proto__" })).status, 400);

    assert.equal((await request(app).delete(`/api/cartoon/shelf/${characterId}`)).status, 200);
    assert.equal((await request(app).delete(`/api/cartoon/shelf/${characterId}`)).status, 404);
  });

  test("render waits for every clip, then renders and shows a URL, never a file name", async () => {
    const id = await readyCartoon();
    const early = await request(app).post(`/api/cartoon/${id}/render`);
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "NOT_READY");
    assert.match(early.body.error, /no clip yet/);
    assert.ok(Array.isArray(early.body.blockers));
    assert.ok((await request(app).get(`/api/cartoon/${id}`)).body.project.renderBlockers.length > 0);

    const film = await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    assert.equal(film.status, 200, JSON.stringify(film.body));
    await until(() => isFilming(id));

    const before = renders.length;
    const r = await request(app).post(`/api/cartoon/${id}/render`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.project.running.render, true);
    assert.equal(r.body.project.render.status, "queued");
    await until(() => isRenderingCartoon(id));
    assert.equal(renders.length, before + 1);
    assert.equal(renders.at(-1).compositionId, "Cartoon");

    const got = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    assert.equal(got.running.render, false);
    assert.equal(got.render.status, "done");
    assert.match(got.render.url, new RegExp(`^/outputs/cartoons/${id}/the-lost-lamb-${id.slice(0, 8)}\\.mp4$`));
    assert.equal(got.render.file, undefined);
    assert.equal(got.render.previous, undefined);
    assert.deepEqual(got.renderBlockers, []);
    assert.deepEqual(got.renderWarnings, []);
  });

  test("render is refused while one runs, and the film and edits wait for it", async () => {
    const id = await readyCartoon();
    await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    await until(() => isFilming(id));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    renderImpl = async (args) => {
      await gate;
      if (args.signal.aborted) throw new Error("cancelled");
      fs.writeFileSync(args.outputLocation, "raw");
    };
    assert.equal((await request(app).post(`/api/cartoon/${id}/render`)).status, 200);
    const again = await request(app).post(`/api/cartoon/${id}/render`);
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "RUNNING");
    const film = await request(app).post(`/api/cartoon/${id}/film`).send({ only: ["sh1"], confirmOverBenchmark: true });
    assert.equal(film.status, 409);
    assert.equal(film.body.code, "RENDERING");
    assert.equal((await request(app).patch(`/api/cartoon/${id}`).send({ captions: { enabled: false } })).body.code, "RENDERING");
    assert.equal((await request(app).delete(`/api/cartoon/${id}`)).body.code, "BUSY");

    const stop = await request(app).post(`/api/cartoon/${id}/render/cancel`);
    assert.deepEqual(stop.body, { ok: true, stopping: true });
    release();
    await until(() => isRenderingCartoon(id));
    assert.equal(readProject(ctx().dataDir, id).render.status, "cancelled");
    assert.deepEqual((await request(app).post(`/api/cartoon/${id}/render/cancel`)).body, { ok: true, stopping: false });
  });

  test("render is BUSY while the film runs, and a stale shot is only a warning", async () => {
    const id = await readyCartoon();
    let finish;
    const hold = new Promise((resolve) => { finish = resolve; });
    waitImpl = async (taskId) => { await hold; return { ok: true, videoUrl: `https://example.com/${taskId}.mp4`, tokens: 100000 }; };
    await request(app).post(`/api/cartoon/${id}/film`).send({ confirmOverBenchmark: true });
    const busy = await request(app).post(`/api/cartoon/${id}/render`);
    assert.equal(busy.status, 409);
    assert.equal(busy.body.code, "BUSY");
    finish();
    await until(() => isFilming(id));
    updateProject(ctx().dataDir, id, (p) => ({ ...p, shots: p.shots.map((s, i) => (i === 1 ? { ...s, clip: { ...s.clip, stale: true } } : s)) }));
    const got = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    assert.deepEqual(got.renderBlockers, []);
    assert.equal(got.renderWarnings.length, 1);
  });

  test("a render left running by a restart reads as stopped", async () => {
    const id = (await create()).body.project.id;
    updateProject(ctx().dataDir, id, (p) => ({ ...p, render: { status: "rendering", progress: 30 } }));
    const got = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    assert.equal(got.render.status, "error");
    assert.match(got.render.error, /restart/);
  });

  test("delete removes the cartoon and unknown ids are 404", async () => {
    const id = (await create()).body.project.id;
    assert.equal((await request(app).delete(`/api/cartoon/${id}`)).status, 200);
    assert.equal((await request(app).get(`/api/cartoon/${id}`)).status, 404);
    assert.equal((await request(app).get("/api/cartoon/not-a-uuid")).status, 404);
    assert.equal((await request(app).patch("/api/cartoon/..%2F..%2Fsecrets").send({ title: "x" })).status, 404);
  });

  test("delete waits while a paid clip can still be fetched free, on the shot or kept on remake", async () => {
    const paid = (startedAt) => ({ status: "error", taskId: "task-paid", chargedTaskId: "task-paid", startedAt, seconds: 4, prompt: "p", error: "not downloaded" });
    const withClip = (id, clip) => updateProject(ctx().dataDir, id, (p) => ({ ...p, shots: p.shots.map((s, i) => (i === 0 ? { ...s, clip } : s)) }));
    const sentence = "A clip you paid for hasn't finished downloading. Open Film and press Retry or Re-make to fetch it free, then delete.";

    const failed = (await create()).body.project.id;
    withClip(failed, paid(Date.now()));
    const refused = await request(app).delete(`/api/cartoon/${failed}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "PAID_NOT_SAVED");
    assert.equal(refused.body.error, sentence);
    assert.equal((await request(app).get(`/api/cartoon/${failed}`)).status, 200, "the cartoon is kept");

    const remade = (await create()).body.project.id;
    withClip(remade, { status: "done", url: "/outputs/c.mp4", remake: paid(Date.now()) });
    assert.equal((await request(app).delete(`/api/cartoon/${remade}`)).body.code, "PAID_NOT_SAVED");

    // Past BytePlus's re-fetch window the clip is gone either way, so nothing is saved by waiting.
    withClip(failed, paid(Date.now() - 24 * 60 * 60 * 1000));
    assert.equal((await request(app).delete(`/api/cartoon/${failed}`)).status, 200);
  });

  test("restart recovery walks the owner's and every user's cartoons", async () => {
    const base = path.join(root, "resume");
    const owner = { dataDir: base, outputDir: path.join(base, "outputs-owner") };
    const user = { dataDir: path.join(base, "users", "u1"), outputDir: path.join(base, "users", "u1", "outputs") };
    const queuedFirst = (c) => {
      const p = createProject(c.dataDir, cartoonFromScript(SCRIPT));
      return updateProject(c.dataDir, p.id, (x) => ({ ...x, shots: x.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "queued", taskId: null, seconds: 4, prompt: "p" } } : s)) }));
    };
    const a = queuedFirst(owner);
    const b = queuedFirst(user);
    const collected = updateProject(user.dataDir, b.id, (x) => ({
      ...x, shots: x.shots.map((s, i) => (i === 1 ? { ...s, clip: { status: "generating", taskId: "task-r", seconds: 4, prompt: "p" } } : s)),
    }));
    assert.ok(collected);
    const n = await resumeCartoonFilms({ ledgerDir: path.join(root, "ledger"), dataDir: base, outputDir: owner.outputDir, deps: { wait: (t) => waitImpl(t), download: async (_u, f) => fs.writeFileSync(f, "mp4"), ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "x"); return { ok: true }; }, probe: async () => 4, transcribe: async () => ({ ok: true, text: "" }), windows: async () => [] } });
    assert.equal(n, 1);
    assert.match(readProject(owner.dataDir, a.id).shots[0].clip.error, /restart/);
    assert.match(readProject(user.dataDir, b.id).shots[0].clip.error, /restart/);
    assert.equal(readProject(user.dataDir, b.id).shots[1].clip.status, "done");
  });

  test("restart recovery marks every context's cartoons running before it waits on any clip", async () => {
    const base = path.join(root, "resume-all");
    const owner = { dataDir: base, outputDir: path.join(base, "outputs-owner") };
    const user = { dataDir: path.join(base, "users", "u2"), outputDir: path.join(base, "users", "u2", "outputs") };
    const generating = (c, taskId) => {
      const p = createProject(c.dataDir, cartoonFromScript(SCRIPT));
      return updateProject(c.dataDir, p.id, (x) => ({ ...x, shots: x.shots.map((s, i) => (i === 0 ? { ...s, clip: { status: "generating", taskId, seconds: 4, prompt: "p" } } : s)) }));
    };
    const a = generating(owner, "task-a");
    const b = generating(user, "task-b");
    let release;
    const gate = new Promise((r) => { release = r; });
    const deps = {
      wait: async (t) => { await gate; return { ok: true, videoUrl: `https://example.com/${t}.mp4`, tokens: 100000 }; },
      download: async (_u, f) => fs.writeFileSync(f, "mp4"),
      ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "x"); return { ok: true }; },
      probe: async () => 4,
      transcribe: async () => ({ ok: true, text: "" }),
      windows: async () => [],
    };
    const resumed = resumeCartoonFilms({ ledgerDir: path.join(root, "ledger"), dataDir: base, outputDir: owner.outputDir, deps });
    assert.equal(isFilming(a.id), true, "the owner's cartoon is claimed");
    assert.equal(isFilming(b.id), true, "the user's cartoon is claimed before the owner's clip arrives");
    release();
    assert.equal(await resumed, 2);
    assert.equal(isFilming(b.id), false);
  });
});
