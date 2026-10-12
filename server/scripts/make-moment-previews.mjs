// Renders the four Moments style previews with the real motion engine:
// client/public/moments/previews/<style>.mp4 (360x640, ~6 s, silent, looping).
// The "photos" are generated, textured stills (a colour gradient, a grid, bold
// boxes and a big numeral), so no personal pictures are shipped in this public
// repo and the camera moves (push, pan, punch, shake) are visible in a preview.
// Run from server/: node scripts/make-moment-previews.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_DIR } from "../src/lib/videoFilters.js";
import { workImageArgs } from "../src/lib/motion/prepare.js";
import { directMoment } from "../src/lib/motion/director.js";
import { beatGridOf } from "../src/lib/motion/cuts.js";
import { validatePlan } from "../src/lib/motion/plan.js";
import { renderPlan, runFfmpeg } from "../src/lib/motion/render.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../client/public/moments/previews");
const LENGTH = 6;
const MAX_BYTES = 600 * 1024;
// Energy, the beat period (a stand-in for the song's tempo) and the seed per style. A calm song is
// slow and a hype one is fast, so the cut rate differs the way it does for a real Moment.
const STYLES = {
  glow: { energy: 0.2, period: 1.5, seed: 1 },
  celebrate: { energy: 0.8, period: 0.55, seed: 11 },
  hype: { energy: 0.95, period: 0.43, seed: 3 },
  gallery: { energy: 0.5, period: 0.6, seed: 7 },
};

// Mixed shapes, like a real camera roll: tall phone shots and wide ones.
const STILLS = [
  { w: 1080, h: 1920, c0: "0xF5B041", c1: "0x6C3483", box: "0xE74C3C" },
  { w: 1920, h: 1080, c0: "0x48C9B0", c1: "0x1B4F72", box: "0xF4D03F" },
  { w: 1080, h: 1920, c0: "0xEC7063", c1: "0xF7DC6F", box: "0x2874A6" },
  { w: 1920, h: 1080, c0: "0x85C1E9", c1: "0x2874A6", box: "0xE67E22" },
  { w: 1080, h: 1920, c0: "0x58D68D", c1: "0x4A235A", box: "0xF1948A" },
];

/** Escapes a path for use inside a drawtext fontfile='...' option. */
const filterPath = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/** The still's filter chain: a grid, three bold boxes (placed differently per still) and a big numeral. */
function textureFilter(i, box) {
  const font = filterPath(path.join(FONT_DIR, "Anton.ttf"));
  const boxes = [
    `drawbox=x=iw*${0.08 + 0.1 * (i % 3)}:y=ih*0.1:w=iw*0.28:h=ih*0.2:color=${box}@0.9:t=fill`,
    `drawbox=x=iw*0.62:y=ih*${0.55 + 0.05 * (i % 2)}:w=iw*0.3:h=ih*0.18:color=white@0.85:t=fill`,
    `drawbox=x=iw*0.1:y=ih*0.72:w=iw*0.22:h=ih*0.22:color=black@0.55:t=fill`,
  ];
  return [
    "drawgrid=w=iw/9:h=ih/9:t=6:color=white@0.45",
    ...boxes,
    `drawtext=fontfile='${font}':text='${i + 1}':fontsize=h*0.5:fontcolor=white:borderw=14:bordercolor=black@0.7:x=(w-text_w)*0.5:y=(h-text_h)*0.45`,
  ].join(",");
}

async function run(args) {
  const r = await runFfmpeg(args);
  if (!r.ok) throw new Error(r.stderr || r.error);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "moment-previews-"));
try {
  fs.mkdirSync(outDir, { recursive: true });
  const photos = [];
  for (let i = 0; i < STILLS.length; i += 1) {
    const { w, h, c0, c1, box } = STILLS[i];
    const src = path.join(work, `src-${i}.png`);
    await run(["-v", "error", "-y", "-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:d=1`,
      "-vf", textureFilter(i, box), "-frames:v", "1", src]);
    const out = path.join(work, `work-${i}.jpg`);
    const { args, shape } = workImageArgs({ src, out, width: w, height: h, orientation: 1 });
    await run(args);
    photos.push({ file: out, shape });
  }
  const shapes = photos.map((p) => p.shape);
  for (const [style, { energy, period, seed }] of Object.entries(STYLES)) {
    const beats = [];
    for (let t = period; t < LENGTH; t += period) beats.push(Math.round(t * 1000) / 1000);
    const grid = beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [4, 8], period });
    const { plan } = directMoment({
      photos: photos.map((p) => ({ shape: p.shape })), heroIndex: 0, grid, title: "Your title",
      statements: ["Your words here", "Made with BibleFuel"], styleId: style, energy, lengthSec: LENGTH, seed,
    });
    const checked = validatePlan(plan, { photoCount: photos.length, shapes });
    if (!checked.ok) throw new Error(`${style}: invalid plan: ${checked.errors.join("; ")}`);
    const workDir = fs.mkdtempSync(path.join(work, `${style}-`));
    const full = path.join(work, `${style}-full.mp4`);
    const r = await renderPlan({ plan, workImages: photos.map((p) => p.file), song: null, voice: null, workDir, out: full });
    if (!r.ok) throw new Error(`${style}: ${r.error} ${r.detail || ""}`);
    // Encode to the temp dir; only a file that passes the size check reaches the repo.
    const small = path.join(work, `${style}-preview.mp4`);
    await run(["-v", "error", "-y", "-i", full, "-an", "-vf", "scale=360:640", "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", small]);
    const bytes = fs.statSync(small).size;
    if (bytes > MAX_BYTES) throw new Error(`${style}.mp4 is ${bytes} bytes, over the ${MAX_BYTES} limit`);
    fs.copyFileSync(small, path.join(outDir, `${style}.mp4`));
    console.log(`wrote ${style}.mp4 (${Math.round(bytes / 1024)} KB)`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
