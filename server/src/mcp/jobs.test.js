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

const scene = (id, fields) => ({ id, imageStatus: "done", imagePath: `/srv/genImg/p1/${id}.png`, ...fields });

test("story: pre-render statuses are running with the status as phase", () => {
  const making = [scene("s1", { imageStatus: "generating" })];
  for (const [status, scenes] of [["transcribing", []], ["segmenting", []], ["generating_images", making]]) {
    const handle = NORMALISERS.story.normalise({ ok: true, project: { projectId: "p1", status, error: null, scenes } }, { outputUrl: toUrl });
    assert.equal(handle.status, "running", status);
    assert.equal(handle.phase, status);
    assert.equal(handle.percent, null);
  }
});

test("story: an idle draft reads done, not running", () => {
  for (const status of ["draft", "draft_script"]) {
    const handle = NORMALISERS.story.normalise({ project: { projectId: "p1", status, error: null } }, { outputUrl: toUrl });
    assert.equal(handle.status, "done", status);
    assert.equal(handle.phase, status);
    assert.equal(handle.output, null);
  }
});

test("story: generating_images with no scene being made reads done, with the phase the scenes say", () => {
  const read = (scenes) => NORMALISERS.story.normalise({ project: { projectId: "p1", status: "generating_images", scenes } }, { outputUrl: toUrl });
  const segmented = read([scene("s1", { imageStatus: "pending", imagePath: null }), scene("s2", { imageStatus: "pending", imagePath: null })]);
  assert.equal(segmented.status, "done");
  assert.equal(segmented.phase, "needs_images");
  assert.equal(read([scene("s1"), scene("s2", { imageStatus: "pending", imagePath: null })]).phase, "needs_images");
  assert.equal(read([scene("s1"), scene("s2")]).phase, "ready_to_render");
  assert.equal(read([]).phase, "no_scenes");
});

test("story: pictures about to start by themselves (preparing) keep running", () => {
  const payload = { project: { projectId: "p1", status: "generating_images", scenes: [scene("s1", { imageStatus: "pending" })] }, preparing: true };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "running");
  assert.equal(handle.phase, "preparing");
});

test("story: ready_to_render is done (the pictures step finished) with no video yet", () => {
  const payload = { project: { projectId: "p1", status: "ready_to_render", error: null, scenes: [scene("s1"), scene("s2")] } };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.deepEqual(handle, { kind: "story", id: "p1", status: "done", percent: 100, phase: "ready_to_render", output: null, error: null });
});

test("story: images that stopped with failed scenes are failed, with the first reason", () => {
  const payload = {
    project: {
      projectId: "p1",
      status: "generating_images",
      scenes: [scene("s1"), scene("s2", { imageStatus: "error", imageError: "Daily free image quota used up." }), scene("s3", { imageStatus: "error", imageError: "x" })],
    },
  };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "failed");
  assert.equal(handle.phase, "generating_images");
  assert.equal(handle.error, "2 of 3 scenes have no picture: Daily free image quota used up.");
});

test("story: images still being made keep running; failed scenes beside pending ones read failed", () => {
  const making = { project: { projectId: "p1", status: "generating_images", scenes: [scene("s1"), scene("s2", { imageStatus: "generating" })] } };
  assert.equal(NORMALISERS.story.normalise(making, { outputUrl: toUrl }).status, "running");
  const stopped = { project: { projectId: "p1", status: "generating_images", scenes: [scene("s1", { imageStatus: "pending" }), scene("s2", { imageStatus: "error", imageError: "quota" })] } };
  const handle = NORMALISERS.story.normalise(stopped, { outputUrl: toUrl });
  assert.equal(handle.status, "failed");
  assert.equal(handle.error, "1 of 2 scenes have no picture: quota");
});

test("story: AI motion in flight keeps a ready project running as animating, with counts", () => {
  const payload = {
    project: {
      projectId: "p1",
      status: "ready_to_render",
      scenes: [
        scene("s1", { aiVideoStatus: "done" }),
        scene("s2", { aiVideoStatus: "generating" }),
        scene("s3", { aiVideoStatus: "queued" }),
        scene("s4", { aiVideoStatus: "error", aiVideoError: "provider said no" }),
        scene("s5"),
      ],
    },
  };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "running");
  assert.equal(handle.phase, "animating");
  assert.deepEqual(handle.animation, { queued: 1, generating: 1, done: 1, failed: 1 });
});

test("story: finished AI motion reports its counts and the project's own status", () => {
  const payload = {
    project: {
      projectId: "p1",
      status: "done",
      render: { outputPath: "/srv/outputs/story/p1/video.mp4" },
      scenes: [scene("s1", { aiVideoStatus: "done" }), scene("s2", { aiVideoStatus: "none" })],
    },
  };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "done");
  assert.deepEqual(handle.animation, { queued: 0, generating: 0, done: 1, failed: 0 });
});

test("story: a render in progress stays the render even while clips are in flight", () => {
  const payload = {
    project: { projectId: "p1", status: "rendering", render: { percent: 30 }, scenes: [scene("s1", { aiVideoStatus: "generating" })] },
  };
  const handle = NORMALISERS.story.normalise(payload, { outputUrl: toUrl });
  assert.equal(handle.status, "running");
  assert.equal(handle.phase, "rendering");
  assert.equal(handle.percent, 30);
});

test("story: a cancelled project reads cancelled", () => {
  const handle = NORMALISERS.story.normalise({ project: { projectId: "p1", status: "error", error: "Cancelled." } }, { outputUrl: toUrl });
  assert.equal(handle.status, "cancelled");
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

// ---- ambient ----

const amb = (fields = {}, extra = {}) => ({ ok: true, project: { projectId: "a1", status: "draft", error: null, drops: [], movements: [], render: { jobId: null, outputPath: null, status: "idle", percent: 0, phase: "" }, ...fields }, ...extra });
const ambient = (payload) => NORMALISERS.ambient.normalise(payload, { outputUrl: toUrl });

test("ambient: the status route is the project", () => {
  assert.equal(NORMALISERS.ambient.route("a1"), "/api/ambient/a1");
});

test("ambient: voicing and images are running with the stage as phase; images report the share of pictures in", () => {
  const voicing = ambient(amb({ status: "voicing" }));
  assert.deepEqual(voicing, { kind: "ambient", id: "a1", status: "running", percent: null, phase: "voicing", output: null, error: null });
  const movements = [{ imageStatus: "done" }, { imageStatus: "generating" }, { imageStatus: "generating" }, { imageStatus: "error" }];
  const images = ambient(amb({ status: "generating_images", movements }));
  assert.equal(images.status, "running");
  assert.equal(images.phase, "generating_images");
  assert.equal(images.percent, 50);
});

test("ambient: assembling and rendering read the render's percent and phase", () => {
  const assembling = ambient(amb({ status: "assembling", render: { jobId: "j", status: "running", percent: 0, phase: "waiting for another job to finish" } }));
  assert.deepEqual(assembling, { kind: "ambient", id: "a1", status: "running", percent: 0, phase: "waiting for another job to finish", output: null, error: null });
  const rendering = ambient(amb({ status: "rendering", render: { jobId: "j", status: "running", percent: 37, phase: "rendering" } }));
  assert.equal(rendering.status, "running");
  assert.equal(rendering.percent, 37);
  assert.equal(rendering.phase, "rendering");
});

test("ambient: ready_to_render and a quiet draft are done (the step is over) with no video", () => {
  const ready = ambient(amb({ status: "ready_to_render", render: { outputPath: "/srv/u/outputs/ambient/a1/video.mp4", status: "done" } }));
  assert.deepEqual(ready, { kind: "ambient", id: "a1", status: "done", percent: 100, phase: "ready_to_render", output: null, error: null });
  const draft = ambient(amb({ status: "draft", drops: [{ status: "pending" }] }));
  assert.equal(draft.status, "done");
  assert.equal(draft.phase, "draft");
  assert.equal(draft.output, null);
});

test("ambient: a draft left with unvoiced verses or missing pictures is failed, with the first reason", () => {
  const drops = [{ status: "done" }, { status: "error", error: "no verse text returned for \"Psalm 151\"" }, { status: "error", error: "x" }];
  const voice = ambient(amb({ status: "draft", drops }));
  assert.equal(voice.status, "failed");
  assert.equal(voice.phase, "draft");
  assert.equal(voice.error, "2 of 3 verses could not be voiced: no verse text returned for \"Psalm 151\"");
  const movements = [{ imageStatus: "done" }, { imageStatus: "error", imageError: "quota" }];
  const images = ambient(amb({ status: "draft", movements }));
  assert.equal(images.status, "failed");
  assert.equal(images.error, "1 of 2 pictures could not be made: quota");
});

test("ambient: a music-only session ignores its stored verses", () => {
  const handle = ambient(amb({ status: "draft", words: "none", drops: [{ status: "error", error: "x" }] }));
  assert.equal(handle.status, "done");
});

test("ambient: done carries the video under the session's own folder", () => {
  const handle = ambient(amb({ status: "done", render: { jobId: "j", outputPath: "/srv/u/outputs/ambient/a1/video.mp4", status: "done", percent: 100, phase: "" } }));
  assert.equal(handle.status, "done");
  assert.equal(handle.percent, 100);
  assert.deepEqual(handle.output, { url: `${BASE}/outputs/ambient/a1/video.mp4`, path: "/srv/u/outputs/ambient/a1/video.mp4" });
});

test("ambient: a cancel reads cancelled and an error reads failed", () => {
  assert.equal(ambient(amb({ status: "error", error: "Cancelled." })).status, "cancelled");
  const failed = ambient(amb({ status: "error", error: "ffmpeg exited 1: boom" }));
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "ffmpeg exited 1: boom");
});

test("ambient: work a server restart stopped reads failed, with how to start it again", () => {
  const handle = ambient(amb({ status: "rendering", render: { jobId: "j", status: "running", percent: 42, phase: "rendering" } }, { interrupted: true }));
  assert.equal(handle.status, "failed");
  assert.equal(handle.phase, "rendering");
  assert.equal(handle.percent, 42);
  assert.match(handle.error, /server restarted/);
  assert.match(handle.error, /ambient_cancel/);
  assert.match(handle.error, /ambient_render/);
  const images = ambient(amb({ status: "generating_images", movements: [{ imageStatus: "generating" }] }, { interrupted: true }));
  assert.equal(images.status, "failed");
  assert.match(images.error, /ambient_step/);
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

const STORY_RESTART = "This stopped when the server restarted. Call story_cancel, then story_process or story_render again.";

test("story: a step a restart stopped (interrupted) reads failed, saying what to do", () => {
  const busy = [
    [{ status: "rendering", render: { jobId: "j", status: "running", percent: 40 } }, "rendering"],
    [{ status: "transcribing" }, "transcribing"],
    [{ status: "segmenting" }, "segmenting"],
    [{ status: "generating_images", scenes: [scene("s1", { imageStatus: "generating" })] }, "generating_images"],
    [{ status: "ready_to_render", scenes: [scene("s1", { aiVideoStatus: "generating" })] }, "animating"],
  ];
  for (const [fields, phase] of busy) {
    const handle = NORMALISERS.story.normalise({ project: { projectId: "p1", ...fields }, interrupted: true }, { outputUrl: toUrl });
    assert.equal(handle.status, "failed", phase);
    assert.equal(handle.phase, phase);
    assert.equal(handle.error, STORY_RESTART);
  }
});

test("story: without the route's interrupted flag the same project keeps running", () => {
  const handle = NORMALISERS.story.normalise({ project: { projectId: "p1", status: "transcribing" } }, { outputUrl: toUrl });
  assert.equal(handle.status, "running");
});
