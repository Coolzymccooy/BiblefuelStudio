import { test } from "node:test";
import assert from "node:assert/strict";
import { AMBIENT_ID, unvoicedCount, picturesToMake, projectView, startedHandle } from "./ambientView.js";

const BASE = "http://host.test";

const PROJECT = (fields = {}) => ({
  projectId: "a1", title: "Still Waters", theme: "rest", status: "draft", error: null,
  targetSec: 7200, aspect: "landscape", translation: "kjv", words: "verses", motion: "still",
  captions: "static", captionSpan: "section", captionPosition: "lower", captionPreset: "default", captionEnergy: "calm",
  bed: { mode: "assemble", trackRefs: ["library:peaceful-worship", "mylib:t1", "library:peaceful-worship"], filePath: null, volume: 0.85, crossfadeSec: 6, order: "shuffle", allowUncleared: false, builtOrder: null },
  drops: [], movements: [], published: [],
  render: { jobId: null, outputPath: null, status: "idle", percent: 0, phase: "" },
  ...fields,
});

test("AMBIENT_ID accepts the store's ids and refuses anything that could leave the route path", () => {
  assert.equal(AMBIENT_ID.safeParse("0b7c6f1e-4a2d-4c1e-9f00-1234567890ab").success, true);
  for (const bad of ["../x", "a/b", "a.b", "", "x".repeat(65)]) assert.equal(AMBIENT_ID.safeParse(bad).success, false, bad);
});

test("unvoicedCount counts the verses a voice run will speak", () => {
  const drops = [
    { status: "done", audioPath: "/a.mp3" },
    { status: "done", audioPath: null },
    { status: "pending" },
    { status: "error", error: "x" },
  ];
  assert.equal(unvoicedCount(PROJECT({ drops })), 3);
  assert.equal(unvoicedCount(PROJECT()), 0);
});

test("picturesToMake counts the missing pictures, all of them with force, or the one movement named", () => {
  const movements = [
    { id: "m1", imageStatus: "done", imagePath: "/p1.png" },
    { id: "m2", imageStatus: "done", imagePath: null },
    { id: "m3", imageStatus: "error" },
  ];
  assert.equal(picturesToMake(PROJECT({ movements })), 2);
  assert.equal(picturesToMake(PROJECT({ movements }), { force: true }), 3);
  assert.equal(picturesToMake(PROJECT({ movements }), { movementId: "m1" }), 1);
});

test("projectView shows the settings, verses, pictures and a job handle, without server-only fields", () => {
  const project = PROJECT({
    status: "done",
    drops: [{ id: "d1", atMs: 900000, reference: "Psalms 23:1-3", translation: "kjv", text: "The LORD is my shepherd", verses: ["v"], audioPath: "/srv/tts-1.mp3", durationMs: 9000, status: "done", error: null }],
    movements: [{ id: "m1", startMs: 0, endMs: 7200000, imageStatus: "done", imageError: null, imageSource: "generated", imagePath: "/srv/genImg/a.png", imageUrl: "/outputs/genImg/a.png", imagePrompt: "p" }],
    bed: { ...PROJECT().bed, builtOrder: [{ ref: "library:peaceful-worship", file: "/srv/music/01.mp3", startSec: 0, durationSec: 300, label: "Peaceful Worship", credit: "Music from Pixabay" }] },
    published: [{ videoId: "abcdefghijk", url: "https://youtu.be/abcdefghijk", privacyStatus: "private", publishAt: null, at: 1 }],
    render: { jobId: "j", outputPath: "/srv/u/outputs/ambient/a1/video.mp4", status: "done", percent: 100, phase: "" },
  });
  const view = projectView(project, BASE);
  assert.equal(view.id, "a1");
  assert.equal(view.targetSec, 7200);
  assert.deepEqual(view.captions, { mode: "static", span: "section", position: "lower", preset: "default", energy: "calm", seed: null });
  assert.deepEqual(view.bed.tracks, ["library:peaceful-worship", "mylib:t1"]);
  assert.deepEqual(view.bed.tracklist, [{ ref: "library:peaceful-worship", label: "Peaceful Worship", credit: "Music from Pixabay", startSec: 0, durationSec: 300 }]);
  assert.equal(view.bed.trackRefs, undefined);
  assert.deepEqual(view.drops, [{ id: "d1", atMs: 900000, reference: "Psalms 23:1-3", translation: "kjv", status: "done", error: null, text: "The LORD is my shepherd", durationMs: 9000 }]);
  assert.deepEqual(view.movements, [{ id: "m1", startMs: 0, endMs: 7200000, imageStatus: "done", imageError: null, imageSource: "generated", image: { url: `${BASE}/outputs/genImg/a.png`, path: "/srv/genImg/a.png" } }]);
  assert.equal(view.verses, 1);
  assert.equal(view.versesVoiced, 1);
  assert.equal(view.picturesDone, 1);
  assert.equal(view.published.length, 1);
  assert.equal(view.job.kind, "ambient");
  assert.equal(view.job.status, "done");
  assert.deepEqual(view.job.output, { url: `${BASE}/outputs/ambient/a1/video.mp4`, path: "/srv/u/outputs/ambient/a1/video.mp4" });
});

test("projectView passes a restart-stopped flag through to the handle", () => {
  const view = projectView(PROJECT({ status: "rendering", render: { jobId: "j", status: "running", percent: 10, phase: "rendering" } }), BASE, { interrupted: true });
  assert.equal(view.job.status, "failed");
  assert.equal(view.interrupted, true);
});

test("startedHandle is a running ambient handle", () => {
  assert.deepEqual(startedHandle("a1", "voicing"), { kind: "ambient", id: "a1", status: "running", percent: null, phase: "voicing", output: null, error: null });
});
