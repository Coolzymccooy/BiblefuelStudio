// Renders one still per Showcase template into a contact sheet, to look at
// the MomentShowcase composition without a full render. The photos are
// generated stills (no personal pictures in this public repo), mixed tall
// and wide like a camera roll.
// Run from server/: node scripts/showcase-stills.mjs [style] [tall|wide] [outDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FONT_DIR } from "../src/lib/videoFilters.js";
import { STYLES, isShowcase } from "../src/lib/motion/styles.js";
import { SHAPES } from "../src/lib/showcase/templates.js";
import { stageImageArgs } from "../src/lib/showcase/stage.js";
import { startAssetServer } from "../src/lib/sceneScript/assetServer.js";
import { getServeUrl } from "../src/lib/render/lifecycle.js";
import { runFfmpeg } from "../src/lib/motion/render.js";

const style = process.argv[2] || "fellowship";
const shape = process.argv[3] === "wide" ? "wide" : "tall";
const outDir = path.resolve(process.argv[4] || path.join(os.tmpdir(), "showcase-stills"));
if (!isShowcase(style)) throw new Error(`${style} is not a Showcase style`);

const STILLS = [
  { w: 1080, h: 1440, c0: "0xF5B041", c1: "0x6C3483" },
  { w: 1600, h: 1200, c0: "0x48C9B0", c1: "0x1B4F72" },
  { w: 1080, h: 1920, c0: "0xEC7063", c1: "0xF7DC6F" },
  { w: 1440, h: 1080, c0: "0x85C1E9", c1: "0x2874A6" },
  { w: 1200, h: 1600, c0: "0x58D68D", c1: "0x4A235A" },
  { w: 1080, h: 1350, c0: "0xF1948A", c1: "0x1A5276" },
];
const TEMPLATE_ORDER = ["single", "polaroids", "split", "grid", "swipe", "triptych", "spotlight", "filmstrip", "finale", "invite"];
const PHOTOS_OF = { single: 1, spotlight: 1, split: 2, polaroids: 3, swipe: 3, triptych: 3, grid: 4, filmstrip: 5, finale: 1, invite: 1 };
const SCENE_SEC = 3;
/** Where in each scene the still is taken: late enough that every card has landed. */
const LOOK_AT = 0.75;

async function run(args) {
  const r = await runFfmpeg(args);
  if (!r.ok) throw new Error(r.stderr || r.error);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-stills-"));
let server;
try {
  fs.mkdirSync(outDir, { recursive: true });
  const files = { "display.ttf": path.join(FONT_DIR, "Anton.ttf") };
  const images = [];
  for (let i = 0; i < STILLS.length; i += 1) {
    const { w, h, c0, c1 } = STILLS[i];
    const src = path.join(work, `src-${i}.png`);
    await run(["-v", "error", "-y", "-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:d=1`,
      "-vf", "drawgrid=w=iw/6:h=ih/6:t=8:color=white@0.5", "-frames:v", "1", src]);
    const staged = stageImageArgs({ src, card: path.join(work, `card-${i}.jpg`), blur: path.join(work, `blur-${i}.jpg`), width: w, height: h, orientation: 1, frame: shape });
    await run(staged.card);
    await run(staged.blur);
    files[`card-${i}.jpg`] = path.join(work, `card-${i}.jpg`);
    files[`blur-${i}.jpg`] = path.join(work, `blur-${i}.jpg`);
    images.push({ name: i, shape: staged.shape });
  }
  server = await startAssetServer(files);
  let next = 0;
  const scenes = TEMPLATE_ORDER.map((template, k) => {
    const photos = Array.from({ length: PHOTOS_OF[template] }, () => { const p = next % STILLS.length; next += 1; return p; });
    return { template, photos, start: k * SCENE_SEC, end: (k + 1) * SCENE_SEC };
  });
  const s = STYLES[style];
  const { w, h } = SHAPES[shape];
  const props = {
    fps: 30, w, h, durationSec: scenes.length * SCENE_SEC, shape, beatSec: 0.6, scenes, flashes: [],
    invite: { day: 21, label: "NOV" }, palette: s.palette, letterbox: s.letterbox,
    images: images.map((im) => ({ card: server.url(`card-${im.name}.jpg`), blur: server.url(`blur-${im.name}.jpg`), shape: im.shape })),
    fonts: { display: server.url("display.ttf") },
  };
  const { selectComposition, renderStill } = await import("@remotion/renderer");
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({ serveUrl, id: "MomentShowcase", inputProps: props });
  const shots = [];
  for (const scene of scenes) {
    const output = path.join(work, `${scene.template}.png`);
    await renderStill({ composition, serveUrl, inputProps: props, output, frame: Math.round((scene.start + SCENE_SEC * LOOK_AT) * 30), scale: 0.4 });
    shots.push(output);
  }
  const sheet = path.join(outDir, `${style}-${shape}.png`);
  const inputs = shots.flatMap((f) => ["-i", f]);
  await run(["-v", "error", "-y", ...inputs, "-filter_complex", `${shots.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${shots.length}:layout=${layout(shots.length, shape)}`, "-frames:v", "1", sheet]);
  console.log(sheet);
} finally {
  await server?.close();
  fs.rmSync(work, { recursive: true, force: true });
}

/** Five across, two rows. */
function layout(count, frameShape) {
  const { w, h } = SHAPES[frameShape];
  const cw = Math.round(w * 0.4);
  const ch = Math.round(h * 0.4);
  return Array.from({ length: count }, (_, i) => `${(i % 5) * cw}_${Math.floor(i / 5) * ch}`).join("|");
}
