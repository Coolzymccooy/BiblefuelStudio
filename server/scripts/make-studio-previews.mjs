// Renders the 6-second Studio look samples the caption picker plays.
// Dev-only (needs ffmpeg with libass and the lavfi `gradients` source).
// Run from server/: node scripts/make-studio-previews.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LOOKS } from "../src/lib/kinetic/looks.js";
import { studioCaptionFilter } from "../src/lib/kinetic/filter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../client/public/studio-looks");
const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const W = 640;
const H = 360;
const DUR = 6;
// Four short lines that show a stack, a slam, a quote and a framed hook.
const LINES = [
  { text: "Fear thou not", start: 0.3, end: 1.5 },
  { text: "I still dey", start: 1.7, end: 2.9 },
  { text: "By his grace", start: 3.1, end: 4.2 },
  { text: "I still dey", start: 4.4, end: 5.6 },
];
const OVERRIDES = { 0: "stack", 1: "slam", 2: "quote", 3: "frame" };

fs.mkdirSync(outDir, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio-previews-"));
try {
  for (const id of Object.keys(LOOKS)) {
    const assPath = path.join(work, `${id}.ass`);
    const built = studioCaptionFilter({
      assPath, lines: LINES, w: W, h: H, look: `studio-${id}`, energy: "wild", seed: 1, overrides: OVERRIDES,
    });
    for (const f of built.sideFiles) fs.writeFileSync(f.path, f.text, "utf8");
    const out = path.join(outDir, `${id}.mp4`);
    const r = spawnSync(ff, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `gradients=s=${W}x${H}:c0=0x1b1030:c1=0x5a2a12:x0=0:y0=0:x1=${W}:y1=${H}:d=${DUR}:speed=0.01:r=25`,
      "-vf", built.filter,
      "-t", String(DUR), "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
      out,
    ], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${id}: ffmpeg failed: ${r.stderr}`);
    console.log(`${id}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
