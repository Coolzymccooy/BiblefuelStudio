// server/src/lib/lyricVideo/audibleEnd.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { trailingSilenceStart, measureAudibleEnd, SILENCE_DB, MIN_SILENCE_SEC } from "./audibleEnd.js";

describe("trailingSilenceStart", () => {
  const SR = 100;
  const signal = (loudSec, quietSec, loud = 0.5, quiet = 0) =>
    Float32Array.from({ length: Math.round((loudSec + quietSec) * SR) }, (_, i) => (i < loudSec * SR ? (i % 2 ? loud : -loud) : quiet));

  test("defaults: -40 dB, half a second", () => {
    assert.equal(SILENCE_DB, -40);
    assert.equal(MIN_SILENCE_SEC, 0.5);
  });
  test("a trailing silence starts just after the last loud sample", () => {
    assert.equal(trailingSilenceStart(signal(3, 2), SR), 3);
  });
  test("no trailing silence: null", () => {
    assert.equal(trailingSilenceStart(signal(3, 0), SR), null);
  });
  test("a trailing silence shorter than the minimum is not one", () => {
    assert.equal(trailingSilenceStart(signal(3, 0.3), SR), null);
  });
  test("quiet but above -40 dB still counts as sound", () => {
    assert.equal(trailingSilenceStart(signal(3, 2, 0.5, 0.02), SR), null);
  });
  test("quiet below -40 dB is silence", () => {
    assert.equal(trailingSilenceStart(signal(3, 2, 0.5, 0.005), SR), 3);
  });
  test("a silence in the middle of the song is not its end", () => {
    const gap = Float32Array.from({ length: 8 * SR }, (_, i) => (i < 3 * SR || i >= 5 * SR ? 0.5 : 0));
    assert.equal(trailingSilenceStart(gap, SR), null);
  });
  test("nothing above the threshold at all: null (nothing to measure)", () => {
    assert.equal(trailingSilenceStart(new Float32Array(500), SR), null);
  });
  test("thresholds can be set", () => {
    assert.equal(trailingSilenceStart(signal(3, 0.3), SR, { minSilenceSec: 0.2 }), 3);
    assert.equal(trailingSilenceStart(signal(3, 2, 0.5, 0.02), SR, { thresholdDb: -30 }), 3);
  });
});

describe("measureAudibleEnd", () => {
  test("uses the decoded samples and stays inside the song", async () => {
    const decode = async () => Float32Array.from({ length: 8000 * 5 }, (_, i) => (i < 8000 * 3 ? 0.5 : 0));
    assert.equal(await measureAudibleEnd("x.m4a", 5, { decode }), 3);
    assert.equal(await measureAudibleEnd("x.m4a", 2.5, { decode }), 2.5, "never past the song's length");
  });
  test("no trailing silence: the song's length", async () => {
    const decode = async () => new Float32Array(8000 * 5).fill(0.5);
    assert.equal(await measureAudibleEnd("x.m4a", 5, { decode }), 5);
  });
  test("a decode failure is thrown to the caller", async () => {
    const decode = async () => { throw new Error("ffmpeg decode exited 1: nope"); };
    await assert.rejects(measureAudibleEnd("x.m4a", 5, { decode }), /nope/);
  });
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

describe("measureAudibleEnd on real audio", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "audible-end-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const make = (name, filter) => {
    const file = path.join(dir, name);
    const r = spawnSync(FF, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", filter, "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", file]);
    assert.equal(r.status, 0, String(r.stderr));
    return file;
  };

  test("3 s of tone then 2 s of silence: about 3 s", async () => {
    const file = make("tone-then-silence.m4a", "sine=frequency=440:duration=3:sample_rate=16000,apad=pad_dur=2");
    const end = await measureAudibleEnd(file, 5);
    assert.ok(Math.abs(end - 3) < 0.1, `audible end ${end}`);
  });
  test("3 s tone, 2 s silence, 3 s tone: the song's length", async () => {
    const file = make("gap.m4a", "sine=frequency=440:duration=8:sample_rate=16000,volume=enable='between(t,3,5)':volume=0");
    assert.equal(await measureAudibleEnd(file, 8), 8);
  });
  test("tone to the very end: the song's length", async () => {
    const file = make("tone.m4a", "sine=frequency=440:duration=4:sample_rate=16000");
    assert.equal(await measureAudibleEnd(file, 4), 4);
  });
  test("a file that cannot be read rejects", async () => {
    await assert.rejects(measureAudibleEnd(path.join(dir, "missing.m4a"), 5), /ffmpeg/);
  });
});
