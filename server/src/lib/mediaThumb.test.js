import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

// generateVideoThumbnail runs ffmpeg on every background video upload, on
// bytes the user chose. Those bytes decide the format, whatever the name, so a
// concat list or a playlist named .mp4 must not make ffmpeg open other files.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const needsFfmpeg = { skip: !hasFfmpeg && "ffmpeg not installed" };

const UUID = "4d3c2b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d";

let dir;
let outputDir;
let generateVideoThumbnail;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-thumb-"));
  outputDir = path.join(dir, "outputs");
  fs.mkdirSync(outputDir);
  // paths.js reads OUTPUT_DIR when it is first imported.
  process.env.OUTPUT_DIR = outputDir;
  ({ generateVideoThumbnail } = await import("./mediaThumb.js"));
});
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function makeClip(file) {
  const r = spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=160x120:r=10:d=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
  assert.equal(r.status, 0, String(r.stderr));
}

describe("generateVideoThumbnail", () => {
  test("a real clip gets a JPEG thumbnail", needsFfmpeg, () => {
    const clip = path.join(dir, `bg-video-${UUID}.mp4`);
    makeClip(clip);
    const got = generateVideoThumbnail(clip, { outputBaseName: "thumb-real" });
    assert.equal(got, "/outputs/thumb-real.jpg");
    const head = fs.readFileSync(path.join(outputDir, "thumb-real.jpg")).subarray(0, 2);
    assert.deepEqual([...head], [0xff, 0xd8]);
  });

  test("a concat list named .mp4 is not followed: no thumbnail, and quickly", needsFfmpeg, () => {
    // A real clip beside the list: if ffmpeg followed the list it would read
    // this clip and make a thumbnail from it.
    const sub = fs.mkdtempSync(path.join(dir, "concat-"));
    makeClip(path.join(sub, "sib.mp4"));
    const list = path.join(sub, `bg-video-${UUID}.mp4`);
    fs.writeFileSync(list, "ffconcat version 1.0\nfile sib.mp4\n");
    const t0 = Date.now();
    const got = generateVideoThumbnail(list, { outputBaseName: "thumb-concat" });
    const ms = Date.now() - t0;
    assert.equal(got, "");
    assert.equal(fs.existsSync(path.join(outputDir, "thumb-concat.jpg")), false, "nothing read from the listed clip");
    assert.ok(ms < 10_000, `took ${ms} ms`);
  });

  test("a run that takes too long is stopped and gives no thumbnail", needsFfmpeg, () => {
    const clip = path.join(dir, `bg-video-${UUID.replace("4d3", "5e4")}.mp4`);
    makeClip(clip);
    const got = generateVideoThumbnail(clip, { outputBaseName: "thumb-slow", timeoutMs: 1 });
    assert.equal(got, "");
    assert.equal(fs.existsSync(path.join(outputDir, "thumb-slow.jpg")), false);
  });
});
