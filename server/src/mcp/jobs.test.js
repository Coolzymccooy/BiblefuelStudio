import { test } from "node:test";
import assert from "node:assert/strict";
import { NORMALISERS, outputUrl, waitForJob, clampTimeoutSec } from "./jobs.js";

const BASE = "https://biblefuel.tiwaton.co.uk";
const toUrl = (p) => outputUrl(p, BASE);

test("outputUrl mirrors the client mediaUrl", () => {
  assert.equal(outputUrl("", BASE), "");
  assert.equal(outputUrl(null, BASE), "");
  assert.equal(outputUrl("https://cdn.example.com/v.mp4", BASE), "https://cdn.example.com/v.mp4");
  assert.equal(outputUrl("data:video/mp4;base64,AA", BASE), "data:video/mp4;base64,AA");
  assert.equal(outputUrl("blob:abc", BASE), "blob:abc");
  assert.equal(outputUrl("/outputs/timeline/t.mp4", BASE), `${BASE}/outputs/timeline/t.mp4`);
  assert.equal(outputUrl("video-1.mp4", BASE), `${BASE}/outputs/video-1.mp4`);
  assert.equal(outputUrl("C:\\data\\outputs\\video-1.mp4", BASE), `${BASE}/outputs/video-1.mp4`);
  assert.equal(outputUrl("/srv/outputs-x/video-1.mp4", BASE), `${BASE}/outputs/video-1.mp4`);
  assert.equal(outputUrl("video-1.mp4", ""), "/outputs/video-1.mp4");
});

test("clampTimeoutSec clamps to 1..90 and defaults to 60", () => {
  assert.equal(clampTimeoutSec(500), 90);
  assert.equal(clampTimeoutSec(0), 1);
  assert.equal(clampTimeoutSec(-4), 1);
  assert.equal(clampTimeoutSec(12.7), 12);
  assert.equal(clampTimeoutSec(undefined), 60);
  assert.equal(clampTimeoutSec("abc"), 60);
});

test("routes are the live status endpoints", () => {
  assert.equal(NORMALISERS.job.route("job_1"), "/api/jobs/job_1");
  assert.equal(NORMALISERS.captioned.route("c1"), "/api/render/captioned-video-status/c1");
  assert.equal(NORMALISERS.story.route("p1"), "/api/story/p1");
  assert.equal(NORMALISERS.timeline.route("t1"), "/api/timeline/render/t1");
  assert.equal(NORMALISERS.instrumental.route("i1"), "/api/music/instrumental/i1");
  assert.equal(NORMALISERS.publish.route("y1"), "/api/social/youtube/publish/y1");
  assert.equal(NORMALISERS.job.route("a/b"), "/api/jobs/a%2Fb");
});

test("job: running with numeric progress", () => {
  const payload = { ok: true, job: { id: "job_1", type: "render_video", status: "running", progress: 42, createdAt: "t" } };
  const handle = NORMALISERS.job.normalise(payload, { outputUrl: toUrl });
  assert.deepEqual(handle, {
    kind: "job", id: "job_1", status: "running", percent: 42, phase: null, output: null, error: null,
  });
});

test("job: done maps result.videoUrl and result.outFile", () => {
  const payload = {
    ok: true,
    job: {
      id: "job_2", type: "render_video", status: "done", progress: 100,
      result: { outFile: "C:\\data\\outputs\\video-9.mp4", file: "C:\\data\\outputs\\video-9.mp4", videoUrl: "/outputs/video-9.mp4" },
    },
  };
  const handle = NORMALISERS.job.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "done");
  assert.equal(handle.percent, 100);
  assert.deepEqual(handle.output, { url: `${BASE}/outputs/video-9.mp4`, path: "C:\\data\\outputs\\video-9.mp4" });
});

test("job: waveform result has only outFile", () => {
  const payload = { ok: true, job: { id: "job_3", status: "done", progress: 100, result: { outFile: "/srv/outputs/waveform-1.mp4" } } };
  const handle = NORMALISERS.job.normalise(payload, { outputUrl: toUrl });
  assert.deepEqual(handle.output, { url: `${BASE}/outputs/waveform-1.mp4`, path: "/srv/outputs/waveform-1.mp4" });
});

test("job: failed carries the error and non-numeric progress is null", () => {
  const payload = { ok: true, job: { id: "job_4", status: "failed", progress: { step: "x" }, error: "ffmpeg exited 1" } };
  const handle = NORMALISERS.job.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "failed");
  assert.equal(handle.percent, null);
  assert.equal(handle.error, "ffmpeg exited 1");
  assert.equal(handle.output, null);
});

test("job: an object progress with a percent is read", () => {
  const payload = { ok: true, job: { id: "job_5", status: "running", progress: { percent: 30 } } };
  assert.equal(NORMALISERS.job.normalise(payload, { outputUrl: toUrl }).percent, 30);
});

test("captioned: running encoding", () => {
  const payload = { ok: true, jobId: "c1", status: "running", phase: "encoding", percent: 55, durationSec: 20, file: null, error: null };
  assert.deepEqual(NORMALISERS.captioned.normalise(payload, { outputUrl: toUrl }), {
    kind: "captioned", id: "c1", status: "running", percent: 55, phase: "encoding", output: null, error: null,
  });
});

test("captioned: done has the file", () => {
  const payload = { ok: true, jobId: "c1", status: "done", phase: "encoding", percent: 100, durationSec: 20, file: "captioned-1.mp4" };
  const handle = NORMALISERS.captioned.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "done");
  assert.deepEqual(handle.output, { url: `${BASE}/outputs/captioned-1.mp4`, path: "captioned-1.mp4" });
});

test("captioned: error maps to failed and a cancel maps to cancelled", () => {
  const failed = NORMALISERS.captioned.normalise({ jobId: "c2", status: "error", percent: 10, error: "ffmpeg crashed" }, { outputUrl: toUrl });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "ffmpeg crashed");
  const cancelled = NORMALISERS.captioned.normalise({ jobId: "c3", status: "error", error: "Render cancelled" }, { outputUrl: toUrl });
  assert.equal(cancelled.status, "cancelled");
  const interrupted = NORMALISERS.captioned.normalise({ jobId: "c4", status: "interrupted" }, { outputUrl: toUrl });
  assert.equal(interrupted.status, "failed");
});

test("story: pre-render statuses are running with the status as phase", () => {
  for (const status of ["transcribing", "segmenting", "generating_images", "ready_to_render"]) {
    const handle = NORMALISERS.story.normalise({ ok: true, project: { projectId: "p1", status, error: null } }, { outputUrl: toUrl });
    assert.equal(handle.status, "running", status);
    assert.equal(handle.phase, status);
    assert.equal(handle.percent, null);
  }
});

test("story: rendering reads render.percent", () => {
  const payload = { ok: true, project: { projectId: "p1", status: "rendering", render: { jobId: "j", outputPath: null, status: "running", percent: 61, phase: "encoding" } } };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.deepEqual(handle, { kind: "story", id: "p1", status: "running", percent: 61, phase: "encoding", output: null, error: null });
});

test("story: done carries render.outputPath", () => {
  const payload = { ok: true, project: { projectId: "p1", status: "done", error: null, render: { jobId: "j", outputPath: "/srv/outputs/story/p1/out.mp4", status: "done" } } };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "done");
  assert.equal(handle.percent, 100);
  assert.deepEqual(handle.output, { url: `${BASE}/outputs/story/p1/out.mp4`, path: "/srv/outputs/story/p1/out.mp4" });
});

test("story: two projects with the same file name get different urls", () => {
  const make = (projectId) => ({ project: { projectId, status: "done", render: { outputPath: `/srv/outputs/story/${projectId}/video.mp4` } } });
  const a = NORMALISERS.story.normalise(make("p1"), { outputUrl: toUrl });
  const b = NORMALISERS.story.normalise(make("p2"), { outputUrl: toUrl });
  assert.equal(a.output.url, `${BASE}/outputs/story/p1/video.mp4`);
  assert.equal(b.output.url, `${BASE}/outputs/story/p2/video.mp4`);
});

test("percent is clamped to 0..100", () => {
  const read = (progress) => NORMALISERS.job.normalise({ job: { id: "j", status: "running", progress } }, { outputUrl: toUrl }).percent;
  assert.equal(read(150), 100);
  assert.equal(read(-5), 0);
});

test("story: error maps to failed; unknown status is running with the raw phase", () => {
  const failed = NORMALISERS.story.normalise({ project: { projectId: "p1", status: "error", error: "render failed" } }, { outputUrl: toUrl });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "render failed");
  const odd = NORMALISERS.story.normalise({ project: { projectId: "p1", status: "narrating" } }, { outputUrl: toUrl });
  assert.equal(odd.status, "running");
  assert.equal(odd.phase, "narrating");
});

test("timeline: completed maps to done and prefers publicUrl", () => {
  const payload = {
    ok: true, jobId: "t1", status: "completed", progress: 100, phase: "done",
    publicUrl: "/outputs/timeline/t1.mp4", file: "/srv/outputs/timeline/t1.mp4", warnings: [], error: undefined,
  };
  const handle = NORMALISERS.timeline.normalise(payload, { outputUrl: toUrl });
  assert.deepEqual(handle, {
    kind: "timeline", id: "t1", status: "done", percent: 100, phase: "done",
    output: { url: `${BASE}/outputs/timeline/t1.mp4`, path: "/srv/outputs/timeline/t1.mp4" }, error: null,
  });
});

test("timeline: running and failed", () => {
  const running = NORMALISERS.timeline.normalise({ ok: true, jobId: "t2", status: "running", progress: 10, phase: "rendering" }, { outputUrl: toUrl });
  assert.equal(running.status, "running");
  assert.equal(running.percent, 10);
  const failed = NORMALISERS.timeline.normalise({ ok: true, jobId: "t3", status: "failed", progress: 100, phase: "failed", error: "No clips" }, { outputUrl: toUrl });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "No clips");
  assert.equal(failed.output, null);
});

test("instrumental: running then done with resultFile", () => {
  const running = NORMALISERS.instrumental.normalise(
    { ok: true, job: { jobId: "i1", status: "running", percent: 20, error: null, resultFile: null, track: null, where: "server", laptopOnline: false } },
    { outputUrl: toUrl },
  );
  assert.deepEqual(running, { kind: "instrumental", id: "i1", status: "running", percent: 20, phase: null, output: null, error: null });
  const done = NORMALISERS.instrumental.normalise(
    { ok: true, job: { jobId: "i1", status: "done", percent: 100, error: null, resultFile: "instrumental-i1.m4a", track: { id: "tr" }, where: "server", laptopOnline: false } },
    { outputUrl: toUrl },
  );
  assert.equal(done.status, "done");
  assert.deepEqual(done.output, { url: `${BASE}/outputs/instrumental-i1.m4a`, path: "instrumental-i1.m4a" });
});

test("instrumental: error maps to failed", () => {
  const handle = NORMALISERS.instrumental.normalise({ ok: true, job: { jobId: "i2", status: "error", percent: 5, error: "separator crashed" } }, { outputUrl: toUrl });
  assert.equal(handle.status, "failed");
  assert.equal(handle.error, "separator crashed");
});

test("publish: running, done with the YouTube url, and error", () => {
  const running = NORMALISERS.publish.normalise({ ok: true, job: { jobId: "y1", status: "running", startedAt: 1, finishedAt: null } }, { outputUrl: toUrl });
  assert.deepEqual(running, { kind: "publish", id: "y1", status: "running", percent: null, phase: null, output: null, error: null });
  const done = NORMALISERS.publish.normalise(
    { ok: true, job: { jobId: "y1", status: "done", result: { videoId: "abcdefghijk", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk", forcedPrivate: false } } },
    { outputUrl: toUrl },
  );
  assert.equal(done.status, "done");
  assert.equal(done.percent, 100);
  assert.deepEqual(done.output, { url: "https://www.youtube.com/watch?v=abcdefghijk", path: null });
  const failed = NORMALISERS.publish.normalise({ ok: true, job: { jobId: "y2", status: "error", error: "quota exceeded" } }, { outputUrl: toUrl });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "quota exceeded");
});

test("normalisers do not mutate the payload", () => {
  const payload = Object.freeze({ ok: true, job: Object.freeze({ id: "job_1", status: "done", result: Object.freeze({ outFile: "a.mp4" }) }) });
  assert.doesNotThrow(() => NORMALISERS.job.normalise(payload, { outputUrl: toUrl }));
});

/** A fake api that serves a scripted sequence of payloads, with a fake clock that sleep advances. */
function harness(payloads) {
  const calls = [];
  const sleeps = [];
  let time = 0;
  const api = {
    async call(method, path) {
      calls.push({ method, path });
      return payloads[Math.min(calls.length - 1, payloads.length - 1)];
    },
  };
  return {
    api, calls, sleeps,
    opts: {
      outputUrl: toUrl,
      now: () => time,
      sleep: async (ms) => { sleeps.push(ms); time += ms; },
    },
  };
}

test("waitForJob returns at the first terminal poll", async () => {
  const running = { ok: true, job: { id: "job_1", status: "running", progress: 10 } };
  const done = { ok: true, job: { id: "job_1", status: "done", progress: 100, result: { outFile: "v.mp4" } } };
  const h = harness([running, running, done]);
  const handle = await waitForJob(h.api, { kind: "job", id: "job_1", timeoutSec: 60, ...h.opts });
  assert.equal(handle.status, "done");
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.sleeps, [3000, 3000]);
  assert.equal(h.calls[0].path, "/api/jobs/job_1");
  assert.equal(h.calls[0].method, "GET");
});

test("waitForJob returns immediately when the first poll is terminal", async () => {
  const h = harness([{ ok: true, job: { id: "job_1", status: "failed", error: "boom" } }]);
  const handle = await waitForJob(h.api, { kind: "job", id: "job_1", ...h.opts });
  assert.equal(handle.status, "failed");
  assert.equal(h.sleeps.length, 0);
});

test("waitForJob returns the running handle at the timeout", async () => {
  const running = { ok: true, job: { id: "job_1", status: "running", progress: 10 } };
  const h = harness([running]);
  const handle = await waitForJob(h.api, { kind: "job", id: "job_1", timeoutSec: 1, ...h.opts });
  assert.equal(handle.status, "running");
  assert.equal(handle.percent, 10);
  assert.deepEqual(h.sleeps, [1000]);
  assert.equal(h.calls.length, 2);
});

test("waitForJob clamps an oversized timeout to 90 seconds", async () => {
  const h = harness([{ ok: true, job: { id: "job_1", status: "running" } }]);
  await waitForJob(h.api, { kind: "job", id: "job_1", timeoutSec: 500, ...h.opts });
  assert.equal(h.sleeps.reduce((a, b) => a + b, 0), 90000);
});

test("waitForJob stamps the id and projectId onto the handle", async () => {
  const h = harness([{ ok: true, jobId: "t1", status: "completed", progress: 100 }]);
  const handle = await waitForJob(h.api, { kind: "timeline", id: "t1", projectId: "proj_9", ...h.opts });
  assert.equal(handle.id, "t1");
  assert.equal(handle.projectId, "proj_9");
  assert.equal(handle.kind, "timeline");
});

test("waitForJob rejects an unknown kind", async () => {
  const h = harness([{}]);
  await assert.rejects(waitForJob(h.api, { kind: "nope", id: "x", ...h.opts }), (err) => err.code === "BAD_KIND");
});
