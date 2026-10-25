import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stageImageArgs, CARD_LONG_SIDE, BLUR_SIZE } from "./stage.js";
import { FFMPEG_51_FILTERS } from "../motion/effects/index.js";
import { filterNames, ffmpegAvailable, FFMPEG } from "../motion/testkit.js";

const vfOf = (args) => args[args.indexOf("-vf") + 1];
const stage = (over = {}) => stageImageArgs({ src: "in.jpg", card: "c.jpg", blur: "b.jpg", width: 4032, height: 3024, orientation: 1, frame: "tall", ...over });

test("the card keeps the photo's aspect with its long side at 1400, autorotate off", () => {
  assert.equal(CARD_LONG_SIDE, 1400);
  const { card, shape } = stage();
  assert.equal(shape, "wide");
  assert.ok(card.indexOf("-noautorotate") < card.indexOf("-i"));
  assert.match(vfOf(card), /scale=1400:1400:force_original_aspect_ratio=decrease/);
  assert.equal(card.at(-1), "c.jpg");
});

test("EXIF 6 and 8 turn a stored landscape upright and tall, in both images", () => {
  for (const [orientation, turn] of [[6, "transpose=1"], [8, "transpose=2"]]) {
    const { card, blur, shape } = stage({ orientation });
    assert.equal(shape, "tall", `orientation ${orientation}`);
    assert.ok(vfOf(card).startsWith(`${turn},`));
    assert.ok(vfOf(blur).startsWith(`${turn},`));
    assert.ok(blur.indexOf("-noautorotate") < blur.indexOf("-i"));
  }
});

test("the blur is a small cover of the frame's own shape", () => {
  assert.deepEqual(BLUR_SIZE, { tall: [216, 384], wide: [384, 216] });
  assert.match(vfOf(stage({ frame: "tall" }).blur), /scale=216:384:force_original_aspect_ratio=increase,crop=216:384/);
  assert.match(vfOf(stage({ frame: "wide" }).blur), /scale=384:216:force_original_aspect_ratio=increase,crop=384:216/);
});

test("staging uses only filters ffmpeg 5.1 has", () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { card, blur } = stage({ orientation });
    for (const name of filterNames([vfOf(card), vfOf(blur)])) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  }
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-stage-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sizeOf = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  return r.stdout.trim().split(",").map(Number);
};

test("ffmpeg writes an upright card and a frame-shaped blur", { skip: !ffmpegAvailable() }, () => {
  const src = path.join(tmp, "src.png");
  spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=2000x1500:d=1", "-frames:v", "1", src]);
  const card = path.join(tmp, "card.jpg");
  const blur = path.join(tmp, "blur.jpg");
  const staged = stageImageArgs({ src, card, blur, width: 2000, height: 1500, orientation: 6, frame: "wide" });
  for (const args of [staged.card, staged.blur]) assert.equal(spawnSync(FFMPEG, args).status, 0);
  assert.deepEqual(sizeOf(card), [1050, 1400], "rotated tall, long side 1400");
  assert.deepEqual(sizeOf(blur), [384, 216]);
});
