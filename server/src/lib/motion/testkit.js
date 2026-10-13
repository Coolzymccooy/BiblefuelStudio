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
