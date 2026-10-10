import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { _setJobCtxForTest, _resetJobCtxForTest, _renderVideoCoreForTest } from "../../src/routes/jobs.js";
import { hasLibass } from "../../src/lib/kinetic/capability.js";

// Script/Wizard, Series and social renders all run through renderVideoCore.
// These render real (tiny) videos and look at the pixels: white Studio
// captions over a solid green picture. A filter string can look right and
// still draw nothing.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const skip = !hasFfmpeg ? "ffmpeg not installed" : !hasLibass() ? "ffmpeg here has no libass" : false;

let dir;
let media;

function ff(args) {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

/**
 * Near-white pixels in a frame at time t (scaled to 270 px wide): how many,
 * and the first row that has any. The drawtext fallback also draws white
 * captions, so the Studio look is told apart by where and how much it draws:
 * libass sets captions high in the frame and fills far more of it.
 */
function whiteAt(video, t) {
  const r = spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1",
    "-vf", "scale=270:-2,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  let count = 0;
  let firstRow = Infinity;
  for (let i = 0; i + 2 < r.stdout.length; i += 3) {
    if (r.stdout[i] > 200 && r.stdout[i + 1] > 200 && r.stdout[i + 2] > 200) {
      count += 1;
      firstRow = Math.min(firstRow, Math.floor(i / 3 / 270));
    }
  }
  return { count, firstRow };
}

function assertStudioCaptions(video, t) {
  const { count, firstRow } = whiteAt(video, t);
  assert.ok(count > 300, `expected Studio-sized white captions at ${t} s, got ${count} white pixels`);
  assert.ok(firstRow < 100, `expected Studio captions high in the frame, first white row was ${firstRow}`);
}

const leftoverAss = () => fs.readdirSync(dir).filter((f) => f.endsWith(".ass"));

before(() => {
  if (skip) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-render-"));
  media = { bg: path.join(dir, "bg.mp4"), voice: path.join(dir, "voice.m4a") };
  ff(["-f", "lavfi", "-i", "color=c=0x00FF00:s=320x240:d=4:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", media.bg]);
  ff(["-f", "lavfi", "-i", "sine=f=440:d=4", "-c:a", "aac", media.voice]);
});

after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("Script renders draw Studio looks with libass", { skip }, () => {
  before(() => _setJobCtxForTest({ dataDir: dir, outputDir: dir, userId: "studio-user" }));
  after(() => _resetJobCtxForTest());

  test("timed words (series and auto-posts render this way)", async () => {
    const { outFile } = await _renderVideoCoreForTest({
      backgroundPath: media.bg, audioPath: media.voice, durationSec: 4, aspect: "square",
      typographyPreset: "studio-lagos-night", captionEnergy: "calm", captionSeed: 1,
      words: [
        { text: "Peace", start: 0.2, end: 1.2 },
        { text: "be", start: 1.2, end: 1.8 },
        { text: "still", start: 1.8, end: 2.8 },
      ],
    }, "t-studio-words");
    assert.ok(fs.existsSync(outFile));
    assertStudioCaptions(outFile, 1.5);
    assert.deepEqual(leftoverAss(), [], "the .ass file is removed after the render");
  });

  test("lines only, on the single-background path, are spread over the video", async () => {
    const { outFile } = await _renderVideoCoreForTest({
      backgroundPath: media.bg, audioPath: media.voice, durationSec: 4, aspect: "square",
      typographyPreset: "studio-clean-white", captionSeed: 1,
      lines: ["Peace be still"],
    }, "t-studio-lines");
    assert.ok(fs.existsSync(outFile));
    assertStudioCaptions(outFile, 1.0);
    assert.deepEqual(leftoverAss(), [], "the .ass file is removed after the render");
  });
});
