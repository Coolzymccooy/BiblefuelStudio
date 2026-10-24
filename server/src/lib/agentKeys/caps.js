import fs from "fs";
import path from "path";
import { DATA_DIR } from "../paths.js";

/**
 * Hard daily caps for MCP agent traffic, applied to every caller (premium and
 * super-admin included). Separate from the plan quotas in middleware/quota.js.
 *
 * File: DATA_DIR/agent-keys-usage.json
 * Shape: { subjects: { [subjectId]: { day: "YYYY-MM-DD", counts: Caps } } }
 * subjectId is the agent key id.
 *
 * Counters reset at midnight UTC, lazily: a stored day that is not today reads
 * as all zeros. Writes are serialised through one in-process promise chain.
 */

export const CAP_BUCKETS = ["renders", "aiVideoUsd", "images", "tts", "publishes"];

const DEFAULT_CEILINGS = {
  renders: 10,
  aiVideoUsd: 2,
  images: 30,
  tts: 30,
  publishes: 3,
};

const ENV_NAMES = {
  renders: "MCP_DAILY_RENDERS",
  aiVideoUsd: "MCP_DAILY_AI_VIDEO_USD",
  images: "MCP_DAILY_IMAGES",
  tts: "MCP_DAILY_TTS",
  publishes: "MCP_DAILY_PUBLISHES",
};

// Absorbs float drift when fractional amounts (aiVideoUsd) accumulate.
const EPSILON = 1e-9;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultClock = () => new Date().toISOString().slice(0, 10);
let clock = defaultClock;

/** Test seam: `fn()` returns the "YYYY-MM-DD" UTC day. Pass null to restore. */
export function _setClock(fn) {
  clock = typeof fn === "function" ? fn : defaultClock;
}

let queue = Promise.resolve();

function usageFilePath() {
  return path.join(DATA_DIR, "agent-keys-usage.json");
}

function emptyCounts() {
  return Object.fromEntries(CAP_BUCKETS.map((bucket) => [bucket, 0]));
}

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function assertBucket(bucket) {
  if (!CAP_BUCKETS.includes(bucket)) throw new Error(`caps: unknown bucket ${bucket}`);
}

/** @returns {{renders:number, aiVideoUsd:number, images:number, tts:number, publishes:number}} */
export function ceilings() {
  return Object.fromEntries(
    CAP_BUCKETS.map((bucket) => [bucket, readEnvNumber(ENV_NAMES[bucket], DEFAULT_CEILINGS[bucket])]),
  );
}

/**
 * min(ceiling, key cap) per bucket. Role and plan are deliberately ignored.
 * A JWT session (key === null) gets the ceilings.
 */
export function effectiveCaps(key) {
  const limits = ceilings();
  const own = key?.caps;
  if (!own || typeof own !== "object") return limits;
  return Object.fromEntries(
    CAP_BUCKETS.map((bucket) => {
      const value = own[bucket];
      const usable = typeof value === "number" && Number.isFinite(value) && value >= 0;
      return [bucket, usable ? Math.min(limits[bucket], value) : limits[bucket]];
    }),
  );
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(usageFilePath(), "utf-8"));
    if (parsed && typeof parsed.subjects === "object" && parsed.subjects) return parsed;
  } catch {
    // Missing or unreadable file reads as empty.
  }
  return { subjects: {} };
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = usageFilePath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, target);
}

function usageFor(store, subjectId, day) {
  const entry = store.subjects[subjectId];
  if (!entry || entry.day !== day) return { day, counts: emptyCounts() };
  return { day, counts: { ...emptyCounts(), ...(entry.counts || {}) } };
}

/** @returns {{ day: string, counts: Caps }} */
export function readKeyUsage(subjectId) {
  return usageFor(readStore(), subjectId, clock());
}

function nextMidnightUtc(day) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + MS_PER_DAY).toISOString();
}

function roundCount(value) {
  return Math.round(value * 1e6) / 1e6;
}

function doCharge(subjectId, key, bucket, amount) {
  const day = clock();
  const store = readStore();
  const usage = usageFor(store, subjectId, day);
  const limit = effectiveCaps(key)[bucket];
  const used = usage.counts[bucket];
  if (used + amount > limit + EPSILON) {
    return { ok: false, used, limit, resetsAt: nextMidnightUtc(day) };
  }
  const nextUsed = roundCount(used + amount);
  const nextSubjects = {
    ...store.subjects,
    [subjectId]: { day, counts: { ...usage.counts, [bucket]: nextUsed } },
  };
  writeStore({ ...store, subjects: nextSubjects });
  return { ok: true, used: nextUsed, limit };
}

/**
 * Reserve `amount` of `bucket` for this subject. Refuses without writing when
 * it would exceed the effective cap. Calls run one after another.
 */
export async function charge(subjectId, key, bucket, amount = 1) {
  assertBucket(bucket);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`caps: invalid amount ${amount}`);
  }
  const run = queue.then(() => doCharge(subjectId, key, bucket, amount));
  queue = run.catch(() => {});
  return run;
}

/** @returns {{ [bucket]: { used:number, limit:number, remaining:number } }} */
export function capsSummary(subjectId, key) {
  const { counts } = readKeyUsage(subjectId);
  const limits = effectiveCaps(key);
  return Object.fromEntries(
    CAP_BUCKETS.map((bucket) => [
      bucket,
      {
        used: counts[bucket],
        limit: limits[bucket],
        remaining: Math.max(0, roundCount(limits[bucket] - counts[bucket])),
      },
    ]),
  );
}
