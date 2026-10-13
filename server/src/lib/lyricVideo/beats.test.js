import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { onsetEnvelope, estimateTempo, beatTimes, detectBeats } from "./beats.js";

const SR = 11025;
const HOP = 256;
function clicks(bpm, seconds, offset = 0.1) {
  const s = new Float32Array(SR * seconds);
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const i = Math.round(t * SR);
    for (let k = 0; k < 200 && i + k < s.length; k += 1) s[i + k] = Math.sin(k / 3) * Math.exp(-k / 40);
  }
  return s;
}

describe("tempo on click tracks", () => {
  for (const bpm of [100, 120]) {
    test(`${bpm} BPM`, () => {
      const env = onsetEnvelope(clicks(bpm, 20), SR, HOP);
      const got = estimateTempo(env, SR, HOP);
      assert.ok(Math.abs(got - bpm) <= 1, `got ${got}`);
      const times = beatTimes(env, SR, HOP, got, 20);
      assert.ok(Math.abs(times[0] - 0.1) < 0.03, `first beat ${times[0]}`);
    });
  }
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");

test("matches librosa on the reference song excerpt", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const { bpm, times } = await detectBeats(path.join(FIX, "song-60-90s.m4a"));
  const ref = JSON.parse(fs.readFileSync(path.join(FIX, "librosa-beats.json"), "utf8"));
  assert.ok(Math.abs(bpm - ref.bpm) <= 1, `bpm ${bpm} vs ${ref.bpm}`);
  const refTimes = ref.beats.filter((t) => t >= 61 && t <= 89).map((t) => t - 60);
  const dists = refTimes.map((r) => Math.min(...times.map((t) => Math.abs(t - r)))).sort((a, b) => a - b);
  const median = dists[Math.floor(dists.length / 2)];
  assert.ok(median < 0.04, `median distance ${median}s`);
});
