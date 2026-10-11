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
  ff(["-f", "lavfi", "-i", "sine=f=220:d=8", media.bed]);
  media.bed30 = path.join(dir, "bed30.wav");
  ff(["-f", "lavfi", "-i", "sine=f=220:d=30", media.bed30]);
  ff(["-f", "lavfi", "-i", "sine=f=440:d=1.5", media.voice]);
});

after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("Ambient renders draw Studio looks with libass", { skip }, () => {
  test("a Studio verse is on screen through its section and clean before it", () => {
    const project = {
      projectId: "ambient-studio", aspect: "portrait", targetSec: 8, motion: "still",
      captions: "static", captionSpan: "section", captionPreset: "studio-clean-white", captionEnergy: "calm", captionSeed: 1,
      bed: { volume: 0.85 },
      movements: [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 8000 }],
    };
    // The verse belongs to the second movement, 2 s to 8 s; the first is bare.
    const drops = [{
      atMs: 5000, durationMs: 1500, audioPath: media.voice, status: "done", reference: "Psalms 46:10", translation: "kjv",
      text: "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.",
    }];
    const { args } = buildAmbientFfmpegArgs(project, {
      bedPath: media.bed, images: [media.image, media.image], drops, outPath: media.out, workDir: dir,
    });
    ff(args);
    assert.ok(fs.existsSync(media.out), "the render exists");
    assert.ok(fs.existsSync(path.join(dir, "captions.ass")), "the engine's file was written beside the render");

    const during = whiteAt(media.out, 3.3);
    assert.ok(during.count > 300, `expected Studio-sized white captions at 3.3 s, got ${during.count} white pixels`);
    // The serif fallback, like the reference line, sits in the bottom fifth of
    // the frame (row ~385 of 480); the stacked phrases at 3.3 s start far above it.
    assert.ok(during.firstRow < during.rows * 0.5, `expected Studio captions above the lower band, first white row was ${during.firstRow} of ${during.rows}`);
    const before = whiteAt(media.out, 0.5);
    assert.ok(before.count < 20, `expected a clean frame at 0.5 s, got ${before.count} white pixels`);
  });

  test("late in a long section page the whole page is up", () => {
    // A 30 s section holds its pages for 15 s each. Words must land at
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
    // The verse is two pages of ~15 s each. Each page's words land within a few
    // seconds, so a page looks the same early and late in its window; a reveal spread
    // over the 15 s would still be climbing at the early sample.
    const page1Early = whiteAt(out, 7);
    const page1Late = whiteAt(out, 12);
    const page2Early = whiteAt(out, 22);
    const page2Late = whiteAt(out, 27);
    for (const [name, frame] of [["page 1", page1Late], ["page 2", page2Late]]) {
      assert.ok(frame.count > 300, `expected ${name} up late in its window, got ${frame.count} white pixels`);
      assert.ok(frame.firstRow < frame.rows * 0.78, `expected Studio captions above the reference line, first row ${frame.firstRow}`);
    }
    assert.ok(Math.abs(page1Late.count - page1Early.count) < page1Early.count * 0.25, `page 1 complete by 7 s: ${page1Early.count} vs ${page1Late.count}`);
    assert.ok(Math.abs(page2Late.count - page2Early.count) < page2Early.count * 0.25, `page 2 complete by 22 s: ${page2Early.count} vs ${page2Late.count}`);
  });
});
