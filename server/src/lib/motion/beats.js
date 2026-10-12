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
// Tempo is accepted when the mean-removed onset envelope correlates with
// itself one and two beats later at least this much (Pearson-style r, divided
// by the variance). A ratio to the mean autocorrelation cannot separate music
// from noise, so this uses r. Measured: white noise <= 0.015 over 60 seeds,
// the 23 bundled songs 0.045-0.542, click tracks 70-160 BPM 0.55-0.78.
const TEMPO_MIN_CORRELATION = 0.05;
// The faster reading wins when it scores at least this share of the slower one.
const DOUBLE_SHARE = 0.8;
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

/**
 * How well the mean-removed envelope `x` repeats every `lag` frames:
 * mean of x[f] * (x[f+lag] + x[f+2*lag]) / 2, divided by the variance.
 */
function correlation(x, lag, variance) {
  let sum = 0;
  let count = 0;
  for (let f = 0; f + 2 * lag < x.length - 1; f += 1) {
    sum += (x[f] * (at(x, f + lag) + at(x, f + 2 * lag))) / 2;
    count += 1;
  }
  return count ? sum / count / variance : 0;
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
  if (!env.length) return null;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const x = Float64Array.from(env, (v) => v - mean);
  let variance = 0;
  for (const v of x) variance += v * v;
  variance /= x.length;
  if (variance <= 0) return null;
  const scores = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    scores.push({ bpm, score: correlation(x, (60 / bpm) * FRAME_RATE, variance) });
  }
  let best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.score < TEMPO_MIN_CORRELATION) return null;
  // Every other beat repeats too, so half the tempo scores as well as the real
  // one. Prefer the faster reading while it is in range and nearly as strong.
  // Lags are quantised to whole frames, so look +-1 BPM around the double.
  const near = scores.filter((s) => Math.abs(s.bpm - best.bpm * 2) <= 1);
  const double = near.length ? near.reduce((a, b) => (b.score > a.score ? b : a)) : null;
  if (double && double.score >= DOUBLE_SHARE * best.score) best = double;
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
