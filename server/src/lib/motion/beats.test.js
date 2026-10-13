import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  onsetEnvelope, estimateTempo, beatGrid, chooseWindow, pausesFrom, decodePcm, FRAME_RATE,
} from "./beats.js";
import { fileURLToPath } from "node:url";
import { clickTrack, noiseTrack, silence, toneGaps, ffmpegAvailable } from "./testkit.js";

for (const bpm of [90, 120, 150]) {
  test(`a ${bpm} BPM click track reads as ${bpm} BPM (±1)`, () => {
    const env = onsetEnvelope(clickTrack({ bpm, sec: 30 }));
    const got = estimateTempo(env);
    assert.ok(got !== null, "tempo found");
    assert.ok(Math.abs(got - bpm) <= 1, `got ${got}`);
  });
}

test("a 160 BPM click track reads within 159-160 and never above 160", () => {
  const got = estimateTempo(onsetEnvelope(clickTrack({ bpm: 160, sec: 30 })));
  assert.ok(got !== null, "tempo found");
  assert.ok(got >= 159 && got <= 160, `got ${got}`);
});

test("a 70 BPM click track reads within 70-71 and never below 70", () => {
  const got = estimateTempo(onsetEnvelope(clickTrack({ bpm: 70, sec: 30 })));
  assert.ok(got !== null, "tempo found");
  assert.ok(got >= 70 && got <= 71, `got ${got}`);
});

test("clicks just outside 70-160 still read inside it", () => {
  for (const bpm of [69.2, 161]) {
    const got = estimateTempo(onsetEnvelope(clickTrack({ bpm, sec: 30 })));
    assert.ok(got !== null, `${bpm} BPM: tempo found`);
    assert.ok(got >= 70 && got <= 160, `${bpm} BPM read as ${got}`);
  }
});

test("an empty envelope has no tempo", () => {
  assert.equal(estimateTempo(new Float64Array(0)), null);
});

test("beat times land within 30 ms of the clicks", () => {
  const bpm = 120;
  const offset = 0.1;
  const env = onsetEnvelope(clickTrack({ bpm, sec: 30, offset }));
  const grid = beatGrid(env, estimateTempo(env), 5, 15);
  const period = 60 / bpm;
  assert.ok(grid.beats.length >= 28 && grid.beats.length <= 31, `beats ${grid.beats.length}`);
  for (const b of grid.beats) {
    const abs = 5 + b;
    const k = Math.round((abs - offset) / period);
    const err = Math.abs(abs - (offset + k * period));
    assert.ok(err <= 0.03, `beat at ${abs.toFixed(3)} is ${(err * 1000).toFixed(0)} ms off`);
  }
});

test("downbeats are every 4th beat and strong beats are the loudest", () => {
  // Every 4th click (from the third) is loud: that phase is the downbeat.
  const bpm = 120;
  const period = 60 / bpm;
  const level = (t) => (Math.round((t - 0.1) / period) % 4 === 2 ? 0.95 : 0.3);
  const env = onsetEnvelope(clickTrack({ bpm, sec: 20, level }));
  const grid = beatGrid(env, estimateTempo(env), 0, 16);
  assert.ok(grid.downbeats.length >= 7);
  for (let i = 1; i < grid.downbeats.length; i += 1) assert.equal(grid.downbeats[i] - grid.downbeats[i - 1], 4);
  const first = grid.beats[grid.downbeats[0]];
  assert.equal(Math.round((first - 0.1) / period) % 4, 2);
  assert.ok(grid.strong.length >= 1);
  assert.ok(grid.strong.every((i) => grid.downbeats.includes(i)), "the loud clicks are the strong beats");
  assert.ok(Math.abs(grid.period - 0.5) < 0.01);
});

test("silence and noise have no tempo", () => {
  assert.equal(estimateTempo(onsetEnvelope(silence(20))), null);
  for (const seed of [1, 2, 3, 4, 5]) {
    assert.equal(estimateTempo(onsetEnvelope(noiseTrack({ sec: 20, seed }))), null, `noise seed ${seed}`);
  }
});

test("the chosen window is the loud part of the track", () => {
  const pcm = clickTrack({ bpm: 120, sec: 60, level: (t) => (t >= 30 ? 0.9 : 0.05) });
  const start = chooseWindow(onsetEnvelope(pcm), 15);
  assert.ok(start >= 29.5 && start <= 45, `start ${start}`);
});

test("a track shorter than the window starts at 0", () => {
  assert.equal(chooseWindow(onsetEnvelope(clickTrack({ bpm: 120, sec: 8 })), 15), 0);
});

test("pausesFrom finds the silent gaps between phrases, not the edges", () => {
  const pcm = toneGaps([[0.5, false], [2, true], [0.6, false], [1.5, true], [0.1, false], [1, true], [0.7, false]]);
  const gaps = pausesFrom(pcm);
  assert.equal(gaps.length, 1, JSON.stringify(gaps));
  assert.ok(Math.abs(gaps[0].start - 2.5) < 0.05 && Math.abs(gaps[0].end - 3.1) < 0.05, JSON.stringify(gaps));
});

test("FRAME_RATE is about 43 frames a second", () => {
  assert.ok(FRAME_RATE > 43 && FRAME_RATE < 43.1);
});

function fakeSpawn({ code = 0, out = Buffer.from([1, 0, 2, 0]), err = "" } = {}) {
  const calls = [];
  const impl = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit("data", out);
      child.stderr.emit("data", Buffer.from(err));
      child.emit("close", code);
    });
    return child;
  };
  return { impl, calls };
}

test("decodePcm asks ffmpeg for mono s16le at the sample rate, capped in length", async () => {
  const { impl, calls } = fakeSpawn();
  const buf = await decodePcm("song.mp3", { spawnImpl: impl, ffmpegPath: "ff", maxSec: 600 });
  assert.equal(buf.length, 4);
  const a = calls[0].args;
  assert.equal(calls[0].cmd, "ff");
  assert.deepEqual(a.slice(a.indexOf("-t"), a.indexOf("-t") + 2), ["-t", "600"]);
  assert.ok(a.indexOf("-t") < a.indexOf("-i"), "-t limits the input");
  assert.ok(a.includes("s16le") && a.includes("11025") && a.includes("1"));
});

test("decodePcm stops ffmpeg and rejects as cancelled when its signal aborts", async () => {
  let killed = null;
  const impl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig) => { killed = sig ?? "SIGTERM"; setImmediate(() => child.emit("close", null)); return true; };
    return child; // never finishes on its own
  };
  const ac = new AbortController();
  const running = decodePcm("long.mp3", { spawnImpl: impl, signal: ac.signal });
  ac.abort();
  await assert.rejects(running, /cancelled/);
  assert.ok(killed, "the decoder process was killed");
});

test("decodePcm with an already-aborted signal never starts ffmpeg", async () => {
  const { impl, calls } = fakeSpawn();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(decodePcm("song.mp3", { spawnImpl: impl, signal: ac.signal }), /cancelled/);
  assert.equal(calls.length, 0);
});

test("decodePcm rejects with ffmpeg's error when the file can't be read", async () => {
  const { impl } = fakeSpawn({ code: 1, out: Buffer.alloc(0), err: "Invalid data found" });
  await assert.rejects(decodePcm("bad.mp3", { spawnImpl: impl }), /Invalid data found/);
});

test("a real song (22-gospel-fire) reads about 100 BPM", { skip: !ffmpegAvailable() }, async () => {
  const file = fileURLToPath(new URL("../../../assets/music/22-gospel-fire.mp3", import.meta.url));
  const env = onsetEnvelope(await decodePcm(file, { maxSec: 240 }));
  const got = estimateTempo(env);
  // Prod runs a different ffmpeg whose resampler can shift the reading by 0.1.
  assert.ok(got !== null && got >= 99 && got <= 100.5, `got ${got}`);
});
