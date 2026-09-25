import fs from "fs";
import path from "path";

/**
 * Per-user daily usage counters.
 *
 * Layout: DATA_DIR/users/<userId>/usage.json
 * Shape: { day: "YYYY-MM-DD", counts: { scripts: 0, tts: 0, render: 0, imageGen: 0 } }
 *
 * Counter buckets reset at midnight UTC. Reset is lazy: every read/increment
 * checks the stored day and starts a fresh counter object when the day rolls
 * over. No background job needed.
 *
 * Spec: docs/superpowers/specs/2026-05-26-public-multitenancy-design.md §Phase 3
 */

function usageFilePath(dataDir) {
  if (!dataDir) throw new Error("usage: dataDir required");
  return path.join(dataDir, "usage.json");
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function emptyCounts() {
  return { scripts: 0, tts: 0, render: 0, imageGen: 0 };
}

function readRaw(dataDir) {
  try {
    if (!fs.existsSync(dataDir)) return null;
    const f = usageFilePath(dataDir);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * @returns {{ day: string, counts: { scripts:number, tts:number, render:number, imageGen:number } }}
 */
export function readUsage(dataDir) {
  const today = todayUtc();
  const raw = readRaw(dataDir);
  if (!raw || raw.day !== today) {
    return { day: today, counts: emptyCounts() };
  }
  return {
    day: raw.day,
    counts: { ...emptyCounts(), ...(raw.counts || {}) },
  };
}

/**
 * Bump a counter and persist. Returns the new count for that bucket.
 * @param {string} dataDir
 * @param {'scripts'|'tts'|'render'|'imageGen'} bucket
 * @param {number} [by=1]
 */
export function incrementUsage(dataDir, bucket, by = 1) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const current = readUsage(dataDir);
  const valid = ["scripts", "tts", "render", "imageGen"];
  if (!valid.includes(bucket)) throw new Error(`usage: unknown bucket ${bucket}`);
  current.counts[bucket] = (current.counts[bucket] || 0) + Number(by || 1);
  fs.writeFileSync(usageFilePath(dataDir), JSON.stringify(current, null, 2));
  return current.counts[bucket];
}

/**
 * Zero out every bucket for the current day. Used by super-admin to grant a
 * user a fresh allotment without waiting for the midnight-UTC rollover.
 * Returns the new (all-zero) usage record.
 *
 * @param {string} dataDir
 */
export function resetUsage(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const fresh = { day: todayUtc(), counts: emptyCounts() };
  fs.writeFileSync(usageFilePath(dataDir), JSON.stringify(fresh, null, 2));
  return fresh;
}
