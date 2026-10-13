import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { onsetEnvelope, estimateTempo, beatTimes, detectBeats, analyseBeats } from "./beats.js";

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

function noise(seconds, amp = 0.2) {
  const s = new Float32Array(SR * seconds);
  let seed = 12345; // fixed LCG so the test is deterministic
  for (let i = 0; i < s.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    s[i] = ((seed / 2 ** 32) * 2 - 1) * amp;
  }
  return s;
}

describe("no beat to find", () => {
  test("silence gives no beats", () => {
    assert.deepEqual(analyseBeats(new Float32Array(SR * 20), SR), { bpm: 0, times: [] });
  });
  test("white noise gives no beats", () => {
    for (const secs of [10, 30]) assert.deepEqual(analyseBeats(noise(secs), SR), { bpm: 0, times: [] });
  });
  test("a steady tone with a slow wobble gives no beats", () => {
    const s = new Float32Array(SR * 20);
    for (let i = 0; i < s.length; i += 1) s[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) * (0.7 + 0.3 * Math.sin((2 * Math.PI * 0.3 * i) / SR));
    assert.deepEqual(analyseBeats(s, SR), { bpm: 0, times: [] });
  });
  test("clicks buried in quiet noise still give a beat grid", () => {
    const c = clicks(110, 30);
    const n = noise(30, 0.05);
    const { bpm, times } = analyseBeats(c.map((v, i) => v + n[i]), SR);
    assert.ok(Math.abs(bpm - 110) <= 1, `got ${bpm}`);
    assert.ok(times.length > 40);
  });
  test("clicks alone still give the same grid as before", () => {
    const { bpm } = analyseBeats(clicks(120, 20), SR);
    assert.ok(Math.abs(bpm - 120) <= 1);
  });
});

describe("decoding", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  test("a real silent file gives no beats", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beats-"));
    try {
      const file = path.join(dir, "silence.wav");
      assert.equal(spawnSync(FF, ["-v", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "15", file]).status, 0);
      assert.deepEqual(await detectBeats(file), { bpm: 0, times: [] });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("a real white-noise file gives no beats", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beats-"));
    try {
      const file = path.join(dir, "noise.wav");
      assert.equal(spawnSync(FF, ["-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=20:c=white:r=22050:a=0.3", file]).status, 0);
      assert.deepEqual(await detectBeats(file), { bpm: 0, times: [] });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  test("a file ffmpeg cannot read rejects with ffmpeg's reason", async () => {
    await assert.rejects(detectBeats(path.join(os.tmpdir(), "no-such-beats-file.m4a")), /no-such-beats-file|No such file|Error opening/i);
  });
});
