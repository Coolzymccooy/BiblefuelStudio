import { spawn } from "node:child_process";

const BANDS = 40;
const FLOOR = 1e-3;
/**
 * Spectral flux jumps as a hit first enters the Hann window, which is
 * frame / 4 (= one hop at the default 1024 / 256) before the hit's own time;
 * measured on click tracks as 19-25 ms. Beat times are pushed back by it.
 */
const ONSET_DELAY_HOPS = 1;

/** In-place radix-2 FFT. `re`/`im` are Float64Arrays of a power-of-two length. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const mel = (hz) => 2595 * Math.log10(1 + hz / 700);
const unmel = (m) => 700 * (10 ** (m / 2595) - 1);

/** FFT bin ranges [lo, hi) for BANDS mel-spaced bands, each at least one bin wide. */
function bandEdges(sr, frame) {
  const half = frame / 2;
  const hzPerBin = sr / frame;
  const top = mel(sr / 2);
  const bottom = mel(30);
  const edges = [];
  for (let b = 0; b <= BANDS; b += 1) {
    edges.push(Math.round(unmel(bottom + ((top - bottom) * b) / BANDS) / hzPerBin));
  }
  for (let b = 1; b <= BANDS; b += 1) edges[b] = Math.min(half, Math.max(edges[b], edges[b - 1] + 1));
  return edges;
}

/**
 * Onset strength per hop: the mean positive change in log band energy
 * (spectral flux over mel-spaced bands). Frames are centred on f * hop, so
 * env index * hop / sr is a hit's time to within the attack of the sound.
 */
export function onsetEnvelope(samples, sr, hop = 256, frame = 1024) {
  const n = samples.length > 0 ? Math.floor(samples.length / hop) + 1 : 0;
  const env = new Float32Array(n);
  if (n === 0) return env;
  const edges = bandEdges(sr, frame);
  const window = new Float64Array(frame);
  for (let k = 0; k < frame; k += 1) window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / frame);
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  let prev = new Float64Array(BANDS);
  let cur = new Float64Array(BANDS);
  for (let f = 0; f < n; f += 1) {
    const start = f * hop - frame / 2;
    for (let k = 0; k < frame; k += 1) {
      const idx = start + k;
      re[k] = idx >= 0 && idx < samples.length ? samples[idx] * window[k] : 0;
      im[k] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let b = 0; b < BANDS; b += 1) {
      let p = 0;
      for (let k = edges[b]; k < edges[b + 1]; k += 1) p += re[k] * re[k] + im[k] * im[k];
      cur[b] = Math.log(FLOOR + p / (edges[b + 1] - edges[b]));
      if (f > 0) flux += Math.max(0, cur[b] - prev[b]);
    }
    env[f] = flux / BANDS;
    [prev, cur] = [cur, prev];
  }
  return env;
}

/** Light 3-tap smoothing so a hit that straddles two frames still scores. */
function smooth(env) {
  const out = new Float32Array(env.length);
  for (let i = 0; i < env.length; i += 1) {
    out[i] = 0.25 * (env[i - 1] || 0) + 0.5 * env[i] + 0.25 * (env[i + 1] || 0);
  }
  return out;
}

/** Mean envelope value on the grid off, off + period, ... (linear interpolation). */
function gridScore(env, period, off) {
  let sum = 0;
  let count = 0;
  for (let t = off; t < env.length - 1; t += period) {
    const i = Math.floor(t);
    const frac = t - i;
    sum += env[i] * (1 - frac) + env[i + 1] * frac;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/** The grid offset (in frames, within one period) where the hits line up best. */
function bestPhase(env, period) {
  let bestOff = 0;
  let bestScore = -Infinity;
  for (let off = 0; off < period; off += 0.25) {
    const score = gridScore(env, period, off);
    if (score > bestScore) { bestScore = score; bestOff = off; }
  }
  return { off: bestOff, score: bestScore };
}

/**
 * Autocorrelation over the allowed range (weighted towards ~115 BPM, like
 * librosa's prior) picks the rough tempo; a fine search of how well a
 * constant grid fits the hits then sharpens it past one-frame resolution.
 */
export function estimateTempo(env, sr, hop, { min = 70, max = 180 } = {}) {
  const fps = sr / hop;
  const mean = env.reduce((a, b) => a + b, 0) / (env.length || 1);
  const x = Array.from(env, (v) => v - mean);
  const lagMin = Math.floor((60 * fps) / max);
  const lagMax = Math.ceil((60 * fps) / min);
  const ac = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i += 1) s += x[i] * x[i + lag];
    ac[lag] = s;
  }
  let best = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 1) ** 2);
    const score = ac[lag] * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  const coarse = (60 * fps) / best;
  const sm = smooth(env);
  let bestBpm = coarse;
  let bestFit = -Infinity;
  for (let bpm = coarse * 0.96; bpm <= coarse * 1.04; bpm += 0.05) {
    const fit = bestPhase(sm, (60 * fps) / bpm).score;
    if (fit > bestFit) { bestFit = fit; bestBpm = bpm; }
  }
  return Math.round(bestBpm * 100) / 100;
}

/** A constant grid at `bpm`, phased to where the hits line up best. */
export function beatTimes(env, sr, hop, bpm, durationSec) {
  const fps = sr / hop;
  const period = (60 * fps) / bpm;
  const { off } = bestPhase(smooth(env), period);
  const times = [];
  for (let t = off; t / fps < durationSec; t += period) {
    times.push(Math.round(((t + ONSET_DELAY_HOPS) / fps) * 1000) / 1000);
  }
  return times;
}

export function decodeMono(filePath, sr = 11025) {
  return new Promise((resolve, reject) => {
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, ["-v", "error", "-i", filePath, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"]);
    const chunks = [];
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg decode exited ${code}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

export async function detectBeats(filePath) {
  const sr = 11025;
  const hop = 256;
  const samples = await decodeMono(filePath, sr);
  const env = onsetEnvelope(samples, sr, hop);
  const bpm = estimateTempo(env, sr, hop);
  return { bpm, times: beatTimes(env, sr, hop, bpm, samples.length / sr) };
}
