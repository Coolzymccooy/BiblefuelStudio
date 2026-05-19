/**
 * Series history store.
 *
 * Tracks every series the user has generated so the UI can show "Your series"
 * with status (queued, rendering, published, failed) derived from the job
 * records. Each series row keeps:
 *   - seriesId, userId, chapterReference, translation, totalParts
 *   - jobIds: one per part, in order
 *   - createdAt
 *
 * Stored as a single JSON file under DATA_DIR. Series records are small
 * (kilobytes), so a flat file is fine until we migrate to SQLite.
 *
 * Concurrency: writes are atomic via temp-file + rename. Reads are tolerant
 * of corruption (return empty list).
 */

import fs from "fs";
import path from "path";
import { DATA_DIR } from "../paths.js";

const FILE = path.join(DATA_DIR, "series.json");
const TMP = path.join(DATA_DIR, "series.json.tmp");
const MAX_RECENT = 200;

/**
 * @typedef {object} SeriesRecord
 * @property {string} seriesId
 * @property {string} userId
 * @property {string} chapterReference
 * @property {string} book
 * @property {number} chapter
 * @property {string} translation
 * @property {number} totalParts
 * @property {string[]} jobIds
 * @property {string} createdAt   ISO timestamp
 */

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @returns {SeriesRecord[]} */
export function readSeries() {
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return Array.isArray(parsed?.series) ? parsed.series : [];
  } catch {
    return [];
  }
}

/** @param {SeriesRecord} record */
export function appendSeries(record) {
  ensureDir();
  const current = readSeries();
  const next = [record, ...current].slice(0, MAX_RECENT);
  fs.writeFileSync(TMP, JSON.stringify({ series: next }, null, 2), "utf-8");
  fs.renameSync(TMP, FILE);
  return record;
}

/**
 * @param {string} userId
 * @param {number} [limit=50]
 * @returns {SeriesRecord[]}
 */
export function listSeriesForUser(userId, limit = 50) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return [];
  return readSeries()
    .filter((s) => String(s?.userId || "") === safeUserId)
    .slice(0, limit);
}
