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

const round2 = (v) => Math.round(v * 100) / 100;

/** The song's sha1, streamed: an upload can be very large, and this must not block or buffer it whole. */
function hashOf(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// A cache entry is used only when it has the shape analysis() writes. Anything
// else (hand-edited, truncated, or from an older build) is rebuilt: a negative
// tempo, for example, would hang beatGrid.
function validEntry(c) {
  return Array.isArray(c.env)
    && Number.isFinite(c.durationSec)
    && (c.tempo === null || (Number.isFinite(c.tempo) && c.tempo > 0));
}

function readEntry(cacheFile) {
  if (!fs.existsSync(cacheFile)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (!validEntry(c)) return null;
    return { tempo: c.tempo, durationSec: c.durationSec, env: Float64Array.from(c.env) };
  } catch {
    return null; // unreadable or corrupt: rebuilt below
  }
}

// The cache is best-effort: a failed write is reported, and the analysis still returns.
function writeEntry(dir, cacheFile, data) {
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, cacheFile);
  } catch (err) {
    console.warn(`beat cache not written (${cacheFile}): ${err.message}`);
    try { fs.unlinkSync(tmp); } catch { /* no tmp file was left behind */ }
  }
}

async function analysis(ctx, file, decode, signal) {
  const dir = cacheDir(ctx.dataDir);
  const cacheFile = path.join(dir, `${await hashOf(file)}.json`);
  const cached = readEntry(cacheFile);
  if (cached) return cached;
  // Rounded BEFORE use, exactly as it is cached: a first render (cache miss) and a
  // re-render (cache hit) must see the same envelope, or the window and beat phase
  // can flip and "same seed, same video" breaks.
  const env = Float64Array.from(onsetEnvelope(await decode(file, { signal })), (v) => Math.round(v * 1e4) / 1e4);
  const result = { tempo: estimateTempo(env), durationSec: env.length / FRAME_RATE, env };
  writeEntry(dir, cacheFile, { tempo: result.tempo, durationSec: result.durationSec, env: Array.from(env) });
  return result;
}

export async function songGrid(ctx, file, { lengthSec, windowStartSec = null, decode = decodePcm, signal }) {
  const { tempo, durationSec, env } = await analysis(ctx, file, decode, signal);
  const latest = Math.max(0, durationSec - lengthSec);
  const requested = Number.isFinite(windowStartSec) ? windowStartSec : null;
  // Rounded once: the grid and the returned windowStartSec are the same value.
  const start = round2(requested === null
    ? chooseWindow(env, lengthSec)
    : Math.min(Math.max(0, requested), latest));
  const grid = tempo ? beatGridOf(beatGrid(env, tempo, start, lengthSec)) : pulseGrid(lengthSec);
  return { grid, tempo, durationSec, windowStartSec: start };
}

export async function voiceGrid(file, { lengthSec, decode = decodePcm, signal }) {
  const pcm = await decode(file, { signal });
  const durationSec = round2(pcm.length / 2 / SAMPLE_RATE);
  const pauses = pausesFrom(pcm).filter((p) => p.start < lengthSec);
  const paused = pauses.length ? pauseGrid(pauses, lengthSec) : null;
  // A pause grid with no marks inside the Moment (every pause falls after its end) has nothing to cut on.
  const grid = paused && paused.marks.length ? paused : pulseGrid(lengthSec);
  return { ...grid, durationSec };
}
