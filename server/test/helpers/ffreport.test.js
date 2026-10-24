import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tokenize, unguardedInputs, captureFfmpegReports } from "./ffreport.js";

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const skip = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

describe("ffreport helper", () => {
  test("tokenize undoes the report's quoting", () => {
    assert.deepEqual(
      tokenize('ffmpeg -y -i "C:\\\\a b\\\\x.mp3" -f null -'),
      ["ffmpeg", "-y", "-i", "C:\\a b\\x.mp3", "-f", "null", "-"],
    );
  });

  test("unguardedInputs flags each input without its own whitelist, and skips lavfi", () => {
    const args = [
      "-y", "-protocol_whitelist", "file,pipe", "-stream_loop", "-1", "-i", "bg.mp4",
      "-i", "voice.mp3",
      "-f", "lavfi", "-i", "anullsrc",
      "-protocol_whitelist", "file,pipe", "-i", "music.mp3", "out.mp4",
    ];
    assert.deepEqual(unguardedInputs(args), ["voice.mp3"]);
  });

  test("reports from a real ffmpeg run are read back", { skip }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffreport-"));
    const cap = captureFfmpegReports(dir);
    try {
      spawnSync(FF, ["-v", "error", "-protocol_whitelist", "file,pipe", "-i", path.join(dir, "none.mp3"), "-f", "null", "-"]);
      const [cmd] = cap.commands();
      assert.equal(cmd.program, "ffmpeg");
      assert.deepEqual(unguardedInputs(cmd.tokens), []);
      assert.ok(cmd.tokens.includes(path.join(dir, "none.mp3")));
    } finally {
      cap.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
