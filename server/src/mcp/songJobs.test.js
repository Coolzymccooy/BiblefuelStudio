import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { NORMALISERS, JOB_KINDS, outputUrl, waitForJob } from "./jobs.js";

const BASE = "https://biblefuel.tiwaton.co.uk";
const toUrl = (p) => outputUrl(p, BASE);

// ---- lyric_align -------------------------------------------------------------

const lyric = (timing, fields = {}) => ({ project: { projectId: "lv_1", timing, lines: [], ...fields } });
const align = (payload) => NORMALISERS.lyric_align.normalise(payload, { outputUrl: toUrl });

test("lyric_align, lyric_render and moments are job kinds with their status routes", () => {
  for (const kind of ["lyric_align", "lyric_render", "moments"]) assert.ok(JOB_KINDS.includes(kind), kind);
  assert.equal(NORMALISERS.lyric_align.route("lv_1"), "/api/lyric-video/lv_1");
  assert.equal(NORMALISERS.lyric_render.route("job-9", "lv_1"), "/api/lyric-video/lv_1/render/job-9");
  assert.equal(NORMALISERS.moments.route("m-1"), "/api/moments/m-1");
  assert.equal(NORMALISERS.lyric_render.needsProjectId, true);
});

test("lyric_align: running reports the step, and the listening share as a percent", () => {
  assert.deepEqual(align(lyric({ status: "running", progress: { step: "preparing" } })), {
    kind: "lyric_align", id: "lv_1", status: "running", percent: null, phase: "preparing", output: null, error: null,
  });
  const listening = align(lyric({ status: "running", progress: { step: "listening", window: 3, total: 12 } }));
  assert.equal(listening.percent, 25);
  assert.equal(listening.phase, "listening");
});

test("lyric_align: done counts the timed and flagged lines, and keeps a failed re-run's reason as a warning", () => {
  const lines = [
    { id: "l1", words: [{ text: "a", start: 1, end: 2 }], start: 1, end: 2 },
    { id: "l2", words: [{ text: "b", start: 3, end: 4 }], start: 3, end: 4, flag: "unheard" },
    { id: "l3", text: "c" },
  ];
  const done = align(lyric({ status: "done", lastError: null }, { lines }));
  assert.equal(done.status, "done");
  assert.equal(done.percent, 100);
  assert.deepEqual(done.lines, { total: 3, timed: 2, flagged: 1 });
  assert.equal(done.warning, undefined);
  const rerun = align(lyric({ status: "done", lastError: "The speech service is busy" }, { lines }));
  assert.equal(rerun.status, "done");
  assert.equal(rerun.warning, "The speech service is busy");
});

test("lyric_align: an error is failed with its reason; idle means timing has not run on these lyrics", () => {
  const failed = align(lyric({ status: "error", error: "Timing stopped before it finished — run it again." }));
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Timing stopped/);
  const idle = align(lyric({ status: "idle" }));
  assert.equal(idle.status, "failed");
  assert.match(idle.error, /lyric_align/);
  assert.equal(align({ project: { projectId: "lv_2" } }).status, "failed");
});

// ---- lyric_render ------------------------------------------------------------

const render = (job) => NORMALISERS.lyric_render.normalise({ job }, { outputUrl: toUrl });

test("lyric_render: running with progress; done gives the video as an /outputs path and url", () => {
  assert.deepEqual(render({ jobId: "j1", status: "running", progress: 40, error: null, file: null }), {
    kind: "lyric_render", id: "j1", status: "running", percent: 40, phase: null, output: null, error: null,
  });
  const done = render({ jobId: "j1", status: "done", progress: 100, error: null, file: "lyric-abc.mp4" });
  assert.equal(done.status, "done");
  assert.deepEqual(done.output, { url: `${BASE}/outputs/lyric-abc.mp4`, path: "/outputs/lyric-abc.mp4" });
});

test("lyric_render: an error is failed, a cancel is cancelled", () => {
  const failed = render({ jobId: "j2", status: "error", progress: 0, error: "The video could not be made. Try again, or choose a different background.", file: null });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /could not be made/);
  assert.equal(render({ jobId: "j3", status: "error", progress: 10, error: "Render cancelled", file: null }).status, "cancelled");
});

test("waitForJob refuses a lyric_render wait without the project id", async () => {
  const api = { call: async () => ({}) };
  await assert.rejects(waitForJob(api, { kind: "lyric_render", id: "j1" }), (err) => err.code === "NEEDS_PROJECT_ID");
});

// ---- moments -----------------------------------------------------------------

const moment = (render) => NORMALISERS.moments.normalise({ ok: true, project: { projectId: "m-1", render } }, { outputUrl: toUrl });

test("moments: a running render reports its stage and percent", () => {
  assert.deepEqual(moment({ jobId: "j", status: "running", percent: 30, stage: "drawing" }), {
    kind: "moments", id: "m-1", status: "running", percent: 30, phase: "drawing", output: null, error: null,
  });
});

test("moments: done gives the video; an error is failed and a cancel cancelled", () => {
  const done = moment({ jobId: "j", status: "done", percent: 100, stage: "done", file: "/outputs/moment-1.mp4" });
  assert.equal(done.status, "done");
  assert.deepEqual(done.output, { url: `${BASE}/outputs/moment-1.mp4`, path: "/outputs/moment-1.mp4" });
  const failed = moment({ jobId: "j", status: "error", percent: 0, stage: "error", error: "This Moment no longer exists." });
  assert.equal(failed.status, "failed");
  assert.equal(moment({ jobId: "j", status: "error", percent: 0, stage: "error", error: "Cancelled." }).status, "cancelled");
});

test("moments: a render a restart stopped is failed and says what to do; no render is failed too", () => {
  const stopped = moment({ jobId: "j", status: "interrupted", percent: 40, stage: "drawing" });
  assert.equal(stopped.status, "failed");
  assert.match(stopped.error, /restarted.*moments_render/);
  const none = moment(null);
  assert.equal(none.status, "failed");
  assert.match(none.error, /moments_render/);
});

test("lyric_render: with the owner's output folder the path is absolute and the url stays the /outputs link (#121)", () => {
  const outputDir = path.resolve("/srv/users/u1/outputs");
  const done = NORMALISERS.lyric_render.normalise({ job: { jobId: "j9", status: "done", progress: 100, file: "lyric-9.mp4" } }, { outputUrl: toUrl, outputDir });
  assert.deepEqual(done.output, { url: `${BASE}/outputs/lyric-9.mp4`, path: path.join(outputDir, "lyric-9.mp4") });
});

test("lyric_render is the kind that asks its callers for the owner's output folder", () => {
  assert.equal(NORMALISERS.lyric_render.needsOutputDir, true);
});
