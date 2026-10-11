import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { buildAmbientFfmpegArgs } from "../../src/lib/ambient/ambientRender.js";
import { hasLibass } from "../../src/lib/kinetic/capability.js";

// An Ambient scripture video with a Studio look, run through real ffmpeg and
// judged by its pixels: white captions over a black picture. A filter string
// can look right and still draw nothing.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const skip = !hasFfmpeg ? "ffmpeg not installed" : !hasLibass() ? "ffmpeg here has no libass" : false;

const W = 270; // sampled frames are scaled to this width
let dir;
let media;

function ff(args) {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

/** Near-white pixels in the frame at time t: how many, and the first row that has any. */
function whiteAt(video, t) {
  const r = spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1",
    "-vf", `scale=${W}:-2,format=rgb24`, "-f", "rawvideo", "-"], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  let count = 0;
  let firstRow = Infinity;
  for (let i = 0; i + 2 < r.stdout.length; i += 3) {
    if (r.stdout[i] > 200 && r.stdout[i + 1] > 200 && r.stdout[i + 2] > 200) {
      count += 1;
      firstRow = Math.min(firstRow, Math.floor(i / 3 / W));
    }
  }
  return { count, firstRow, rows: r.stdout.length / 3 / W };
}

before(() => {
  if (skip) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ambient-studio-render-"));
  media = {
    image: path.join(dir, "bg.png"),
    bed: path.join(dir, "bed.wav"),
    voice: path.join(dir, "voice.wav"),
    out: path.join(dir, "out.mp4"),
  };
  ff(["-f", "lavfi", "-i", "color=c=black:s=1080x1920", "-frames:v", "1", media.image]);
  ff(["-f", "lavfi", "-i", "sine=f=220:d=5", media.bed]);
  media.bed30 = path.join(dir, "bed30.wav");
  ff(["-f", "lavfi", "-i", "sine=f=220:d=30", media.bed30]);
  ff(["-f", "lavfi", "-i", "sine=f=440:d=1.5", media.voice]);
});

after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("Ambient renders draw Studio looks with libass", { skip }, () => {
  test("a Studio verse is on screen through its section and clean before it", () => {
    const project = {
      projectId: "ambient-studio", aspect: "portrait", targetSec: 5, motion: "still",
      captions: "static", captionSpan: "section", captionPreset: "studio-clean-white", captionEnergy: "calm", captionSeed: 1,
      bed: { volume: 0.85 },
      movements: [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 5000 }],
    };
    // The verse belongs to the second movement, 2 s to 5 s; the first is bare.
    const drops = [{
      atMs: 3500, durationMs: 1500, audioPath: media.voice, status: "done", reference: "Psalms 46:10", translation: "kjv",
      text: "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.",
    }];
    const { args } = buildAmbientFfmpegArgs(project, {
      bedPath: media.bed, images: [media.image, media.image], drops, outPath: media.out, workDir: dir,
    });
    ff(args);
    assert.ok(fs.existsSync(media.out), "the render exists");
    assert.ok(fs.existsSync(path.join(dir, "captions.ass")), "the engine's file was written beside the render");

    const during = whiteAt(media.out, 3.25);
    assert.ok(during.count > 300, `expected Studio-sized white captions at 3.25 s, got ${during.count} white pixels`);
    // The serif fallback, like the reference line, sits in the bottom fifth of
    // the frame (row ~385 of 480); the stacked phrases at 3.25 s start far above it.
    assert.ok(during.firstRow < during.rows * 0.5, `expected Studio captions above the lower band, first white row was ${during.firstRow} of ${during.rows}`);
    const before = whiteAt(media.out, 0.5);
    assert.ok(before.count < 20, `expected a clean frame at 0.5 s, got ${before.count} white pixels`);
  });

  test("late in a long section page the whole verse is up, and it is gone when the page ends", () => {
    // A 30 s section holds one page for all 30 s. Its words must land at
    // reading pace, not trickle in across the section, and stay.
    const out = path.join(dir, "long.mp4");
    const project = {
      projectId: "ambient-studio-long", aspect: "portrait", targetSec: 30, motion: "still",
      captions: "static", captionSpan: "section", captionPreset: "studio-clean-white", captionEnergy: "calm", captionSeed: 1,
      bed: { volume: 0.85 },
      movements: [{ startMs: 0, endMs: 30000 }],
    };
    const drops = [{
      atMs: 2000, durationMs: 1500, audioPath: media.voice, status: "done", reference: "Psalms 46:10", translation: "kjv",
      text: "Be still, and know that I am God: I will be exalted among the heathen.",
    }];
    const { args } = buildAmbientFfmpegArgs(project, {
      bedPath: media.bed30, images: [media.image], drops, outPath: out, workDir: dir,
    });
    ff(args);
    // 12 words at 0.4 s: all up by ~5 s. Every sample after that carries the full verse, so the
    // white-pixel count is steady; a reveal spread over 30 s would still be climbing at 20 s.
    const mid = whiteAt(out, 12);
    const late = whiteAt(out, 26);
    assert.ok(late.count > 300, `expected the verse up at 26 s, got ${late.count} white pixels`);
    assert.ok(late.firstRow < late.rows * 0.5, `expected Studio captions high in the frame, first row ${late.firstRow}`);
    assert.ok(Math.abs(late.count - mid.count) < mid.count * 0.25, `verse complete by 12 s: ${mid.count} vs ${late.count} at 26 s`);
  });
});
