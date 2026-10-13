# Motion Engine (Moments Phase 1, plan A of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared motion engine in `server/src/lib/motion/`: beat analysis, cut points, effect modules, smart styles, the motion-plan contract, the seeded director, and the renderer that turns a motion plan plus photos and audio into a 1080×1920 MP4.

**Architecture:** The engine is a set of small pure modules plus one orchestrator, mirroring `server/src/lib/kinetic/`:
- Beats come from an onset envelope with autocorrelation.
- The director turns a timing grid, photos, statements, a style, Energy and a seed into a validated **motion plan**.
- The renderer:
  1. renders each shot as its own short ffmpeg clip;
  2. joins the clips with the concat demuxer (stream copy);
  3. burns in the statements (via the existing `buildAss`) and the ASS overlays, grades the picture, and mixes the audio.

Plans B (Moments server) and C (Moments client) build on this engine.

**Tech Stack:**
- Node 20 ESM, tested with `node:test` and `node:assert/strict`.
- ffmpeg, via `child_process.spawn`. Prod runs 5.1.9; dev runs 8.x.
- `zod` (already a dependency).
- The existing kinetic caption engine.

**Spec:** `docs/superpowers/specs/2026-10-12-moments-motion-engine-design.md`

## Global Constraints

- **ffmpeg 5.1 compatibility:**
  - Every filter must exist in ffmpeg 5.1. A filter added after 5.1 fails in prod, which runs 5.1.9.
  - Filtergraphs reach ffmpeg via `-filter_complex_script` files, never inline `-filter_complex`.
  - Use `-noautorotate` on photo inputs. ffmpeg 8 auto-rotates JPEG EXIF orientation and 5.1 does not; we rotate ourselves, so both behave the same.
- **Blends:** any `blend` runs in `gbrp`. A screen blend in YUV tints everything magenta.
- **Output:**
  - The output is 1080×1920 at 30 fps, H.264 (`yuv420p`), AAC at 48 kHz and 192k, with `+faststart`.
  - Shots last between 0.35 s and 4 s.
  - The end card lasts at least 1.5 s.
- **Statements:**
  - Statements are drawn only by the existing kinetic `buildAss`. All text goes through its escaping.
  - Caption energy is `calm` below 0.34, `lively` from 0.34 to 0.66, and `wild` above 0.66.
- **Style looks:**

  | Style | Look |
  |---|---|
  | glow | `studio-gospel-gold` |
  | celebrate | `studio-lagos-night` |
  | hype | `studio-lagos-night` |
  | gallery | `studio-clean-white` |

- **Determinism:** the same inputs and seed give an identical plan. The PRNG is `mulberry32` from `server/src/lib/kinetic/director.js`.
- **Dependencies:** no new server runtime dependencies.
- **Writing code:** write files containing backslashes (ASS override tags, `\:` in drawtext, regexes) with the editor's Write/Edit tools, never with shell heredocs. Heredocs have silently eaten backslashes in this repo.
- **Commits:**
  - Run `git add` and `git commit` as separate commands. Never use `--no-verify`.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** run them from `server/` with `node --test <file>`. The full suite is `npm test`.

## Review Focus

These are the inputs most likely to break a real user's Moment that no single task's happy path covers. Each has a pinned test in the task named.

1. **A song shorter than the Moment** (a 3 s jingle for a 15 s Moment). Audio must pad with silence to the full length, not cut the video short. → Task 11 (`finishArgs` pads with `apad,atrim`) and the Task 12 smoke test.
2. **A wide or panoramic photo** (a 4:1 phone panorama). It must not be squashed. → Task 3 (split crop keeps the panel aspect) and Task 8 (wide photos only get `pan` or splits).
3. **A phone photo with EXIF rotation 6** (portrait shot held sideways). It must come out upright on both ffmpeg 5.1 and 8. → Task 9 tests: the `orientationOf` parser, and the `transpose=1` plus `-noautorotate` args.
4. **A 150 BPM track.** It must lock at 150, not at 75. → Task 1's octave test.
5. **Only 3 photos for a 60 s hype Moment** (many shots, few photos). The same photo must never appear twice in a row. → Task 8 test.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/lib/motion/testkit.js` | Test-only helpers: synthetic PCM (clicks, noise, tone), filter-name parser, ffmpeg availability. |
| `server/src/lib/motion/beats.js` | `decodePcm`, `onsetEnvelope`, `estimateTempo`, `combScore`, `beatGrid`, `chooseWindow`, `pausesFrom`. |
| `server/src/lib/motion/cuts.js` | Timing grids (`beatGridOf`, `pulseGrid`, `pauseGrid`) and `cutPoints`, i.e. shot boundaries from a grid and Energy. |
| `server/src/lib/motion/effects/common.js` | Shared expression helpers (`num`, `lerp`, `frameCount`, `anchoredXY`, `zoompan`, font path). |
| `server/src/lib/motion/effects/moves.js` | Move effects: push, punch, shake, still, pan, split2, split3. |
| `server/src/lib/motion/effects/entrances.js` | Entrance effects: cut, flash, whip, glitch, crossfade. |
| `server/src/lib/motion/effects/overlays.js` | Overlay effects: lightLeak, viewfinder (video); sparkles, doodles, rayBurst (ASS). |
| `server/src/lib/motion/effects/index.js` | Registry: `EFFECTS`, `getEffect`, `effectsOfKind`, `FFMPEG_51_FILTERS`. |
| `server/src/lib/motion/styles.js` | `STYLES`, `STYLE_IDS`, `resolveStyle`, `captionEnergyFor`. |
| `server/src/lib/motion/plan.js` | `OUTPUT`, the zod schema, and `validatePlan`. |
| `server/src/lib/motion/director.js` | `directMoment`, plus the photo-assignment and caption-placement helpers. |
| `server/src/lib/motion/prepare.js` | `orientationOf` (EXIF) and `workImageArgs` (rotate and fit a photo to a working image). |
| `server/src/lib/motion/shotArgs.js` | `shotGraph`, `shotArgs`, `lastFrameArgs`. |
| `server/src/lib/motion/finish.js` | `fxAss`, `statementsAss`, `finishArgs`. |
| `server/src/lib/motion/render.js` | `runFfmpeg`, `renderPlan`. |

**Design note — splits are moves.** The spec's style table lists `split2`/`split3` in the Overlays column. Here they are implemented as **moves**, because a split replaces how the photo fills the frame (it is the shot's zoom). The spec's behaviour (splits appear in Hype and Gallery) is unchanged.

**Design note — working image size.** The spec says to scale photos to "long side 2160". In fact, tall photos are cover-cropped to **2160×3840** (2× output), and wide photos are scaled to height **2160**. The spike showed zoompan jitters unless its input is about 2× the output, and the working image is what zoompan reads.

---

### Task 1: Beat analysis

**Files:**
- Create: `server/src/lib/motion/testkit.js`
- Create: `server/src/lib/motion/beats.js`
- Test: `server/src/lib/motion/beats.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SAMPLE_RATE = 11025`, `HOP = 256`, `FRAME_RATE = SAMPLE_RATE / HOP`.
  - `decodePcm(file, { ffmpegPath?, maxSec? = 900, spawnImpl? }) → Promise<Buffer>` (s16le mono at `SAMPLE_RATE`).
  - `onsetEnvelope(pcm: Buffer) → Float64Array`.
  - `estimateTempo(env) → number | null` (BPM within 70–160, one decimal).
  - `combScore(env, periodSec, startSec, lenSec) → { offset: number, score: number }`.
  - `beatGrid(env, bpm, startSec, lenSec) → { beats: number[], downbeats: number[], strong: number[], period: number }`. `beats` are seconds relative to `startSec`; `downbeats` and `strong` are indices into `beats`.
  - `chooseWindow(env, lenSec) → number` (start second).
  - `pausesFrom(pcm, { frameSec?, threshold?, minGapSec? }) → { start: number, end: number }[]`.
  - From `testkit.js`: `clickTrack`, `noiseTrack`, `silence`, `toneGaps`, `filterNames`, `ffmpegAvailable`.

- [ ] **Step 1: Write the test kit**

`server/src/lib/motion/testkit.js`:

```js
// Helpers shared by the motion test files. Not a test file itself.
import { spawnSync } from "node:child_process";
import { mulberry32 } from "../kinetic/director.js";
import { SAMPLE_RATE } from "./beats.js";

function pcm(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  return buf;
}

/**
 * Clicks at `bpm` for `sec` seconds: 10 ms decaying bursts. `level(t)` sets
 * each click's amplitude (0..1), so a test can make one section louder.
 * `offset` is when the first click lands.
 */
export function clickTrack({ bpm, sec, offset = 0.1, level = () => 0.8 }) {
  const n = Math.floor(sec * SAMPLE_RATE);
  const out = new Float64Array(n);
  const period = 60 / bpm;
  const clickLen = Math.floor(0.01 * SAMPLE_RATE);
  for (let t = offset; t < sec; t += period) {
    const at = Math.floor(t * SAMPLE_RATE);
    const amp = level(t);
    for (let i = 0; i < clickLen && at + i < n; i += 1) {
      out[at + i] = amp * Math.sin(i * 0.9) * (1 - i / clickLen);
    }
  }
  return pcm(out);
}

export function noiseTrack({ sec, seed = 3, amp = 0.3 }) {
  const rnd = mulberry32(seed);
  return pcm(Array.from({ length: Math.floor(sec * SAMPLE_RATE) }, () => (rnd() * 2 - 1) * amp));
}

export function silence(sec) {
  return Buffer.alloc(Math.floor(sec * SAMPLE_RATE) * 2);
}

/** A 220 Hz tone with silent gaps: `parts` is [[seconds, on?], ...]. */
export function toneGaps(parts) {
  const out = [];
  for (const [sec, on] of parts) {
    const n = Math.floor(sec * SAMPLE_RATE);
    for (let i = 0; i < n; i += 1) out.push(on ? 0.5 * Math.sin((2 * Math.PI * 220 * out.length) / SAMPLE_RATE) : 0);
  }
  return pcm(out);
}

/**
 * The filter names a list of filtergraph statements uses. Labels ([x]) and
 * single-quoted option values (which hold commas and semicolons inside
 * expressions) are removed before splitting into filters.
 */
export function filterNames(statements) {
  const names = new Set();
  for (const st of statements) {
    let text = "";
    let quoted = false;
    for (const ch of st) {
      if (ch === "'") { quoted = !quoted; continue; }
      if (!quoted) text += ch;
    }
    text = text.replace(/\[[^\]]*\]/g, "");
    for (const part of text.split(/[;,]/)) {
      const name = part.trim().split("=")[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
export function ffmpegAvailable() {
  const r = spawnSync(ff, ["-hide_banner", "-version"], { encoding: "utf8" });
  return r.status === 0;
}
export const FFMPEG = ff;
```

- [ ] **Step 2: Write the failing tests**

`server/src/lib/motion/beats.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  onsetEnvelope, estimateTempo, beatGrid, chooseWindow, pausesFrom, decodePcm, FRAME_RATE,
} from "./beats.js";
import { clickTrack, noiseTrack, silence, toneGaps } from "./testkit.js";

for (const bpm of [90, 120, 150]) {
  test(`a ${bpm} BPM click track reads as ${bpm} BPM (±1)`, () => {
    const env = onsetEnvelope(clickTrack({ bpm, sec: 30 }));
    const got = estimateTempo(env);
    assert.ok(got !== null, "tempo found");
    assert.ok(Math.abs(got - bpm) <= 1, `got ${got}`);
  });
}

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
  assert.equal(estimateTempo(onsetEnvelope(noiseTrack({ sec: 20 }))), null);
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

test("decodePcm rejects with ffmpeg's error when the file can't be read", async () => {
  const { impl } = fakeSpawn({ code: 1, out: Buffer.alloc(0), err: "Invalid data found" });
  await assert.rejects(decodePcm("bad.mp3", { spawnImpl: impl }), /Invalid data found/);
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/beats.test.js`
Expected: FAIL with `Cannot find module` for `./beats.js`.

- [ ] **Step 4: Implement `beats.js`**

`server/src/lib/motion/beats.js`:

```js
import { spawn } from "node:child_process";

/**
 * Beats for the motion director, from the audio alone.
 *
 * Mono PCM at 11 kHz becomes an onset envelope (how much the log energy
 * rises in each 23 ms frame). Tempo is the lag that best correlates the
 * envelope with itself; beat times come from the comb at that tempo that
 * collects the most onset energy. Plain JS, no dependencies.
 */
export const SAMPLE_RATE = 11025;
export const HOP = 256;
export const FRAME_RATE = SAMPLE_RATE / HOP;

const MIN_BPM = 70;
const MAX_BPM = 160;
// Best autocorrelation over the mean one. A rhythmic track scores far above;
// noise and speech sit near 1.
const TEMPO_CONFIDENCE = 1.3;
const SILENT_ENERGY = 1e-3;
const STRONG_SHARE = 0.15;

/** Mono signed 16-bit PCM at SAMPLE_RATE from any audio file ffmpeg can read. */
export function decodePcm(file, { ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg", maxSec = 900, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-t", String(maxSec), "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1"];
    const child = spawnImpl(ffmpegPath, args, { windowsHide: true });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`audio decode failed (${code}): ${stderr.trim().slice(-300)}`));
    });
  });
}

/** Rise in log energy per HOP frame, floored at 0. */
export function onsetEnvelope(pcm) {
  const samples = Math.floor((pcm?.length || 0) / 2);
  const frames = Math.floor(samples / HOP);
  const env = new Float64Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f += 1) {
    let e = 0;
    for (let i = 0; i < HOP; i += 1) {
      const s = pcm.readInt16LE((f * HOP + i) * 2) / 32768;
      e += s * s;
    }
    const level = Math.log1p(1000 * e);
    env[f] = Math.max(0, level - prev);
    prev = level;
  }
  return env;
}

/** The envelope at a fractional frame, linearly interpolated (0 outside). */
function at(env, frame) {
  if (frame < 0 || frame >= env.length - 1) return 0;
  const i = Math.floor(frame);
  const k = frame - i;
  return env[i] * (1 - k) + env[i + 1] * k;
}

/** Mean of env[f] * (env[f+lag] + env[f+2*lag]): how well the envelope repeats every `lag` frames. */
function autocorr(env, lag) {
  let sum = 0;
  let count = 0;
  for (let f = 0; f + 2 * lag < env.length - 1; f += 1) {
    sum += env[f] * (at(env, f + lag) + at(env, f + 2 * lag));
    count += 1;
  }
  return count ? sum / count : 0;
}

/**
 * The comb at `periodSec` over [startSec, startSec+lenSec) that collects the
 * most onset energy: its offset from startSec and its mean energy per tooth.
 */
export function combScore(env, periodSec, startSec, lenSec) {
  let best = { offset: 0, score: -1 };
  for (let off = 0; off < periodSec; off += 0.005) {
    let sum = 0;
    let teeth = 0;
    for (let t = startSec + off; t < startSec + lenSec; t += periodSec) {
      sum += Math.max(at(env, t * FRAME_RATE), at(env, t * FRAME_RATE - 0.5), at(env, t * FRAME_RATE + 0.5));
      teeth += 1;
    }
    const score = teeth ? sum / teeth : 0;
    if (score > best.score) best = { offset: off, score };
  }
  return best;
}

/** Tempo in BPM (70–160, one decimal), or null when nothing repeats. */
export function estimateTempo(env) {
  let total = 0;
  for (const v of env) total += v;
  if (total < SILENT_ENERGY) return null;
  const scores = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    scores.push({ bpm, score: autocorr(env, (60 / bpm) * FRAME_RATE) });
  }
  // The mean, not the median: a clean click track scores exactly 0 at most
  // lags, so its median is 0 even though its rhythm is perfect.
  const mean = scores.reduce((s, x) => s + x.score, 0) / scores.length;
  let best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  if (mean <= 0 || best.score / mean < TEMPO_CONFIDENCE) return null;
  // Every other beat repeats too, so half the tempo scores as well as the real
  // one. Prefer the faster reading while it is in range and nearly as strong.
  const double = scores.find((s) => Math.abs(s.bpm - best.bpm * 2) < 0.26);
  if (double && double.score >= 0.9 * best.score) best = double;
  // Refine to 0.1 BPM with the comb over the whole track.
  const lenSec = env.length / FRAME_RATE;
  let refined = { bpm: best.bpm, score: -1 };
  for (let bpm = best.bpm - 1; bpm <= best.bpm + 1.0001; bpm += 0.1) {
    const { score } = combScore(env, 60 / bpm, 0, lenSec);
    if (score > refined.score) refined = { bpm, score };
  }
  return Math.round(refined.bpm * 10) / 10;
}

/** Beat times in a window (relative to its start), every 4th as a downbeat, the loudest as strong. */
export function beatGrid(env, bpm, startSec, lenSec) {
  const period = 60 / bpm;
  const { offset } = combScore(env, period, startSec, lenSec);
  const beats = [];
  for (let t = offset; t < lenSec; t += period) beats.push(Math.round(t * 1000) / 1000);
  const energy = beats.map((b) => {
    const f = (startSec + b) * FRAME_RATE;
    return Math.max(at(env, f), at(env, f - 0.5), at(env, f + 0.5));
  });
  let phase = 0;
  let phaseScore = -1;
  for (let k = 0; k < 4; k += 1) {
    let s = 0;
    for (let i = k; i < beats.length; i += 4) s += energy[i];
    if (s > phaseScore) { phase = k; phaseScore = s; }
  }
  const downbeats = beats.map((_, i) => i).filter((i) => i >= phase && (i - phase) % 4 === 0);
  const ranked = beats.map((_, i) => i).sort((a, b) => energy[b] - energy[a]);
  const strong = ranked.slice(0, Math.max(1, Math.ceil(beats.length * STRONG_SHARE))).sort((a, b) => a - b);
  return { beats, downbeats, strong, period };
}

/** Start (seconds) of the `lenSec` window with the most onset energy, in 0.5 s steps. */
export function chooseWindow(env, lenSec) {
  const total = env.length / FRAME_RATE;
  if (total <= lenSec) return 0;
  const width = Math.round(lenSec * FRAME_RATE);
  const step = Math.max(1, Math.round(0.5 * FRAME_RATE));
  let best = { start: 0, sum: -1 };
  for (let f = 0; f + width <= env.length; f += step) {
    let sum = 0;
    for (let i = f; i < f + width; i += 1) sum += env[i];
    if (sum > best.sum) best = { start: f, sum };
  }
  return Math.round((best.start / FRAME_RATE) * 100) / 100;
}

/**
 * Silent gaps in speech: runs of frames whose RMS is under `threshold`,
 * at least `minGapSec` long. Leading and trailing silence is not a gap.
 */
export function pausesFrom(pcm, { frameSec = 0.02, threshold = 0.02, minGapSec = 0.25 } = {}) {
  const per = Math.max(1, Math.round(frameSec * SAMPLE_RATE));
  const frames = Math.floor(Math.floor((pcm?.length || 0) / 2) / per);
  const quiet = [];
  for (let f = 0; f < frames; f += 1) {
    let e = 0;
    for (let i = 0; i < per; i += 1) {
      const s = pcm.readInt16LE((f * per + i) * 2) / 32768;
      e += s * s;
    }
    quiet.push(Math.sqrt(e / per) < threshold);
  }
  const gaps = [];
  let runStart = -1;
  for (let f = 0; f <= frames; f += 1) {
    const q = f < frames && quiet[f];
    if (q && runStart < 0) runStart = f;
    if (!q && runStart >= 0) {
      const start = runStart * frameSec;
      const end = f * frameSec;
      const leading = runStart === 0;
      const trailing = f === frames;
      if (!leading && !trailing && end - start >= minGapSec) {
        gaps.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
      }
      runStart = -1;
    }
  }
  return gaps;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/beats.test.js`
Expected: all PASS.

Two cases may need tuning:
- **Noise or click tests fail on the confidence threshold:** tune `TEMPO_CONFIDENCE` within 1.15–1.6 and keep a comment on the measured values. Do not weaken the tests.
- **The 150 BPM case reads 75:** check the doubling rule.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/motion/testkit.js server/src/lib/motion/beats.js server/src/lib/motion/beats.test.js
```

```bash
git commit -m "feat: motion engine beat analysis (tempo, beat grid, window, pauses)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Timing grids and cut points

**Files:**
- Create: `server/src/lib/motion/cuts.js`
- Test: `server/src/lib/motion/cuts.test.js`

**Interfaces:**
- Consumes: `mulberry32` from `../kinetic/director.js`.
- Produces:
  - `MIN_SHOT = 0.35`, `MAX_SHOT = 4`, `END_CARD_MIN = 1.5`, `PULSE_SEC = 2`.
  - A grid object: `{ kind: 'beats'|'pulse'|'pauses', marks: { t: number, downbeat: boolean, strong: boolean }[], period: number|null }`.
  - `beatGridOf({ beats, downbeats, strong, period }) → grid`.
  - `pulseGrid(lengthSec) → grid`.
  - `pauseGrid(pauses: {start,end}[], lengthSec) → grid`.
  - `cutPoints({ grid, energy, lengthSec, rnd }) → { start, end, downbeat, strong }[]`. Boundaries are contiguous from 0 to `lengthSec`, rounded to 3 decimals.
  - `energyBand(energy) → 'calm'|'medium'|'hype'`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/cuts.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../kinetic/director.js";
import {
  beatGridOf, pulseGrid, pauseGrid, cutPoints, energyBand, MIN_SHOT, MAX_SHOT, END_CARD_MIN,
} from "./cuts.js";

/** A 120 BPM grid over `len` s: downbeats every 4 beats from beat 0, beat 8 strong. */
function grid120(len = 30) {
  const period = 0.5;
  const beats = [];
  for (let t = 0.2; t < len; t += period) beats.push(Math.round(t * 1000) / 1000);
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
  return beatGridOf({ beats, downbeats, strong: [8, 24], period });
}

function checkTiling(cuts, len) {
  assert.equal(cuts[0].start, 0);
  assert.equal(cuts.at(-1).end, len);
  for (let i = 1; i < cuts.length; i += 1) assert.equal(cuts[i].start, cuts[i - 1].end);
  for (const c of cuts) {
    assert.ok(c.end - c.start >= MIN_SHOT - 1e-9, `short shot ${JSON.stringify(c)}`);
    assert.ok(c.end - c.start <= MAX_SHOT + 1e-9, `long shot ${JSON.stringify(c)}`);
  }
  assert.ok(cuts.at(-1).end - cuts.at(-1).start >= END_CARD_MIN - 1e-9, "end card is long enough");
}

test("energy bands split at 0.34 and 0.66", () => {
  assert.equal(energyBand(0), "calm");
  assert.equal(energyBand(0.33), "calm");
  assert.equal(energyBand(0.34), "medium");
  assert.equal(energyBand(0.66), "medium");
  assert.equal(energyBand(0.67), "hype");
});

test("calm cuts every 4 or 8 beats, on downbeats", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const cuts = cutPoints({ grid: grid120(), energy: 0.1, lengthSec: 30, rnd: mulberry32(seed) });
    checkTiling(cuts, 30);
    for (const c of cuts.slice(1, -1)) assert.ok(c.downbeat, `seed ${seed}: cut at ${c.start} is not a downbeat`);
    // The last two shots may be the halves of an over-long end card, so only
    // the shots before them must be whole 4- or 8-beat steps.
    for (const c of cuts.slice(1, -2)) {
      const beats = Math.round((c.end - c.start) / 0.5);
      assert.ok([4, 8].includes(beats), `seed ${seed}: ${beats} beats at ${c.start}`);
    }
  }
});

test("medium cuts every 2 beats", () => {
  const cuts = cutPoints({ grid: grid120(), energy: 0.5, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  const inner = cuts.slice(1, -1).map((c) => Math.round((c.end - c.start) * 1000) / 1000);
  assert.ok(inner.every((d) => d === 1), JSON.stringify(inner));
});

test("hype cuts every beat", () => {
  const cuts = cutPoints({ grid: grid120(), energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  const inner = cuts.slice(1, -1).map((c) => Math.round((c.end - c.start) * 1000) / 1000);
  assert.ok(inner.every((d) => d === 0.5), JSON.stringify(inner));
  assert.ok(cuts.some((c) => c.strong), "the strong beats are marked");
});

test("hype bursts split a strong beat in two when half a beat is long enough", () => {
  // 80 BPM: half a beat is 0.375 s, just over MIN_SHOT.
  const period = 0.75;
  const beats = [];
  for (let t = 0; t < 20; t += period) beats.push(Math.round(t * 1000) / 1000);
  const grid = beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8], period });
  const cuts = cutPoints({ grid, energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  const at6 = cuts.find((c) => Math.abs(c.start - 6) < 1e-6);
  assert.ok(at6 && Math.abs(at6.end - 6.375) < 1e-6, JSON.stringify(cuts.slice(6, 10)));
});

test("a pulse grid cuts every 2 s and every cut is a downbeat", () => {
  const cuts = cutPoints({ grid: pulseGrid(15), energy: 0.5, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(cuts, 15);
  assert.ok(cuts.every((c) => c.downbeat));
});

test("a pause grid cuts in the voice's gaps and splits long phrases by energy", () => {
  const grid = pauseGrid([{ start: 2.9, end: 3.1 }, { start: 9.8, end: 10.2 }], 15);
  const calm = cutPoints({ grid, energy: 0.1, lengthSec: 15, rnd: mulberry32(1) });
  checkTiling(calm, 15);
  assert.ok(calm.some((c) => Math.abs(c.start - 3) < 1e-6));
  assert.ok(calm.some((c) => Math.abs(c.start - 10) < 1e-6));
  const hype = cutPoints({ grid, energy: 0.9, lengthSec: 15, rnd: mulberry32(1) });
  assert.ok(hype.slice(0, -1).every((c) => c.end - c.start <= 1.5 + 1e-9), JSON.stringify(hype));
});

test("the same seed gives the same cuts", () => {
  const a = cutPoints({ grid: grid120(60), energy: 0.2, lengthSec: 60, rnd: mulberry32(9) });
  const b = cutPoints({ grid: grid120(60), energy: 0.2, lengthSec: 60, rnd: mulberry32(9) });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/cuts.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `cuts.js`**

`server/src/lib/motion/cuts.js`:

```js
/**
 * Where the shots change. A grid of candidate times (beats, voice pauses, or
 * an even pulse) plus Energy gives contiguous shot boundaries from 0 to the
 * Moment's length.
 */
export const MIN_SHOT = 0.35;
export const MAX_SHOT = 4;
export const END_CARD_MIN = 1.5;
export const PULSE_SEC = 2;

const r3 = (n) => Math.round(n * 1000) / 1000;
const MAX_BY_BAND = { calm: 4, medium: 3, hype: 1.5 };

export function energyBand(energy) {
  if (energy < 0.34) return "calm";
  if (energy <= 0.66) return "medium";
  return "hype";
}

export function beatGridOf({ beats, downbeats = [], strong = [], period }) {
  const down = new Set(downbeats);
  const hard = new Set(strong);
  return {
    kind: "beats",
    marks: beats.map((t, i) => ({ t, downbeat: down.has(i), strong: hard.has(i) })),
    period,
  };
}

export function pulseGrid(lengthSec) {
  const marks = [];
  for (let t = PULSE_SEC; t < lengthSec; t += PULSE_SEC) marks.push({ t: r3(t), downbeat: true, strong: false });
  return { kind: "pulse", marks, period: PULSE_SEC };
}

export function pauseGrid(pauses, lengthSec) {
  const marks = (pauses || [])
    .map((p) => r3((p.start + p.end) / 2))
    .filter((t) => t > 0 && t < lengthSec)
    .map((t) => ({ t, downbeat: true, strong: false }));
  return { kind: "pauses", marks, period: null };
}

/** Boundaries chosen from the grid's marks, before the length rules. */
function rawBoundaries({ grid, band, rnd }) {
  const marks = grid.marks;
  if (grid.kind !== "beats") return marks.map((m) => ({ ...m }));
  const out = [];
  if (band === "hype") {
    marks.forEach((m, i) => {
      out.push({ ...m });
      const next = marks[i + 1];
      if (m.strong && next && (next.t - m.t) / 2 >= MIN_SHOT) {
        out.push({ t: r3((m.t + next.t) / 2), downbeat: false, strong: false });
      }
    });
    return out;
  }
  // Calm and medium step from the first downbeat so steps of 2/4/8 stay on the bar.
  let i = Math.max(0, marks.findIndex((m) => m.downbeat));
  while (i < marks.length) {
    out.push({ ...marks[i] });
    const step = band === "medium" ? 2 : rnd() < 0.5 ? 4 : 8;
    i += step;
  }
  return out;
}

/** Contiguous shots from 0 to lengthSec, every one MIN_SHOT..MAX_SHOT, the last at least END_CARD_MIN. */
export function cutPoints({ grid, energy, lengthSec, rnd }) {
  const band = energyBand(energy);
  const maxLen = grid.kind === "beats" ? MAX_SHOT : MAX_BY_BAND[band];
  const inner = rawBoundaries({ grid, band, rnd }).filter((m) => m.t >= MIN_SHOT && m.t <= lengthSec - MIN_SHOT);

  // Starts of shots: 0, then each boundary.
  let starts = [{ t: 0, downbeat: true, strong: false }, ...inner];
  // Drop boundaries that make a shot shorter than MIN_SHOT.
  starts = starts.filter((s, i, arr) => i === 0 || s.t - arr[i - 1].t >= MIN_SHOT - 1e-9);
  while (starts.length > 1 && lengthSec - starts.at(-1).t < MIN_SHOT) starts.pop();
  // The end card: merge trailing shots until it is long enough.
  while (starts.length > 1 && lengthSec - starts.at(-1).t < END_CARD_MIN) starts.pop();

  const cuts = [];
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].t : lengthSec;
    const span = end - s.t;
    const pieces = Math.max(1, Math.ceil(span / maxLen - 1e-9));
    for (let k = 0; k < pieces; k += 1) {
      cuts.push({
        start: r3(s.t + (span * k) / pieces),
        end: r3(k === pieces - 1 ? end : s.t + (span * (k + 1)) / pieces),
        downbeat: k === 0 ? s.downbeat : false,
        strong: k === 0 ? s.strong : false,
      });
    }
  });
  // Splitting may leave an end card under END_CARD_MIN: give it the shot before.
  while (cuts.length > 1 && cuts.at(-1).end - cuts.at(-1).start < END_CARD_MIN - 1e-9) {
    const last = cuts.pop();
    cuts.at(-1).end = last.end;
  }
  if (cuts.at(-1).end - cuts.at(-1).start > MAX_SHOT) {
    const last = cuts.pop();
    const mid = r3((last.start + last.end) / 2);
    cuts.push({ ...last, end: mid }, { start: mid, end: last.end, downbeat: false, strong: false });
  }
  return cuts;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/cuts.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/motion/cuts.js server/src/lib/motion/cuts.test.js
```

```bash
git commit -m "feat: motion engine timing grids and cut points

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Effect foundation, registry and moves

**Files:**
- Create: `server/src/lib/motion/effects/common.js`
- Create: `server/src/lib/motion/effects/moves.js`
- Create: `server/src/lib/motion/effects/index.js` (moves only for now; Tasks 4–5 add entrances and overlays)
- Test: `server/src/lib/motion/effects/moves.test.js`

**Interfaces:**
- Consumes: `FONT_DIR`, `escapeFontPath` from `../../videoFilters.js`; `filterNames` from `../testkit.js`.
- Produces:
  - **Effect module shape:** `{ id, kind: 'move'|'entrance'|'overlay', needs: string[], shapes?: ('tall'|'wide')[], strong: boolean, graph?({ input, output, shot, ctx, tag }) → string[], assEvents?({ shot, ctx, rnd }) → string[] }`.
  - **`ctx`:** `{ w, h, fps, frames, dur, prev: string|null }`. `prev` is the input label of the previous shot's last frame, set only for a crossfade.
  - **`shot`** (as defined by the plan schema, Task 7): `{ start, end, photo, role, move: { id, intensity }, entrance: { id }, overlays: { id }[], anchor: { x, y } }`.
  - **`common.js`:** `num(n, d=3)`, `lerp(a, b, t)`, `frameCount(shot, fps)`, `anchoredXY(anchor)`, `zoompan({ input, output, z, x, y, ctx })`, `FONT_ANTON`.
  - **`index.js`:** `EFFECTS` (frozen map id → module), `getEffect(id)` (own keys only, else null), `effectsOfKind(kind)`, `FFMPEG_51_FILTERS` (Set).

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/effects/moves.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { frameCount, anchoredXY } from "./common.js";
import { filterNames } from "../testkit.js";

const ctx = { w: 1080, h: 1920, fps: 30, frames: 45, dur: 1.5, prev: null };
const shot = (move, intensity = 0.5) => ({
  start: 0, end: 1.5, photo: 0, role: "body", move: { id: move, intensity }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 },
});
const MOVES = ["push", "punch", "shake", "still", "pan", "split2", "split3"];

test("every move is registered as a move", () => {
  assert.deepEqual(effectsOfKind("move").map((e) => e.id).sort(), [...MOVES].sort());
  for (const id of MOVES) assert.equal(getEffect(id).kind, "move");
});

test("getEffect ignores the prototype chain", () => {
  assert.equal(getEffect("constructor"), null);
  assert.equal(getEffect("__proto__"), null);
  assert.equal(getEffect("nope"), null);
});

for (const id of MOVES) {
  test(`${id} reads its input label, writes its output label, and uses only ffmpeg 5.1 filters`, () => {
    const g = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx, tag: "m" });
    assert.ok(g.length >= 1);
    assert.ok(g.some((s) => s.includes("[0:v]")), "reads the input");
    assert.ok(g.at(-1).endsWith("[mv]"), "ends at the output");
    for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  });
}

test("zoom moves make exactly the shot's frame count at the output size", () => {
  for (const id of ["push", "punch", "shake", "still"]) {
    const [g] = getEffect(id).graph({ input: "[0:v]", output: "[mv]", shot: shot(id), ctx, tag: "m" });
    assert.ok(g.includes(":d=45:s=1080x1920:fps=30"), `${id}: ${g}`);
  }
});

test("a stronger push zooms further", () => {
  const z = (i) => getEffect("push").graph({ input: "[0:v]", output: "[mv]", shot: shot("push", i), ctx, tag: "m" })[0].match(/z='1\+([\d.]+)\*on/)[1];
  assert.ok(Number(z(1)) > Number(z(0)));
});

test("the zoom stays anchored where the faces are", () => {
  assert.deepEqual(anchoredXY({ x: 0.5, y: 0.38 }), { x: "(iw-iw/zoom)*0.500", y: "(ih-ih/zoom)*0.380" });
});

test("pan travels a 9:16 window across a wide photo", () => {
  const [g] = getEffect("pan").graph({ input: "[0:v]", output: "[mv]", shot: shot("pan"), ctx, tag: "m" });
  assert.match(g, /crop=w='ih\*1080\/1920':h=ih/);
  assert.match(g, /x='\(iw-ow\)\*\(0\.15\+0\.7\*t\/1\.500\)'/);
  assert.match(g, /scale=1080:1920/);
});

test("split panels crop to the panel's own shape, so wide photos are never squashed", () => {
  const g = getEffect("split3").graph({ input: "[0:v]", output: "[mv]", shot: shot("split3"), ctx, tag: "m" }).join(";");
  // Panel 1080x640: the crop keeps w:h = 1080:640 whichever side limits it.
  assert.match(g, /crop=w='min\(iw,ih\*1080\/640\)':h='min\(ih,iw\*640\/1080\)'/);
  assert.equal((g.match(/zoompan=/g) || []).length, 3);
});

test("only pan and the splits take wide photos", () => {
  const wide = MOVES.filter((id) => getEffect(id).shapes.includes("wide")).sort();
  assert.deepEqual(wide, ["pan", "split2", "split3"]);
});

test("splits are strong; zoom moves are not", () => {
  assert.equal(getEffect("split2").strong, true);
  assert.equal(getEffect("split3").strong, true);
  assert.equal(getEffect("push").strong, false);
});

test("frameCount tiles consecutive shots exactly", () => {
  const a = { start: 0, end: 0.517 };
  const b = { start: 0.517, end: 1.033 };
  assert.equal(frameCount(a, 30) + frameCount(b, 30), Math.round(1.033 * 30));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/effects/moves.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `common.js`**

`server/src/lib/motion/effects/common.js`:

```js
import path from "node:path";
import { FONT_DIR, escapeFontPath } from "../../videoFilters.js";

/** Anton, escaped for a drawtext fontfile inside a filtergraph. */
export const FONT_ANTON = escapeFontPath(path.join(FONT_DIR, "Anton.ttf"));

/** A number for a filter expression: fixed decimals, never exponent notation. */
export const num = (n, d = 3) => Number(n).toFixed(d);

/** a..b by t, with t clamped to 0..1. */
export const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, Number(t) || 0));

/** Frames a shot covers. Both ends are rounded to frames, so consecutive shots tile exactly. */
export function frameCount(shot, fps) {
  return Math.max(1, Math.round(shot.end * fps) - Math.round(shot.start * fps));
}

/** zoompan x/y that keep the anchor (0..1 of the picture) in place while zooming. */
export function anchoredXY(anchor) {
  return { x: `(iw-iw/zoom)*${num(anchor.x)}`, y: `(ih-ih/zoom)*${num(anchor.y)}` };
}

/** One zoompan over a still: ctx.frames frames at the output size. */
export function zoompan({ input, output, z, x, y, ctx }) {
  return `${input}zoompan=z='${z}':x='${x}':y='${y}':d=${ctx.frames}:s=${ctx.w}x${ctx.h}:fps=${ctx.fps}${output}`;
}
```

- [ ] **Step 4: Implement `moves.js`**

`server/src/lib/motion/effects/moves.js`:

```js
import { anchoredXY, lerp, num, zoompan } from "./common.js";

/**
 * Moves: how the photo fills the frame over the shot. Tall photos arrive as
 * a 2160x3840 working image (2x the output, so zooms are smooth); wide ones
 * at height 2160. zoompan clamps x/y to the picture, so offsets never show
 * an edge.
 */
const zoomMove = (id, build) => ({
  id, kind: "move", needs: [], shapes: ["tall"], strong: false,
  graph({ input, output, shot, ctx }) {
    const { z, x, y } = build(shot, ctx);
    return [zoompan({ input, output, z, x, y, ctx })];
  },
});

export const push = zoomMove("push", (shot, ctx) => {
  const gain = lerp(0.05, 0.14, shot.move.intensity);
  return { z: `1+${num(gain)}*on/${ctx.frames}`, ...anchoredXY(shot.anchor) };
});

export const punch = zoomMove("punch", (shot, ctx) => {
  const kick = lerp(0.12, 0.3, shot.move.intensity);
  return { z: `1.04+${num(kick)}*pow(max(0,1-on/7),2)+0.04*on/${ctx.frames}`, ...anchoredXY(shot.anchor) };
});

export const shake = zoomMove("shake", (shot, ctx) => {
  const amp = lerp(16, 48, shot.move.intensity);
  const { x, y } = anchoredXY(shot.anchor);
  return {
    z: `1.12+0.03*on/${ctx.frames}`,
    x: `${x}+${num(amp, 1)}*sin(on*2.3)*exp(-on/6)`,
    y: `${y}+${num(amp * 0.8, 1)}*cos(on*2.9)*exp(-on/6)`,
  };
});

export const still = zoomMove("still", (shot, ctx) => ({ z: `1.02+0.01*on/${ctx.frames}`, ...anchoredXY(shot.anchor) }));

/** A landscape photo: a 9:16 window travelling across it. */
export const pan = {
  id: "pan", kind: "move", needs: [], shapes: ["tall", "wide"], strong: false,
  graph({ input, output, ctx }) {
    return [
      `${input}loop=loop=${ctx.frames - 1}:size=1:start=0,setpts=N/${ctx.fps}/TB,` +
        `crop=w='ih*${ctx.w}/${ctx.h}':h=ih:x='(iw-ow)*(0.15+0.7*t/${num(ctx.dur)})':y=0,` +
        `scale=${ctx.w}:${ctx.h},setsar=1,fps=${ctx.fps}${output}`,
    ];
  },
};

/**
 * n panels stacked, each a band of the photo slowly zooming, entering 0.15 s
 * apart (the middle one mirrored in a triple). Each crop keeps the panel's
 * own shape whichever side of the photo limits it, so nothing is squashed.
 */
function split(n) {
  return {
    id: `split${n}`, kind: "move", needs: [], shapes: ["tall", "wide"], strong: true,
    graph({ input, output, ctx, tag }) {
      const ph = Math.floor(ctx.h / n);
      const bands = n === 3 ? [0.1, 0.5, 0.9] : [0.15, 0.75];
      const lines = [`${input}split=${n}${bands.map((_, k) => `[s${tag}${k}]`).join("")}`];
      bands.forEach((band, k) => {
        const flip = n === 3 && k === 1 ? ",hflip" : "";
        lines.push(
          `[s${tag}${k}]crop=w='min(iw,ih*${ctx.w}/${ph})':h='min(ih,iw*${ph}/${ctx.w})':x='(iw-ow)/2':y='(ih-oh)*${num(band)}'${flip},` +
            `zoompan=z='1+0.06*on/${ctx.frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${ctx.frames}:s=${ctx.w}x${ph}:fps=${ctx.fps}[p${tag}${k}]`,
        );
      });
      lines.push(`color=c=black:s=${ctx.w}x${ctx.h}:r=${ctx.fps}:d=${num(ctx.dur)}[bg${tag}]`);
      let cur = `[bg${tag}]`;
      bands.forEach((_, k) => {
        const out = k === n - 1 ? output : `[l${tag}${k}]`;
        lines.push(`${cur}[p${tag}${k}]overlay=0:${k * ph + (k ? 4 : 0)}:enable='gte(t,${num(k * 0.15, 2)})'${out}`);
        cur = out;
      });
      return lines;
    },
  };
}

export const split2 = split(2);
export const split3 = split(3);
```

- [ ] **Step 5: Implement `index.js`**

`server/src/lib/motion/effects/index.js`:

```js
import * as moves from "./moves.js";

/**
 * Every motion effect by id. The director picks from here by kind; the plan
 * validator and renderer look effects up by id.
 */
export const EFFECTS = Object.freeze(
  Object.fromEntries([...Object.values(moves)].map((e) => [e.id, Object.freeze(e)])),
);

export function getEffect(id) {
  return typeof id === "string" && Object.hasOwn(EFFECTS, id) ? EFFECTS[id] : null;
}

export function effectsOfKind(kind) {
  return Object.values(EFFECTS).filter((e) => e.kind === kind);
}

/**
 * Filters the engine may use: all present in ffmpeg 5.1 (prod runs 5.1.9).
 * A test checks every effect's graph against this list. Add a filter here
 * only after checking it exists in 5.1's filter list.
 */
export const FFMPEG_51_FILTERS = new Set([
  "zoompan", "loop", "setpts", "crop", "scale", "setsar", "fps", "split", "hflip", "color", "overlay",
  "format", "null", "fade", "gblur", "rgbashift", "noise", "eq", "xfade", "geq", "blend",
  "drawbox", "drawtext", "vignette", "trim", "ass", "colorbalance", "concat",
]);
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/effects/moves.test.js`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/lib/motion/effects/common.js server/src/lib/motion/effects/moves.js server/src/lib/motion/effects/index.js server/src/lib/motion/effects/moves.test.js
```

```bash
git commit -m "feat: motion effect registry and moves (push, punch, shake, still, pan, splits)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Entrances

**Files:**
- Create: `server/src/lib/motion/effects/entrances.js`
- Modify: `server/src/lib/motion/effects/index.js` (register the entrances)
- Test: `server/src/lib/motion/effects/entrances.test.js`

**Interfaces:**
- Consumes: the effect module shape and `ctx` from Task 3; `num`, `lerp` from `common.js`.
- Produces: entrances `cut`, `flash`, `whip`, `glitch`, `crossfade`. `flash` and `glitch` are `strong: true`. `crossfade` uses `ctx.prev` and degrades to `null` without it.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/effects/entrances.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { filterNames } from "../testkit.js";

const ctx = (over = {}) => ({ w: 1080, h: 1920, fps: 30, frames: 45, dur: 1.5, prev: null, ...over });
const shot = { start: 1, end: 2.5, photo: 0, role: "body", move: { id: "push", intensity: 0.5 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 } };
const IDS = ["cut", "flash", "whip", "glitch", "crossfade"];

test("every entrance is registered as an entrance", () => {
  assert.deepEqual(effectsOfKind("entrance").map((e) => e.id).sort(), [...IDS].sort());
});

for (const id of IDS) {
  test(`${id} reads its input, writes its output, and uses only ffmpeg 5.1 filters`, () => {
    for (const c of [ctx(), ctx({ prev: "[1:v]" })]) {
      const g = getEffect(id).graph({ input: "[ov]", output: "[en]", shot, ctx: c, tag: "e" });
      assert.ok(g.some((s) => s.includes("[ov]")));
      assert.ok(g.at(-1).endsWith("[en]"));
      for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
    }
  });
}

test("cut passes the picture through unchanged", () => {
  assert.deepEqual(getEffect("cut").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx(), tag: "e" }), ["[ov]null[en]"]);
});

test("flash fades in from white at the start of the shot", () => {
  const [g] = getEffect("flash").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx(), tag: "e" });
  assert.match(g, /fade=t=in:st=0:d=0\.\d+:color=white/);
});

test("crossfade blends from the previous shot's last frame", () => {
  const g = getEffect("crossfade").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx({ prev: "[1:v]" }), tag: "e" }).join(";");
  assert.match(g, /\[1:v\]scale=1080:1920/);
  assert.match(g, /xfade=transition=fade:duration=0\.500:offset=0\[en\]/);
});

test("crossfade with no previous frame is a cut", () => {
  assert.deepEqual(getEffect("crossfade").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx(), tag: "e" }), ["[ov]null[en]"]);
});

test("a short shot gets a shorter crossfade", () => {
  const g = getEffect("crossfade").graph({ input: "[ov]", output: "[en]", shot, ctx: ctx({ prev: "[1:v]", dur: 0.5, frames: 15 }), tag: "e" }).join(";");
  assert.match(g, /duration=0\.200/);
});

test("flash and glitch are strong; cut, whip and crossfade are not", () => {
  assert.deepEqual(IDS.filter((id) => getEffect(id).strong).sort(), ["flash", "glitch"]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/effects/entrances.test.js`
Expected: FAIL (the entrances are not registered).

- [ ] **Step 3: Implement `entrances.js`**

`server/src/lib/motion/effects/entrances.js`:

```js
import { lerp, num } from "./common.js";

/**
 * Entrances: how a shot arrives. They run last in the shot's graph (after
 * overlays), so a flash or glitch covers everything on screen.
 */
const entrance = (id, strong, graph) => ({ id, kind: "entrance", needs: [], strong, graph });

export const cut = entrance("cut", false, ({ input, output }) => [`${input}null${output}`]);

export const flash = entrance("flash", true, ({ input, output, shot }) => [
  `${input}fade=t=in:st=0:d=${num(lerp(0.12, 0.24, shot.move.intensity), 2)}:color=white${output}`,
]);

export const whip = entrance("whip", false, ({ input, output }) => [
  `${input}gblur=sigma=40:sigmaV=0.1:enable='lt(t,0.18)'${output}`,
]);

export const glitch = entrance("glitch", true, ({ input, output, tag }) => [
  `${input}split[g${tag}a][g${tag}b]`,
  `[g${tag}b]rgbashift=rh=-24:bh=24:gv=10,noise=alls=40:allf=t,eq=contrast=1.3[g${tag}c]`,
  `[g${tag}a][g${tag}c]overlay=0:0:enable='lt(t,0.14)+between(t,0.36,0.43)'${output}`,
]);

/**
 * A blend from the previous shot's last frame (a still, input ctx.prev) into
 * this shot. Both sides are normalised to the same size, pixel format and
 * frame rate, because xfade refuses mismatched inputs. Without a previous
 * frame (the first shot) it is a cut.
 */
export const crossfade = entrance("crossfade", false, ({ input, output, ctx, tag }) => {
  if (!ctx.prev) return [`${input}null${output}`];
  const d = Math.min(0.5, ctx.dur * 0.4);
  return [
    `${ctx.prev}scale=${ctx.w}:${ctx.h},setsar=1,format=yuv420p,loop=loop=${ctx.frames - 1}:size=1:start=0,setpts=N/${ctx.fps}/TB,fps=${ctx.fps}[xp${tag}]`,
    `${input}format=yuv420p,setsar=1,setpts=N/${ctx.fps}/TB,fps=${ctx.fps}[xc${tag}]`,
    `[xp${tag}][xc${tag}]xfade=transition=fade:duration=${num(d)}:offset=0${output}`,
  ];
});
```

- [ ] **Step 4: Register the entrances in `index.js`**

In `server/src/lib/motion/effects/index.js`, add the import and include the entrances in `EFFECTS`:

```js
import * as moves from "./moves.js";
import * as entrances from "./entrances.js";

export const EFFECTS = Object.freeze(
  Object.fromEntries([...Object.values(moves), ...Object.values(entrances)].map((e) => [e.id, Object.freeze(e)])),
);
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/effects/`
Expected: all PASS (the moves tests still pass).

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/motion/effects/entrances.js server/src/lib/motion/effects/index.js server/src/lib/motion/effects/entrances.test.js
```

```bash
git commit -m "feat: motion entrances (cut, flash, whip, glitch, crossfade)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Overlays

**Files:**
- Create: `server/src/lib/motion/effects/overlays.js` (write this file with the Write tool: it holds ASS `\` override tags and a drawtext `\:`)
- Modify: `server/src/lib/motion/effects/index.js` (register the overlays)
- Test: `server/src/lib/motion/effects/overlays.test.js`

**Interfaces:**
- Consumes: `num`, `lerp`, `FONT_ANTON` from `common.js`; `assTime` from `../../kinetic/text.js`; `mulberry32` from `../../kinetic/director.js`.
- Produces:
  - **Video overlays with `graph`:** `lightLeak`, `viewfinder`.
  - **ASS overlays with `assEvents({ shot, ctx, rnd }) → string[]`:** `sparkles`, `doodles`, `rayBurst`. Their Dialogue lines use style `FX`, layer 2, in **global** time (`shot.start`-based).
  - None of the overlays is strong.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/effects/overlays.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../../kinetic/director.js";
import { getEffect, effectsOfKind, FFMPEG_51_FILTERS } from "./index.js";
import { filterNames } from "../testkit.js";

const ctx = { w: 1080, h: 1920, fps: 30, frames: 60, dur: 2, prev: null };
const shot = { start: 10, end: 12, photo: 0, role: "body", move: { id: "push", intensity: 0.7 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 } };

test("every overlay is registered as an overlay", () => {
  assert.deepEqual(effectsOfKind("overlay").map((e) => e.id).sort(), ["doodles", "lightLeak", "rayBurst", "sparkles", "viewfinder"]);
});

for (const id of ["lightLeak", "viewfinder"]) {
  test(`${id} is a video overlay using only ffmpeg 5.1 filters`, () => {
    const g = getEffect(id).graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" });
    assert.ok(g.some((s) => s.includes("[mv]")));
    assert.ok(g.at(-1).endsWith("[ov]"));
    for (const name of filterNames(g)) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  });
}

test("the light leak blends in planar RGB (a YUV screen blend tints magenta)", () => {
  const g = getEffect("lightLeak").graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" }).join(";");
  assert.match(g, /\[mv\]format=gbrp/);
  assert.match(g, /blend=all_mode=screen:eof_action=pass\[ov\]/);
  assert.match(g, /color=c=black:s=270x480/, "the leak is drawn small and scaled up");
});

test("the viewfinder draws its labels in Anton with an escaped running clock", () => {
  const g = getEffect("viewfinder").graph({ input: "[mv]", output: "[ov]", shot, ctx, tag: "o0" }).join(";");
  assert.match(g, /fontfile='[^']*Anton\.ttf'/);
  assert.ok(g.includes("text='%{pts\\:hms}'"), "the colon in pts:hms is escaped");
});

for (const id of ["sparkles", "doodles", "rayBurst"]) {
  test(`${id} writes FX Dialogue lines inside the shot's own time`, () => {
    const lines = getEffect(id).assEvents({ shot, ctx, rnd: mulberry32(4) });
    assert.ok(lines.length > 0);
    for (const l of lines) {
      assert.match(l, /^Dialogue: \d,\d:\d\d:\d\d\.\d\d,\d:\d\d:\d\d\.\d\d,FX,,0,0,0,,/);
      const [, a, b] = l.match(/^Dialogue: \d,(\d:\d\d:\d\d\.\d\d),(\d:\d\d:\d\d\.\d\d)/);
      const sec = (t) => { const [h, m, s] = t.split(":"); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
      assert.ok(sec(a) >= 10 - 1e-9 && sec(b) <= 12 + 1e-9, l);
    }
  });
}

test("ASS overlays are deterministic for a seed", () => {
  const a = getEffect("sparkles").assEvents({ shot, ctx, rnd: mulberry32(4) });
  const b = getEffect("sparkles").assEvents({ shot, ctx, rnd: mulberry32(4) });
  assert.deepEqual(a, b);
});

test("more intensity means more sparkles", () => {
  const n = (i) => getEffect("sparkles").assEvents({ shot: { ...shot, move: { id: "push", intensity: i } }, ctx, rnd: mulberry32(1) }).length;
  assert.ok(n(1) > n(0));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/effects/overlays.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `overlays.js`**

Use the Write tool. `server/src/lib/motion/effects/overlays.js`:

```js
import { assTime } from "../../kinetic/text.js";
import { FONT_ANTON, lerp, num } from "./common.js";

/**
 * Overlays: decoration on top of a shot. Video overlays add filters to the
 * shot's own graph; ASS overlays return Dialogue lines (global time, style
 * FX) that the finish stage draws over the whole video in one pass.
 */
const videoOverlay = (id, graph) => ({ id, kind: "overlay", needs: [], strong: false, graph });
const assOverlay = (id, assEvents) => ({ id, kind: "overlay", needs: [], strong: false, assEvents });

/**
 * A warm orange leak sweeping across for 0.9 s, screen-blended. It is drawn
 * at 270x480 and scaled up (geq per pixel at full size is slow), and both
 * sides blend in gbrp: a YUV screen blend tints the picture magenta.
 */
export const lightLeak = videoOverlay("lightLeak", ({ input, output, ctx, tag }) => {
  const G = "(max(0,1-hypot(X-W*(0.9-0.5*T/0.9),Y-H*0.25)/(W*0.95))*max(0,1-T/0.9))";
  return [
    `color=c=black:s=270x480:r=${ctx.fps}:d=${num(Math.min(ctx.dur, 0.9))},format=gbrp,` +
      `geq=r='255*${G}':g='150*${G}':b='60*${G}',scale=${ctx.w}:${ctx.h},format=gbrp[lk${tag}]`,
    `${input}format=gbrp[lb${tag}]`,
    `[lb${tag}][lk${tag}]blend=all_mode=screen:eof_action=pass${output}`,
  ];
});

/** A camera viewfinder: corner brackets, a blinking REC dot, labels, a running clock, centre cross. */
export const viewfinder = videoOverlay("viewfinder", ({ input, output, ctx }) => {
  const { w, h } = ctx;
  const c = "white@0.92";
  const L = 105;
  const T = 8;
  const I = 69;
  const corners = [
    [I, I, L, T], [I, I, T, L], [w - I - L, I, L, T], [w - I - T, I, T, L],
    [I, h - I - T, L, T], [I, h - I - L, T, L], [w - I - L, h - I - T, L, T], [w - I - T, h - I - L, T, L],
  ].map(([x, y, bw, bh]) => `drawbox=x=${x}:y=${y}:w=${bw}:h=${bh}:color=${c}:t=fill`);
  const filters = [
    ...corners,
    `drawbox=x=${I + 27}:y=${I + 45}:w=24:h=24:color=red@0.95:t=fill:enable='lt(mod(t,0.8),0.5)'`,
    `drawtext=fontfile='${FONT_ANTON}':text='REC':x=${I + 66}:y=${I + 36}:fontsize=45:fontcolor=white`,
    `drawtext=fontfile='${FONT_ANTON}':text='4K 60':x=w-tw-${I + 27}:y=${I + 36}:fontsize=39:fontcolor=white@0.9`,
    `drawtext=fontfile='${FONT_ANTON}':text='%{pts\\:hms}':x=${I + 27}:y=h-${I + 90}:fontsize=39:fontcolor=white@0.9`,
    `drawbox=x=w/2-45:y=h/2-1:w=90:h=3:color=white@0.6:t=fill`,
    `drawbox=x=w/2-1:y=h/2-45:w=3:h=90:color=white@0.6:t=fill`,
    `vignette=angle=0.55`,
  ];
  return [`${input}${filters.join(",")}${output}`];
});

const STAR = "m 0 -14 l 3 -3 14 0 3 3 0 14 -3 3 -14 0 -3 -3";
const CROSS = "m -14 -18 l 0 -4 14 -18 18 -14 4 0 18 14 14 18 0 4 -14 18 -18 14 -4 0 -18 -14";
const PLUS = "m -4 -18 l 4 -18 4 -4 18 -4 18 4 4 4 4 18 -4 18 -4 4 -18 4 -18 -4 -4 -4";
const GOLD = "&H33E6FF&";
const RAYS = ["&H3C3CFF&", "&H33E6FF&", "&H5AFF5A&", "&HFFC83C&", "&HFF64C8&", "&H00A5FF&"];

/** Gold and white stars twinkling up the middle of the frame. */
export const sparkles = assOverlay("sparkles", ({ shot, ctx, rnd }) => {
  const count = Math.round(lerp(8, 24, shot.move.intensity));
  const dur = shot.end - shot.start;
  const lines = [];
  for (let k = 0; k < count; k += 1) {
    const t = shot.start + (dur * k) / count;
    const end = Math.min(shot.end, t + 0.7);
    const x = Math.round(ctx.w * (0.15 + 0.7 * rnd()));
    const y = Math.round(ctx.h * (0.25 + 0.5 * rnd()));
    const dx = Math.round((rnd() - 0.5) * 90);
    const dy = Math.round(60 + rnd() * 90);
    const s = Math.round(100 + rnd() * 90);
    const col = rnd() > 0.5 ? GOLD : "&HFFFFFF&";
    lines.push(`Dialogue: 2,${assTime(t)},${assTime(end)},FX,,0,0,0,,{\\an5\\move(${x},${y},${x + dx},${y - dy})\\bord0\\shad0\\1c${col}\\fscx${s}\\fscy${s}\\t(0,350,\\fscx${Math.round(s * 1.6)}\\fscy${Math.round(s * 1.6)}\\frz90)\\fad(60,300)\\p1}${STAR}{\\p0}`);
  }
  return lines;
});

/** Hand-drawn crosses and pluses popping in around the edges. */
export const doodles = assOverlay("doodles", ({ shot, ctx, rnd }) => {
  const dur = shot.end - shot.start;
  const spots = [[0.12, 0.15], [0.85, 0.22], [0.8, 0.78], [0.18, 0.85]];
  return spots.map(([fx, fy], k) => {
    const t = shot.start + Math.min(dur * 0.6, k * 0.15);
    const x = Math.round(ctx.w * fx + (rnd() - 0.5) * 60);
    const y = Math.round(ctx.h * fy + (rnd() - 0.5) * 60);
    const shape = k % 2 === 0 ? CROSS : PLUS;
    return `Dialogue: 2,${assTime(t)},${assTime(shot.end)},FX,,0,0,0,,{\\an5\\pos(${x},${y})\\bord3\\3c&H000000&\\shad0\\1c&HFFFFFF&\\fscx60\\fscy60\\t(0,120,\\fscx160\\fscy160)\\t(120,220,\\fscx150\\fscy150)\\p1}${shape}{\\p0}`;
  });
});

/** The end card: a burst of coloured rays from the centre. */
export const rayBurst = assOverlay("rayBurst", ({ shot, ctx, rnd }) => {
  const lines = [];
  const cx = ctx.w / 2;
  const cy = ctx.h / 2;
  for (let k = 0; k < 48; k += 1) {
    const a = (k / 48) * Math.PI * 2 + rnd() * 0.1;
    const r0 = 60 + rnd() * 45;
    const r1 = 450 + rnd() * 390;
    const t0 = shot.start + rnd() * 0.15;
    const end = Math.min(shot.end, t0 + 0.9);
    const deg = Math.round((-a * 180) / Math.PI);
    const p = (r) => `${Math.round(cx + Math.cos(a) * r)},${Math.round(cy + Math.sin(a) * r)}`;
    lines.push(`Dialogue: 2,${assTime(t0)},${assTime(end)},FX,,0,0,0,,{\\an5\\move(${p(r0)},${p(r1)},0,700)\\frz${deg}\\bord0\\shad0\\blur2\\1c${RAYS[k % RAYS.length]}\\fad(0,350)\\p1}m 0 -4 l 51 -4 51 4 0 4{\\p0}`);
  }
  return lines;
});
```

- [ ] **Step 4: Register the overlays in `index.js`**

```js
import * as moves from "./moves.js";
import * as entrances from "./entrances.js";
import * as overlays from "./overlays.js";

export const EFFECTS = Object.freeze(
  Object.fromEntries(
    [...Object.values(moves), ...Object.values(entrances), ...Object.values(overlays)].map((e) => [e.id, Object.freeze(e)]),
  ),
);
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/effects/`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/motion/effects/overlays.js server/src/lib/motion/effects/index.js server/src/lib/motion/effects/overlays.test.js
```

```bash
git commit -m "feat: motion overlays (light leak, viewfinder, sparkles, doodles, ray burst)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Smart styles

**Files:**
- Create: `server/src/lib/motion/styles.js`
- Test: `server/src/lib/motion/styles.test.js`

**Interfaces:**
- Consumes: `getEffect` from `./effects/index.js`; `isStudioLook` from `../kinetic/looks.js`.
- Produces:
  - `STYLES`: frozen, keyed by id. Each style is `{ id, label, description, look, grade, moves: {id: weight}, entrances: {id: weight}, overlays: {id: weight}, overlayRate, endOverlay }`.
  - `STYLE_IDS = ['glow','celebrate','hype','gallery']`.
  - `resolveStyle(id)`: own keys only; falls back to `celebrate`.
  - `captionEnergyFor(energy) → 'calm'|'lively'|'wild'`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/styles.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, STYLE_IDS, resolveStyle, captionEnergyFor } from "./styles.js";
import { getEffect } from "./effects/index.js";
import { isStudioLook } from "../kinetic/looks.js";

test("the four launch styles, in order", () => {
  assert.deepEqual(STYLE_IDS, ["glow", "celebrate", "hype", "gallery"]);
});

test("every palette entry names an existing effect of the right kind", () => {
  for (const s of Object.values(STYLES)) {
    for (const [kind, palette] of [["move", s.moves], ["entrance", s.entrances], ["overlay", s.overlays]]) {
      for (const [id, weight] of Object.entries(palette)) {
        assert.equal(getEffect(id)?.kind, kind, `${s.id}: ${id}`);
        assert.ok(weight > 0);
      }
    }
    assert.equal(getEffect(s.endOverlay)?.kind, "overlay", `${s.id} end overlay`);
  }
});

test("each style uses the spec's Studio look", () => {
  assert.equal(STYLES.glow.look, "studio-gospel-gold");
  assert.equal(STYLES.celebrate.look, "studio-lagos-night");
  assert.equal(STYLES.hype.look, "studio-lagos-night");
  assert.equal(STYLES.gallery.look, "studio-clean-white");
  for (const s of Object.values(STYLES)) assert.ok(isStudioLook(s.look));
});

test("Energy maps to the caption engine's three levels", () => {
  assert.equal(captionEnergyFor(0), "calm");
  assert.equal(captionEnergyFor(0.33), "calm");
  assert.equal(captionEnergyFor(0.34), "lively");
  assert.equal(captionEnergyFor(0.66), "lively");
  assert.equal(captionEnergyFor(0.67), "wild");
});

test("unknown style ids fall back to celebrate, ignoring the prototype chain", () => {
  assert.equal(resolveStyle("nope").id, "celebrate");
  assert.equal(resolveStyle("constructor").id, "celebrate");
  assert.equal(resolveStyle("glow").id, "glow");
});
```

A style need not list a wide-capable move: the director (Task 8) falls back to `pan` for wide photos whichever style is chosen. Task 8's "wide photos only get pan or a split" test covers that for all four styles.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/styles.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `styles.js`**

`server/src/lib/motion/styles.js`:

```js
/**
 * Smart styles: which moves, entrances and overlays a Moment draws from
 * (weighted), its colour grade, and its Studio caption look. Energy then
 * sets intensity within the style.
 */
export const STYLES = Object.freeze({
  glow: Object.freeze({
    id: "glow",
    label: "Glow",
    description: "Calm and devotional: slow pushes, soft fades, warm light.",
    look: "studio-gospel-gold",
    grade: "eq=saturation=1.05:gamma=1.04,colorbalance=rs=0.04:bs=-0.04",
    moves: { push: 4, pan: 2, still: 1 },
    entrances: { crossfade: 4, cut: 1 },
    overlays: { lightLeak: 1 },
    overlayRate: 0.35,
    endOverlay: "sparkles",
  }),
  celebrate: Object.freeze({
    id: "celebrate",
    label: "Celebrate",
    description: "Birthdays and parties: punch-ins, flashes and sparkles.",
    look: "studio-lagos-night",
    grade: "eq=saturation=1.2:contrast=1.05",
    moves: { punch: 3, push: 2 },
    entrances: { flash: 3, cut: 2, whip: 2 },
    overlays: { sparkles: 3, doodles: 2 },
    overlayRate: 0.4,
    endOverlay: "rayBurst",
  }),
  hype: Object.freeze({
    id: "hype",
    label: "Hype",
    description: "TikTok energy: shakes, whips, glitches and splits.",
    look: "studio-lagos-night",
    grade: "eq=contrast=1.12:saturation=1.1",
    moves: { shake: 3, punch: 3, split2: 1, split3: 1 },
    entrances: { whip: 3, glitch: 2, flash: 2 },
    overlays: { doodles: 1 },
    overlayRate: 0.2,
    endOverlay: "rayBurst",
  }),
  gallery: Object.freeze({
    id: "gallery",
    label: "Gallery",
    description: "Clean and steady for events and sermon promos.",
    look: "studio-clean-white",
    grade: "eq=saturation=0.95:contrast=1.03",
    moves: { push: 3, pan: 2, split3: 1 },
    entrances: { cut: 3, crossfade: 2 },
    overlays: { viewfinder: 1 },
    overlayRate: 0.3,
    endOverlay: "sparkles",
  }),
});

export const STYLE_IDS = Object.freeze(Object.keys(STYLES));

export function resolveStyle(id) {
  return typeof id === "string" && Object.hasOwn(STYLES, id) ? STYLES[id] : STYLES.celebrate;
}

/** Moments Energy (0..1) as the caption engine's level. */
export function captionEnergyFor(energy) {
  if (energy < 0.34) return "calm";
  if (energy <= 0.66) return "lively";
  return "wild";
}
```

Hype includes `doodles` (the spike used them on its glitch shot), even though the spec's table names only the splits there. With the splits moved to moves, Hype would otherwise have no overlay at all.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/styles.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/motion/styles.js server/src/lib/motion/styles.test.js
```

```bash
git commit -m "feat: four motion smart styles (glow, celebrate, hype, gallery)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The motion-plan contract

**Files:**
- Create: `server/src/lib/motion/plan.js`
- Test: `server/src/lib/motion/plan.test.js`

**Interfaces:**
- Consumes: `zod`; `getEffect` from `./effects/index.js`; `STYLE_IDS` from `./styles.js`.
- Produces:
  - `OUTPUT = { w: 1080, h: 1920, fps: 30 }`.
  - `validatePlan(plan, { photoCount }) → { ok: true, plan } | { ok: false, errors: string[] }`.
  - **The plan shape** (used by Tasks 8, 10–12 and plan B):

```js
{
  version: 1, w: 1080, h: 1920, fps: 30,
  durationSec: number,            // 0 < d <= 61
  seed: number,                   // integer
  style: 'glow'|'celebrate'|'hype'|'gallery',
  energy: number,                 // 0..1
  shots: [{ start, end, photo: int, role: 'open'|'body'|'end',
            move: { id, intensity: 0..1 }, entrance: { id }, overlays: [{ id }], anchor: { x: 0..1, y: 0..1 } }],
  captions: [{ text, start, end, reveal, holdUntil, effect?: string }],
}
```

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/plan.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan, OUTPUT } from "./plan.js";

const shot = (start, end, over = {}) => ({
  start, end, photo: 0, role: "body", move: { id: "push", intensity: 0.5 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 }, ...over,
});
const good = () => ({
  version: 1, ...OUTPUT, durationSec: 4, seed: 7, style: "glow", energy: 0.2,
  shots: [shot(0, 2, { role: "open" }), shot(2, 4, { role: "end", photo: 1, overlays: [{ id: "sparkles" }] })],
  captions: [{ text: "HAPPY 40TH", start: 0.15, end: 1.95, reveal: 0.6, holdUntil: 1.95, effect: "title" }],
});

test("a good plan passes", () => {
  const r = validatePlan(good(), { photoCount: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("OUTPUT is 1080x1920 at 30 fps", () => {
  assert.deepEqual(OUTPUT, { w: 1080, h: 1920, fps: 30 });
});

const bad = [
  ["a gap between shots", (p) => { p.shots[1].start = 2.5; }, /contiguous/],
  ["shots not reaching the end", (p) => { p.shots[1].end = 3.5; }, /durationSec/],
  ["an unknown move", (p) => { p.shots[0].move.id = "spin"; }, /move "spin"/],
  ["an entrance used as a move", (p) => { p.shots[0].move.id = "flash"; }, /move "flash"/],
  ["a missing photo", (p) => { p.shots[1].photo = 5; }, /photo 5/],
  ["a caption past the end", (p) => { p.captions[0].end = 9; }, /caption 0/],
  ["overlapping captions", (p) => { p.captions.push({ text: "B", start: 1, end: 3, reveal: 0.2, holdUntil: 3 }); }, /overlap/],
  ["a too-long statement", (p) => { p.captions[0].text = "x".repeat(61); }, /text/],
  ["a bad style", (p) => { p.style = "disco"; }, /style/],
  ["energy above 1", (p) => { p.energy = 1.5; }, /energy/],
  ["a shot ending before it starts", (p) => { p.shots[0].end = 0; }, /ends before it starts/],
];
for (const [name, mutate, re] of bad) {
  test(`rejects ${name}`, () => {
    const p = good();
    mutate(p);
    const r = validatePlan(p, { photoCount: 2 });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => re.test(e)), JSON.stringify(r.errors));
  });
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/plan.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `plan.js`**

`server/src/lib/motion/plan.js`:

```js
import { z } from "zod";
import { getEffect } from "./effects/index.js";
import { STYLE_IDS } from "./styles.js";

/**
 * The motion plan: the one contract between the director, the renderer and
 * (later) "Open in Timeline". A plan that passes validatePlan renders.
 */
export const OUTPUT = Object.freeze({ w: 1080, h: 1920, fps: 30 });
const EPS = 1e-6;

const unit = z.number().min(0).max(1);
const shotSchema = z.object({
  start: z.number().min(0),
  // min(0), not positive(): an end at or before the start is reported by the
  // clearer "ends before it starts" check below.
  end: z.number().min(0),
  photo: z.number().int().min(0),
  role: z.enum(["open", "body", "end"]),
  move: z.object({ id: z.string(), intensity: unit }),
  entrance: z.object({ id: z.string() }),
  overlays: z.array(z.object({ id: z.string() })).max(2),
  anchor: z.object({ x: unit, y: unit }),
});
const captionSchema = z.object({
  text: z.string().trim().min(1).max(60),
  start: z.number().min(0),
  end: z.number().positive(),
  reveal: z.number().positive(),
  holdUntil: z.number().positive(),
  effect: z.string().optional(),
});
const planSchema = z.object({
  version: z.literal(1),
  w: z.literal(OUTPUT.w),
  h: z.literal(OUTPUT.h),
  fps: z.literal(OUTPUT.fps),
  durationSec: z.number().positive().max(61),
  seed: z.number().int().min(0),
  style: z.enum(STYLE_IDS),
  energy: unit,
  shots: z.array(shotSchema).min(1).max(240),
  captions: z.array(captionSchema).max(9),
});

function kindError(id, kind, label) {
  return getEffect(id)?.kind === kind ? null : `${label}: ${kind} "${id}" is not a known ${kind}`;
}

export function validatePlan(plan, { photoCount }) {
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const p = parsed.data;
  const errors = [];
  p.shots.forEach((s, i) => {
    const label = `shot ${i}`;
    if (s.end <= s.start) errors.push(`${label} ends before it starts`);
    if (i === 0 && Math.abs(s.start) > EPS) errors.push(`${label} must start at 0`);
    if (i > 0 && Math.abs(s.start - p.shots[i - 1].end) > EPS) errors.push(`${label} is not contiguous with the shot before`);
    if (s.photo >= photoCount) errors.push(`${label} uses photo ${s.photo}, but there are ${photoCount}`);
    for (const e of [kindError(s.move.id, "move", label), kindError(s.entrance.id, "entrance", label),
      ...s.overlays.map((o) => kindError(o.id, "overlay", label))]) if (e) errors.push(e);
  });
  if (Math.abs(p.shots.at(-1).end - p.durationSec) > EPS) errors.push(`the last shot must end at durationSec (${p.durationSec})`);
  p.captions.forEach((c, i) => {
    if (c.end <= c.start || c.end > p.durationSec + EPS) errors.push(`caption ${i} must sit inside 0..durationSec`);
    if (i > 0 && c.start < p.captions[i - 1].end - EPS) errors.push(`caption ${i} and the one before overlap`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, plan: p };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/plan.test.js`
Expected: all PASS. If zod's message for the 61-character text does not contain "text", the path prefix (`captions.0.text`) still matches `/text/`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/motion/plan.js server/src/lib/motion/plan.test.js
```

```bash
git commit -m "feat: motion plan schema and validator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The director

**Files:**
- Create: `server/src/lib/motion/director.js`
- Test: `server/src/lib/motion/director.test.js`

**Interfaces:**
- Consumes:
  - `mulberry32` from `../kinetic/director.js`;
  - `cutPoints`, `beatGridOf`, `pulseGrid` from `./cuts.js`;
  - `resolveStyle` from `./styles.js`;
  - `getEffect` from `./effects/index.js`;
  - `OUTPUT`, `validatePlan` from `./plan.js`.
- Produces:
  - `TALL_ANCHOR = { x: 0.5, y: 0.38 }`, `WIDE_ANCHOR = { x: 0.5, y: 0.5 }`.
  - `directMoment({ photos: { shape: 'tall'|'wide' }[], heroIndex = 0, grid, title = '', statements = [], styleId, energy, lengthSec, seed, capabilities = [] }) → { plan, dropped }`. `plan` passes `validatePlan`; `dropped` is the number of photos left out.
  - `assignPhotos(photoCount, heroIndex, shotCount) → { sequence: number[], dropped }`.
  - `placeCaptions({ cuts, title, statements, period }) → caption[]`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/director.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { directMoment, assignPhotos, placeCaptions } from "./director.js";
import { beatGridOf, pulseGrid } from "./cuts.js";
import { validatePlan } from "./plan.js";
import { getEffect } from "./effects/index.js";

function grid120(len) {
  const beats = [];
  for (let t = 0.2; t < len; t += 0.5) beats.push(Math.round(t * 1000) / 1000);
  return beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [8, 16, 40], period: 0.5 });
}
const tall = (n) => Array.from({ length: n }, () => ({ shape: "tall" }));
const base = (over = {}) => ({
  photos: tall(6), heroIndex: 0, grid: grid120(30), title: "HAPPY 40TH, TOLU",
  statements: ["40 years of grace", "Still rising", "Favour looks good on you", "Celebrate!"],
  styleId: "celebrate", energy: 0.8, lengthSec: 30, seed: 11, ...over,
});

test("the plan validates", () => {
  for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
    for (const energy of [0.1, 0.5, 0.9]) {
      const { plan } = directMoment(base({ styleId, energy }));
      const r = validatePlan(plan, { photoCount: 6 });
      assert.equal(r.ok, true, `${styleId}@${energy}: ${JSON.stringify(r.errors)}`);
    }
  }
});

test("the same seed gives the same plan; another seed gives another", () => {
  assert.deepEqual(directMoment(base()).plan, directMoment(base()).plan);
  assert.notDeepEqual(directMoment(base()).plan.shots, directMoment(base({ seed: 12 })).plan.shots);
});

test("no move or entrance repeats on consecutive shots", () => {
  for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
    const { plan } = directMoment(base({ styleId, energy: 0.9, lengthSec: 60, grid: grid120(60) }));
    for (let i = 1; i < plan.shots.length; i += 1) {
      assert.notEqual(plan.shots[i].move.id, plan.shots[i - 1].move.id, `${styleId} move at ${i}`);
      assert.notEqual(plan.shots[i].entrance.id, plan.shots[i - 1].entrance.id, `${styleId} entrance at ${i}`);
    }
  }
});

test("strong effects only land on downbeats or strong beats", () => {
  const { plan } = directMoment(base({ styleId: "hype", energy: 0.9 }));
  const grid = grid120(30);
  const hits = new Set(grid.marks.filter((m) => m.downbeat || m.strong).map((m) => m.t));
  plan.shots.slice(1).forEach((s) => {
    const strong = getEffect(s.move.id).strong || getEffect(s.entrance.id).strong;
    if (strong) assert.ok(hits.has(s.start), `strong effect at ${s.start}`);
  });
});

test("the hero opens and closes; the end card carries its overlay", () => {
  const { plan } = directMoment(base({ heroIndex: 3 }));
  assert.equal(plan.shots[0].photo, 3);
  assert.equal(plan.shots[0].role, "open");
  assert.equal(plan.shots.at(-1).photo, 3);
  assert.equal(plan.shots.at(-1).role, "end");
  assert.deepEqual(plan.shots.at(-1).overlays, [{ id: "rayBurst" }]);
  assert.equal(plan.shots[0].entrance.id, "cut");
});

test("the same photo never appears in consecutive shots, even with 3 photos for 60 s of hype", () => {
  const { plan } = directMoment(base({ photos: tall(3), energy: 0.95, lengthSec: 60, grid: grid120(60), styleId: "hype" }));
  for (let i = 1; i < plan.shots.length; i += 1) assert.notEqual(plan.shots[i].photo, plan.shots[i - 1].photo, `at ${i}`);
});

test("too many photos: the user's order is kept and the extras dropped from the end", () => {
  const { sequence, dropped } = assignPhotos(10, 0, 6);
  assert.deepEqual(sequence, [0, 1, 2, 3, 4, 0]);
  assert.equal(dropped, 5);
});

test("wide photos only get pan or a split", () => {
  const photos = [{ shape: "tall" }, { shape: "wide" }, { shape: "tall" }, { shape: "wide" }];
  for (const styleId of ["glow", "celebrate", "hype", "gallery"]) {
    const { plan } = directMoment(base({ photos, styleId }));
    for (const s of plan.shots) {
      if (photos[s.photo].shape === "wide") assert.ok(getEffect(s.move.id).shapes.includes("wide"), `${styleId}: ${s.move.id}`);
    }
  }
});

test("open and end shots never use a split", () => {
  const { plan } = directMoment(base({ styleId: "hype" }));
  assert.ok(!plan.shots[0].move.id.startsWith("split"));
  assert.ok(!plan.shots.at(-1).move.id.startsWith("split"));
});

test("effects needing a capability we lack are never chosen", () => {
  const { plan } = directMoment(base({ capabilities: [] }));
  for (const s of plan.shots) {
    for (const id of [s.move.id, s.entrance.id, ...s.overlays.map((o) => o.id)]) {
      assert.deepEqual(getEffect(id).needs.filter((n) => n !== ""), []);
    }
  }
});

test("the title opens with the title effect; the last statement is on the end card", () => {
  const { plan } = directMoment(base());
  assert.equal(plan.captions[0].text, "HAPPY 40TH, TOLU");
  assert.equal(plan.captions[0].effect, "title");
  const endStart = plan.shots.at(-1).start;
  assert.equal(plan.captions.at(-1).text, "Celebrate!");
  assert.ok(plan.captions.at(-1).start >= endStart);
});

test("statements start near a downbeat shot and never overlap", () => {
  const { plan } = directMoment(base({ energy: 0.5 }));
  const shotStarts = plan.shots.map((s) => s.start);
  for (let i = 1; i < plan.captions.length; i += 1) {
    assert.ok(plan.captions[i].start >= plan.captions[i - 1].end - 1e-9);
    assert.ok(shotStarts.some((t) => plan.captions[i].start - t >= 0 && plan.captions[i].start - t <= 0.2), `caption ${i}`);
  }
});

test("captions hold to their end and reveal within them", () => {
  const caps = placeCaptions({
    cuts: [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }, { start: 6, end: 8 }, { start: 8, end: 10 }],
    title: "Hi", statements: ["one two three", "end"], period: 0.5,
  });
  for (const c of caps) {
    assert.equal(c.holdUntil, c.end);
    assert.ok(c.reveal > 0 && c.reveal <= c.end - c.start);
  }
});

test("no statements and no title gives no captions", () => {
  const { plan } = directMoment(base({ title: "", statements: [] }));
  assert.deepEqual(plan.captions, []);
});

test("a pulse grid (no music) still makes a valid plan", () => {
  const { plan } = directMoment(base({ grid: pulseGrid(15), lengthSec: 15 }));
  assert.equal(validatePlan(plan, { photoCount: 6 }).ok, true);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/director.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `director.js`**

`server/src/lib/motion/director.js`:

```js
import { mulberry32 } from "../kinetic/director.js";
import { cutPoints } from "./cuts.js";
import { resolveStyle } from "./styles.js";
import { getEffect } from "./effects/index.js";
import { OUTPUT } from "./plan.js";

/**
 * The motion director: photos, a timing grid, statements, a style, Energy
 * and a seed in; a motion plan out. Deterministic: every shot draws the same
 * five random numbers whatever happens, so changing one input never reshuffles
 * the rest of the edit.
 */
export const TALL_ANCHOR = Object.freeze({ x: 0.5, y: 0.38 });
export const WIDE_ANCHOR = Object.freeze({ x: 0.5, y: 0.5 });
const r3 = (n) => Math.round(n * 1000) / 1000;
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/** Hero opens and closes; the rest in the user's order, cycled, extras dropped from the end. */
export function assignPhotos(photoCount, heroIndex, shotCount) {
  const hero = heroIndex >= 0 && heroIndex < photoCount ? heroIndex : 0;
  let others = Array.from({ length: photoCount }, (_, i) => i).filter((i) => i !== hero);
  const bodyCount = Math.max(0, shotCount - 2);
  const dropped = Math.max(0, others.length - bodyCount);
  others = others.slice(0, Math.max(bodyCount, 0) || others.length);
  if (!others.length) others = [hero];
  if (shotCount === 1) return { sequence: [hero], dropped };
  const body = Array.from({ length: bodyCount }, (_, k) => others[k % others.length]);
  return { sequence: [hero, ...body, hero], dropped };
}

function pick(weights, ok, r) {
  const entries = Object.entries(weights).filter(([id]) => ok(id));
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let x = r * total;
  for (const [id, w] of entries) {
    x -= w;
    if (x < 0) return id;
  }
  return entries.at(-1)[0];
}

function usable(id, { kind, shape, capabilities, strongOk, avoid }) {
  const e = getEffect(id);
  if (!e || e.kind !== kind) return false;
  if (e.needs.some((n) => !capabilities.includes(n))) return false;
  if (e.strong && !strongOk) return false;
  if (shape && e.shapes && !e.shapes.includes(shape)) return false;
  return !avoid.includes(id);
}

function chooseMove({ style, shape, role, capabilities, strongOk, prevMove, lastForPhoto, r }) {
  const base = { kind: "move", shape, capabilities, strongOk };
  const noSplit = (id) => role === "body" || !id.startsWith("split");
  const tries = [[prevMove, lastForPhoto], [prevMove]];
  for (const avoid of tries) {
    const id = pick(style.moves, (m) => noSplit(m) && usable(m, { ...base, avoid }), r);
    if (id) return id;
  }
  // A wide photo can only pan or split. A split is strong and needs a strong
  // beat; when there is none, a repeated pan beats breaking the beat rule.
  if (shape === "wide") return prevMove !== "pan" ? "pan" : strongOk && role === "body" ? "split2" : "pan";
  return prevMove === "push" ? "still" : "push";
}

function chooseEntrance({ style, index, capabilities, strongOk, prev, r }) {
  if (index === 0) return "cut";
  const id = pick(style.entrances, (m) => usable(m, { kind: "entrance", capabilities, strongOk, avoid: [prev] }), r);
  if (id) return id;
  return prev === "cut" ? "crossfade" : "cut";
}

function chooseOverlays({ style, role, move, energy, capabilities, strongOk, prev, gate, r }) {
  if (role === "open") return [];
  if (role === "end") return getEffect(style.endOverlay) ? [{ id: style.endOverlay }] : [];
  if (move.startsWith("split")) return [];
  if (gate >= style.overlayRate * (0.5 + energy)) return [];
  const id = pick(style.overlays, (m) => usable(m, { kind: "overlay", capabilities, strongOk, avoid: [prev] }), r);
  return id ? [{ id }] : [];
}

/**
 * Title on the opening shots; the last statement on the end card; the rest
 * spread over the body, each starting on a shot (a downbeat one where the
 * group has one) and spanning up to 3 shots, so some shots breathe.
 */
export function placeCaptions({ cuts, title = "", statements = [], period }) {
  const beat = period && period > 0 ? period : 0.5;
  const out = [];
  const line = (text, start, end, effect) => {
    const words = String(text).trim().split(/\s+/).length;
    const reveal = r3(Math.max(0.2, Math.min(words * beat, (end - start) * 0.6)));
    const c = { text: String(text).trim(), start: r3(start), end: r3(end), reveal, holdUntil: r3(end) };
    if (effect) c.effect = effect;
    out.push(c);
  };
  const last = cuts.length - 1;
  const t = String(title || "").trim();
  if (t) line(t, cuts[0].start + 0.15, cuts[Math.min(1, Math.max(0, last - 1))].end - 0.05, "title");
  const texts = statements.map((s) => String(s || "").trim()).filter(Boolean);
  if (!texts.length) return out;
  const closing = texts.at(-1);
  const body = texts.slice(0, -1);
  const firstBody = t ? Math.min(2, last) : 1;
  const slots = [];
  for (let i = firstBody; i < last; i += 1) slots.push(i);
  const kept = body.slice(0, slots.length);
  if (kept.length) {
    const size = Math.floor(slots.length / kept.length);
    kept.forEach((text, j) => {
      const group = slots.slice(j * size, j === kept.length - 1 ? slots.length : (j + 1) * size);
      const downIdx = group.findIndex((i) => cuts[i].downbeat);
      const first = downIdx > 0 && downIdx < group.length ? downIdx : 0;
      const span = group.slice(first, first + 3);
      line(text, cuts[span[0]].start + 0.05, cuts[span.at(-1)].end - 0.05);
    });
  }
  if (last > 0 || !t) line(closing, cuts[last].start + 0.15, cuts[last].end - 0.1);
  return out;
}

export function directMoment({
  photos, heroIndex = 0, grid, title = "", statements = [], styleId, energy, lengthSec, seed, capabilities = [],
}) {
  const rnd = mulberry32(seed);
  const style = resolveStyle(styleId);
  const e = clamp01(energy);
  const cuts = cutPoints({ grid, energy: e, lengthSec, rnd });
  const { sequence, dropped } = assignPhotos(photos.length, heroIndex, cuts.length);
  const lastMoveOf = new Map();
  const shots = [];
  cuts.forEach((c, i) => {
    const [rMove, rEntrance, rGate, rOverlay, rIntensity] = [rnd(), rnd(), rnd(), rnd(), rnd()];
    const photo = sequence[i];
    const shape = photos[photo]?.shape === "wide" ? "wide" : "tall";
    const role = i === 0 ? "open" : i === cuts.length - 1 ? "end" : "body";
    const prev = shots[i - 1];
    const strongOk = Boolean(c.downbeat || c.strong);
    const move = chooseMove({
      style, shape, role, capabilities, strongOk, prevMove: prev?.move.id, lastForPhoto: lastMoveOf.get(photo), r: rMove,
    });
    lastMoveOf.set(photo, move);
    const entrance = chooseEntrance({ style, index: i, capabilities, strongOk, prev: prev?.entrance.id, r: rEntrance });
    const overlays = chooseOverlays({
      style, role, move, energy: e, capabilities, strongOk, prev: prev?.overlays[0]?.id, gate: rGate, r: rOverlay,
    });
    shots.push({
      start: c.start,
      end: c.end,
      photo,
      role,
      move: { id: move, intensity: r3(clamp01(0.25 + 0.6 * e + 0.15 * rIntensity)) },
      entrance: { id: entrance },
      overlays,
      anchor: { ...(shape === "wide" ? WIDE_ANCHOR : TALL_ANCHOR) },
    });
  });
  const captions = placeCaptions({ cuts, title, statements, period: grid.period });
  return {
    plan: { version: 1, ...OUTPUT, durationSec: lengthSec, seed, style: style.id, energy: e, shots, captions },
    dropped,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/director.test.js`
Expected: all PASS.

The "no repeats" test uses only tall photos. A wide photo may repeat `pan` by design; see the comment in `chooseMove`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/motion/director.js server/src/lib/motion/director.test.js
```

```bash
git commit -m "feat: motion director (shots, effects, photos and statements from a seed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Photo preparation (EXIF rotation and working image)

**Files:**
- Create: `server/src/lib/motion/prepare.js`
- Test: `server/src/lib/motion/prepare.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `orientationOf(file) → 1..8` (JPEG EXIF orientation; 1 for anything else or on any read problem).
  - `workImageArgs({ src, out, width, height, orientation }) → { args: string[], shape: 'tall'|'wide' }`. `width` and `height` are the stored (pre-rotation) pixel size.
  - `WORK = { tallW: 2160, tallH: 3840, wideH: 2160 }`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/prepare.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { orientationOf, workImageArgs } from "./prepare.js";

/** A minimal JPEG: SOI, an APP1 Exif block with one IFD0 entry (orientation), EOI. */
function jpegWithOrientation(value, littleEndian = true) {
  const tiff = Buffer.alloc(26);
  if (littleEndian) {
    tiff.write("II", 0, "ascii"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(value, 18);
  } else {
    tiff.write("MM", 0, "ascii"); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(value, 18);
  }
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(exif.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, exif, Buffer.from([0xff, 0xd9])]);
}

function tmpFile(buf, name = "p.jpg") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-prep-"));
  const f = path.join(dir, name);
  fs.writeFileSync(f, buf);
  return f;
}

test("reads EXIF orientation from little- and big-endian JPEGs", () => {
  assert.equal(orientationOf(tmpFile(jpegWithOrientation(6))), 6);
  assert.equal(orientationOf(tmpFile(jpegWithOrientation(8, false))), 8);
});

test("anything unreadable is orientation 1", () => {
  assert.equal(orientationOf(tmpFile(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "p.png")), 1);
  assert.equal(orientationOf(tmpFile(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]))), 1);
  assert.equal(orientationOf("/no/such/file.jpg"), 1);
  assert.equal(orientationOf(tmpFile(jpegWithOrientation(42))), 1);
});

test("a portrait photo becomes a 2160x3840 cover crop, upright, with autorotate off", () => {
  const { args, shape } = workImageArgs({ src: "in.jpg", out: "w.jpg", width: 1450, height: 2576, orientation: 1 });
  assert.equal(shape, "tall");
  assert.ok(args.indexOf("-noautorotate") < args.indexOf("-i"));
  const vf = args[args.indexOf("-vf") + 1];
  assert.match(vf, /scale=2160:3840:force_original_aspect_ratio=increase/);
  assert.match(vf, /crop=2160:3840:\(iw-ow\)\/2:\(ih-oh\)\*0\.38/);
});

test("rotation 6 turns a stored landscape into a tall, upright working image", () => {
  const { args, shape } = workImageArgs({ src: "in.jpg", out: "w.jpg", width: 4032, height: 3024, orientation: 6 });
  assert.equal(shape, "tall");
  assert.match(args[args.indexOf("-vf") + 1], /^transpose=1,/);
});

test("other rotations use the matching transform", () => {
  const vf = (o) => workImageArgs({ src: "a", out: "b", width: 100, height: 200, orientation: o }).args.find((a, i, all) => all[i - 1] === "-vf");
  assert.match(vf(3), /^hflip,vflip,/);
  assert.match(vf(8), /^transpose=2,/);
  assert.match(vf(2), /^hflip,/);
  assert.match(vf(4), /^vflip,/);
  assert.match(vf(5), /^transpose=0,/);
  assert.match(vf(7), /^transpose=3,/);
});

test("a landscape photo keeps its shape at height 2160", () => {
  const { args, shape } = workImageArgs({ src: "in.jpg", out: "w.jpg", width: 4000, height: 3000, orientation: 1 });
  assert.equal(shape, "wide");
  assert.equal(args[args.indexOf("-vf") + 1], "scale=-2:2160,setsar=1");
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/prepare.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `prepare.js`**

`server/src/lib/motion/prepare.js`:

```js
import fs from "node:fs";

/**
 * Photos become working images before any shot renders: upright, and sized
 * so zoompan has 2x the output to work with (smooth zooms). Tall photos are
 * cover-cropped to 9:16 around the upper middle, where faces usually are;
 * wide ones keep their shape for the pan and split moves.
 *
 * Rotation is done here from the EXIF tag, with -noautorotate on the input:
 * ffmpeg 8 auto-rotates JPEGs and 5.1 (prod) does not, so relying on either
 * would make dev and prod disagree.
 */
export const WORK = Object.freeze({ tallW: 2160, tallH: 3840, wideH: 2160 });

const ROTATE = { 2: "hflip", 3: "hflip,vflip", 4: "vflip", 5: "transpose=0", 6: "transpose=1", 7: "transpose=3", 8: "transpose=2" };

function readExifOrientation(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1];
    const len = buf.readUInt16BE(pos + 2);
    if (marker === 0xe1 && buf.toString("binary", pos + 4, pos + 10) === "Exif\0\0") {
      const t = pos + 10;
      const le = buf.toString("ascii", t, t + 2) === "II";
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      const entries = u16(ifd);
      for (let k = 0; k < entries; k += 1) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1; // image data: no EXIF before it
    pos += 2 + len;
  }
  return 1;
}

/** JPEG EXIF orientation (1..8); 1 for any other file or any read problem. */
export function orientationOf(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(128 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return readExifOrientation(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 1;
  }
}

/** ffmpeg args that write the upright working image for one photo. */
export function workImageArgs({ src, out, width, height, orientation }) {
  const rotate = ROTATE[orientation] || "";
  const swaps = orientation >= 5 && orientation <= 8;
  const w = swaps ? height : width;
  const h = swaps ? width : height;
  const shape = w > h ? "wide" : "tall";
  const fit = shape === "tall"
    ? `scale=${WORK.tallW}:${WORK.tallH}:force_original_aspect_ratio=increase,crop=${WORK.tallW}:${WORK.tallH}:(iw-ow)/2:(ih-oh)*0.38,setsar=1`
    : `scale=-2:${WORK.wideH},setsar=1`;
  const vf = rotate ? `${rotate},${fit}` : fit;
  return {
    shape,
    args: ["-hide_banner", "-v", "error", "-y", "-noautorotate", "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "2", out],
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/prepare.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/motion/prepare.js server/src/lib/motion/prepare.test.js
```

```bash
git commit -m "feat: motion photo preparation (EXIF rotation, working image)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Shot rendering args, proven against real ffmpeg

**Files:**
- Create: `server/src/lib/motion/shotArgs.js`
- Test: `server/src/lib/motion/shotArgs.test.js`

**Interfaces:**
- Consumes: `getEffect` from `./effects/index.js`; `frameCount` from `./effects/common.js`; `ffmpegAvailable`, `FFMPEG` from `./testkit.js`.
- Produces:
  - `shotGraph({ shot, w, h, fps, hasPrev }) → string`: the whole filtergraph, ending at label `[v]`.
  - `shotArgs({ shot, index, workImage, prevFrame, out, w, h, fps, workDir }) → { args, sideFiles: { path, text }[] }`. The args use `-filter_complex_script <workDir>/shot-<index>.txt`.
  - `lastFrameArgs(clip, png) → string[]`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/shotArgs.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { shotGraph, shotArgs, lastFrameArgs } from "./shotArgs.js";
import { ffmpegAvailable, FFMPEG } from "./testkit.js";

const shot = (over = {}) => ({
  start: 1, end: 1.6, photo: 0, role: "body", move: { id: "push", intensity: 0.6 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 }, ...over,
});

test("the graph runs move, then overlays, then entrance, then trims to the frame count", () => {
  const g = shotGraph({ shot: shot({ entrance: { id: "flash" }, overlays: [{ id: "lightLeak" }] }), w: 1080, h: 1920, fps: 30, hasPrev: false });
  const iMove = g.indexOf("zoompan");
  const iLeak = g.indexOf("blend=all_mode=screen");
  const iFlash = g.indexOf("fade=t=in");
  assert.ok(iMove >= 0 && iMove < iLeak && iLeak < iFlash, g);
  assert.match(g, /format=yuv420p,trim=end_frame=18,setpts=N\/30\/TB\[v\]$/);
});

test("ASS overlays add nothing to the shot graph (the finish stage draws them)", () => {
  const g = shotGraph({ shot: shot({ overlays: [{ id: "sparkles" }] }), w: 1080, h: 1920, fps: 30, hasPrev: false });
  assert.ok(!g.includes("sparkles"));
});

test("shotArgs writes the graph to a script file and reads the previous frame only for a crossfade", () => {
  const plain = shotArgs({ shot: shot(), index: 3, workImage: "w.jpg", prevFrame: "last.png", out: "s.mp4", w: 1080, h: 1920, fps: 30, workDir: "wd" });
  assert.equal(plain.args.filter((a) => a === "-i").length, 1, "no previous frame without a crossfade");
  assert.equal(plain.args[plain.args.indexOf("-filter_complex_script") + 1], path.join("wd", "shot-3.txt"));
  assert.equal(plain.sideFiles[0].path, path.join("wd", "shot-3.txt"));
  assert.ok(!plain.args.includes("-filter_complex"));
  assert.deepEqual(plain.args.slice(plain.args.indexOf("-frames:v"), plain.args.indexOf("-frames:v") + 2), ["-frames:v", "18"]);
  const xf = shotArgs({ shot: shot({ entrance: { id: "crossfade" } }), index: 3, workImage: "w.jpg", prevFrame: "last.png", out: "s.mp4", w: 1080, h: 1920, fps: 30, workDir: "wd" });
  assert.equal(xf.args.filter((a) => a === "-i").length, 2);
  assert.match(xf.sideFiles[0].text, /\[1:v\]scale=/);
});

test("lastFrameArgs grabs the final frame as a still", () => {
  const a = lastFrameArgs("s.mp4", "last.png");
  assert.ok(a.includes("-sseof") && a.includes("s.mp4") && a.at(-1) === "last.png");
});

// Every effect's graph must actually run in ffmpeg. Small frames keep it quick.
const skip = ffmpegAvailable() ? false : "ffmpeg not available";
const W = 108;
const H = 192;
const FPS = 10;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-shot-"));
  const tallImg = path.join(dir, "tall.png");
  const wideImg = path.join(dir, "wide.png");
  const prev = path.join(dir, "prev.png");
  for (const [file, size] of [[tallImg, "216x384"], [wideImg, "324x216"], [prev, `${W}x${H}`]]) {
    const r = spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=s=${size}:d=1`, "-frames:v", "1", file]);
    assert.equal(r.status, 0, String(r.stderr));
  }
  return { dir, tallImg, wideImg, prev };
}

function renderOne(fx, s, image) {
  const out = path.join(fx.dir, `o-${Math.random().toString(36).slice(2)}.mp4`);
  const { args, sideFiles } = shotArgs({ shot: s, index: 0, workImage: image, prevFrame: fx.prev, out, w: W, h: H, fps: FPS, workDir: fx.dir });
  for (const f of sideFiles) fs.writeFileSync(f.path, f.text);
  const r = spawnSync(FFMPEG, args, { encoding: "utf8" });
  assert.equal(r.status, 0, `${JSON.stringify(s.move)} ${s.entrance.id} ${JSON.stringify(s.overlays)}\n${r.stderr}`);
  const probe = spawnSync(FFMPEG, ["-v", "error", "-i", out, "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(probe.status, 0);
}

test("every move, entrance and video overlay renders in real ffmpeg", { skip }, () => {
  const fx = fixture();
  try {
    for (const m of ["push", "punch", "shake", "still", "split2", "split3"]) renderOne(fx, shot({ move: { id: m, intensity: 0.7 } }), fx.tallImg);
    for (const m of ["pan", "split2", "split3"]) renderOne(fx, shot({ move: { id: m, intensity: 0.7 } }), fx.wideImg);
    for (const e of ["cut", "flash", "whip", "glitch", "crossfade"]) renderOne(fx, shot({ entrance: { id: e } }), fx.tallImg);
    for (const o of ["lightLeak", "viewfinder"]) renderOne(fx, shot({ overlays: [{ id: o }] }), fx.tallImg);
    renderOne(fx, shot({ entrance: { id: "crossfade" }, overlays: [{ id: "lightLeak" }] }), fx.tallImg);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("a rendered shot has exactly its frame count", { skip }, () => {
  const fx = fixture();
  try {
    const out = path.join(fx.dir, "count.mp4");
    const { args, sideFiles } = shotArgs({ shot: shot({ start: 0, end: 1.2 }), index: 0, workImage: fx.tallImg, prevFrame: null, out, w: W, h: H, fps: FPS, workDir: fx.dir });
    for (const f of sideFiles) fs.writeFileSync(f.path, f.text);
    assert.equal(spawnSync(FFMPEG, args).status, 0);
    const r = spawnSync(FFMPEG, ["-v", "error", "-i", out, "-map", "0:v", "-c", "copy", "-f", "null", "-"], { encoding: "utf8" });
    assert.equal(r.status, 0);
    const count = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out], { encoding: "utf8" });
    if (count.status === 0) assert.equal(Number(count.stdout.trim()), 12);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/shotArgs.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `shotArgs.js`**

`server/src/lib/motion/shotArgs.js`:

```js
import path from "node:path";
import { getEffect } from "./effects/index.js";
import { frameCount } from "./effects/common.js";

/**
 * One shot's filtergraph: the move from the working image (input 0), video
 * overlays, then the entrance (input 1 is the previous shot's last frame,
 * for a crossfade), then trimmed to the shot's exact frame count. ASS
 * overlays are skipped here: the finish stage draws them all in one pass.
 */
export function shotGraph({ shot, w, h, fps, hasPrev }) {
  const frames = frameCount(shot, fps);
  const ctx = { w, h, fps, frames, dur: frames / fps, prev: hasPrev ? "[1:v]" : null };
  const lines = [];
  lines.push(...getEffect(shot.move.id).graph({ input: "[0:v]", output: "[mv]", shot, ctx, tag: "m" }));
  let last = "[mv]";
  shot.overlays.forEach((o, k) => {
    const fx = getEffect(o.id);
    if (!fx.graph) return;
    const out = `[ov${k}]`;
    lines.push(...fx.graph({ input: last, output: out, shot, ctx, tag: `o${k}` }));
    last = out;
  });
  lines.push(...getEffect(shot.entrance.id).graph({ input: last, output: "[en]", shot, ctx, tag: "e" }));
  lines.push(`[en]format=yuv420p,trim=end_frame=${frames},setpts=N/${fps}/TB[v]`);
  return lines.join(";\n");
}

export function shotArgs({ shot, index, workImage, prevFrame, out, w, h, fps, workDir }) {
  const hasPrev = shot.entrance.id === "crossfade" && Boolean(prevFrame);
  const script = path.join(workDir, `shot-${index}.txt`);
  const frames = frameCount(shot, fps);
  const args = [
    "-hide_banner", "-v", "error", "-y",
    "-i", workImage,
    ...(hasPrev ? ["-i", prevFrame] : []),
    "-filter_complex_script", script,
    "-map", "[v]",
    "-frames:v", String(frames),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-an",
    out,
  ];
  return { args, sideFiles: [{ path: script, text: shotGraph({ shot, w, h, fps, hasPrev }) }] };
}

/** The clip's final frame as a still, for the next shot's crossfade. */
export function lastFrameArgs(clip, png) {
  return ["-hide_banner", "-v", "error", "-y", "-sseof", "-0.2", "-i", clip, "-update", "1", "-frames:v", "1", png];
}
```

The `-frames:v` test asserts `18` for a 0.6 s shot at 30 fps: `round(1.6 × 30) − round(1 × 30) = 48 − 30 = 18`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/shotArgs.test.js`
Expected: all PASS, including the two real-ffmpeg tests on a machine with ffmpeg.

If a real-ffmpeg test fails, the stderr in the assertion names the filter. Fix that effect's graph in its own file (Tasks 3–5) and keep the effect's unit tests green. For example, if xfade complains about mismatched time bases, normalise both inputs with `settb=1/${fps}` after `fps=`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/motion/shotArgs.js server/src/lib/motion/shotArgs.test.js
```

```bash
git commit -m "feat: motion shot rendering args, every effect proven in real ffmpeg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If fixing a real-ffmpeg failure touched an effect file, add that file to the same commit.

---

### Task 11: Finish stage (statements, FX, grade, audio)

**Files:**
- Create: `server/src/lib/motion/finish.js` (use the Write tool: the FX ASS header has no backslashes, but the effects it gathers do)
- Test: `server/src/lib/motion/finish.test.js`

**Interfaces:**
- Consumes: `buildAss` from `../kinetic/ass.js`; `escapeFontPath`, `FONT_DIR` from `../videoFilters.js`; `getEffect`; `resolveStyle`, `captionEnergyFor` from `./styles.js`; `mulberry32`.
- Produces:
  - `statementsAss(plan) → string` (`""` when there are no captions).
  - `fxAss(plan) → string` (`""` when no shot has an ASS overlay).
  - `finishArgs({ body, out, plan, statementsPath, fxPath, song, voice, workDir }) → { args, sideFiles }`. Here `song` is `{ file, startSec } | null`, `voice` is `{ file } | null`, and `statementsPath` / `fxPath` are `string | null`.
  - `LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'`.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/finish.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { statementsAss, fxAss, finishArgs } from "./finish.js";

const plan = (over = {}) => ({
  version: 1, w: 1080, h: 1920, fps: 30, durationSec: 15, seed: 5, style: "celebrate", energy: 0.8,
  shots: [
    { start: 0, end: 7, photo: 0, role: "open", move: { id: "push", intensity: 0.6 }, entrance: { id: "cut" }, overlays: [], anchor: { x: 0.5, y: 0.38 } },
    { start: 7, end: 12, photo: 1, role: "body", move: { id: "punch", intensity: 0.6 }, entrance: { id: "flash" }, overlays: [{ id: "sparkles" }], anchor: { x: 0.5, y: 0.38 } },
    { start: 12, end: 15, photo: 0, role: "end", move: { id: "push", intensity: 0.6 }, entrance: { id: "whip" }, overlays: [{ id: "rayBurst" }], anchor: { x: 0.5, y: 0.38 } },
  ],
  captions: [
    { text: "HAPPY 40TH", start: 0.15, end: 6.9, reveal: 1, holdUntil: 6.9, effect: "title" },
    { text: "Celebrate!", start: 12.15, end: 14.9, reveal: 0.5, holdUntil: 14.9 },
  ],
  ...over,
});

test("statements come from the kinetic engine in the style's look", () => {
  const ass = statementsAss(plan());
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Knewave|Permanent Marker/, "Lagos Night fonts");
  assert.ok(ass.includes("HAPPY") && ass.includes("Celebrate"));
});

test("no captions, no statements file", () => {
  assert.equal(statementsAss(plan({ captions: [] })), "");
});

test("FX gathers every shot's ASS overlay events, deterministically", () => {
  const a = fxAss(plan());
  assert.match(a, /Style: FX,/);
  assert.ok((a.match(/^Dialogue: /gm) || []).length > 48, "sparkles plus 48 rays");
  assert.equal(fxAss(plan()), a);
  assert.equal(fxAss(plan({ shots: plan().shots.map((s) => ({ ...s, overlays: [] })) })), "");
});

const common = { body: "body.mp4", out: "out.mp4", workDir: "wd", statementsPath: "wd/s.ass", fxPath: "wd/fx.ass" };
const graphOf = (r) => r.sideFiles[0].text;

test("song only: trimmed from its window, padded to length, faded, loudness-normalised", () => {
  const r = finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 42.5 }, voice: null });
  const a = r.args;
  assert.deepEqual(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 4), ["-ss", "42.500", "-i", "song.mp3"]);
  assert.match(graphOf(r), /\[1:a\]aresample=48000,apad,atrim=0:15\.000,afade=t=in:d=0\.3,afade=t=out:st=13\.800:d=1\.2,loudnorm=I=-14:TP=-1\.5:LRA=11\[a\]/);
  assert.equal(a[a.indexOf("-filter_complex_script") + 1], path.join("wd", "finish.txt"));
  assert.deepEqual(a.slice(a.indexOf("-t"), a.indexOf("-t") + 2), ["-t", "15.000"]);
});

test("song plus voice: the song ducks under the voice", () => {
  const g = graphOf(finishArgs({ ...common, plan: plan(), song: { file: "song.mp3", startSec: 0 }, voice: { file: "vo.mp3" } }));
  assert.match(g, /sidechaincompress=threshold=0\.01:ratio=12:attack=5:release=350:makeup=2/);
  assert.match(g, /amix=inputs=2:duration=first/);
});

test("voice only and silence both give a full-length audio track", () => {
  const v = graphOf(finishArgs({ ...common, plan: plan(), song: null, voice: { file: "vo.mp3" } }));
  assert.match(v, /\[1:a\]aresample=48000,apad,atrim=0:15\.000/);
  const s = finishArgs({ ...common, plan: plan(), song: null, voice: null });
  assert.ok(s.args.join(" ").includes("anullsrc=r=48000:cl=stereo"));
});

test("the picture is graded, then statements, then FX, with escaped paths", () => {
  const g = graphOf(finishArgs({ ...common, statementsPath: "C:\\w\\s.ass", fxPath: "C:\\w\\fx.ass", plan: plan(), song: null, voice: null }));
  const v = g.split(";")[0];
  assert.ok(v.startsWith("[0:v]eq=saturation=1.2:contrast=1.05,ass=filename='C\\:/w/s.ass'"), v);
  assert.ok(v.includes(",ass=filename='C\\:/w/fx.ass'"), v);
  assert.ok(v.endsWith("[v]"));
});

test("missing statements and FX files are simply left out", () => {
  const g = graphOf(finishArgs({ ...common, statementsPath: null, fxPath: null, plan: plan(), song: null, voice: null }));
  assert.ok(!g.includes("ass="));
});

test("the output is a social-ready MP4", () => {
  const { args } = finishArgs({ ...common, plan: plan(), song: null, voice: null });
  for (const flag of [["-c:v", "libx264"], ["-pix_fmt", "yuv420p"], ["-c:a", "aac"], ["-b:a", "192k"], ["-ar", "48000"], ["-movflags", "+faststart"]]) {
    assert.equal(args[args.indexOf(flag[0]) + 1], flag[1]);
  }
  assert.equal(args.at(-1), "out.mp4");
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/finish.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `finish.js`**

`server/src/lib/motion/finish.js`:

```js
import path from "node:path";
import { buildAss } from "../kinetic/ass.js";
import { mulberry32 } from "../kinetic/director.js";
import { escapeFontPath, FONT_DIR } from "../videoFilters.js";
import { getEffect } from "./effects/index.js";
import { resolveStyle, captionEnergyFor } from "./styles.js";

/**
 * The last pass over the joined shots: colour grade, the statements
 * (kinetic engine), the ASS overlays, and the audio mix, encoded for social.
 */
export const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11";
const n3 = (x) => Number(x).toFixed(3);

export function statementsAss(plan) {
  if (!plan.captions.length) return "";
  const style = resolveStyle(plan.style);
  const overrides = {};
  plan.captions.forEach((c, i) => { if (c.effect) overrides[i] = c.effect; });
  return buildAss({
    lines: plan.captions.map(({ text, start, end, reveal, holdUntil }) => ({ text, start, end, reveal, holdUntil })),
    w: plan.w,
    h: plan.h,
    look: style.look,
    energy: captionEnergyFor(plan.energy),
    seed: plan.seed,
    overrides,
  });
}

export function fxAss(plan) {
  const ctx = { w: plan.w, h: plan.h, fps: plan.fps };
  const events = [];
  plan.shots.forEach((shot, i) => {
    shot.overlays.forEach((o, k) => {
      const fx = getEffect(o.id);
      if (fx?.assEvents) events.push(...fx.assEvents({ shot, ctx, rnd: mulberry32((plan.seed + i * 101 + k * 7) >>> 0) }));
    });
  });
  if (!events.length) return "";
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${plan.w}`, `PlayResY: ${plan.h}`, "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: FX,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}

const assFilter = (p) => `ass=filename='${escapeFontPath(p)}':fontsdir='${escapeFontPath(FONT_DIR)}'`;

function audioGraph({ song, voice, D }) {
  const fit = `aresample=48000,apad,atrim=0:${n3(D)}`;
  const tail = (sec) => `afade=t=out:st=${n3(Math.max(0, D - sec))}:d=${sec}`;
  if (song && voice) {
    return [
      `[1:a]${fit},volume=0.35[m]`,
      `[2:a]${fit},asplit=2[v1][v2]`,
      `[m][v1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[duck]`,
      `[v2][duck]amix=inputs=2:duration=first:dropout_transition=2,${tail(1.2)},${LOUDNESS}[a]`,
    ];
  }
  if (song) return [`[1:a]${fit},afade=t=in:d=0.3,${tail(1.2)},${LOUDNESS}[a]`];
  if (voice) return [`[1:a]${fit},${tail(0.6)},${LOUDNESS}[a]`];
  return ["[1:a]anull[a]"];
}

export function finishArgs({ body, out, plan, statementsPath, fxPath, song, voice, workDir }) {
  const D = plan.durationSec;
  const style = resolveStyle(plan.style);
  const inputs = ["-i", body];
  if (song) inputs.push("-ss", n3(song.startSec || 0), "-i", song.file);
  if (voice) inputs.push("-i", voice.file);
  if (!song && !voice) inputs.push("-f", "lavfi", "-t", n3(D), "-i", "anullsrc=r=48000:cl=stereo");
  const video = [style.grade, statementsPath && assFilter(statementsPath), fxPath && assFilter(fxPath)].filter(Boolean);
  const graph = [`[0:v]${video.join(",") || "null"}[v]`, ...audioGraph({ song, voice, D })].join(";");
  const script = path.join(workDir, "finish.txt");
  const args = [
    "-hide_banner", "-v", "error", "-y",
    ...inputs,
    "-filter_complex_script", script,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "-t", n3(D),
    out,
  ];
  return { args, sideFiles: [{ path: script, text: graph }] };
}
```

- [ ] **Step 4: Add the finish filters to the 5.1 allow-list and pin it**

Append the audio and grade filters to `FFMPEG_51_FILTERS` in `server/src/lib/motion/effects/index.js`:

```js
  "aresample", "apad", "atrim", "afade", "volume", "asplit", "sidechaincompress", "amix", "loudnorm", "anull", "anullsrc",
```

Then add this test to `finish.test.js`:

```js
import { filterNames } from "./testkit.js";
import { FFMPEG_51_FILTERS } from "./effects/index.js";

test("the finish graph uses only ffmpeg 5.1 filters", () => {
  for (const [song, voice] of [[{ file: "s", startSec: 0 }, null], [{ file: "s", startSec: 0 }, { file: "v" }], [null, { file: "v" }], [null, null]]) {
    const g = finishArgs({ ...common, plan: plan(), song, voice }).sideFiles[0].text;
    for (const name of filterNames([g])) assert.ok(FFMPEG_51_FILTERS.has(name), `${name} not allowed`);
  }
});
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/finish.test.js src/lib/motion/effects/`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/motion/finish.js server/src/lib/motion/finish.test.js server/src/lib/motion/effects/index.js
```

```bash
git commit -m "feat: motion finish stage (statements, FX, grade, ducked audio mix)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `renderPlan` orchestration and the real smoke render

**Files:**
- Create: `server/src/lib/motion/render.js`
- Test: `server/src/lib/motion/render.test.js`

**Interfaces:**
- Consumes:
  - `shotArgs`, `lastFrameArgs` (Task 10);
  - `statementsAss`, `fxAss`, `finishArgs` (Task 11);
  - `hasLibass` from `../kinetic/capability.js`.
- Produces:
  - `runFfmpeg(args, { signal, ffmpegPath }) → Promise<{ ok, code, stderr, error? }>`. An aborted signal kills ffmpeg and resolves `{ ok: false, error: 'cancelled' }`.
  - `renderPlan({ plan, workImages: string[], song, voice, workDir, out, runner?, onProgress?, signal?, libass? }) → Promise<{ ok: true, file } | { ok: false, error, detail? }>`.
  - Progress events are `{ stage: 'shots'|'join'|'finish', fraction: 0..1 }`.
  - `renderPlan` writes only inside `workDir` and `out`, and never deletes `workDir`; the caller does.

- [ ] **Step 1: Write the failing tests**

`server/src/lib/motion/render.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderPlan } from "./render.js";
import { directMoment } from "./director.js";
import { pulseGrid } from "./cuts.js";
import { workImageArgs } from "./prepare.js";
import { ffmpegAvailable, FFMPEG } from "./testkit.js";
import { hasLibass } from "../kinetic/capability.js";

const shot = (start, end, entrance = "cut", overlays = []) => ({
  start, end, photo: 0, role: "body", move: { id: "push", intensity: 0.5 }, entrance: { id: entrance }, overlays, anchor: { x: 0.5, y: 0.38 },
});
const plan = () => ({
  version: 1, w: 1080, h: 1920, fps: 30, durationSec: 6, seed: 3, style: "glow", energy: 0.2,
  shots: [shot(0, 2), shot(2, 4, "crossfade"), shot(4, 6, "cut", [{ id: "sparkles" }])],
  captions: [{ text: "Grace", start: 0.2, end: 1.9, reveal: 0.5, holdUntil: 1.9 }],
});

function recorder({ failAt = -1 } = {}) {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    return calls.length - 1 === failAt ? { ok: false, code: 1, stderr: "boom: No such filter" } : { ok: true, code: 0, stderr: "" };
  };
  return { calls, runner };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "motion-render-"));

test("shots, the last frame before a crossfade, the join, then the finish", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const progress = [];
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, onProgress: (p) => progress.push(p), libass: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const kinds = calls.map((a) => (a.includes("-sseof") ? "last" : a.includes("concat") ? "join" : a.some((x) => String(x).endsWith("finish.txt")) ? "finish" : "shot"));
  assert.deepEqual(kinds, ["shot", "last", "shot", "shot", "join", "finish"]);
  const list = fs.readFileSync(path.join(workDir, "list.txt"), "utf8");
  assert.equal(list.trim().split("\n").length, 3);
  assert.ok(fs.existsSync(path.join(workDir, "statements.ass")));
  assert.ok(fs.existsSync(path.join(workDir, "fx.ass")));
  const fractions = progress.filter((p) => p.stage === "shots").map((p) => p.fraction);
  assert.deepEqual(fractions, [1 / 3, 2 / 3, 1]);
  assert.deepEqual(progress.at(-1), { stage: "finish", fraction: 1 });
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("a failing shot stops the render with a friendly error and the detail", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder({ failAt: 2 });
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /shot 2 of 3/);
  assert.match(r.detail, /No such filter/);
  assert.equal(calls.length, 3, "nothing runs after the failure");
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("without libass the render refuses rather than dropping the statements", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, libass: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /statements/i);
  assert.equal(calls.length, 0);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("an already-aborted signal renders nothing", async () => {
  const workDir = tmp();
  const { calls, runner } = recorder();
  const ac = new AbortController();
  ac.abort();
  const r = await renderPlan({ plan: plan(), workImages: ["w0.jpg"], song: null, voice: null, workDir, out: path.join(workDir, "o.mp4"), runner, signal: ac.signal, libass: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /cancelled/);
  assert.equal(calls.length, 0);
  fs.rmSync(workDir, { recursive: true, force: true });
});

// The smoke render: real ffmpeg, a real 15 s Moment.
const skip = ffmpegAvailable() && hasLibass() ? false : "ffmpeg with libass not available";

test("smoke: a 15 s Moment from 4 photos and a 3 s tone is a 1080x1920, 15 s MP4", { skip, timeout: 300_000 }, async () => {
  const dir = tmp();
  try {
    const colours = ["red", "green", "blue", "orange"];
    const workImages = colours.map((c, i) => {
      const src = path.join(dir, `p${i}.png`);
      assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=${i === 3 ? "640x360" : "360x640"}:d=1`, "-frames:v", "1", src]).status, 0);
      const out = path.join(dir, `w${i}.jpg`);
      const { args } = workImageArgs({ src, out, width: i === 3 ? 640 : 360, height: i === 3 ? 360 : 640, orientation: 1 });
      assert.equal(spawnSync(FFMPEG, args).status, 0);
      return out;
    });
    const tone = path.join(dir, "tone.m4a");
    assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", tone]).status, 0);
    const photos = [{ shape: "tall" }, { shape: "tall" }, { shape: "tall" }, { shape: "wide" }];
    const { plan: p } = directMoment({
      photos, heroIndex: 0, grid: pulseGrid(15), title: "Happy birthday", statements: ["Blessed", "Celebrate"],
      styleId: "celebrate", energy: 0.7, lengthSec: 15, seed: 21,
    });
    const workDir = path.join(dir, "work");
    fs.mkdirSync(workDir);
    const out = path.join(dir, "moment.mp4");
    const r = await renderPlan({ plan: p, workImages, song: { file: tone, startSec: 0 }, voice: null, workDir, out });
    assert.equal(r.ok, true, JSON.stringify(r));
    const probe = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), ["-v", "error", "-show_entries", "stream=width,height,codec_type:format=duration", "-of", "json", out], { encoding: "utf8" });
    if (probe.status === 0) {
      const info = JSON.parse(probe.stdout);
      const v = info.streams.find((s) => s.codec_type === "video");
      assert.equal(v.width, 1080);
      assert.equal(v.height, 1920);
      assert.ok(info.streams.some((s) => s.codec_type === "audio"));
      assert.ok(Math.abs(Number(info.format.duration) - 15) <= 0.1, `duration ${info.format.duration}`);
    } else {
      assert.ok(fs.statSync(out).size > 10_000);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && node --test src/lib/motion/render.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `render.js`**

`server/src/lib/motion/render.js`:

```js
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { hasLibass } from "../kinetic/capability.js";
import { shotArgs, lastFrameArgs } from "./shotArgs.js";
import { statementsAss, fxAss, finishArgs } from "./finish.js";

/**
 * Motion plan + working images + audio -> one MP4. Each shot is its own
 * short ffmpeg run (memory stays flat whatever the length), joined by the
 * concat demuxer without re-encoding, then one finish pass draws the
 * statements and overlays and mixes the audio.
 */
export function runFfmpeg(args, { signal, ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg" } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: "cancelled", stderr: "" });
      return;
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, error: String(err?.message || err), stderr });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) resolve({ ok: false, error: "cancelled", stderr });
      else resolve({ ok: code === 0, code, stderr });
    });
  });
}

const tail = (s) => String(s || "").trim().split("\n").slice(-8).join("\n");
const writeSide = (files) => { for (const f of files) fs.writeFileSync(f.path, f.text, "utf8"); };
const pad = (i) => String(i).padStart(3, "0");

export async function renderPlan({
  plan, workImages, song = null, voice = null, workDir, out, runner = runFfmpeg, onProgress = () => {}, signal, libass,
}) {
  if (signal?.aborted) return { ok: false, error: "cancelled" };
  const canDraw = libass ?? hasLibass();
  if (plan.captions.length && !canDraw) {
    return { ok: false, error: "This server can't draw the statements (its ffmpeg has no libass)." };
  }
  const run = async (args, what) => {
    const r = await runner(args, { signal });
    if (r.ok) return null;
    if (r.error === "cancelled") return { ok: false, error: "cancelled" };
    return { ok: false, error: `Rendering failed at ${what}.`, detail: tail(r.stderr || r.error) };
  };

  const n = plan.shots.length;
  const clips = [];
  for (let i = 0; i < n; i += 1) {
    const shot = plan.shots[i];
    const clip = path.join(workDir, `shot-${pad(i)}.mp4`);
    const prevFrame = i > 0 ? path.join(workDir, `last-${pad(i - 1)}.png`) : null;
    const { args, sideFiles } = shotArgs({
      shot, index: i, workImage: workImages[shot.photo], prevFrame, out: clip, w: plan.w, h: plan.h, fps: plan.fps, workDir,
    });
    writeSide(sideFiles);
    const failed = await run(args, `shot ${i + 1} of ${n}`);
    if (failed) return failed;
    if (plan.shots[i + 1]?.entrance.id === "crossfade") {
      const grabbed = await run(lastFrameArgs(clip, path.join(workDir, `last-${pad(i)}.png`)), `shot ${i + 1} of ${n}`);
      if (grabbed) return grabbed;
    }
    clips.push(clip);
    onProgress({ stage: "shots", fraction: (i + 1) / n });
  }

  const list = path.join(workDir, "list.txt");
  fs.writeFileSync(list, clips.map((c) => `file '${path.basename(c)}'`).join("\n") + "\n", "utf8");
  const body = path.join(workDir, "body.mp4");
  const joined = await run(["-hide_banner", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", body], "joining the shots");
  if (joined) return joined;
  onProgress({ stage: "join", fraction: 1 });

  const statementsText = statementsAss(plan);
  const statementsPath = statementsText ? path.join(workDir, "statements.ass") : null;
  if (statementsPath) fs.writeFileSync(statementsPath, statementsText, "utf8");
  const fxText = fxAss(plan);
  const fxPath = fxText ? path.join(workDir, "fx.ass") : null;
  if (fxPath) fs.writeFileSync(fxPath, fxText, "utf8");
  const { args, sideFiles } = finishArgs({ body, out, plan, statementsPath, fxPath, song, voice, workDir });
  writeSide(sideFiles);
  const finished = await run(args, "the finishing pass");
  if (finished) return finished;
  onProgress({ stage: "finish", fraction: 1 });
  return { ok: true, file: out };
}
```

The concat demuxer resolves `file 'shot-000.mp4'` relative to the list file's own folder (`workDir`), so no absolute paths and no quoting problems with spaces in the temp path.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd server && node --test src/lib/motion/render.test.js`
Expected: all PASS. The smoke test takes up to a few minutes on a laptop.

If the smoke duration is off by more than 0.1 s, check that `cutPoints` tiles exactly to `lengthSec` and that `finishArgs` uses `-t`.

- [ ] **Step 5: Run the whole motion suite and the server suite**

Run: `cd server && node --test "src/lib/motion/**/*.test.js"`
Expected: all PASS.

Run: `cd server && npm test`
Expected: all PASS. The motion modules are new, so nothing else should change.

- [ ] **Step 6: Commit**

```bash
git add server/src/lib/motion/render.js server/src/lib/motion/render.test.js
```

```bash
git commit -m "feat: motion renderPlan orchestration with a real 15 s smoke render

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

- **Plan B** (`docs/superpowers/plans/2026-10-12-moments-server.md`): occasions and templates, AI statements, the Moments project store, the beat-analysis cache, the render stage (prepare → analyse → `directMoment` → `renderPlan`), the `/api/moments` routes and quotas.
- **Plan C** (`docs/superpowers/plans/2026-10-12-moments-client.md`): `MomentsPage`, the wizard, the result and history views, and the Create hub card.
- **Manual check before the PR (spec §11.3):** render the four styles at calm and hype with the operator's 12 photos, and send a contact sheet plus the videos.
