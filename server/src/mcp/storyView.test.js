import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  estimateSceneCount, missingImageCount, knownDurationMs, aiMotionRefusal, projectView, startedHandle, STORY_STYLES,
} from "./storyView.js";
import { STYLE_ANCHORS } from "../lib/story/styleAnchors.js";

const BASE = "http://host.test";

afterEach(() => { delete process.env.STORY_MAX_SCENES; });

test("STORY_STYLES are the app's style anchors", () => {
  assert.deepEqual([...STORY_STYLES].sort(), Object.keys(STYLE_ANCHORS).sort());
});

test("estimateSceneCount: about one scene per 8 s, at least one, at most the 60-scene cap", () => {
  assert.equal(estimateSceneCount(80_000), 10);
  assert.equal(estimateSceneCount(81_000), 11);
  assert.equal(estimateSceneCount(1_000), 1);
  assert.equal(estimateSceneCount(60 * 60 * 1000), 60);
  assert.equal(estimateSceneCount(0), 0);
});

test("estimateSceneCount follows the project's own scene policy and the server's cap", () => {
  assert.equal(estimateSceneCount(100_000, { targetSceneSec: 10 }), 10);
  assert.equal(estimateSceneCount(100_000, { maxScenes: 4 }), 4);
  process.env.STORY_MAX_SCENES = "20";
  assert.equal(estimateSceneCount(60 * 60 * 1000), 20);
  // The routes accept at most 60 as a scene limit, so the charge never passes it either.
  process.env.STORY_MAX_SCENES = "100";
  assert.equal(estimateSceneCount(60 * 60 * 1000), 60);
  assert.equal(estimateSceneCount(60 * 60 * 1000, { maxScenes: 90 }), 60);
});

test("missingImageCount counts scenes without a finished picture; force counts them all", () => {
  const project = { scenes: [{ imageStatus: "done", imagePath: "a" }, { imageStatus: "error" }, { imageStatus: "pending" }, { imageStatus: "done" }] };
  assert.equal(missingImageCount(project), 3);
  assert.equal(missingImageCount(project, { force: true }), 4);
  assert.equal(missingImageCount({}), 0);
});

test("knownDurationMs reads the transcript, then the source", () => {
  assert.equal(knownDurationMs({ transcript: { words: [{ startMs: 0, endMs: 900 }, { startMs: 900, endMs: 4200 }] } }), 4200);
  assert.equal(knownDurationMs({ transcript: { words: [] }, source: { durationMs: 3000 } }), 3000);
  assert.equal(knownDurationMs({ source: { durationMs: 0 } }), null);
});

test("aiMotionRefusal refuses a project that would start paid AI motion by itself", () => {
  assert.equal(aiMotionRefusal({ aiMotion: null }), null);
  assert.equal(aiMotionRefusal({ aiMotion: { quality: "standard", autoStartedAt: 123 } }), null);
  const refused = aiMotionRefusal({ aiMotion: { quality: "standard", autoStartedAt: null } });
  assert.equal(refused.structuredContent.error, "AI_MOTION_PROJECT");
});

test("projectView drops the transcript and gives scenes and the render as url and path", () => {
  const project = {
    projectId: "p1",
    title: "T",
    status: "done",
    error: null,
    style: "cinematic-bible",
    aspect: "portrait",
    captions: "kinetic",
    cast: ["moses"],
    music: { path: "library:calm", volume: 0.3, autoDuck: true },
    source: { audioPath: "/srv/outputs/u/a.mp3", durationMs: 9000 },
    transcript: { words: [{ text: "x", startMs: 0, endMs: 9000 }] },
    scenes: [
      { id: "scene-001", text: "In the beginning", startMs: 0, endMs: 9000, imagePrompt: "light", imageStatus: "done", imagePath: "/srv/outputs/genImg/p1/part-1.png", imageUrl: "/outputs/genImg/p1/part-1.png", aiVideoStatus: "done" },
    ],
    render: { jobId: "j", outputPath: "/srv/outputs/story/p1/video.mp4", status: "done" },
  };
  const view = projectView(project, BASE);
  assert.equal(view.transcript, undefined);
  assert.equal(view.id, "p1");
  assert.equal(view.durationMs, 9000);
  assert.equal(view.audioPath, "/srv/outputs/u/a.mp3");
  assert.deepEqual(view.scenes[0], {
    id: "scene-001", text: "In the beginning", startMs: 0, endMs: 9000, imagePrompt: "light",
    imageStatus: "done", imageError: null,
    image: { url: `${BASE}/outputs/genImg/p1/part-1.png`, path: "/srv/outputs/genImg/p1/part-1.png" },
    aiVideoStatus: "done",
  });
  assert.equal(view.job.kind, "story");
  assert.deepEqual(view.job.output, { url: `${BASE}/outputs/story/p1/video.mp4`, path: "/srv/outputs/story/p1/video.mp4" });
  assert.equal(view.scenesWithImage, 1);
});

test("startedHandle is a running story handle for the project", () => {
  assert.deepEqual(startedHandle("p1", "rendering"), {
    kind: "story", id: "p1", status: "running", percent: null, phase: "rendering", output: null, error: null,
  });
});
