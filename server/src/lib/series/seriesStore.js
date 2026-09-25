/**
 * Series history store — multi-tenant.
 *
 * Each call takes the per-user dataDir; the legacy single-file format is
 * preserved, just relocated under per-user dirs when MULTITENANT=true.
 * Concurrency: writes are atomic via temp-file + rename. Reads tolerate
 * corruption (return empty list).
 */

import fs from "fs";
import path from "path";

const MAX_RECENT = 200;

function filePath(dataDir) {
  if (!dataDir) throw new Error("series: dataDir required");
  return path.join(dataDir, "series.json");
}
function tmpPath(dataDir) {
  return path.join(dataDir, "series.json.tmp");
}

function ensureDir(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

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

/** @returns {SeriesRecord[]} */
export function readSeries(dataDir) {
  ensureDir(dataDir);
  const f = filePath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(parsed?.series) ? parsed.series : [];
  } catch {
    return [];
  }
}

/** @param {SeriesRecord} record */
export function appendSeries(dataDir, record) {
  ensureDir(dataDir);
  const current = readSeries(dataDir);
  const next = [record, ...current].slice(0, MAX_RECENT);
  fs.writeFileSync(tmpPath(dataDir), JSON.stringify({ series: next }, null, 2), "utf-8");
  fs.renameSync(tmpPath(dataDir), filePath(dataDir));
  return record;
}

/**
 * @param {string} dataDir
 * @param {string} userId
 * @param {number} [limit=50]
 * @returns {SeriesRecord[]}
 */
export function listSeriesForUser(dataDir, userId, limit = 50) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return [];
  return readSeries(dataDir)
    .filter((s) => String(s?.userId || "") === safeUserId)
    .slice(0, limit);
}
