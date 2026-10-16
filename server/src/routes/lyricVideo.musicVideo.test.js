// server/src/routes/lyricVideo.musicVideo.test.js
// AI music videos: POST /:id/to-story and POST /:id/use-story-video (super admins only).
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import { createLyricVideoRouter } from "./lyricVideo.js";
import { readProject, writeProject, createProject, applySheet } from "../lib/lyricVideo/projectStore.js";
import { readProject as readStory, writeProject as writeStory, createProject as createStory } from "../lib/story/projectStore.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/story/sceneSegmenter.js";
import { planMusicScenes } from "../lib/musicVideo/scenePlan.js";
import { anchorFor } from "../lib/story/styleAnchors.js";

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

let root;
let server;
let base;
let ctx;
let savedKey;
// What the Story seam was asked to do; startStoryImages is always stubbed here.
const seen = { started: [], created: [] };
let realCreate = true;

const userCtx = (name, isSuperAdmin = true) => {
  const dataDir = path.join(root, name);
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir, { recursive: true });
  return { userId: name, dataDir, outputDir, plan: "premium", isSuperAdmin };
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-mv-"));
  ctx = userCtx("admin");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  const { createStoryFromScenes } = await import("./story.js");
  app.use("/api/lyric-video", createLyricVideoRouter({
    story: {
      createStoryFromScenes: (c, opts) => {
        seen.created.push({ ctx: c, opts });
        return realCreate ? createStoryFromScenes(c, opts) : { projectId: `story-${seen.created.length}` };
      },
      startStoryImages: (c, id, opts) => { seen.started.push({ ctx: c, id, before: opts?.before }); return Promise.resolve(); },
    },
  }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/lyric-video`;
});
after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  seen.started = [];
  seen.created = [];
  realCreate = true;
  ctx = userCtx("admin");
  savedKey = process.env.BYTEPLUS_ARK_API_KEY;
  delete process.env.BYTEPLUS_ARK_API_KEY;
  // Never the network: by default the prompt call fails and the plain prompts are used.
  _setLlmImpl(async () => { throw new Error("no LLM in tests"); });
});
afterEach(() => {
  _resetLlmImpl();
  if (savedKey === undefined) delete process.env.BYTEPLUS_ARK_API_KEY; else process.env.BYTEPLUS_ARK_API_KEY = savedKey;
});

const call = async (method, url, body) => {
  const r = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, text }; }
};

const SHEET = "[VERSE 1]\nwe walk by faith\nnot by sight\n[CHORUS]\ngrace beyond the race\ngrace beyond the race";

/** A timed song: verse at 0 s, chorus at 12 s, four lines, 24 s long. */
function timedProject(c, { timed = true } = {}) {
  let p = createProject(c.dataDir, { title: "Grace Beyond the Race", artist: "Sthill Waters" });
  p = applySheet(p, SHEET);
  const starts = [1, 6, 12.5, 18];
  const lines = p.lines.map((l, i) => {
    if (!timed) return l;
    const s = starts[i];
    const [w1, ...rest] = l.text.split(" ");
    return { ...l, start: s, end: s + 4, words: [{ text: w1, start: s, end: s + 1 }, { text: rest.join(" "), start: s + 1, end: s + 4 }] };
  });
  const sections = p.sections.map((s, i) => (timed ? { ...s, start: i === 0 ? 0 : 12 } : s));
  // Named as a song taken out of a video, which this feature deletes with the song.
  const songFile = path.join(c.outputDir, "lyric-song-0a1b2c.m4a");
  fs.writeFileSync(songFile, "x");
  return writeProject(c.dataDir, {
    ...p, lines, sections,
    song: { file: songFile, durationSec: 24, coverStill: null },
    timing: timed ? { status: "done", audibleEnd: 23.5 } : { status: "idle" },
  });
}

describe("POST /:id/to-story", () => {
  test("is for super admins only", async () => {
    const p = timedProject(ctx);
    ctx = { ...ctx, isSuperAdmin: false };
    const r = await call("POST", `/${p.projectId}/to-story`, {});
    assert.equal(r.status, 403);
    assert.equal(seen.created.length, 0);
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo, undefined);
  });

  test("refuses a song with no timed lines", async () => {
    const p = timedProject(ctx, { timed: false });
    const r = await call("POST", `/${p.projectId}/to-story`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "Run Timing first.");
    assert.equal(seen.created.length, 0);
  });

  test("refuses while timing runs, and refuses a bad shape, character or quality", async () => {
    const p = timedProject(ctx);
    for (const body of [{ aspect: "round" }, { character: 7 }, { aiMotion: "yes" }, { quality: "ultra" }, { character: "x".repeat(301) }]) {
      assert.equal((await call("POST", `/${p.projectId}/to-story`, body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal((await call("POST", "/lv_nope/to-story", {})).status, 404);
    assert.equal(seen.created.length, 0);
  });

  test("builds the Story project from the song's sections and starts its pictures", async () => {
    process.env.BYTEPLUS_ARK_API_KEY = "ark-test";
    const p = timedProject(ctx);
    const r = await call("POST", `/${p.projectId}/to-story`, { aspect: "landscape", aiMotion: true, quality: "high" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    const id = r.json.storyProjectId;
    const story = readStory(ctx.dataDir, id);
    assert.equal(story.title, "Grace Beyond the Race · music video");
    assert.equal(story.style, "music-video");
    assert.equal(story.aspect, "landscape");
    assert.equal(story.captions, "none");
    assert.equal(story.music, null);
    assert.equal(story.status, "generating_images");
    assert.equal(story.source.durationMs, 24000);
    assert.equal(path.dirname(story.source.audioPath), path.join(ctx.outputDir, "story", id), "the Story project plays its own copy of the song");
    assert.equal(fs.readFileSync(story.source.audioPath, "utf8"), "x");
    assert.deepEqual(story.aiMotion, { quality: "high", autoStartedAt: null, note: null });
    // Seconds become milliseconds, word by word, in order.
    assert.deepEqual(story.transcript.words.slice(0, 2), [{ text: "we", startMs: 1000, endMs: 2000 }, { text: "walk by faith", startMs: 2000, endMs: 5000 }]);
    assert.equal(story.transcript.words.length, 8);
    const plan = planMusicScenes({ sections: p.sections, lines: p.lines, durationSec: 24 });
    assert.deepEqual(story.scenes.map((s) => [s.startMs, s.endMs, s.imageStatus]), plan.map((s) => [s.startMs, s.endMs, "pending"]));
    assert.equal(story.scenes[story.scenes.length - 1].endMs, 24000, "the scenes cover the whole song file, quiet tail included");
    // The prompt call failed in this test: every scene got the plain prompt, with the style anchor.
    assert.equal(story.scenes[0].imagePrompt, `cinematic music video shot, VERSE 1: we walk by faith, ${anchorFor("music-video")}`);
    assert.equal(seen.started.length, 1);
    assert.deepEqual(seen.started[0].ctx, { dataDir: ctx.dataDir, outputDir: ctx.outputDir });
    assert.equal(seen.started[0].id, id);
    assert.equal(typeof seen.started[0].before, "function", "the pictures wait for the prompts");
  });

  test("records the link on the lyric project", async () => {
    const p = timedProject(ctx);
    const r = await call("POST", `/${p.projectId}/to-story`, {});
    const link = readProject(ctx.dataDir, p.projectId).musicVideo;
    assert.equal(link.storyProjectId, r.json.storyProjectId);
    assert.ok(!Number.isNaN(Date.parse(link.createdAt)));
    assert.equal((await call("GET", `/${p.projectId}`)).json.project.musicVideo.storyProjectId, r.json.storyProjectId);
  });

  test("AI motion is off unless asked for, and needs the Seedance key", async () => {
    const p = timedProject(ctx);
    const off = await call("POST", `/${p.projectId}/to-story`, {});
    assert.equal(readStory(ctx.dataDir, off.json.storyProjectId).aiMotion, null);
    const noKey = await call("POST", `/${p.projectId}/to-story`, { aiMotion: true, again: true });
    assert.equal(readStory(ctx.dataDir, noKey.json.storyProjectId).aiMotion, null);
    assert.equal(seen.created[1].opts.aiMotion.quality, "standard");
  });

  test("the character and the LLM prompts reach the scenes", async () => {
    const man = "a young Black African man in his late twenties, short hair, plain olive shirt";
    const p = timedProject(ctx);
    const plan = planMusicScenes({ sections: p.sections, lines: p.lines, durationSec: 24 });
    let asked = "";
    _setLlmImpl(async (prompt) => { asked = prompt; return JSON.stringify({ prompts: plan.map((_, i) => `shot ${i + 1}`) }); });
    const r = await call("POST", `/${p.projectId}/to-story`, { character: `  ${man}  ` });
    await seen.started[0].before();
    assert.ok(asked.includes(man));
    assert.match(asked, /Grace Beyond the Race/);
    const story = readStory(ctx.dataDir, r.json.storyProjectId);
    assert.deepEqual(story.scenes.map((s) => s.imagePrompt), plan.map((_, i) => `shot ${i + 1}, ${anchorFor("music-video")}`));
  });

  test("answers at once with the plain prompts, without waiting for the LLM", async () => {
    let asked = 0;
    _setLlmImpl(() => { asked += 1; return new Promise(() => {}); }); // never answers
    const p = timedProject(ctx);
    const started = Date.now();
    const r = await call("POST", `/${p.projectId}/to-story`, {});
    assert.equal(r.status, 200);
    assert.ok(Date.now() - started < 2000, "the answer did not wait on the prompt call");
    assert.equal(asked, 0, "the prompt call runs after the answer, in the step before the pictures");
    const story = readStory(ctx.dataDir, r.json.storyProjectId);
    assert.equal(story.status, "generating_images", "the Story page shows it working");
    assert.ok(story.scenes.every((s) => s.imagePrompt.startsWith("cinematic music video shot")));
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo.storyProjectId, r.json.storyProjectId);
  });

  test("the LLM's prompts replace the plain ones afterwards, but never a prompt the user edited", async () => {
    const p = timedProject(ctx);
    const plan = planMusicScenes({ sections: p.sections, lines: p.lines, durationSec: 24 });
    _setLlmImpl(async () => JSON.stringify({ prompts: plan.map((_, i) => `shot ${i + 1}`) }));
    const r = await call("POST", `/${p.projectId}/to-story`, {});
    const id = r.json.storyProjectId;
    const story = readStory(ctx.dataDir, id);
    writeStory(ctx.dataDir, { ...story, scenes: story.scenes.map((s, i) => (i === 1 ? { ...s, imagePrompt: "my own", promptEditedByUser: true } : s)) });
    await seen.started[0].before();
    const after = readStory(ctx.dataDir, id).scenes;
    assert.equal(after[0].imagePrompt, `shot 1, ${anchorFor("music-video")}`);
    assert.equal(after[1].imagePrompt, "my own");
  });

  test("when the LLM fails the plain prompts stay, and the step still ends so the pictures start", async () => {
    _setLlmImpl(async () => { throw new Error("down"); });
    const p = timedProject(ctx);
    const r = await call("POST", `/${p.projectId}/to-story`, {});
    const before = readStory(ctx.dataDir, r.json.storyProjectId).scenes.map((s) => s.imagePrompt);
    await seen.started[0].before(); // resolves: startStoryImages then makes the pictures
    assert.deepEqual(readStory(ctx.dataDir, r.json.storyProjectId).scenes.map((s) => s.imagePrompt), before);
  });

  test("confines nothing new: the Story plays the lyric project's own song, whatever the body says", async () => {
    const p = timedProject(ctx);
    realCreate = false;
    const r = await call("POST", `/${p.projectId}/to-story`, { audioPath: "/etc/passwd", path: "/etc/passwd", song: { file: "/etc/passwd" } });
    assert.equal(r.status, 200);
    assert.equal(seen.created[0].opts.audioPath, p.song.file);
  });

  test("a missing song file is refused", async () => {
    const p = timedProject(ctx);
    fs.rmSync(p.song.file);
    assert.equal((await call("POST", `/${p.projectId}/to-story`, {})).status, 409);
    assert.equal(seen.created.length, 0);
  });

  test("deleting the song project leaves the Story project's soundtrack in place", async () => {
    const p = timedProject(ctx);
    const id = (await call("POST", `/${p.projectId}/to-story`, {})).json.storyProjectId;
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 200);
    assert.equal(fs.existsSync(p.song.file), false, "the lyric project's own extracted song is gone");
    assert.equal(fs.existsSync(readStory(ctx.dataDir, id).source.audioPath), true);
  });

  test("replacing the song leaves the Story project's soundtrack in place", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    const id = (await call("POST", `/${p.projectId}/to-story`, {})).json.storyProjectId;
    const next = path.join(ctx.outputDir, "new-song.wav");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2", next]);
    assert.equal((await call("POST", `/${p.projectId}/song`, { path: next })).status, 200);
    assert.equal(fs.existsSync(p.song.file), false, "the old extracted song was removed");
    assert.equal(fs.existsSync(readStory(ctx.dataDir, id).source.audioPath), true);
  });

  test("a second call is refused as already made, unless the body says again", async () => {
    const p = timedProject(ctx);
    const first = (await call("POST", `/${p.projectId}/to-story`, {})).json.storyProjectId;
    const refused = await call("POST", `/${p.projectId}/to-story`, {});
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "ALREADY_MADE");
    assert.match(refused.json.error, /already/i);
    assert.equal(seen.created.length, 1, "no second project, no spend");
    assert.equal((await call("POST", `/${p.projectId}/to-story`, { again: "yes" })).status, 400);
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo.storyProjectId, first);
  });

  test("a link to a Story project that was deleted does not count as already made", async () => {
    const p = timedProject(ctx);
    const first = (await call("POST", `/${p.projectId}/to-story`, {})).json.storyProjectId;
    fs.rmSync(path.join(ctx.dataDir, "story-projects", `${first}.json`));
    assert.equal((await call("POST", `/${p.projectId}/to-story`, {})).status, 200);
  });

  test("with again, a second call makes a second Story project, and the link points at the newest", async () => {
    const p = timedProject(ctx);
    const first = (await call("POST", `/${p.projectId}/to-story`, {})).json.storyProjectId;
    const second = (await call("POST", `/${p.projectId}/to-story`, { again: true })).json.storyProjectId;
    assert.notEqual(first, second);
    assert.ok(readStory(ctx.dataDir, first));
    assert.ok(readStory(ctx.dataDir, second));
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo.storyProjectId, second);
  });
});


/** A Story project linked to the lyric project, rendered (a real tiny mp4) or not. */
function linkedStory(c, p, { rendered }) {
  const story = createStory(c.dataDir, { title: "mv", style: "music-video" });
  let render = { jobId: null, outputPath: null, status: null };
  if (rendered) {
    const out = path.join(c.outputDir, "story", story.projectId, "video.mp4");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=1", "-pix_fmt", "yuv420p", out]);
    render = { jobId: "j1", outputPath: out, status: "done" };
  }
  writeStory(c.dataDir, { ...story, status: rendered ? "done" : "ready_to_render", render });
  writeProject(c.dataDir, { ...readProject(c.dataDir, p.projectId), musicVideo: { storyProjectId: story.projectId, createdAt: new Date().toISOString() } });
  return { ...story, render };
}

describe("POST /:id/use-story-video", () => {
  test("is for super admins only", async () => {
    const p = timedProject(ctx);
    ctx = { ...ctx, isSuperAdmin: false };
    assert.equal((await call("POST", `/${p.projectId}/use-story-video`, {})).status, 403);
  });

  test("refuses when no Story project is linked, or its video is not rendered", async () => {
    const p = timedProject(ctx);
    const none = await call("POST", `/${p.projectId}/use-story-video`, {});
    assert.equal(none.status, 409);
    assert.equal(none.json.error, "Render the music video in Story Video first.");
    linkedStory(ctx, p, { rendered: false });
    const unrendered = await call("POST", `/${p.projectId}/use-story-video`, {});
    assert.equal(unrendered.status, 409);
    assert.equal(unrendered.json.error, "Render the music video in Story Video first.");
    assert.equal(readProject(ctx.dataDir, p.projectId).background, null);
  });

  test("a finished render outside your outputs is refused like any background", async () => {
    const p = timedProject(ctx);
    const story = linkedStory(ctx, p, { rendered: false });
    writeStory(ctx.dataDir, { ...readStory(ctx.dataDir, story.projectId), status: "done", render: { jobId: "j", outputPath: "/etc/passwd", status: "done" } });
    assert.equal((await call("POST", `/${p.projectId}/use-story-video`, {})).status, 400);
    assert.equal(readProject(ctx.dataDir, p.projectId).background, null);
  });

  const LYRIC_BG = /^lyric-bg-[0-9a-f-]+\.mp4$/;

  test("puts a copy of the finished Story video on as the background, fit auto, so a re-render in Story cannot change it", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    const story = linkedStory(ctx, p, { rendered: true });
    const r = await call("POST", `/${p.projectId}/use-story-video`, {});
    assert.equal(r.status, 200);
    const bg = r.json.project.background;
    assert.equal(bg.kind, "video");
    assert.equal(bg.fit, "auto");
    assert.equal(path.dirname(bg.file), fs.realpathSync(ctx.outputDir), "the copy is the song's own, in the user's outputs");
    assert.match(path.basename(bg.file), LYRIC_BG);
    assert.notEqual(bg.file, fs.realpathSync(story.render.outputPath));
    assert.deepEqual(fs.readFileSync(bg.file), fs.readFileSync(story.render.outputPath));
    assert.deepEqual(readProject(ctx.dataDir, p.projectId).background, bg);
    // Story renders again over its own file: the lyric background does not move.
    const copied = fs.readFileSync(bg.file);
    fs.writeFileSync(story.render.outputPath, "re-rendered");
    assert.deepEqual(fs.readFileSync(bg.file), copied);
  });

  test("using it again replaces the earlier copy, which is deleted", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    linkedStory(ctx, p, { rendered: true });
    const first = (await call("POST", `/${p.projectId}/use-story-video`, {})).json.project.background.file;
    const second = (await call("POST", `/${p.projectId}/use-story-video`, {})).json.project.background.file;
    assert.notEqual(first, second);
    assert.equal(fs.existsSync(first), false, "the earlier copy is gone");
    assert.equal(fs.existsSync(second), true);
  });

  test("a background of the user's own is never deleted when the copy replaces it", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    const own = path.join(ctx.outputDir, "my-background.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=1", "-pix_fmt", "yuv420p", own]);
    assert.equal((await call("PUT", `/${p.projectId}/background`, { path: own })).status, 200);
    linkedStory(ctx, p, { rendered: true });
    assert.equal((await call("POST", `/${p.projectId}/use-story-video`, {})).status, 200);
    assert.equal(fs.existsSync(own), true);
  });

  test("choosing another background, or deleting the song, removes the copy", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    linkedStory(ctx, p, { rendered: true });
    const copy = (await call("POST", `/${p.projectId}/use-story-video`, {})).json.project.background.file;
    assert.equal((await call("PUT", `/${p.projectId}/background`, { path: null })).status, 200);
    assert.equal(fs.existsSync(copy), false);
    const again = (await call("POST", `/${p.projectId}/use-story-video`, {})).json.project.background.file;
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 200);
    assert.equal(fs.existsSync(again), false);
  });

  test("the copy is recorded on the song, and making another music video keeps the record", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    linkedStory(ctx, p, { rendered: true });
    const copy = (await call("POST", `/${p.projectId}/use-story-video`, {})).json.project.background.file;
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo.backgroundCopy, copy);
    assert.equal((await call("POST", `/${p.projectId}/to-story`, { again: true })).status, 200);
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo.backgroundCopy, copy);
    assert.equal((await call("PUT", `/${p.projectId}/background`, { path: null })).status, 200);
    assert.equal(fs.existsSync(copy), false, "the recorded copy is deleted when replaced");
    assert.equal(readProject(ctx.dataDir, p.projectId).musicVideo.backgroundCopy ?? null, null);
  });

  test("a file that only looks like a copy (same name pattern, not made here) is never deleted", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    const lookalike = path.join(ctx.outputDir, "lyric-bg-0123abcd.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=1", "-pix_fmt", "yuv420p", lookalike]);
    assert.equal((await call("PUT", `/${p.projectId}/background`, { path: lookalike })).status, 200);
    linkedStory(ctx, p, { rendered: true });
    assert.equal((await call("POST", `/${p.projectId}/use-story-video`, {})).status, 200);
    assert.equal(fs.existsSync(lookalike), true, "replaced by the copy, but not deleted");
    assert.equal((await call("PUT", `/${p.projectId}/background`, { path: lookalike })).status, 200);
    assert.equal((await call("DELETE", `/${p.projectId}`)).status, 200);
    assert.equal(fs.existsSync(lookalike), true, "deleting the song leaves it too");
  });
});

describe("replacing the song resets its music video link", () => {
  test("the old song's Story project is no longer linked, so the next one is not a repeat and its render cannot be attached", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const p = timedProject(ctx);
    const story = linkedStory(ctx, p, { rendered: true });
    const copy = (await call("POST", `/${p.projectId}/use-story-video`, {})).json.project.background.file;
    const next = path.join(ctx.outputDir, "new-song.wav");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2", next]);
    assert.equal((await call("POST", `/${p.projectId}/song`, { path: next })).status, 200);
    const after = readProject(ctx.dataDir, p.projectId);
    assert.equal(after.musicVideo.storyProjectId ?? null, null, "the link to the old song's video is gone");
    assert.equal(after.musicVideo.createdAt ?? null, null);
    assert.equal(after.musicVideo.backgroundCopy, copy, "the copy this song owns is still recorded, so it is still cleaned up");
    assert.ok(readStory(ctx.dataDir, story.projectId), "the Story project itself is left alone");
    const use = await call("POST", `/${p.projectId}/use-story-video`, {});
    assert.equal(use.status, 409);
    assert.equal(use.json.error, "Render the music video in Story Video first.");
    // Timed again for the new song: a music video for it is a first one, not a repeat.
    const retimed = timedProject(ctx);
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, p.projectId), lines: retimed.lines, sections: retimed.sections, song: retimed.song });
    assert.equal((await call("POST", `/${p.projectId}/to-story`, {})).status, 200);
    assert.equal((await call("PUT", `/${p.projectId}/background`, { path: null })).status, 200);
    assert.equal(fs.existsSync(copy), false, "the recorded copy is still deleted when replaced");
  });
});
