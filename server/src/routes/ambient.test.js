import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

import ambientRouter, {
  AMBIENT_STATUS, unclearedTracks, assembleBed, renderStage,
  _setLookupImpl, _resetLookupImpl,
  _setSynthImpl, _resetSynthImpl,
  _setProbeImpl, _resetProbeImpl,
  _setImageGenImpl, _resetImageGenImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
  _setPlanImpl, _resetPlanImpl,
  _setRenderStageImpl, _resetRenderStageImpl,
  _setQuotaImpl, _resetQuotaImpl,
  clearCancelled, isCancelled, markCancelled,
  _setLoudnessImpl, _resetLoudnessImpl, _setFfmpegSpawnImpl, _resetFfmpegSpawnImpl,
} from "./ambient.js";
import { EventEmitter } from "events";
import { readProject, writeProject } from "../lib/ambient/projectStore.js";
import { createJob, getJob as getRenderJob } from "../lib/renderJobs.js";
import { registerTrack } from "../lib/musicLibraryStore.js";
import { readLibrary, registerImage, _setEmbedImpl, _resetEmbedImpl } from "../lib/imageGen/imageLibrary.js";
import { _resetHeavyGate, runExclusive } from "../lib/heavyJobGate.js";
import { _setEncodersProbe, _resetEncodersProbe } from "../lib/ambient/encoders.js";

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
    // On and held for each verse's whole section: a music-first video with
    // ten seconds of scripture in ten minutes read as a bare image.
    assert.equal(p.captions, "static");
    assert.equal(p.captionSpan, "section");
    assert.equal(p.captionPosition, "lower");
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
    assert.equal(res.body.project.drops[0].verses, null, "the old verses must not be captioned either");
  });

  test("the verses are kept one by one, so captions can show a passage a verse at a time", async () => {
    _setLookupImpl(async () => ({ verses: [{ text: "First verse." }, { text: "  Second 	 verse. " }] }));
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 1 });
    await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    const voiced = await waitFor(p.projectId, (x) => x.drops[0]?.status === "done");
    assert.deepEqual(voiced.drops[0].verses, ["First verse.", "Second verse."]);
    assert.equal(voiced.drops[0].text, "First verse. Second verse.");
    // A retime keeps them, like it keeps the audio.
    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: [{ id: voiced.drops[0].id, atMs: 30_000, reference: voiced.drops[0].reference }],
    });
    assert.deepEqual(res.body.project.drops[0].verses, ["First verse.", "Second verse."]);
  });

  test("verses can't be sent by the client — like text, they are burned as scripture", async () => {
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 1 });
    const planned = readProject(dataDir, p.projectId);
    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: [{ id: planned.drops[0].id, atMs: planned.drops[0].atMs, reference: planned.drops[0].reference, verses: ["forged words"] }],
    });
    assert.ok(!JSON.stringify(res.body.project.drops).includes("forged words"));
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

describe("PATCH /api/ambient/:id/motion", () => {
  test("a new session is still, and gentle drift can be switched on and off", async () => {
    const p = await createSession();
    assert.equal(p.motion, "still");
    const on = await request(app).patch(`/api/ambient/${p.projectId}/motion`).send({ motion: "drift" });
    assert.equal(on.status, 200);
    assert.equal(on.body.project.motion, "drift");
    assert.equal(readProject(dataDir, p.projectId).motion, "drift");
    const off = await request(app).patch(`/api/ambient/${p.projectId}/motion`).send({ motion: "still" });
    assert.equal(off.body.project.motion, "still");
  });

  test("an unknown motion is refused and nothing changes", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/motion`).send({ motion: "spin" });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(readProject(dataDir, p.projectId).motion, "still");
  });

  test("it can't change under a render that is already encoding", async () => {
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: "rendering" });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/motion`).send({ motion: "drift" });
    assert.equal(res.status, 409);
    assert.equal(readProject(dataDir, p.projectId).motion, "still");
  });

  test("an unknown session is a 404", async () => {
    const res = await request(app).patch("/api/ambient/nope/motion").send({ motion: "drift" });
    assert.equal(res.status, 404);
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

  test("accepts shuffle or fixed order, ignores anything else", async () => {
    const p = await createSession();
    const ok = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "fixed" });
    assert.equal(ok.body.project.bed.order, "fixed");
    const bad = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "random" });
    assert.equal(bad.body.project.bed.order, "fixed");
  });

  test("switching to fixed order dedupes an inherited shuffle play order", async () => {
    // Shuffle expands trackRefs into a repeated play order (up to 400 refs);
    // "Keep my order" must not adopt that expanded list as the operator's own.
    const p = await createSession();
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, order: "shuffle", trackRefs: ["a", "b", "a", "c", "b"] },
    });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "fixed" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.project.bed.trackRefs, ["a", "b", "c"]);
  });

  test("switching to fixed order with explicit trackRefs keeps them as sent, undeduped", async () => {
    const p = await createSession();
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, order: "shuffle", trackRefs: ["a", "b", "a", "c", "b"] },
    });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`)
      .send({ order: "fixed", trackRefs: ["library:devotional", "library:devotional"] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.project.bed.trackRefs, ["library:devotional", "library:devotional"]);
  });

  test("patching an already-fixed bed's other fields does not dedupe trackRefs", async () => {
    const p = await createSession();
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, order: "fixed", trackRefs: ["a", "b", "a"] },
    });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "fixed", volume: 0.5 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.project.bed.trackRefs, ["a", "b", "a"], "already fixed — nothing to dedupe from");
  });

  test("changing the order drops the cached bed", async () => {
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), bed: { ...p.bed, builtPath: "x", builtHash: "old" } });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ order: "fixed" });
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

  test("only pictures made in the bright style are reused, and new ones join that pool", async () => {
    const asked = [];
    const registered = [];
    _setImageLibraryImpl({
      find: async (q) => { asked.push(q); return []; },
      register: async (e) => { registered.push(e); return { id: "n1" }; },
      mark: () => {},
    });
    _setImageGenImpl(async ({ rawPrompt }) => ({ ok: true, path: `/img/${rawPrompt.length}.png` }));
    const p = await createSession();
    // A session saved before the change still carries the old dark prompt.
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      movements: readProject(dataDir, p.projectId).movements.map((m) => ({ ...m, imagePrompt: "storm at night, cinematic" })),
    });
    await request(app).post(`/api/ambient/${p.projectId}/images`).send({});
    await waitFor(p.projectId, (x) => x.movements.every((m) => m.imageStatus === "done"));
    assert.ok(asked.length > 0);
    assert.ok(asked.every((q) => q.style === "ambient-bright-v1"), "old dark pictures (style '') must not be reused");
    assert.ok(registered.every((e) => e.style === "ambient-bright-v1"));
    assert.ok(asked.every((q) => /bright/i.test(q.prompt)), "an old session's prompt is refreshed when regenerated");
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
    // Not ready while a picture is missing, and not "generating" either: that
    // status is transient and busy, so the page polled forever and refused
    // your own upload for the failed movement.
    assert.equal(out.status, AMBIENT_STATUS.DRAFT);
  });

  test("with no movements it is a 400", async () => {
    // A fresh session has its one movement now, so strip it to reach the guard.
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), movements: [] });
    assert.equal((await request(app).post(`/api/ambient/${p.projectId}/images`).send({})).status, 400);
  });
});

// A real 1x1 PNG, so the byte-signature check sees a genuine image.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Stand-in for what POST /api/media/upload-background leaves on disk. */
function fakeUpload(bytes = PNG_1X1, name = `bg-image-${UUID}.png`, dir = outputDir) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file.replace(/\\/g, "/");
}

describe("PUT /api/ambient/:id/movements/:movementId/image", () => {
  beforeEach(() => { _setEmbedImpl(async () => null); });
  afterEach(() => { _resetEmbedImpl(); });

  const put = (p, body, movementId = p.movements[0].id) =>
    request(app).put(`/api/ambient/${p.projectId}/movements/${movementId}/image`).send(body);

  test("attaches your own uploaded photo to a movement", async () => {
    const p = await createSession({ targetSec: 600 });
    const res = await put(p, { uploadPath: fakeUpload() });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const m = res.body.project.movements[0];
    assert.equal(m.imageStatus, "done");
    assert.equal(m.imageSource, "upload");
    assert.match(m.imageUrl, /^\/outputs\/imagelib-[0-9a-f]{64}\.png$/, "served from the flat pool, like generated stills");
    assert.ok(fs.existsSync(m.imagePath));
    assert.equal(path.dirname(m.imagePath), outputDir);
  });

  test("an upload joins your library but is never auto-reused for another prompt", async () => {
    // It has no prompt, so no embedding and no categories: it can be CHOSEN
    // from the library, never silently substituted into someone's scene.
    const p = await createSession({ targetSec: 600 });
    await put(p, { uploadPath: fakeUpload() });
    const [entry] = readLibrary(dataDir).items;
    assert.equal(entry.provider, "upload");
    assert.equal(entry.prompt, "");
    assert.ok(!entry.embedding, "no embedding to match against");
    assert.deepEqual(entry.categories, []);
  });

  test("refuses a file outside your own outputs", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "amb-other-"));
    try {
      const p = await createSession({ targetSec: 600 });
      const res = await put(p, { uploadPath: fakeUpload(PNG_1X1, `bg-image-${UUID}.png`, elsewhere) });
      assert.equal(res.status, 400);
      assert.equal(readProject(dataDir, p.projectId).movements[0].imagePath ?? null, null);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("refuses a traversal that only starts inside your outputs", async () => {
    // The file sits one level ABOVE outputs; `..` must not reach it.
    const p = await createSession({ targetSec: 600 });
    fakeUpload(PNG_1X1, `bg-image-${UUID}.png`, dataDir);
    const res = await put(p, { uploadPath: `${outputDir}/../bg-image-${UUID}.png` });
    assert.equal(res.status, 400);
  });

  test("only the file name is taken from the client, never the folder", async () => {
    // A UNC share or a foreign folder in the path is never opened: the name is
    // looked up in YOUR outputs, so the most a client can name is its own file.
    const p = await createSession({ targetSec: 600 });
    fakeUpload();
    const res = await put(p, { uploadPath: String.raw`\\attacker\share\bg-image-${UUID}.png` });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(path.dirname(res.body.project.movements[0].imagePath), outputDir);
  });

  test("a photo over the size cap is refused before it is read into memory", async () => {
    const p = await createSession({ targetSec: 600 });
    const file = fakeUpload();
    fs.truncateSync(file, 26 * 1024 * 1024); // sparse: a valid PNG header, then 26 MB
    const res = await put(p, { uploadPath: file });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /25 MB/);
  });

  test("an image run that starts mid-attach is not overwritten underneath", async () => {
    // The busy check before the await is not enough: POST /images can start
    // while the upload is being copied, and its own movement list would win.
    const p = await createSession({ targetSec: 600 });
    _setImageLibraryImpl({
      register: async (args) => {
        writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: AMBIENT_STATUS.GENERATING_IMAGES });
        return registerImage(args);
      },
    });
    const res = await put(p, { uploadPath: fakeUpload() });
    assert.equal(res.status, 409);
  });

  test("refuses a file the upload route did not produce", async () => {
    // Anything else in outputs (a render, another project's still) is not
    // yours to repoint by name.
    const p = await createSession({ targetSec: 600 });
    const res = await put(p, { uploadPath: fakeUpload(PNG_1X1, "video.png") });
    assert.equal(res.status, 400);
  });

  test("refuses a photo ffmpeg cannot decode, whatever it is named", async () => {
    // An iPhone HEIC arrives saved as .jpg by the upload route. Caught here it
    // is a sentence; caught by ffmpeg it is a render that dies an hour in.
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
    const p = await createSession({ targetSec: 600 });
    const res = await put(p, { uploadPath: fakeUpload(heic, `bg-image-${UUID}.jpg`) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /JPG or PNG/);
  });

  test("attaches an image already in your library, by id", async () => {
    const p = await createSession({ targetSec: 600 });
    await put(p, { uploadPath: fakeUpload() });
    const [entry] = readLibrary(dataDir).items;

    const q = await createSession({ targetSec: 600, title: "Second" });
    const res = await put(q, { libraryId: entry.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const m = res.body.project.movements[0];
    assert.equal(m.imageSource, "library");
    assert.equal(m.imageLibraryId, entry.id);
    assert.equal(m.imagePath, entry.path);
  });

  test("an unknown library id is a 400, not a movement pointing at nothing", async () => {
    const p = await createSession({ targetSec: 600 });
    assert.equal((await put(p, { libraryId: "img_nope" })).status, 400);
  });

  test("an unknown movement is a 404", async () => {
    const p = await createSession({ targetSec: 600 });
    assert.equal((await put(p, { uploadPath: fakeUpload() }, "no-such-movement")).status, 404);
  });

  test("waits while images are generating or a render is running", async () => {
    // imagesStage rewrites the movement list from its own copy as it goes; a
    // change made underneath it would be silently overwritten.
    for (const status of [AMBIENT_STATUS.GENERATING_IMAGES, AMBIENT_STATUS.RENDERING, AMBIENT_STATUS.ASSEMBLING]) {
      const p = await createSession({ targetSec: 600 });
      writeProject(dataDir, { ...readProject(dataDir, p.projectId), status });
      assert.equal((await put(p, { uploadPath: fakeUpload() })).status, 409, status);
    }
  });
});

describe("GET /api/ambient/:id/library-images", () => {
  beforeEach(() => { _setEmbedImpl(async () => null); });
  afterEach(() => { _resetEmbedImpl(); });

  test("lists your images newest first, with URLs and never server paths", async () => {
    const p = await createSession({ targetSec: 600 });
    await request(app).put(`/api/ambient/${p.projectId}/movements/${p.movements[0].id}/image`)
      .send({ uploadPath: fakeUpload() });

    const res = await request(app).get(`/api/ambient/${p.projectId}/library-images`);
    assert.equal(res.status, 200);
    assert.equal(res.body.images.length, 1);
    const [img] = res.body.images;
    assert.match(img.url, /^\/outputs\/imagelib-/);
    assert.equal(img.source, "upload");
    assert.equal(img.path, undefined);
    assert.ok(!JSON.stringify(res.body).includes(path.basename(dataDir)), "no filesystem paths in the response");
  });
});

describe("POST /api/ambient/:id/images with a movementId", () => {
  test("regenerates just that one picture and leaves the others alone", async () => {
    const calls = [];
    _setImageLibraryImpl({ find: async () => [], register: async () => null, mark: () => {} });
    _setImageGenImpl(async ({ partNumber }) => { calls.push(partNumber); return { ok: true, path: `/img/new-${partNumber}.png` }; });

    const p = await createSession({ targetSec: 3600 });
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    const planned = readProject(dataDir, p.projectId);
    writeProject(dataDir, {
      ...planned,
      movements: planned.movements.map((m, i) => ({ ...m, imageStatus: "done", imagePath: `/img/old-${i + 1}.png` })),
    });

    const target = planned.movements[1].id;
    const res = await request(app).post(`/api/ambient/${p.projectId}/images`).send({ movementId: target });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const out = await waitFor(p.projectId, (x) => x.movements[1].imagePath === "/img/new-2.png");
    assert.deepEqual(calls, [2]);
    assert.equal(out.movements[0].imagePath, "/img/old-1.png", "the one you kept stays kept");
  });

  test("an unknown movementId is a 404", async () => {
    const p = await createSession({ targetSec: 600 });
    const res = await request(app).post(`/api/ambient/${p.projectId}/images`).send({ movementId: "nope" });
    assert.equal(res.status, 404);
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

  test("span and position are stored, and a partial update keeps the other", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captionSpan: "spoken" });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captionPosition: "centre" });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.captionSpan, "spoken");
    assert.equal(res.body.project.captionPosition, "centre");
  });

  test("an unknown span or position leaves the stored value alone", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/captions`)
      .send({ captionSpan: "forever", captionPosition: "sideways" });
    assert.equal(res.body.project.captionSpan, "section");
    assert.equal(res.body.project.captionPosition, "lower");
  });

  test("an unrecognised mode leaves the stored one alone", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captions: "static" });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/captions`).send({ captionPreset: "psalm" });
    assert.equal(res.body.project.captions, "static", "omitting the mode must not turn captions off");
  });
});

describe("POST /api/ambient/:id/render", () => {
  beforeEach(() => _resetHeavyGate());

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

  test("a second render cannot start while one is assembling or encoding", async () => {
    // During bed assembly the Render step used to show its button again; a
    // second click started a second render writing the same video.mp4.
    const p = await readySession();
    for (const status of [AMBIENT_STATUS.ASSEMBLING, AMBIENT_STATUS.RENDERING]) {
      writeProject(dataDir, { ...readProject(dataDir, p.projectId), status });
      const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
      assert.equal(res.status, 409, status);
      assert.match(res.body.error, /already rendering/);
    }
  });

  test("a render queued behind another heavy job is visible and cannot be double-started", async () => {
    // Before this fix, onQueued only touched render.phase; project.status stayed
    // whatever it was, so notAlreadyRendering (and the client's own inFlight
    // check) never saw the wait and a second click started a second render.
    const p = await readySession();
    let releaseHeavy;
    const heavyDone = new Promise((resolve) => { releaseHeavy = resolve; });
    runExclusive(() => heavyDone);

    const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const queued = await waitFor(p.projectId, (x) => x.render.phase === "waiting for another job to finish");
    assert.equal(queued.status, AMBIENT_STATUS.ASSEMBLING);

    const second = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already rendering/);

    releaseHeavy();
  });

  test("cancelling a queued render is not undone by a second render click", async () => {
    // clearCancelled() ran at the top of the route handler; a second click
    // that reached the handler while the first was still queued would wipe
    // out the cancel flag the first request's caller just set. Now that the
    // queued state is visible via status, the second click is a 409 and
    // never reaches clearCancelled.
    const p = await readySession();
    let releaseHeavy;
    const heavyDone = new Promise((resolve) => { releaseHeavy = resolve; });
    runExclusive(() => heavyDone);

    const first = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(first.status, 200);
    await waitFor(p.projectId, (x) => x.status === AMBIENT_STATUS.ASSEMBLING);

    markCancelled(p.projectId);
    const second = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(second.status, 409);
    assert.equal(isCancelled(p.projectId), true, "the second, refused request must not clear the cancel flag");

    releaseHeavy();
    clearCancelled(p.projectId);
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
    const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(res.status, 200);
    const out = await waitFor(p.projectId, (x) => x.status === AMBIENT_STATUS.ERROR);
    assert.match(out.error, /ENAMETOOLONG/);
    assert.equal(out.render.status, "error");
    // The job registry too, or the Jobs page shows it running forever. The
    // call sits in a try/catch, so a missing import here failed silently.
    assert.equal(getRenderJob(res.body.jobId)?.status, "error");
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

  test("passes the chosen encoder to the render, and only cpu or amf", async () => {
    const seen = [];
    _setRenderStageImpl(async (_ctx, _id, _job, opts) => { seen.push(opts?.encoder); });
    const p = await readySession();
    await request(app).post(`/api/ambient/${p.projectId}/render`).send({ encoder: "amf" });
    await waitFor(p.projectId, () => seen.length === 1);
    assert.deepEqual(seen, ["amf"]);
  });

  test("an unknown encoder value falls back to cpu", async () => {
    const seen = [];
    _setRenderStageImpl(async (_ctx, _id, _job, opts) => { seen.push(opts?.encoder); });
    const p = await readySession();
    await request(app).post(`/api/ambient/${p.projectId}/render`).send({ encoder: "nvenc" });
    await waitFor(p.projectId, () => seen.length === 1);
    assert.deepEqual(seen, ["cpu"]);
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

// What ffmpeg reads is decided by the server. Every path below reaches
// `-i <path>` at render time, so a client-chosen value is a server-side
// request (http:, hls:) or another tenant's file mixed into your video.
describe("security: the client never chooses what ffmpeg reads", () => {
  test("a new drop cannot arrive pre-voiced with its own audio, text or status", async () => {
    const p = await createSession({ targetSec: 600 });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: [{
        reference: "John 3:16", atMs: 60_000, status: "done",
        audioPath: "http://169.254.169.254/latest/meta-data/",
        text: "words that are not scripture", durationMs: 5000, error: "x",
      }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [d] = readProject(dataDir, p.projectId).drops;
    assert.equal(d.audioPath, null);
    assert.equal(d.status, "pending", "voicing must still run, and fetch the words verbatim");
    assert.equal(d.text, null, "scripture text only ever comes from the Bible lookup");
    assert.equal(d.durationMs, null);
  });

  test("an existing drop keeps the server's audio when the client sends its own", async () => {
    const p = await createSession({ targetSec: 600 });
    const voiced = {
      id: "d1", reference: "John 3:16", atMs: 60_000, translation: "kjv", status: "done",
      text: "For God so loved the world", audioPath: path.join(outputDir, "voice-real.mp3"), durationMs: 4000,
    };
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), drops: [voiced] });

    const res = await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({
      drops: [{ id: "d1", reference: "John 3:16", atMs: 90_000, audioPath: "/etc/passwd", text: "forged", status: "done" }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [d] = readProject(dataDir, p.projectId).drops;
    assert.equal(d.audioPath, voiced.audioPath);
    assert.equal(d.text, voiced.text);
    assert.equal(d.atMs, 90_000, "the retime itself still applies");
  });

  test("a drop edit that omits the time keeps the time it had", async () => {
    const p = await createSession({ targetSec: 600 });
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), drops: [
      { id: "d1", reference: "John 3:16", atMs: 60_000, translation: "kjv", status: "pending", text: null, audioPath: null },
    ] });
    await request(app).patch(`/api/ambient/${p.projectId}/drops`).send({ drops: [{ id: "d1", reference: "John 3:16" }] });
    assert.equal(readProject(dataDir, p.projectId).drops[0].atMs, 60_000);
  });

  test("a bed file outside your own outputs is refused", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "amb-victim-"));
    try {
      const victim = path.join(elsewhere, "their-song.mp3");
      fs.writeFileSync(victim, "x");
      const p = await createSession({ targetSec: 600 });
      const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ mode: "file", filePath: victim });
      assert.equal(res.status, 400);
      assert.equal(readProject(dataDir, p.projectId).bed.filePath, null);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("a bed track that is a bare path outside your outputs is refused", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "amb-victim-"));
    try {
      const victim = path.join(elsewhere, "their-song.mp3");
      fs.writeFileSync(victim, "x");
      const p = await createSession({ targetSec: 600 });
      const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ trackRefs: [victim] });
      assert.equal(res.status, 400);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("your own uploaded mix is still accepted", async () => {
    const mine = path.join(outputDir, "user-audio-mine.mp3");
    fs.writeFileSync(mine, "x");
    const p = await createSession({ targetSec: 600 });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/bed`).send({ mode: "file", filePath: mine });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.bed.filePath, mine);
  });

  test("file-mode render clears a stale tracklist from an earlier assemble build", async () => {
    // A project that once used the shuffle/order builder has a builtOrder;
    // switching to a fixed audio file must not leave chapters/credits
    // describing tracks that are not actually in this video.
    const mine = path.join(outputDir, "user-audio-mine.mp3");
    fs.writeFileSync(mine, "x");
    const p = await createSession({ targetSec: 600 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: {
        ...p.bed, mode: "file", filePath: mine,
        builtOrder: [{ ref: "library:prayer-piano", startSec: 0, label: "Prayer Piano", credit: "" }],
      },
    });
    const { project } = await assembleBed({ dataDir, outputDir }, stored);
    assert.equal(project.bed.builtOrder, null);
  });

  test("a bed path stored before this check is still refused at render time", async () => {
    // Defence in depth: a project saved before the route checked must not
    // reach ffmpeg either.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "amb-victim-"));
    try {
      const victim = path.join(elsewhere, "their-song.mp3");
      fs.writeFileSync(victim, "x");
      const p = await createSession({ targetSec: 600 });
      const stored = writeProject(dataDir, {
        ...readProject(dataDir, p.projectId),
        bed: { ...p.bed, mode: "file", filePath: victim },
      });
      await assert.rejects(assembleBed({ dataDir, outputDir }, stored), /bed file is missing/);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("the music bed is levelled", () => {
  afterEach(() => { _resetLoudnessImpl(); _resetFfmpegSpawnImpl(); });

  /** A stand-in ffmpeg that succeeds at once and keeps its arguments. */
  function fakeFfmpeg(calls) {
    return (args) => {
      calls.push(args);
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    };
  }

  test("every track is measured once and set to one loudness before the crossfades", async () => {
    const measured = [];
    _setLoudnessImpl(async (file) => { measured.push(file); return { inputI: -24, inputTp: -10 }; });
    const calls = [];
    _setFfmpegSpawnImpl(fakeFfmpeg(calls));
    const p = await createSession({ targetSec: 60 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano", "library:peaceful-worship"], crossfadeSec: 2 },
    });
    await assembleBed({ dataDir, outputDir }, stored);
    assert.equal(calls.length, 1);
    const args = calls[0];
    const script = fs.readFileSync(args[args.indexOf("-filter_complex_script") + 1], "utf8");
    // -24 LUFS to the bed's -18: +6 dB, well inside its peak headroom.
    assert.match(script, /volume=6\.00dB/);
    assert.equal(new Set(measured).size, measured.length, "a looped track is measured once, not per repeat");
  });

  test("a bed built from unmeasured tracks is not kept as the levelled one", async () => {
    // Otherwise a one-off measuring failure is stored under the levelled key
    // and that uneven bed is reused for good.
    _setLoudnessImpl(async () => null);
    const calls = [];
    _setFfmpegSpawnImpl(fakeFfmpeg(calls));
    const p = await createSession({ targetSec: 60 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano"], crossfadeSec: 2 },
    });
    const { project } = await assembleBed({ dataDir, outputDir }, stored);
    assert.equal(project.bed.builtHash, null);
  });

  test("an unchanged bed is reused on the next render instead of rebuilt", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    const calls = [];
    _setFfmpegSpawnImpl((args) => {
      // The fake writes the file ffmpeg would have, so the cache check sees it.
      fs.writeFileSync(args[args.length - 1], "bed");
      return fakeFfmpeg(calls)(args);
    });
    const p = await createSession({ targetSec: 60 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano", "library:peaceful-worship"], crossfadeSec: 2 },
    });
    const first = await assembleBed({ dataDir, outputDir }, stored);
    await assembleBed({ dataDir, outputDir }, first.project);
    assert.equal(calls.length, 1, "the second render found the first bed");
  });

  test("a cancel during levelling stops before ffmpeg builds the bed", async () => {
    const p = await createSession({ targetSec: 60 });
    _setLoudnessImpl(async () => { markCancelled(p.projectId); return { inputI: -18, inputTp: -6 }; });
    const calls = [];
    _setFfmpegSpawnImpl(fakeFfmpeg(calls));
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano", "library:peaceful-worship"], crossfadeSec: 2 },
    });
    await assert.rejects(assembleBed({ dataDir, outputDir }, stored), /Cancelled/);
    assert.equal(calls.length, 0);
    clearCancelled(p.projectId);
  });

  test("a track that can't be measured plays at its own level, and the bed still builds", async () => {
    _setLoudnessImpl(async () => null);
    const calls = [];
    _setFfmpegSpawnImpl(fakeFfmpeg(calls));
    const p = await createSession({ targetSec: 60 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano"], crossfadeSec: 2 },
    });
    await assembleBed({ dataDir, outputDir }, stored);
    const args = calls[0];
    const script = fs.readFileSync(args[args.indexOf("-filter_complex_script") + 1], "utf8");
    assert.ok(!/volume=/.test(script));
  });

  test("keep-my-order plays the list as given and leaves the operator's list alone", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    const calls = [];
    _setFfmpegSpawnImpl(fakeFfmpeg(calls));
    const p = await createSession({ targetSec: 20 });
    const refs = ["library:prayer-piano", "library:peaceful-worship"];
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", order: "fixed", trackRefs: refs, crossfadeSec: 2 },
    });
    const { project } = await assembleBed({ dataDir, outputDir }, stored);
    // probe says 8 s per track: 8 + 6 + 6 >= 20 → three tracks, a b a.
    assert.deepEqual(project.bed.builtOrder.map((t) => t.ref), [refs[0], refs[1], refs[0]]);
    assert.deepEqual(project.bed.trackRefs, refs);
  });

  test("the tracklist records start times, labels and credits", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    _setFfmpegSpawnImpl(fakeFfmpeg([]));
    const p = await createSession({ targetSec: 20 });
    const stored = writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...p.bed, mode: "assemble", order: "fixed", trackRefs: ["library:prayer-piano", "library:peaceful-worship"], crossfadeSec: 2 },
    });
    const { project } = await assembleBed({ dataDir, outputDir }, stored);
    assert.deepEqual(project.bed.builtOrder.map((t) => t.startSec), [0, 6, 12]);
    assert.equal(project.bed.builtOrder[0].credit, "Music from Pixabay");
    assert.ok(project.bed.builtOrder[0].label.length > 0);
  });
});

describe("PATCH /api/ambient/:id/words — music only", () => {
  test("new sessions carry verses", async () => {
    const p = await createSession();
    assert.equal(p.words, "verses");
  });

  test("music only gives one picture for the whole length, even with no verses planned", async () => {
    const p = await createSession({ targetSec: 3600 });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.words, "none");
    assert.equal(res.body.project.movements.length, 1);
    assert.equal(res.body.project.movements[0].startMs, 0);
    assert.equal(res.body.project.movements[0].endMs, 3_600_000);
  });

  test("music only keeps the verses on disk so switching back restores them", async () => {
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 3 });
    await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    const back = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "verses" });
    assert.equal(back.body.project.drops.length, 3);
    assert.equal(back.body.project.movements.length, 3);
  });

  test("rejects anything but verses or none", async () => {
    const p = await createSession();
    const res = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "sermon" });
    assert.equal(res.status, 400);
  });

  test("refuses while the session is rendering", async () => {
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: AMBIENT_STATUS.RENDERING });
    const res = await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    assert.equal(res.status, 409);
  });

  test("voicing is refused for a music-only session", async () => {
    const p = await createSession();
    await request(app).patch(`/api/ambient/${p.projectId}/words`).send({ words: "none" });
    const res = await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /music only/);
  });
});

describe("renderStage — music only", () => {
  afterEach(() => { _resetLoudnessImpl(); _resetFfmpegSpawnImpl(); });

  test("a music-only render has no voice input and no burned captions", async () => {
    _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
    const calls = [];
    _setFfmpegSpawnImpl((args) => {
      calls.push(args);
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit("close", 0));
      return proc;
    });
    const p = await createSession({ targetSec: 60 });
    const img = path.join(outputDir, "pic.jpg");
    const voice = path.join(outputDir, "voice.mp3");
    fs.writeFileSync(img, "jpg");
    fs.writeFileSync(voice, "mp3");
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      words: "none",
      // A verse voiced before the switch must not reach the render.
      drops: [{ id: "d1", atMs: 1000, reference: "John 14:27", status: "done", audioPath: voice, durationMs: 4000 }],
      movements: [{ id: "m1", startMs: 0, endMs: 60_000, imageStatus: "done", imagePath: img }],
      bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano"], crossfadeSec: 2 },
    });
    const job = createJob("u1", { durationSec: 60 });
    await renderStage({ dataDir, outputDir }, p.projectId, job.jobId);
    const render = calls[calls.length - 1];
    assert.ok(!render.includes(voice), "the voice file is not an input");
    const script = fs.readFileSync(render[render.indexOf("-filter_complex_script") + 1], "utf8");
    assert.doesNotMatch(script, /drawtext/);
    assert.doesNotMatch(script, /sidechaincompress/);
  });
});

describe("renderStage — AMF encode falls back to CPU", () => {
  afterEach(() => { _resetLoudnessImpl(); _resetFfmpegSpawnImpl(); _resetEncodersProbe(); });

  function readyMusicOnlyProject(targetSec = 60) {
    return (async () => {
      _setLoudnessImpl(async () => ({ inputI: -18, inputTp: -6 }));
      const p = await createSession({ targetSec });
      const img = path.join(outputDir, "pic.jpg");
      fs.writeFileSync(img, "jpg");
      writeProject(dataDir, {
        ...readProject(dataDir, p.projectId),
        words: "none",
        movements: [{ id: "m1", startMs: 0, endMs: targetSec * 1000, imageStatus: "done", imagePath: img }],
        bed: { ...p.bed, mode: "assemble", trackRefs: ["library:prayer-piano"], crossfadeSec: 2 },
      });
      return p;
    })();
  }

  test("an AMF failure retries once with CPU args, clears the stale percent, and records encoderUsed", async () => {
    _setEncodersProbe(() => " V....D h264_amf  AMD AMF H.264 Encoder");
    const videoCalls = [];
    let videoAttempt = 0;
    _setFfmpegSpawnImpl((args) => {
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Bed assembly spawns ffmpeg too (no -c:v in its args) and must succeed
      // so the video pass is reached at all.
      if (!args.includes("-c:v")) {
        setImmediate(() => proc.emit("close", 0));
        return proc;
      }
      videoCalls.push(args);
      videoAttempt += 1;
      if (videoAttempt === 1) {
        // Progress the AMF attempt well past what the CPU retry starts at, so
        // a stale monotonic percent would otherwise poison the retry.
        setImmediate(() => {
          proc.stderr.emit("data", Buffer.from("time=00:00:24.00 bitrate=..."));
          setImmediate(() => proc.emit("close", 1));
        });
      } else {
        setImmediate(() => proc.emit("close", 0));
      }
      return proc;
    });
    const p = await readyMusicOnlyProject(60);
    const job = createJob("u1", { durationSec: 60 });
    await renderStage({ dataDir, outputDir }, p.projectId, job.jobId, { encoder: "amf" });

    assert.equal(videoCalls.length, 2, "AMF attempt then a CPU retry");
    assert.ok(videoCalls[0].includes("h264_amf"), "first attempt uses the graphics chip");
    assert.ok(videoCalls[1].includes("libx264") && !videoCalls[1].includes("h264_amf"), "retry falls back to CPU");

    const saved = readProject(dataDir, p.projectId);
    assert.equal(saved.status, AMBIENT_STATUS.DONE);
    assert.equal(saved.render.encoderUsed, "cpu");
    // The stale 40% from the failed AMF attempt (24/60) must not survive into
    // the retry's own progress — it finished at the terminal 100%, not stuck.
    assert.equal(saved.render.percent, 100);
    assert.equal(getRenderJob(job.jobId)?.percent, 100);
  });

  test("a cancel during the AMF attempt skips the CPU retry entirely", async () => {
    _setEncodersProbe(() => " V....D h264_amf  AMD AMF H.264 Encoder");
    const p = await readyMusicOnlyProject(60);
    const videoCalls = [];
    _setFfmpegSpawnImpl((args) => {
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter();
      if (!args.includes("-c:v")) {
        setImmediate(() => proc.emit("close", 0));
        return proc;
      }
      videoCalls.push(args);
      setImmediate(() => {
        markCancelled(p.projectId);
        proc.emit("close", 1);
      });
      return proc;
    });
    const job = createJob("u1", { durationSec: 60 });
    await renderStage({ dataDir, outputDir }, p.projectId, job.jobId, { encoder: "amf" });
    assert.equal(videoCalls.length, 1, "no CPU retry once cancelled");
    const saved = readProject(dataDir, p.projectId);
    assert.equal(saved.status, AMBIENT_STATUS.ERROR);
    clearCancelled(p.projectId);
  });
});

describe("quota is charged only for work that will run", () => {
  // Five refused renders used to spend the free plan's five for the day.
  const recordCharges = () => {
    const charged = [];
    _setQuotaImpl((bucket) => (_req, _res, next) => { charged.push(bucket); next(); });
    return charged;
  };

  test("a render refused for missing pictures costs nothing", async () => {
    const p = await createSession();
    const charged = recordCharges();
    const res = await request(app).post(`/api/ambient/${p.projectId}/render`).send({});
    assert.equal(res.status, 400);
    assert.deepEqual(charged, []);
  });

  test("voicing with nothing to voice costs nothing", async () => {
    const p = await createSession();
    const charged = recordCharges();
    const res = await request(app).post(`/api/ambient/${p.projectId}/voice`).send({});
    assert.equal(res.status, 400);
    assert.deepEqual(charged, []);
  });

  test("pictures for a movement that isn't there cost nothing", async () => {
    const p = await createSession();
    const charged = recordCharges();
    const res = await request(app).post(`/api/ambient/${p.projectId}/images`).send({ movementId: "nope" });
    assert.equal(res.status, 404);
    assert.deepEqual(charged, []);
  });

  test("an unknown session costs nothing", async () => {
    const charged = recordCharges();
    for (const step of ["voice", "images", "render", "plan"]) {
      await request(app).post(`/api/ambient/missing/${step}`).send({});
    }
    assert.deepEqual(charged, []);
  });

  test("suggesting verses asks the model, so it is charged to the scripts bucket", async () => {
    const p = await createSession();
    const charged = recordCharges();
    const res = await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 2 });
    assert.equal(res.status, 200);
    assert.deepEqual(charged, ["scripts"]);
  });

  test("an exhausted scripts bucket stops the model call", async () => {
    const p = await createSession();
    let asked = 0;
    _setPlanImpl(async () => { asked += 1; return ["Psalms 23:1"]; });
    _setQuotaImpl(() => (_req, res) => res.status(429).json({ ok: false, error: "quota" }));
    const res = await request(app).post(`/api/ambient/${p.projectId}/plan`).send({ count: 1 });
    assert.equal(res.status, 429);
    assert.equal(asked, 0);
  });
});

describe("session length is bounded", () => {
  test("a session longer than ten hours is refused, not stored", async () => {
    const res = await request(app).post("/api/ambient").send({ title: "T", theme: "rest", targetSec: 999_999_999_999 });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /10 hours/);
  });

  test("ten hours exactly is allowed", async () => {
    const p = await createSession({ targetSec: 36_000 });
    assert.equal(p.targetSec, 36_000);
  });
});
