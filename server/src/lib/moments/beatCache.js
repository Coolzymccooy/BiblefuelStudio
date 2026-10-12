import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { decodePcm, onsetEnvelope, estimateTempo, beatGrid, chooseWindow, pausesFrom, FRAME_RATE, SAMPLE_RATE } from "../motion/beats.js";
import { beatGridOf, pulseGrid, pauseGrid } from "../motion/cuts.js";

/**
 * Timing grids for a Moment. A song's onset envelope and tempo are cached by
 * the file's content hash, so Shuffle, a new length or a nudged window never
 * decodes the song again.
 */
const cacheDir = (dataDir) => path.join(dataDir, "moments", "beats");

function hashOf(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

async function analysis(ctx, file, decode) {
  const cacheFile = path.join(cacheDir(ctx.dataDir), `${hashOf(file)}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      return { tempo: c.tempo, durationSec: c.durationSec, env: Float64Array.from(c.env) };
    } catch { /* a corrupt cache entry is rebuilt below */ }
  }
  // Rounded BEFORE use, exactly as it is cached: a first render (cache miss) and a
  // re-render (cache hit) must see the same envelope, or the window and beat phase
  // can flip and "same seed, same video" breaks.
  const env = Float64Array.from(onsetEnvelope(await decode(file)), (v) => Math.round(v * 1e4) / 1e4);
  const result = { tempo: estimateTempo(env), durationSec: env.length / FRAME_RATE, env };
  fs.mkdirSync(cacheDir(ctx.dataDir), { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tempo: result.tempo, durationSec: result.durationSec, env: Array.from(env) }));
  fs.renameSync(tmp, cacheFile);
  return result;
}

export async function songGrid(ctx, file, { lengthSec, windowStartSec = null, decode = decodePcm }) {
  const { tempo, durationSec, env } = await analysis(ctx, file, decode);
  const latest = Math.max(0, durationSec - lengthSec);
  const start = windowStartSec === null || windowStartSec === undefined
    ? chooseWindow(env, lengthSec)
    : Math.min(Math.max(0, windowStartSec), latest);
  const grid = tempo ? beatGridOf(beatGrid(env, tempo, start, lengthSec)) : pulseGrid(lengthSec);
  return { grid, tempo, durationSec, windowStartSec: Math.round(start * 100) / 100 };
}

export async function voiceGrid(file, { lengthSec, decode = decodePcm }) {
  const pcm = await decode(file);
  const durationSec = Math.round((pcm.length / 2 / SAMPLE_RATE) * 100) / 100;
  const pauses = pausesFrom(pcm).filter((p) => p.start < lengthSec);
  const grid = pauses.length ? pauseGrid(pauses, lengthSec) : pulseGrid(lengthSec);
  return { ...grid, durationSec };
}
