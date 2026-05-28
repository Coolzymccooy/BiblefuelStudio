import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { extractAudioToMp3 } from "../../src/lib/transcode.js";

function ffmpegAvailable() {
  const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

describe("extractAudioToMp3", () => {
  test("returns a path ending in .mp3 inside outDir", async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg not available");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcode-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    // Synthesise a 1s silent webm so the test doesn't require fixtures.
    const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const src = path.join(outDir, "src.webm");
    spawnSync(bin, [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
      "-f", "lavfi", "-i", "color=size=64x64:rate=10:color=black",
      "-t", "1", "-c:v", "libvpx", "-c:a", "libvorbis", src,
    ], { stdio: "ignore" });

    const result = await extractAudioToMp3(src, outDir);
    assert.match(result, /\.mp3$/);
    assert.ok(fs.existsSync(result), "extracted mp3 should exist");
    assert.ok(fs.statSync(result).size > 0, "extracted mp3 should be non-empty");
  });

  test("rejects when source does not exist", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcode-"));
    try {
      await assert.rejects(
        () => extractAudioToMp3(path.join(outDir, "missing.webm"), outDir),
        /not found|ENOENT/i,
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
