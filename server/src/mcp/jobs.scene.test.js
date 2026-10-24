import { test } from "node:test";
import assert from "node:assert/strict";
import { NORMALISERS, JOB_KINDS, outputUrl } from "./jobs.js";

// Fixture tests for the scene (scene scripts) and longform job kinds.

const BASE = "https://biblefuel.tiwaton.co.uk";
const toUrl = (p) => outputUrl(p, BASE);
const ID = "0b0c8f8e-1a2b-4c3d-8e9f-001122334455";

const scene = (fields = {}) => NORMALISERS.scene.normalise({ ok: true, project: { id: ID, lines: [], shots: [], ...fields } }, { outputUrl: toUrl });
const line = (id, fields = {}) => ({ id, text: "In the beginning", audio: null, ...fields });
const shot = (id, clip = null) => ({ id, prompt: "a field", clip });

test("scene and longform are job kinds with their status routes", () => {
  assert.ok(JOB_KINDS.includes("scene"));
  assert.ok(JOB_KINDS.includes("longform"));
  assert.equal(NORMALISERS.scene.route(ID), `/api/scene-script/${ID}`);
  assert.equal(NORMALISERS.longform.route("p1"), "/api/story/p1");
});

test("scene: voicing runs with the share of lines voiced", () => {
  const h = scene({
    voice: { status: "running" }, running: { voice: true, shots: false, render: false },
    lines: [line("l1", { audio: { file: "a.mp3" } }), line("l2"), line("l3"), line("l4")],
  });
  assert.equal(h.kind, "scene");
  assert.equal(h.id, ID);
  assert.equal(h.status, "running");
  assert.equal(h.phase, "voicing");
  assert.equal(h.percent, 25);
  assert.equal(h.output, null);
});

test("scene: clips being made run as making_shots with the share settled", () => {
  const h = scene({
    voice: { status: "done" },
    shots: [shot("s1", { status: "done", libraryId: "c1" }), shot("s2", { status: "generating" }), shot("s3", { status: "queued" }), shot("s4", { status: "error", error: "x" })],
  });
  assert.equal(h.status, "running");
  assert.equal(h.phase, "making_shots");
  assert.equal(h.percent, 50);
});

test("scene: a render runs with its progress; it outranks the other stages", () => {
  const h = scene({ voice: { status: "running" }, render: { status: "rendering", progress: 42 }, running: { render: true } });
  assert.equal(h.status, "running");
  assert.equal(h.phase, "rendering");
  assert.equal(h.percent, 42);
  assert.equal(scene({ render: { status: "queued", progress: 0 } }).phase, "rendering");
});

test("scene: a finished render is done with the video under the project's folder", () => {
  const url = `/outputs/scene-scripts/${ID}/the-call.mp4`;
  const h = scene({ voice: { status: "done" }, render: { status: "done", file: "the-call.mp4", url, progress: 100 } });
  assert.equal(h.status, "done");
  assert.equal(h.phase, "rendered");
  assert.equal(h.percent, 100);
  assert.deepEqual(h.output, { url: `${BASE}${url}`, path: url });
});

test("scene: idle and ready is done ready_to_render; idle with blockers is done not_ready and lists them", () => {
  const ready = scene({ voice: { status: "done" }, blockers: [] });
  assert.equal(ready.status, "done");
  assert.equal(ready.phase, "ready_to_render");
  assert.equal(ready.output, null);
  const notReady = scene({ blockers: ["Voice every line first.", "2 shot(s) have no clip yet."] });
  assert.equal(notReady.status, "done");
  assert.equal(notReady.phase, "not_ready");
  assert.deepEqual(notReady.blockers, ["Voice every line first.", "2 shot(s) have no clip yet."]);
});

test("scene: each stage's problem makes it failed, labelled by stage", () => {
  const voice = scene({ voice: { status: "error", error: "2 line(s) could not be voiced. Try again." } });
  assert.equal(voice.status, "failed");
  assert.match(voice.error, /^Voicing: 2 line\(s\) could not be voiced/);
  const shots = scene({ shots: [shot("s1", { status: "error", error: "Something went wrong making this clip." }), shot("s2", { status: "done" })] });
  assert.equal(shots.status, "failed");
  assert.match(shots.error, /Shots: 1 of 2 shots have no clip \(Something went wrong/);
  const render = scene({ render: { status: "error", error: "Interrupted by a server restart. Render again; clips and voices are kept." } });
  assert.equal(render.status, "failed");
  assert.match(render.error, /^Render: Interrupted by a server restart/);
});

test("scene: a stopped render reads cancelled", () => {
  const h = scene({ render: { status: "cancelled", error: null, progress: 0 } });
  assert.equal(h.status, "cancelled");
});

test("scene: the handle carries a per-stage summary", () => {
  const h = scene({
    voice: { status: "done" }, render: { status: "done", url: "/outputs/scene-scripts/x/v.mp4" },
    lines: [line("l1", { audio: { file: "a" } }), line("l2", { audio: { file: "b" }, audioError: "bad" })],
    shots: [shot("s1", { status: "done" }), shot("s2", { status: "error" }), shot("s3")],
  });
  assert.deepEqual(h.stages, { voice: "done", linesVoiced: 1, lines: 2, shotsWithClip: 1, shotsFailed: 1, shots: 3, render: "done", last: null });
});

// ---- longform ----

const longform = (fields = {}) => NORMALISERS.longform.normalise({ ok: true, project: { projectId: "p1", scenes: [], ...fields } }, { outputUrl: toUrl });

test("longform: narrating runs with the share of chunks voiced", () => {
  const h = longform({ status: "narrating", longform: { progress: { done: 3, total: 12, alive: true } } });
  assert.equal(h.kind, "longform");
  assert.equal(h.id, "p1");
  assert.equal(h.status, "running");
  assert.equal(h.phase, "narrating");
  assert.equal(h.percent, 25);
});

test("longform: a narration no longer alive after a restart reads failed with how to resume", () => {
  const h = longform({ status: "narrating", longform: { progress: { done: 3, total: 12, alive: false } } });
  assert.equal(h.status, "failed");
  assert.match(h.error, /restart/);
  assert.match(h.error, /longform_narrate/);
});

test("longform: a draft outline is done (nothing runs) with phase draft_script", () => {
  const h = longform({ status: "draft_script" });
  assert.equal(h.status, "done");
  assert.equal(h.phase, "draft_script");
});

test("longform: after narration it reads like a story, under the longform kind", () => {
  assert.equal(longform({ status: "generating_images", scenes: [{ imageStatus: "generating" }] }).status, "running");
  const ready = longform({ status: "ready_to_render", scenes: [{ imageStatus: "done" }] });
  assert.equal(ready.kind, "longform");
  assert.equal(ready.status, "done");
  assert.equal(ready.phase, "ready_to_render");
  const cancelled = longform({ status: "error", error: "Cancelled." });
  assert.equal(cancelled.status, "cancelled");
});

// ---- L3: the stage run last decides ----

test("scene: an old render error does not fail the handle once a later voicing succeeded", () => {
  const h = scene({
    render: { status: "error", error: "ffmpeg failed", startedAt: 100, finishedAt: 200 },
    voice: { status: "done", finishedAt: 300 },
    blockers: [],
  });
  assert.equal(h.status, "done");
  assert.equal(h.phase, "ready_to_render");
  assert.equal(h.stages.last, "voice");
});

test("scene: an old render error does not fail a shots run that finished later", () => {
  const h = scene({
    render: { status: "error", error: "Interrupted by a server restart.", startedAt: 100 },
    voice: { status: "done", finishedAt: 50 },
    shotsRun: { startedAt: 400, finishedAt: 500, cancelled: false },
    shots: [shot("s1", { status: "done", libraryId: "c1" })],
    blockers: [],
  });
  assert.equal(h.status, "done");
  assert.equal(h.stages.last, "shots");
});

test("scene: the stage run last still fails the handle with its own problem only", () => {
  const h = scene({
    voice: { status: "error", error: "1 line(s) could not be voiced. Try again.", finishedAt: 100 },
    render: { status: "error", error: "ffmpeg failed", startedAt: 200, finishedAt: 300 },
  });
  assert.equal(h.status, "failed");
  assert.equal(h.error, "Render: ffmpeg failed");
});

test("scene: a stopped shots run reads cancelled, with or without the run record", () => {
  const stopped = { status: "error", error: "Stopped before this clip was ordered." };
  const withRun = scene({ shotsRun: { startedAt: 10, finishedAt: 20, cancelled: true }, shots: [shot("s1", { status: "done" }), shot("s2", stopped)] });
  assert.equal(withRun.status, "cancelled");
  const legacy = scene({ shots: [shot("s1", { status: "done" }), shot("s2", stopped)] });
  assert.equal(legacy.status, "cancelled");
});

test("scene: a shots run that ran last with failed clips is failed", () => {
  const h = scene({
    voice: { status: "done", finishedAt: 10 },
    shotsRun: { startedAt: 20, finishedAt: 30, cancelled: false },
    shots: [shot("s1", { status: "error", error: "BytePlus declined this shot's prompt." }), shot("s2", { status: "done" })],
  });
  assert.equal(h.status, "failed");
  assert.match(h.error, /^Shots: 1 of 2 shots have no clip/);
});

test("scene: a render that ran last and finished is rendered even with an older voicing problem", () => {
  const h = scene({
    voice: { status: "error", error: "x", finishedAt: 10 },
    render: { status: "done", url: "/outputs/scene-scripts/x/v.mp4", finishedAt: 20 },
  });
  assert.equal(h.status, "done");
  assert.equal(h.phase, "rendered");
});
