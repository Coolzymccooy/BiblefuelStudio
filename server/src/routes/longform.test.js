import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import longformRouter, { _setPlanImpl, _resetPlanImpl, _setNarrateImpl, _resetNarrateImpl, _setPipelineImpl, _resetPipelineImpl, _setTranscribeImpl, _resetTranscribeImpl, _setQuotaImpl, _resetQuotaImpl } from "./longform.js";
import { markCancelled, isCancelled, clearCancelled } from "./story.js";
import { readProject, writeProject } from "../lib/story/projectStore.js";

let dataDir, outputDir, app;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lf-"));
  outputDir = path.join(dataDir, "out"); fs.mkdirSync(outputDir);
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir }; next(); });
  app.use("/api/longform", longformRouter);
  _setPlanImpl(async ({ idea }) => ({
    title: "Psalms for Rest", summary: "Slow psalms.",
    sections: [
      { heading: "Welcome", reference: null, verseText: "", text: `welcome ${idea}`, targetSec: 60 },
      { heading: "Psalm 23", reference: "Psalm 23:1", verseText: "The LORD is my shepherd.", text: "Psalm 23:1. The LORD is my shepherd. Rest.", targetSec: 300 },
      { heading: "Closing", reference: null, verseText: "", text: "sleep well", targetSec: 60 },
    ],
  }));
});
afterEach(() => { _resetPlanImpl(); _resetNarrateImpl(); _resetPipelineImpl(); _resetTranscribeImpl(); _resetQuotaImpl(); });

const tick = () => new Promise((r) => setImmediate(r));

function fakeNarration({ sections, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  const audioPath = path.join(workDir, "narration.mp3"); fs.writeFileSync(audioPath, "a");
  let t = 0;
  const timed = sections.map((s) => { const out = { ...s, startMs: t, endMs: t + s.targetSec * 1000 }; t = out.endMs + 5000; return out; });
  return { audioPath, durationMs: timed[timed.length - 1].endMs, sections: timed, provider: "azure" };
}

async function waitFor(id, pred, ms = 3000) {
  const start = Date.now();
  for (;;) { const p = readProject(dataDir, id); if (p && pred(p)) return p; if (Date.now() - start > ms) return p; await new Promise((r) => setTimeout(r, 10)); }
}

describe("GET /api/longform/templates", () => {
  test("lists the shipped templates", async () => {
    const res = await request(app).get("/api/longform/templates");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.templates.map((t) => t.id), ["sleep-30", "sleep-60"]);
  });
});

describe("POST /api/longform/draft", () => {
  test("creates a landscape draft_script project with sections and no audio", async () => {
    const res = await request(app).post("/api/longform/draft").send({ idea: "can't sleep", templateId: "sleep-30" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.project;
    assert.equal(p.status, "draft_script");
    assert.equal(p.aspect, "landscape");
    assert.equal(p.captions, "none");
    assert.equal(p.scene.maxScenes, 12);
    assert.equal(p.title, "Psalms for Rest");
    assert.equal(p.longform.templateId, "sleep-30");
    assert.equal(p.longform.sections.length, 3);
    assert.equal(p.source.audioPath, null);
  });
  test("rejects an unknown template and a missing idea by name", async () => {
    let res = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "nope" });
    assert.equal(res.status, 400); assert.match(res.body.error, /template/i);
    res = await request(app).post("/api/longform/draft").send({ templateId: "sleep-30" });
    assert.equal(res.status, 400); assert.match(res.body.error, /idea/i);
  });
});

describe("PATCH /api/longform/:id/sections", () => {
  test("replaces section text while still a draft", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const edited = body.project.longform.sections.map((s, i) => (i === 0 ? { ...s, text: "edited welcome" } : s));
    const res = await request(app).patch(`/api/longform/${body.project.projectId}/sections`).send({ sections: edited });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.longform.sections[0].text, "edited welcome");
  });
});

describe("POST /api/longform/:id/narrate", () => {
  test("narrates, imports section-based timings and hands off to the story pipeline", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    _setNarrateImpl(async ({ sections, workDir }) => {
      fs.mkdirSync(workDir, { recursive: true });
      const audioPath = path.join(workDir, "narration.mp3"); fs.writeFileSync(audioPath, "a");
      let t = 0;
      const timed = sections.map((s) => { const out = { ...s, startMs: t, endMs: t + s.targetSec * 1000 }; t = out.endMs + 5000; return out; });
      return { audioPath, durationMs: timed[timed.length - 1].endMs, sections: timed, provider: "azure" };
    });
    const pipelineCalls = [];
    _setPipelineImpl(async (ctx, projectId, mediaPath) => { pipelineCalls.push({ projectId, mediaPath }); });

    const res = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.status, "narrating");

    const p = await waitFor(id, (x) => pipelineCalls.length === 1);
    assert.equal(pipelineCalls[0].projectId, id);
    assert.ok(p.source.audioPath.endsWith("narration.mp3"));
    assert.equal(p.source.durationMs, 430000);
    assert.equal(p.longform.sections[1].startMs, 65000);
    assert.ok(p.transcript.words.length > 5);
    assert.equal(p.transcript.words[0].startMs, 0);
    assert.equal(p.status, "segmenting");
  });
  test("persists a narration progress heartbeat that survives to completion", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    _setNarrateImpl(async ({ sections, workDir }, deps) => {
      fs.mkdirSync(workDir, { recursive: true });
      const total = sections.length;
      for (let i = 0; i < sections.length; i++) {
        deps?.onProgress?.({ done: i + 1, total });
      }
      const audioPath = path.join(workDir, "narration.mp3"); fs.writeFileSync(audioPath, "a");
      let t = 0;
      const timed = sections.map((s) => { const out = { ...s, startMs: t, endMs: t + s.targetSec * 1000 }; t = out.endMs + 5000; return out; });
      return { audioPath, durationMs: timed[timed.length - 1].endMs, sections: timed, provider: "azure" };
    });
    const pipelineCalls = [];
    _setPipelineImpl(async (ctx, projectId, mediaPath) => { pipelineCalls.push({ projectId, mediaPath }); });

    const res = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const p = await waitFor(id, (x) => pipelineCalls.length === 1);
    assert.equal(p.status, "segmenting");
    assert.equal(p.longform.progress.total, 3);
    assert.equal(p.longform.progress.done, p.longform.progress.total);
  });
  test("resume (no voiceId in the request) reuses the voice from the first narrate call", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    const receivedVoiceIds = [];
    _setNarrateImpl(async ({ sections, voiceId, workDir }) => {
      receivedVoiceIds.push(voiceId);
      fs.mkdirSync(workDir, { recursive: true });
      const audioPath = path.join(workDir, "narration.mp3"); fs.writeFileSync(audioPath, "a");
      let t = 0;
      const timed = sections.map((s) => { const out = { ...s, startMs: t, endMs: t + s.targetSec * 1000 }; t = out.endMs + 5000; return out; });
      return { audioPath, durationMs: timed[timed.length - 1].endMs, sections: timed, provider: "azure" };
    });
    const pipelineCalls = [];
    _setPipelineImpl(async (ctx, projectId, mediaPath) => { pipelineCalls.push({ projectId, mediaPath }); });

    const first = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // The chosen voice is persisted immediately, in the same response — not
    // only once the run finishes.
    assert.equal(first.body.project.longform.voiceId, "v1");
    await waitFor(id, () => pipelineCalls.length === 1);

    // A resume call (the client's Resume button) sends no voiceId at all.
    const second = await request(app).post(`/api/longform/${id}/narrate`).send({});
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.project.longform.voiceId, "v1", "restored from the project, not the empty request body");
    await waitFor(id, () => pipelineCalls.length === 2);

    // The TTS chunk cache is keyed by voiceId — resuming with a different (or
    // missing) voice would silently miss every cached chunk.
    assert.deepEqual(receivedVoiceIds, ["v1", "v1"]);
  });
  test("persists the provider reported by the heartbeat, and tolerates the initial provider-less 0/total call", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    let release;
    const gate = new Promise((r) => { release = r; });
    _setNarrateImpl(async ({ sections, workDir }, deps) => {
      deps?.onProgress?.({ done: 0, total: 3, provider: null });
      await gate;
      deps?.onProgress?.({ done: 1, total: 3, provider: "azure" });
      return fakeNarration({ sections, workDir });
    });
    const pipelineCalls = [];
    _setPipelineImpl(async () => { pipelineCalls.push(1); });

    const res = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const early = await waitFor(id, (x) => x.longform?.progress?.total === 3);
    assert.deepEqual(early.longform.progress, { done: 0, total: 3 }, "0/total is persisted before the first chunk; no null provider key");

    release();
    const done = await waitFor(id, () => pipelineCalls.length === 1);
    assert.equal(done.longform.progress.provider, "azure");
  });
  test("GET /api/story/:id reports whether the narration is alive in this process", async () => {
    const { default: storyRouter } = await import("./story.js");
    app.use("/api/story", storyRouter);
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;

    // A project that says "narrating" but has no run in this process (the
    // server restarted mid-run) must be reported as not alive.
    writeProject(dataDir, { ...readProject(dataDir, id), status: "narrating" });
    const dead = await request(app).get(`/api/story/${id}`);
    assert.equal(dead.status, 200);
    assert.equal(dead.body.project.longform.progress.alive, false);
    assert.equal(readProject(dataDir, id).longform.progress, undefined, "alive is a wire-only enrichment, never persisted");

    let release;
    const gate = new Promise((r) => { release = r; });
    _setNarrateImpl(async ({ sections, workDir }, deps) => {
      deps?.onProgress?.({ done: 0, total: 3, provider: null });
      await gate;
      return fakeNarration({ sections, workDir });
    });
    const pipelineCalls = [];
    _setPipelineImpl(async () => { pipelineCalls.push(1); });
    writeProject(dataDir, { ...readProject(dataDir, id), status: "draft_script" });
    const res = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await waitFor(id, (x) => x.longform?.progress?.total === 3);
    const live = await request(app).get(`/api/story/${id}`);
    assert.equal(live.body.project.status, "narrating");
    assert.deepEqual(live.body.project.longform.progress, { done: 0, total: 3, alive: true });

    release();
    const finished = await waitFor(id, () => pipelineCalls.length === 1);
    assert.equal(finished.status, "segmenting");
    const after = await request(app).get(`/api/story/${id}`);
    assert.equal(after.body.project.longform.progress.alive, undefined, "no liveness flag once narration is over");
  });
  test("rejects a concurrent narrate call for the same project, and allows a new one once the first finishes", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    let resolveDeferred;
    const deferred = new Promise((resolve) => { resolveDeferred = resolve; });
    _setNarrateImpl(async ({ sections, workDir }) => {
      fs.mkdirSync(workDir, { recursive: true });
      await deferred;
      const audioPath = path.join(workDir, "narration.mp3"); fs.writeFileSync(audioPath, "a");
      let t = 0;
      const timed = sections.map((s) => { const out = { ...s, startMs: t, endMs: t + s.targetSec * 1000 }; t = out.endMs + 5000; return out; });
      return { audioPath, durationMs: timed[timed.length - 1].endMs, sections: timed, provider: "azure" };
    });
    const pipelineCalls = [];
    _setPipelineImpl(async (ctx, projectId, mediaPath) => { pipelineCalls.push({ projectId, mediaPath }); });

    const first = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(first.status, 200, JSON.stringify(first.body));

    const second = await request(app).post(`/api/longform/${id}/narrate`).send({});
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already running/i);

    resolveDeferred();
    await waitFor(id, () => pipelineCalls.length === 1);

    const third = await request(app).post(`/api/longform/${id}/narrate`).send({});
    assert.equal(third.status, 200, JSON.stringify(third.body));
  });
  test("refuses when the project has no sections", async () => {
    const { createProject, writeProject } = await import("../lib/story/projectStore.js");
    const p = writeProject(dataDir, { ...createProject(dataDir, { title: "bare" }), status: "draft_script" });
    const res = await request(app).post(`/api/longform/${p.projectId}/narrate`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /sections/i);
  });
  // I2 — the shared cancel flag (POST /api/story/:id/cancel → markCancelled)
  // is honoured between chunks: narration throws, the project ends
  // "Cancelled." and the pipeline is never started.
  test("cancel mid-narration ends the project in error with 'Cancelled.' and never starts the pipeline", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    let progressCalls = 0;
    _setNarrateImpl(async (args, deps) => {
      for (let i = 1; i <= 50; i++) {
        deps.onProgress({ done: i, total: 50 });
        progressCalls = i;
        if (i === 3) markCancelled(id);
        await tick();
      }
      return fakeNarration(args);
    });
    const pipelineCalls = [];
    _setPipelineImpl(async () => { pipelineCalls.push(1); });

    const res = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = await waitFor(id, (x) => x.status === "error");
    assert.equal(p.status, "error");
    assert.equal(p.error, "Cancelled.");
    assert.equal(pipelineCalls.length, 0, "pipeline never started");
    assert.ok(progressCalls < 50, `stopped early at chunk ${progressCalls}`);
    clearCancelled(id);
  });
  test("a cancel that lands after the last chunk still ends the project cancelled and skips the pipeline", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    _setNarrateImpl(async (args, deps) => {
      deps.onProgress({ done: 1, total: 1 });
      markCancelled(id); // after the final heartbeat, before the result is consumed
      return fakeNarration(args);
    });
    const pipelineCalls = [];
    _setPipelineImpl(async () => { pipelineCalls.push(1); });
    await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    const p = await waitFor(id, (x) => x.status === "error");
    assert.equal(p.error, "Cancelled.");
    assert.equal(pipelineCalls.length, 0);
    assert.equal(isCancelled(id), false, "flag cleared once honoured");
  });
  test("a fresh narrate call clears a stale cancel flag", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    markCancelled(id);
    _setNarrateImpl(async (args, deps) => { deps.onProgress({ done: 1, total: 1 }); return fakeNarration(args); });
    const pipelineCalls = [];
    _setPipelineImpl(async () => { pipelineCalls.push(1); });
    await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    await waitFor(id, () => pipelineCalls.length === 1);
    assert.equal(pipelineCalls.length, 1);
  });
  // I8 — a failure while RECORDING the narration error must not escape as an
  // unhandled rejection; the process keeps running and the warning is logged.
  test("a failure while recording the narration error is logged, not thrown", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    const warned = [];
    const origWarn = console.warn;
    console.warn = (...a) => warned.push(a.join(" "));
    try {
      // A rejection whose stringification itself throws — the catch block's
      // `String(e?.message || e)` blows up while trying to record the error.
      _setNarrateImpl(async () => { throw { get message() { throw new Error("poisoned error"); } }; });
      await request(app).post(`/api/longform/${id}/narrate`).send({});
      for (let i = 0; i < 20; i++) await tick();
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      console.warn = origWarn;
      process.off("unhandledRejection", onUnhandled);
    }
    assert.equal(unhandled.length, 0, "no unhandled rejection");
    assert.ok(warned.some((w) => /\[longform\] failed to record narration error/.test(w)), `expected a warning, got: ${warned.join(" | ")}`);
  });
  test("a narration failure lands the project in error with the reason", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    _setNarrateImpl(async () => { throw new Error("azure quota"); });
    await request(app).post(`/api/longform/${body.project.projectId}/narrate`).send({});
    const p = await waitFor(body.project.projectId, (x) => x.status === "error");
    assert.equal(p.status, "error");
    assert.match(p.error, /azure quota/);
  });
});

describe("POST /api/longform/draft — inspiration", () => {
  test("suggests a template when none is given and reports it", async () => {
    const res = await request(app).post("/api/longform/draft").send({ idea: "an hour of psalms" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.longform.templateId, "sleep-60");
    assert.equal(res.body.suggestion.templateId, "sleep-60");
  });
  test("transcribes a voice note into the idea", async () => {
    const note = path.join(outputDir, "note.m4a"); fs.writeFileSync(note, "aud");
    let planned = "";
    _setPlanImpl(async ({ idea }) => { planned = idea; return { title: "T", summary: "", sections: [
      { heading: "A", reference: null, verseText: "", text: "a", targetSec: 60 },
      { heading: "B", reference: null, verseText: "", text: "b", targetSec: 60 },
      { heading: "C", reference: null, verseText: "", text: "c", targetSec: 60 } ] }; });
    _setTranscribeImpl(async () => ({ provider: "local-whisper", words: [{ text: "when", startMs: 0, endMs: 1 }, { text: "I", startMs: 1, endMs: 2 }, { text: "cannot", startMs: 2, endMs: 3 }, { text: "sleep", startMs: 3, endMs: 4 }] }));
    const res = await request(app).post("/api/longform/draft").send({ audioPath: note, templateId: "sleep-30" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(planned, "when I cannot sleep");
    assert.equal(res.body.project.longform.idea, "when I cannot sleep");
  });
  test("rejects a voice note outside the user's output dir", async () => {
    const res = await request(app).post("/api/longform/draft").send({ audioPath: "/etc/passwd", templateId: "sleep-30" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /audioPath/i);
  });
});

describe("POST /api/longform/:id/reopen", () => {
  test("drops a failed long-form project back to draft_script with the error cleared", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    _setNarrateImpl(async () => { throw new Error("azure quota"); });
    await request(app).post(`/api/longform/${id}/narrate`).send({});
    await waitFor(id, (x) => x.status === "error");
    const res = await request(app).post(`/api/longform/${id}/reopen`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.status, "draft_script");
    assert.equal(res.body.project.error, null);
    assert.equal(res.body.project.longform.sections.length, 3, "sections preserved");
    assert.equal(readProject(dataDir, id).status, "draft_script");
  });
  test("refuses by name when the project is not in error, or has no sections", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const res = await request(app).post(`/api/longform/${body.project.projectId}/reopen`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /in error/i);
    const { createProject } = await import("../lib/story/projectStore.js");
    const bare = writeProject(dataDir, { ...createProject(dataDir, { title: "bare" }), status: "error", error: "boom" });
    const res2 = await request(app).post(`/api/longform/${bare.projectId}/reopen`).send({});
    assert.equal(res2.status, 400);
    assert.match(res2.body.error, /sections/i);
    const res3 = await request(app).post(`/api/longform/nope/reopen`).send({});
    assert.equal(res3.status, 404);
  });
});

describe("render quota placement", () => {
  // I4 — the render quota is charged on /draft and /:id/narrate only. With a
  // quota that always 429s, every other route must still work.
  test("only POST /draft and POST /:id/narrate carry the render quota", async () => {
    // Set up a project while the quota still passes.
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    const buckets = [];
    _setQuotaImpl((bucket) => (req, res) => { buckets.push(bucket); res.status(429).json({ ok: false, error: "QUOTA_EXCEEDED" }); });

    assert.equal((await request(app).get("/api/longform/templates")).status, 200);
    const patched = await request(app).patch(`/api/longform/${id}/sections`).send({ sections: body.project.longform.sections });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    writeProject(dataDir, { ...readProject(dataDir, id), status: "error", error: "boom" });
    assert.equal((await request(app).post(`/api/longform/${id}/reopen`).send({})).status, 200);

    assert.equal((await request(app).post("/api/longform/draft").send({ idea: "y", templateId: "sleep-30" })).status, 429);
    assert.equal((await request(app).post(`/api/longform/${id}/narrate`).send({})).status, 429);
    assert.deepEqual(buckets, ["render", "render"]);
  });
  test("the router's layer stack carries the quota handler on exactly those two routes", () => {
    const withQuota = longformRouter.stack
      .filter((l) => l.route)
      .filter((l) => l.route.stack.some((h) => h.name === "renderQuota"))
      .map((l) => `${Object.keys(l.route.methods).join(",")} ${l.route.path}`);
    assert.deepEqual(withQuota.sort(), ["post /:id/narrate", "post /draft"]);
  });
});
