import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { isSceneVideoUpload, resolveSceneVideo, MAX_SCENE_VIDEO_BYTES } from "./sceneVideo.js";

// A clip of your own on a Story scene: a Pixabay download from an iPhone or a
// Samsung. Only your own upload may be used, and only one a render can take.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const needsFfmpeg = { skip: !hasFfmpeg && "ffmpeg not installed" };

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ff = (args) => {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
};

let outputDir;
beforeEach(() => { outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-video-")); });
afterEach(() => { fs.rmSync(outputDir, { recursive: true, force: true }); });

/** A short clip, as POST /api/media/upload-background leaves it on disk. */
function makeClip({ name = `bg-video-${UUID}.mp4`, size = "320x240", dur = 1, rate = 30, dir = outputDir } = {}) {
  const file = path.join(dir, name);
  ff(["-f", "lavfi", "-i", `testsrc=s=${size}:r=${rate}:d=${dur}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
  return file;
}

describe("isSceneVideoUpload", () => {
  test("knows a video upload by its name", () => {
    assert.equal(isSceneVideoUpload(`/x/outputs/bg-video-${UUID}.mp4`), true);
    assert.equal(isSceneVideoUpload(`C:\\o\\bg-video-${UUID}.MOV`), true);
    assert.equal(isSceneVideoUpload(`bg-video-${UUID}.webm`), true);
    assert.equal(isSceneVideoUpload(`bg-image-${UUID}.png`), false);
    assert.equal(isSceneVideoUpload(""), false);
    assert.equal(isSceneVideoUpload(undefined), false);
    assert.equal(isSceneVideoUpload({ path: "a.mp4" }), false);
  });
});

describe("resolveSceneVideo", () => {
  test("accepts a short clip and grabs a poster picture beside it", needsFfmpeg, async () => {
    const clip = makeClip();
    const got = await resolveSceneVideo({ outputDir, uploadPath: clip.replace(/\\/g, "/") });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.videoPath, fs.realpathSync(clip));
    assert.equal(got.videoUrl, `/outputs/bg-video-${UUID}.mp4`);
    assert.equal(path.dirname(got.posterPath), path.dirname(got.videoPath), "poster sits beside the clip");
    assert.equal(got.posterUrl, `/outputs/${path.basename(got.posterPath)}`);
    const head = fs.readFileSync(got.posterPath).subarray(0, 2);
    assert.deepEqual([...head], [0xff, 0xd8], "the poster is a JPEG");
    assert.ok(Math.abs(got.durationSec - 1) < 0.2, `duration ${got.durationSec}`);
  });

  test("refuses anything that isn't your own upload", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "scene-video-elsewhere-"));
    try {
      fs.writeFileSync(path.join(elsewhere, `bg-video-${UUID}.mp4`), "x");
      fs.writeFileSync(path.join(outputDir, "clip.mp4"), "x");
      const cases = [
        path.join(elsewhere, `bg-video-${UUID}.mp4`),
        "clip.mp4",
        `../bg-video-${UUID}.mp4`,
        `bg-video-${UUID.replace("0f8", "9e1")}.mp4`, // not on disk
        "",
        null,
      ];
      for (const uploadPath of cases) {
        const got = await resolveSceneVideo({ outputDir, uploadPath });
        assert.equal(got.ok, false, `${uploadPath} -> ${JSON.stringify(got)}`);
        assert.equal(got.status, 400);
      }
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("another account's clip is refused even with the right name", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "scene-video-other-"));
    try {
      const theirs = path.join(other, `bg-video-${UUID}.mp4`);
      fs.writeFileSync(theirs, "x");
      const got = await resolveSceneVideo({ outputDir, uploadPath: theirs });
      assert.equal(got.ok, false);
      assert.match(got.error, /not found/i);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("a clip over the size cap is refused before it is read", async () => {
    assert.equal(MAX_SCENE_VIDEO_BYTES, 200 * 1024 * 1024);
    fs.writeFileSync(path.join(outputDir, `bg-video-${UUID}.mp4`), Buffer.alloc(64));
    const got = await resolveSceneVideo({ outputDir, uploadPath: `bg-video-${UUID}.mp4`, maxBytes: 10 });
    assert.equal(got.ok, false);
    assert.equal(got.status, 400);
    assert.equal(got.error, "That clip is over 200 MB. Download the HD (1080p) version instead of 4K.");
  });

  test("a file with no picture in it (audio only) is refused", needsFfmpeg, async () => {
    const file = path.join(outputDir, `bg-video-${UUID}.mp4`);
    ff(["-f", "lavfi", "-i", "sine=d=1", "-c:a", "aac", file]);
    const got = await resolveSceneVideo({ outputDir, uploadPath: file });
    assert.equal(got.ok, false);
    assert.equal(got.status, 400);
    assert.match(got.error, /no video/i);
  });

  test("bytes that aren't a video at all are refused", async () => {
    fs.writeFileSync(path.join(outputDir, `bg-video-${UUID}.mp4`), "plain text, not a clip ".repeat(20));
    const got = await resolveSceneVideo({ outputDir, uploadPath: `bg-video-${UUID}.mp4` });
    assert.equal(got.ok, false);
    assert.equal(got.status, 400);
  });

  test("a playlist dressed up as a clip is refused, so ffmpeg never follows it", needsFfmpeg, async () => {
    const target = path.join(outputDir, "secret.txt");
    fs.writeFileSync(target, "not for you");
    const playlist = ["#EXTM3U", "#EXT-X-TARGETDURATION:1", "#EXTINF:1,", `file:${target.replace(/\\/g, "/")}`, "#EXT-X-ENDLIST", ""].join("\n");
    fs.writeFileSync(path.join(outputDir, `bg-video-${UUID}.mp4`), playlist);
    const got = await resolveSceneVideo({ outputDir, uploadPath: `bg-video-${UUID}.mp4` });
    assert.equal(got.ok, false);
    assert.equal(got.status, 400);
  });

  test("a WebM or MOV clip is accepted as well as an MP4", needsFfmpeg, async () => {
    for (const ext of ["mov", "webm"]) {
      const name = `bg-video-${UUID}.${ext}`;
      const file = path.join(outputDir, name);
      ff(["-f", "lavfi", "-i", "testsrc=s=64x64:r=10:d=1", ...(ext === "webm" ? ["-c:v", "libvpx-vp9"] : ["-c:v", "libx264", "-pix_fmt", "yuv420p"]), file]);
      const got = await resolveSceneVideo({ outputDir, uploadPath: name });
      assert.equal(got.ok, true, `${ext}: ${JSON.stringify(got)}`);
    }
  });

  test("a clip over ten minutes is refused", needsFfmpeg, async () => {
    makeClip({ size: "16x16", dur: 601, rate: 1 });
    const got = await resolveSceneVideo({ outputDir, uploadPath: `bg-video-${UUID}.mp4` });
    assert.equal(got.ok, false);
    assert.match(got.error, /10 minutes/);
  });

  test("a clip wider than 4096 pixels is refused", needsFfmpeg, async () => {
    makeClip({ size: "4112x16", dur: 0.5, rate: 4 });
    const got = await resolveSceneVideo({ outputDir, uploadPath: `bg-video-${UUID}.mp4` });
    assert.equal(got.ok, false);
    assert.match(got.error, /4112×16/);
  });
});
