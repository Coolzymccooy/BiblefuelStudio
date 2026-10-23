import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { addClip, getClip } from "./store.js";
import { makeMissingPosters } from "./backfill.js";

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

describe("makeMissingPosters with ffmpeg", () => {
  test("grabs a real frame for a clip without a poster", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-poster-"));
    try {
      const ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
      const src = path.join(root, "src.mp4");
      const made = spawnSync(FF, ["-y", "-f", "lavfi", "-i", "color=c=orange:s=180x320:d=2", "-pix_fmt", "yuv420p", src]);
      assert.equal(made.status, 0);
      const clip = addClip(ctx, { file: src, prompt: "orange" });
      const r = await makeMissingPosters(ctx);
      assert.deepEqual(r, { made: 1, failed: 0, remaining: 0 });
      const poster = path.join(ctx.outputDir, "visual-library", clip.id, "poster.jpg");
      assert.ok(fs.statSync(poster).size > 0);
      assert.ok(getClip(ctx.dataDir, clip.id).posterUrl);
      assert.equal(fs.existsSync(path.join(ctx.outputDir, "visual-library", clip.id, "poster.tmp.jpg")), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
