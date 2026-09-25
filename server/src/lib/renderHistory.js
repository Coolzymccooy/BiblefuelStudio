import fs from "fs";
import path from "path";

// Per-user log of completed captioned-video renders. Backed by a JSON file
// inside the user's dataDir so it shares the tenant scoping conventions used
// elsewhere (library.json, users.json). Append-only on success; a long-lived
// install will be capped at MAX_ENTRIES so the file stays trivially small.

const HISTORY_FILE = "captionedVideoHistory.json";
const MAX_ENTRIES = 50;

function historyPath(dataDir) {
  return path.join(dataDir, HISTORY_FILE);
}

function readSafe(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append a render to the user's history, newest-first, capped at MAX_ENTRIES.
 *
 * @param {string} dataDir
 * @param {object} entry  { jobId, file, createdAt, durationSec, sourceMediaPath?, backgroundId?, mode }
 * @returns {object[]}    the resulting history (newest-first)
 */
export function appendRender(dataDir, entry) {
  if (!dataDir) return [];
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    return [];
  }
  const file = historyPath(dataDir);
  const list = readSafe(file);
  // De-dupe on jobId so a double-call (e.g. retry) doesn't double-list.
  const filtered = list.filter((x) => x.jobId !== entry.jobId);
  const next = [entry, ...filtered].slice(0, MAX_ENTRIES);
  try {
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  } catch {
    // Best-effort: history is not load-bearing for the render itself.
  }
  return next;
}

/**
 * @param {string} dataDir
 * @param {number} [limit=20]
 * @returns {object[]}
 */
export function listRenders(dataDir, limit = 20) {
  if (!dataDir) return [];
  return readSafe(historyPath(dataDir)).slice(0, Math.max(1, Math.min(MAX_ENTRIES, limit)));
}
