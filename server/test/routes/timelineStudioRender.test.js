import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { renderTimelineProof } from "../../src/lib/timelineRender/proofRenderer.js";
import { hasLibass } from "../../src/lib/kinetic/capability.js";

// A Timeline project render with a Studio look, run through real ffmpeg and
// judged by its pixels: white captions over a black picture. A filter string
// can look right and still draw nothing.

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const skip = !hasFfmpeg ? "ffmpeg not installed" : !hasLibass() ? "ffmpeg here has no libass" : false;

let dir;
let bg;

function ff(args) {
  const r = spawnSync(FF, ["-y", "-v", "error", ...args]);
  assert.equal(r.status, 0, String(r.stderr));
}

/** Near-white pixels in the frame at time t (scaled to 320 px wide). */
function whiteAt(video, t) {
  const r = spawnSync(FF, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1",
    "-vf", "scale=320:-2,format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  let count = 0;
  let firstRow = Infinity;
  for (let i = 0; i + 2 < r.stdout.length; i += 3) {
    if (r.stdout[i] > 200 && r.stdout[i + 1] > 200 && r.stdout[i + 2] > 200) {
      count += 1;
      firstRow = Math.min(firstRow, Math.floor(i / 3 / 320));
    }
  }
  return { count, firstRow };
}

before(() => {
  if (skip) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "timeline-studio-render-"));
  bg = path.join(dir, "bg.mp4");
  ff(["-f", "lavfi", "-i", "color=c=black:s=1280x720:d=2:r=24", "-f", "lavfi", "-i", "sine=f=440:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", bg]);
});

after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("Timeline renders draw Studio looks with libass", { skip }, () => {
  test("a Studio caption clip is on screen in its window and clean outside it", async () => {
    const outputPath = path.join(dir, "timeline", "studio.mp4");
    const plan = {
      projectId: "timeline-studio", aspect: "16:9", durationSec: 2,
      tracks: [
        { kind: "video", clips: [{ id: "main", path: bg, startSec: 0, durationSec: 2 }] },
        { kind: "captions", clips: [{ id: "c1", text: "Peace be still", startSec: 0.2, durationSec: 1.6 }] },
      ],
    };
    const result = await renderTimelineProof(plan, {
      serverRoot: dir, outputDir: dir, outputPath,
      typographyPreset: "studio-clean-white", captionEnergy: "calm", captionSeed: 1,
    });
    assert.equal(result.ok, true, String(result.error || ""));
    assert.ok(fs.existsSync(outputPath), "the render exists");

    const during = whiteAt(outputPath, 1.0);
    assert.ok(during.count > 300, `expected Studio-sized white captions at 1.0 s, got ${during.count} white pixels`);
    // The drawtext fallback sits in the lower band (row ~150 of 180); libass
    // sets the phrase high in the frame, which tells the two apart.
    assert.ok(during.firstRow < 100, `expected Studio captions high in the frame, first white row was ${during.firstRow}`);
    const before = whiteAt(outputPath, 0.05);
    assert.ok(before.count < 20, `expected a clean frame at 0.05 s, got ${before.count} white pixels`);

    const leftover = fs.readdirSync(path.dirname(outputPath)).filter((f) => f.endsWith(".ass"));
    assert.deepEqual(leftover, [], "the .ass file is removed after the render");
  });
});
