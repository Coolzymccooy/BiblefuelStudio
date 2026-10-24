import fs from "fs";
import path from "path";

/**
 * Delete old files that exist only while something is being made, never
 * anything a user or a project may still point at.
 *
 * Only these are removed, once older than MEDIA_CLEANUP_MAX_AGE_DAYS (default 14):
 * - in the top level of an outputs folder: debug dumps from captioned renders
 *   (captioned-args-*.txt, captioned-stderr-*.txt), ffmpeg concat lists
 *   (concat-*.txt) and the trimmer's waveform pictures (waveform-*.png; a
 *   waveform *video* is a user's finished file and is kept);
 * - everything under cache/remote-bg, which re-downloads on demand.
 *
 * Finished videos, uploads, voices, the visual library and project folders
 * are never touched: a link to them must keep working. Disk space for those
 * comes from a proper retention rule (scaling plan Phase 3), not from here.
 */
export const DISPOSABLE_FILES = Object.freeze([
  /^captioned-args-[^/\\]+\.txt$/,
  /^captioned-stderr-[^/\\]+\.txt$/,
  /^concat-[\w-]+\.txt$/,
  /^waveform-[\w-]+\.png$/,
]);
export const DISPOSABLE_DIRS = Object.freeze([path.join("cache", "remote-bg")]);

const DAY_MS = 86_400_000;

export function maxAgeDays(env = process.env) {
  const d = Number(env.MEDIA_CLEANUP_MAX_AGE_DAYS);
  return Number.isFinite(d) && d >= 1 ? d : 14;
}

function removeIfOld(file, cutoff, out) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.mtimeMs > cutoff) return;
    fs.rmSync(file, { force: true });
    out.removed += 1;
    out.bytes += st.size;
  } catch {
    // gone already, or in use: try again next time
  }
}

function walkFiles(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    // Never follow a link out of the cache folder.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walkFiles(p, visit);
    else if (e.isFile()) visit(p);
  }
}

/**
 * @param {string[]} outputDirs every outputs folder (the owner's and each user's)
 * @returns {{removed:number, bytes:number}}
 */
export function cleanupDisposableFiles(outputDirs, { now = Date.now(), env = process.env } = {}) {
  const cutoff = now - maxAgeDays(env) * DAY_MS;
  const out = { removed: 0, bytes: 0 };
  for (const root of outputDirs) {
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (DISPOSABLE_FILES.some((re) => re.test(name))) removeIfOld(path.join(root, name), cutoff, out);
    }
    for (const sub of DISPOSABLE_DIRS) walkFiles(path.join(root, sub), (f) => removeIfOld(f, cutoff, out));
  }
  return out;
}

/** The owner's outputs folder plus DATA_DIR/users/<id>/outputs for every user. */
export function allOutputDirs(dataDir, outputDir) {
  const dirs = [outputDir];
  try {
    for (const e of fs.readdirSync(path.join(dataDir, "users"), { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(path.join(dataDir, "users", e.name, "outputs"));
    }
  } catch {
    // no users yet
  }
  return dirs;
}
