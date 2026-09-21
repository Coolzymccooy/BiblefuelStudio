import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import longformRouter, { _setPlanImpl, _resetPlanImpl, _setNarrateImpl, _resetNarrateImpl, _setPipelineImpl, _resetPipelineImpl, _setTranscribeImpl, _resetTranscribeImpl } from "./longform.js";
import { readProject } from "../lib/story/projectStore.js";

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
afterEach(() => { _resetPlanImpl(); _resetNarrateImpl(); _resetPipelineImpl(); _resetTranscribeImpl(); });

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
