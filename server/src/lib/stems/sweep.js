import fs from "fs";
import path from "path";
import { readMusicLibrary } from "../musicLibraryStore.js";

const WEEK_MS = 7 * 86_400_000;

/**
 * Delete instrumentals nobody kept, a week after they were made, and any
 * leftover `stems-work/<jobId>` folders of the same age.
 *
 * Separator cleanup of its work dir is best-effort (a killed process can
 * briefly hold a WAV open on Windows, see removeVocals), so this sweep is
 * the backstop that actually reclaims that space (Ruling 5).
 */
export function sweepStaleInstrumentals({ dataDir, outputDir }, now = Date.now()) {
  sweepInstrumentalFiles(dataDir, outputDir, now);
  sweepWorkDirs(outputDir, now);
}

function sweepInstrumentalFiles(dataDir, outputDir, now) {
  let names;
  try { names = fs.readdirSync(outputDir); } catch { return; }
  const kept = new Set(readMusicLibrary(dataDir).items.map((t) => path.resolve(t.file)));
  for (const name of names) {
    if (!/^instrumental-[\w-]+\.m4a$/.test(name)) continue;
    const file = path.resolve(outputDir, name);
    if (kept.has(file)) continue;
    try {
      if (now - fs.statSync(file).mtimeMs > WEEK_MS) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}

function sweepWorkDirs(outputDir, now) {
  const workRoot = path.resolve(outputDir, "stems-work");
  let names;
  try { names = fs.readdirSync(workRoot); } catch { return; }
  for (const name of names) {
    const dir = path.join(workRoot, name);
    try {
      if (now - fs.statSync(dir).mtimeMs > WEEK_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* already gone */ }
  }
}
