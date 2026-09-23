import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

import ambientRouter, {
  AMBIENT_STATUS, unclearedTracks,
  _setLookupImpl, _resetLookupImpl,
  _setSynthImpl, _resetSynthImpl,
  _setProbeImpl, _resetProbeImpl,
  _setImageGenImpl, _resetImageGenImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
  _setPlanImpl, _resetPlanImpl,
  _setRenderStageImpl, _resetRenderStageImpl,
  _setQuotaImpl, _resetQuotaImpl,
  clearCancelled, isCancelled,
} from "./ambient.js";
import { readProject, writeProject } from "../lib/ambient/projectStore.js";
import { registerTrack } from "../lib/musicLibraryStore.js";

let dataDir, outputDir, app;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amb-"));
  outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", plan: "premium", dataDir, outputDir }; next(); });
  app.use("/api/ambient", ambientRouter);

  // Quota is exercised in its own test; everywhere else it must not interfere.
  _setQuotaImpl(() => (_req, _res, next) => next());
  _setPlanImpl(async ({ count }) => ["Psalms 23:1-3", "John 14:27", "Isaiah 40:31", "Psalms 4:8"].slice(0, count));
  _setLookupImpl(async (reference) => ({ verses: [{ text: `verbatim words of ${reference}` }] }));
  _setSynthImpl(async () => ({ ok: true, file: path.join(outputDir, `voice-${Math.random().toString(16).slice(2)}.mp3`) }));
  _setProbeImpl(async () => 8);
  _setRenderStageImpl(async () => undefined);
});

afterEach(() => {
  _resetLookupImpl(); _resetSynthImpl(); _resetProbeImpl();
  _resetImageGenImpl(); _resetImageLibraryImpl(); _resetPlanImpl();
  _resetRenderStageImpl(); _resetQuotaImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function createSession(body = {}) {
  const res = await request(app)
    .post("/api/ambient")
    .send({ title: "Still Waters", theme: "rest and stillness", targetSec: 3600, ...body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.project;
}

/** Poll the stored project until `pred` holds — the long stages are detached. */
async function waitFor(id, pred, ms = 3000) {
  const start = Date.now();
  for (;;) {
    const p = readProject(dataDir, id);
    if (p && pred(p)) return p;
    if (Date.now() - start > ms) return p;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("POST /api/ambient", () => {
  test("creates a KJV landscape draft with the spec's defaults", async () => {
    const p = await createSession({ targetSec: undefined });
    assert.equal(p.status, AMBIENT_STATUS.DRAFT);
    assert.equal(p.translation, "kjv");
    assert.equal(p.aspect, "landscape");
    assert.equal(p.targetSec, 7200);
    assert.equal(p.bed.mode, "assemble");
    assert.equal(p.captions, "none");
    assert.equal(p.duck.threshold, 0.02, "sidechaincompress threshold is linear, not dB");
    assert.deepEqual(p.drops, []);
  });

  test("a new session already has the one movement it needs, so Look can generate", async () => {
    // Written as movements: [] the Look step read "0 movements" and disabled
    // Generate images until something else happened to re-derive them.
    const p = await createSession({ targetSec: 600 });
    assert.equal(p.movements.length, 1);
    assert.equal(p.movements[0].startMs, 0);
    assert.equal(p.movements[0].endMs, 600_000);
    assert.equal(readProject(dataDir, p.projectId).movements.length, 1, "persisted, not just returned");
  });
});

describe("GET /api/ambient", () => {
  test("lists summaries newest first", async () => {
    const a = await createSession({ title: "A" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createSession({ title: "B" });
    const res = await request(app).get("/api/ambient");
    assert.equal(res.status, 200);
    const ids = res.body.projects.map((x) => x.projectId);
    assert.deepEqual(ids.slice(0, 2), [b.projectId, a.projectId]);
  });
});

describe("GET /api/ambient/:id", () => {
  test("404s an unknown project rather than 500ing", async () => {
    const res = await request(app).get("/api/ambient/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
  });
});

describe("DELETE /api/ambient/:id", () => {
  test("removes the project", async () => {
    const p = await createSession();
    assert.equal((await request(app).delete(`/api/ambient/${p.projectId}`)).status, 200);
    assert.equal((await request(app).get(`/api/ambient/${p.projectId}`)).status, 404);
  });
});

describe("POST /api/ambient/:id/plan", () => {
  test("fills drops at the default fifteen-minute cadence and derives a movement each", async () => {
    const p = await createSession({ targetSec: 3600 });
    const res = await request(app).post(`/api/ambient/${p.projectId}/plan`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const drops = res.body.project.drops;
    assert.deepEqual(drops.map((d) => d.atMs), [900_000, 1_800_000, 2_700_000]);
    assert.ok(drops.every((d) => d.status === "pending" && !d.text), "text arrives at voice time, never from the planner");
    assert.equal(res.body.project.movements.length, drops.length);
    assert.equal(res.body.project.movements[0].startMs, 0);
    assert.equal(res.body.project.movements.at(-1).endMs, 3_600_000);
  });

  test("a ten-minute session gets a verse instead of 'too short'", async () => {
    const p = await createSession({ targetSec: 600 });
    const res = await request(app).post(`/api/ambient/${p.projectId}/plan`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.project.drops.map((d) => d.atMs), [300_000]);
  });

  test("an explicit count is spread across the whole runtime, not crammed into the first hour", async () => {
    const p = await createSession({ targetSec: 7200 });
    const res = await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 4 });
    const times = res.body.project.drops.map((d) => d.atMs);
    assert.equal(times.length, 4);
    assert.ok(times.at(-1) > 5_000_000, `last drop at ${times.at(-1)}ms — the tail is silent`);
    assert.ok(times.at(-1) <= 7200_000 - 60_000, "the last verse must clear the final minute");
  });

  test("the planner never supplies verse text", async () => {
    // A planner that returned prose would be an LLM writing scripture.
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    const stored = readProject(dataDir, p.projectId);
    assert.ok(stored.drops.every((d) => d.text === null));
  });
});

describe("PATCH /api/ambient/:id/drops", () => {
  test("re-times a drop and keeps its audio when the reference is unchanged", async () => {
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    const voiced = await waitFor(p.projectId, (x) => x.drops.every((d) => d.status === "done"));

    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: voiced.drops.map((d, i) => ({ id: d.id, atMs: i === 0 ? 300_000 : d.atMs, reference: d.reference })),
    });
    assert.equal(res.status, 200);
    const moved = res.body.project.drops.find((d) => d.atMs === 300_000);
    assert.equal(moved.status, "done");
    assert.ok(moved.audioPath, "a retime must not throw away the synthesis");
  });

  test("changing a reference discards the old audio", async () => {
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 1 });
    await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    const voiced = await waitFor(p.projectId, (x) => x.drops[0]?.status === "done");

    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: [{ id: voiced.drops[0].id, atMs: voiced.drops[0].atMs, reference: "Psalms 46:10" }],
    });
    // Keeping it would speak the OLD verse under the NEW citation.
    assert.equal(res.body.project.drops[0].status, "pending");
    assert.equal(res.body.project.drops[0].audioPath, null);
    assert.equal(res.body.project.drops[0].text, null);
  });

  test("a non-array body is rejected", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({ drops: "Psalms 23:1" });
    assert.equal(res.status, 400);
  });

  test("movements follow the new drop times", async () => {
    const p = await createSession({ targetSec: 1200 });
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: [{ atMs: 200_000, reference: "Psalms 23:1" }, { atMs: 800_000, reference: "John 14:27" }],
    });
    const m = res.body.project.movements;
    assert.equal(m.length, 2);
    assert.equal(m[0].startMs, 0);
    assert.equal(m[0].endMs, 500_000, "the cut sits midway between the two verses");
    assert.equal(m[1].endMs, 1_200_000);
  });
});

describe("POST /api/ambient/:id/voice", () => {
  test("speaks every drop with the verbatim looked-up text", async () => {
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    const res = await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.project.status, AMBIENT_STATUS.VOICING, "the long stage runs detached");

    const done = await waitFor(p.projectId, (x) => x.status === AMBIENT_STATUS.READY_TO_RENDER);
    assert.equal(done.drops.length, 2);
    for (const d of done.drops) {
      assert.equal(d.status, "done");
      assert.equal(d.text, `verbatim words of ${d.reference}`);
      assert.equal(d.durationMs, 8000);
    }
  });

  test("one bad reference marks that drop and the rest still speak", async () => {
    _setLookupImpl(async (reference) => {
      if (reference === "John 14:27") throw new Error("bible api 404");
      return { verses: [{ text: `verbatim words of ${reference}` }] };
    });
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 3 });
    await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});

    const out = await waitFor(p.projectId, (x) => x.drops.every((d) => d.status !== "pending"));
    const failed = out.drops.find((d) => d.reference === "John 14:27");
    assert.equal(failed.status, "error");
    assert.match(failed.error, /bible api 404/);
    assert.equal(out.drops.filter((d) => d.status === "done").length, 2);
    assert.equal(out.status, AMBIENT_STATUS.DRAFT, "a partial voicing is not ready to render");
  });

  test("voicing with no drops is a 400, not a silent no-op", async () => {
    const p = await createSession();
    const res = await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    assert.equal(res.status, 400);
  });
});

describe("PATCH /api/ambient/:id/bed", () => {
  test("records mode, volume and crossfade", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({
      mode: "assemble", trackRefs: ["library:prayer-piano"], volume: 0.7, crossfadeSec: 10,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.project.bed.trackRefs, ["library:prayer-piano"]);
    assert.equal(res.body.project.bed.volume, 0.7);
    assert.equal(res.body.project.bed.crossfadeSec, 10);
  });

  test("an unknown-licence upload is refused with 409 and the offending tracks", async () => {
    const file = path.join(outputDir, "mine.mp3");
    fs.writeFileSync(file, "x");
    const track = registerTrack(dataDir, { file, label: "My Mix", durationSec: 120 });
    assert.equal(track.licence, "unknown", "the store must default to unknown");

    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`)
      .send({ trackRefs: [`mylib:${track.id}`] });
    assert.equal(res.status, 409);
    assert.equal(res.body.ok, false);
    assert.deepEqual(res.body.uncleared.map((t) => t.label), ["My Mix"]);
    // Nothing was stored — the gate is a gate, not a warning.
    assert.deepEqual(readProject(dataDir, p.projectId).bed.trackRefs, []);
  });

  test("allowUncleared lets the operator proceed knowingly", async () => {
    const file = path.join(outputDir, "mine2.mp3");
    fs.writeFileSync(file, "x");
    const track = registerTrack(dataDir, { file, label: "My Mix 2", durationSec: 120 });

    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`)
      .send({ trackRefs: [`mylib:${track.id}`], allowUncleared: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.bed.allowUncleared, true);
  });

  test("a cleared upload passes the gate without the override", async () => {
    const file = path.join(outputDir, "cleared.mp3");
    fs.writeFileSync(file, "x");
    const track = registerTrack(dataDir, { file, label: "Cleared", licence: "CC0", durationSec: 120 });

    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`)
      .send({ trackRefs: [`mylib:${track.id}`] });
    assert.equal(res.status, 200);
  });

  test("bundled tracks never trip the gate", async () => {
    assert.deepEqual(unclearedTracks(dataDir, ["library:prayer-piano", "library:devotional"]), []);
  });

  test("changing the tracks invalidates a cached assembly", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ trackRefs: ["library:devotional"] });
    // Pretend a bed was built for that selection.
    const { writeProject } = await import("../lib/ambient/projectStore.js");
    const stored = readProject(dataDir, p.projectId);
    writeProject(dataDir, { ...stored, bed: { ...stored.bed, builtPath: "/tmp/bed.m4a", builtHash: "stale" } });

    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`)
      .send({ trackRefs: ["library:devotional", "library:hopeful"] });
    assert.equal(res.body.project.bed.builtPath, null, "a stale bed would render yesterday's music");
    assert.equal(res.body.project.bed.builtHash, null);
  });
});

describe("POST /api/ambient/:id/images", () => {
  test("generates one still per movement", async () => {
    _setImageLibraryImpl({ find: async () => [], register: async () => ({ id: "lib1" }), mark: () => {} });
    _setImageGenImpl(async ({ partNumber }) => ({ ok: true, path: `/img/${partNumber}.png`, publicUrl: `/u/${partNumber}.png` }));

    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    const res = await request(app).post(`/api/ambient/${p.projectId}/images`).send({});
    assert.equal(res.status, 200);

    const out = await waitFor(p.projectId, (x) => x.movements.every((m) => m.imageStatus !== "generating"));
    assert.deepEqual(out.movements.map((m) => m.imagePath), ["/img/1.png", "/img/2.png"]);
    assert.equal(out.status, AMBIENT_STATUS.READY_TO_RENDER);
  });

  test("a library hit spends no image quota", async () => {
    let generated = 0;
    _setImageGenImpl(async () => { generated += 1; return { ok: true, path: "/img/x.png" }; });
    _setImageLibraryImpl({
      find: async () => [{ entry: { id: "reused-1", path: "/lib/a.png", publicUrl: "/u/a.png" }, score: 0.9 }],
      mark: () => {}, register: async () => ({ id: "n" }),
    });

    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 1 });
    await request(app).post(`/api/ambient/${p.projectId}/images`).send({});

    const out = await waitFor(p.projectId, (x) => x.movements[0]?.imageStatus === "done");
    assert.equal(out.movements[0].imageSource, "library");
    assert.equal(generated, 0, "the daily free image cap is low enough that a reuse must not generate");
  });

  test("a failed image marks that movement and does not fail the session", async () => {
    _setImageLibraryImpl({ find: async () => [], register: async () => ({ id: "x" }), mark: () => {} });
    _setImageGenImpl(async ({ partNumber }) => (partNumber === 1
      ? { ok: false, error: "provider is down" }
      : { ok: true, path: `/img/${partNumber}.png` }));

    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    await request(app).post(`/api/ambient/${p.projectId}/images`).send({});

    const out = await waitFor(p.projectId, (x) => x.movements.every((m) => m.imageStatus !== "generating"));
    assert.equal(out.movements[0].imageStatus, "error");
    assert.match(out.movements[0].imageError, /provider is down/);
    assert.equal(out.movements[1].imageStatus, "done");
    assert.equal(out.status, AMBIENT_STATUS.GENERATING_IMAGES, "not ready while a picture is missing");
  });

  test("with no movements it is a 400", async () => {
    // A fresh session has its one movement now, so strip it to reach the guard.
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), movements: [] });
    assert.equal((await request(app).post(`/api/ambient/${p.projectId}/images`).send({})).status, 400);
  });
});

describe("PATCH /api/ambient/:id/captions", () => {
  test("merges against the stored project rather than replacing it", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captions: "static", captionPreset: "psalm" });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captions: "static" });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.captions, "static");
    assert.equal(res.body.project.captionPreset, "psalm", "a partial update must not clear what it omits");
  });

  test("kinetic is stored as static — an ambient drop has no per-word timing", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captions: "kinetic" });
    assert.equal(res.body.project.captions, "static");
  });

  test("an unrecognised mode leaves the stored one alone", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captions: "static" });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captionPreset: "psalm" });
    assert.equal(res.body.project.captions, "static", "omitting the mode must not turn captions off");
  });
});

describe("POST /api/ambient/:id/render", () => {
  async function readySession() {
    _setImageLibraryImpl({ find: async () => [], register: async () => ({ id: "x" }), mark: () => {} });
    _setImageGenImpl(async ({ partNumber }) => ({ ok: true, path: `/img/${partNumber}.png` }));
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ trackRefs: ["library:devotional"] });
    await request(app).post(`/api/ambient/${p.projectId}/images`).send({});
    await waitFor(p.projectId, (x) => x.movements.every((m) => m.imageStatus === "done"));
    return p;
  }

  test("starts a job and returns its id", async () => {
    const p = await readySession();
    const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.jobId);
  });

  test("refuses to render while a movement has no picture", async () => {
    _setImageLibraryImpl({ find: async () => [], register: async () => ({ id: "x" }), mark: () => {} });
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ trackRefs: ["library:devotional"] });
    const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /image/);
  });

  test("refuses to render with no music chosen", async () => {
    _setImageLibraryImpl({ find: async () => [], register: async () => ({ id: "x" }), mark: () => {} });
    _setImageGenImpl(async ({ partNumber }) => ({ ok: true, path: `/img/${partNumber}.png` }));
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 1 });
    await request(app).post(`/api/ambient/${p.projectId}/images`).send({});
    await waitFor(p.projectId, (x) => x.movements.every((m) => m.imageStatus === "done"));
    const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /music/);
  });

  test("a rejected detached render lands on the project instead of killing the server", async () => {
    // Before this was wired, an unhandled rejection from the fire-and-forget
    // took the WHOLE process down under Node's default policy.
    _setRenderStageImpl(async () => { throw new Error("spawn ENAMETOOLONG"); });
    const p = await readySession();
    assert.equal((await request(app).post(`/api/ambient/${p.projectId}/render`).send({})).status, 200);
    const out = await waitFor(p.projectId, (x) => x.status === AMBIENT_STATUS.ERROR);
    assert.match(out.error, /ENAMETOOLONG/);
    assert.equal(out.render.status, "error");
  });

  test("render is charged against the render bucket", async () => {
    const charged = [];
    _setQuotaImpl((bucket) => (_req, _res, next) => { charged.push(bucket); next(); });
    const p = await readySession();
    charged.length = 0;
    await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.deepEqual(charged, ["render"]);
  });

  test("polling the project costs no quota", async () => {
    const charged = [];
    _setQuotaImpl((bucket) => (_req, _res, next) => { charged.push(bucket); next(); });
    const p = await createSession();
    await request(app).get(`/api/ambient/${p.projectId}`);
    await request(app).get(`/api/ambient/${p.projectId}`);
    await request(app).get("/api/ambient");
    assert.deepEqual(charged, [], "a polling client must not burn the operator's allowance");
  });
});

describe("POST /api/ambient/:id/cancel", () => {
  test("flags the project so a detached stage stops", async () => {
    const p = await createSession();
    clearCancelled(p.projectId);
    const res = await request(app).post(`/api/ambient/${p.projectId}/cancel`).send({});
    assert.equal(res.status, 200);
    assert.equal(isCancelled(p.projectId), true);
    assert.equal(res.body.project.status, AMBIENT_STATUS.ERROR);
    assert.equal(res.body.project.error, "Cancelled.");
    clearCancelled(p.projectId);
  });

  test("404s an unknown project", async () => {
    assert.equal((await request(app).post("/api/ambient/nope/cancel").send({})).status, 404);
  });
});
