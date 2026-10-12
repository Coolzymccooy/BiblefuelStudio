import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { songGrid, voiceGrid } from "./beatCache.js";
import { clickTrack, toneGaps } from "../motion/testkit.js";

let ctx;
let song;
beforeEach(() => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "moments-beats-"));
  ctx = { dataDir, outputDir: dataDir };
  song = path.join(dataDir, "song.mp3");
  fs.writeFileSync(song, "pretend mp3 bytes");
});
afterEach(() => fs.rmSync(ctx.dataDir, { recursive: true, force: true }));

test("a song is analysed once, then served from the cache", async () => {
  let decodes = 0;
  const decode = async () => { decodes += 1; return clickTrack({ bpm: 120, sec: 40 }); };
  const a = await songGrid(ctx, song, { lengthSec: 15, decode });
  const b = await songGrid(ctx, song, { lengthSec: 15, decode });
  assert.equal(decodes, 1);
  assert.equal(a.grid.kind, "beats");
  assert.ok(Math.abs(a.tempo - 120) <= 1);
  assert.deepEqual(a.grid, b.grid);
  assert.equal(fs.readdirSync(path.join(ctx.dataDir, "moments", "beats")).length, 1);
});

test("a cache miss and a cache hit give the same window and grid (Shuffle stays reproducible)", async () => {
  // Uneven loudness so the window choice and the beat phase depend on fine envelope values.
  const decode = async () => clickTrack({ bpm: 97, sec: 50, level: (t) => 0.3 + 0.5 * Math.abs(Math.sin(t * 0.7)) });
  const miss = await songGrid(ctx, song, { lengthSec: 15, decode });
  const hit = await songGrid(ctx, song, { lengthSec: 15, decode });
  assert.equal(hit.windowStartSec, miss.windowStartSec);
  assert.deepEqual(hit.grid, miss.grid);
  assert.equal(hit.tempo, miss.tempo);
});

test("the user's own window start wins, clamped so the window fits the song", async () => {
  const decode = async () => clickTrack({ bpm: 120, sec: 40 });
  const own = await songGrid(ctx, song, { lengthSec: 15, windowStartSec: 10, decode });
  assert.equal(own.windowStartSec, 10);
  const late = await songGrid(ctx, song, { lengthSec: 15, windowStartSec: 39, decode });
  assert.ok(late.windowStartSec <= 25 + 1e-9, `${late.windowStartSec}`);
});

test("a song with no clear tempo gets the pulse grid", async () => {
  const decode = async () => Buffer.alloc(11025 * 2 * 20);
  const r = await songGrid(ctx, song, { lengthSec: 15, decode });
  assert.equal(r.tempo, null);
  assert.equal(r.grid.kind, "pulse");
});

test("a voiceover gives a pause grid, or a pulse grid when it never pauses", async () => {
  const withGaps = await voiceGrid("vo.mp3", { lengthSec: 15, decode: async () => toneGaps([[0.2, false], [3, true], [0.5, false], [3, true], [0.2, false]]) });
  assert.equal(withGaps.kind, "pauses");
  assert.equal(withGaps.marks.length, 1);
  const solid = await voiceGrid("vo.mp3", { lengthSec: 15, decode: async () => toneGaps([[5, true]]) });
  assert.equal(solid.kind, "pulse");
});

test("a voiceover grid carries the decoded voice length as durationSec", async () => {
  // 0.2 + 3 + 0.5 + 3 + 0.2 = 6.9 s of generated voice.
  const withGaps = await voiceGrid("vo.mp3", { lengthSec: 15, decode: async () => toneGaps([[0.2, false], [3, true], [0.5, false], [3, true], [0.2, false]]) });
  assert.ok(Math.abs(withGaps.durationSec - 6.9) <= 0.01, `${withGaps.durationSec}`);
  // The pulse fallback keeps the length too.
  const solid = await voiceGrid("vo.mp3", { lengthSec: 15, decode: async () => toneGaps([[5, true]]) });
  assert.equal(solid.kind, "pulse");
  assert.ok(Math.abs(solid.durationSec - 5) <= 0.01, `${solid.durationSec}`);
});

test("a decode failure is reported, not cached", async () => {
  await assert.rejects(songGrid(ctx, song, { lengthSec: 15, decode: async () => { throw new Error("bad audio"); } }), /bad audio/);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, "moments", "beats")), false);
});
