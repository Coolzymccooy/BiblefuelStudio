import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// #121: a render_video job's result carries durationSec, the real length of the
// video it made (read back with ffprobe), so an agent can see that a voiced
// "15 second" short is really 6 seconds long. These render real (tiny) videos.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-length-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const jobs = await import("../../src/routes/jobs.js");

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const skip = spawnSync(FF, ["-version"]).status === 0 ? false : "ffmpeg not installed";
const media = { bg: path.join(process.env.OUTPUT_DIR, "bg.mp4"), voice: path.join(process.env.OUTPUT_DIR, "voice.m4a") };
const ctx = { userId: "owner", dataDir: process.env.DATA_DIR, outputDir: process.env.OUTPUT_DIR, isSuperAdmin: true, isOwner: true };

function ff(args) {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

before(() => {
  if (skip) return;
  ff(["-f", "lavfi", "-i", "color=c=0x224466:s=320x240:d=6:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", media.bg]);
  ff(["-f", "lavfi", "-i", "sine=f=440:d=3", "-c:a", "aac", media.voice]);
});

after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

describe("a finished render_video records the video's real length", { skip }, () => {
  before(() => jobs._setJobCtxForTest(ctx));
  after(() => jobs._resetJobCtxForTest());

  test("without a voice track the length is durationSec", async () => {
    const result = await jobs._executeJobForTest({
      id: "job_len_plain", type: "render_video", payload: { backgroundPath: media.bg, lines: ["Peace"], durationSec: 2, aspect: "square" },
    });
    assert.ok(fs.existsSync(result.outFile));
    assert.equal(typeof result.durationSec, "number");
    assert.ok(Math.abs(result.durationSec - 2) < 0.5, `expected about 2 s, got ${result.durationSec}`);
  });

  test("with a voice track the length is the voice's, not the durationSec asked for", async () => {
    const result = await jobs._executeJobForTest({
      id: "job_len_voice", type: "render_video",
      payload: { backgroundPath: media.bg, audioPath: media.voice, lines: ["Peace"], durationSec: 15, aspect: "square" },
    });
    assert.ok(Math.abs(result.durationSec - 3) < 0.6, `expected about 3 s (the voice), got ${result.durationSec}`);
  });
});
