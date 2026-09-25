import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { parseLoudnorm, gainToTargetDb, measureLoudness, _clearLoudnessCache, BED_TARGET_LUFS } from "./loudness.js";

const REPORT = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-21.75",\n\t"input_tp" : "-18.06",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-31.75",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "-0.05"\n}\nsize=N/A time=00:00:03.00`;

test("reads integrated loudness and true peak from ffmpeg's loudnorm report", () => {
  assert.deepEqual(parseLoudnorm(REPORT), { inputI: -21.75, inputTp: -18.06 });
});

test("an unreadable report or a silent track measures as nothing", () => {
  assert.equal(parseLoudnorm("no json here"), null);
  assert.equal(parseLoudnorm(`{"input_i" : "-inf", "input_tp" : "-inf"}`), null);
});

test("a quiet track is lifted to the bed's level, a loud one brought down", () => {
  assert.equal(gainToTargetDb({ inputI: BED_TARGET_LUFS - 6, inputTp: -20 }), 6);
  assert.equal(gainToTargetDb({ inputI: BED_TARGET_LUFS + 5, inputTp: -1 }), -5);
});

test("a lift never pushes a track's peaks into clipping", () => {
  // -26 LUFS wants +8 dB, but its peaks at -4 dBTP only have room for +2.5.
  assert.equal(gainToTargetDb({ inputI: BED_TARGET_LUFS - 8, inputTp: -4 }), 2.5);
});

test("a measurement off the scale is clamped rather than trusted", () => {
  assert.equal(gainToTargetDb({ inputI: -70, inputTp: -60 }), 12);
  assert.equal(gainToTargetDb(null), 0);
});

test("each file is measured once, then remembered until it changes", async () => {
  _clearLoudnessCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loud-"));
  const file = path.join(dir, "t.mp3");
  fs.writeFileSync(file, "x");
  let runs = 0;
  const run = async () => { runs += 1; return REPORT; };
  const a = await measureLoudness(file, { run });
  const b = await measureLoudness(file, { run });
  assert.deepEqual(a, { inputI: -21.75, inputTp: -18.06 });
  assert.deepEqual(b, a);
  assert.equal(runs, 1);
  fs.writeFileSync(file, "xy"); // a replaced upload is measured again
  await measureLoudness(file, { run });
  assert.equal(runs, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a measurement that fails leaves the track at its own level, and isn't retried every render", async () => {
  _clearLoudnessCache();
  let runs = 0;
  const run = async () => { runs += 1; throw new Error("ffmpeg died"); };
  assert.equal(await measureLoudness("/nope.mp3", { run }), null);
  assert.equal(await measureLoudness("/nope.mp3", { run }), null);
  assert.equal(runs, 1, "a track that can't be measured is not fully decoded again on every render");
});
