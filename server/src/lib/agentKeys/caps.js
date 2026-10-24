import fs from "fs";
import path from "path";
import { DATA_DIR } from "../paths.js";

/**
 * Hard daily caps for MCP agent traffic, applied to every caller (premium and
 * super-admin included). Separate from the plan quotas in middleware/quota.js.
 *
 * File: DATA_DIR/agent-keys-usage.json
 * Shape: { subjects: { [subjectId]: { day: "YYYY-MM-DD", counts: Caps } } }
 * subjectId is the agent key id, or `user:<userId>` for the account counter
 * that every key of one user shares (its limit is the environment ceiling).
 *
 * Counters reset at midnight UTC, lazily: a stored day that is not today reads
 * as all zeros. Writes are serialised through one in-process promise chain.
 */

export const CAP_BUCKETS = ["renders", "aiVideoUsd", "images", "tts", "publishes", "imports"];

const DEFAULT_CEILINGS = {
  renders: 10,
  aiVideoUsd: 2,
  images: 30,
  tts: 30,
  publishes: 3,
  imports: 20,
};

const ENV_NAMES = {
  renders: "MCP_DAILY_RENDERS",
  aiVideoUsd: "MCP_DAILY_AI_VIDEO_USD",
  images: "MCP_DAILY_IMAGES",
  tts: "MCP_DAILY_TTS",
  publishes: "MCP_DAILY_PUBLISHES",
  imports: "MCP_DAILY_IMPORTS",
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

/** @returns {{renders:number, aiVideoUsd:number, images:number, tts:number, publishes:number, imports:number}} */
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

const userSubject = (userId) => `user:${userId}`;

/** Today's use across every key of one user. @returns {{ day: string, counts: Caps }} */
export function readUserUsage(userId) {
  return readKeyUsage(userSubject(userId));
}

function nextMidnightUtc(day) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + MS_PER_DAY).toISOString();
}

function roundCount(value) {
  return Math.round(value * 1e6) / 1e6;
}

/** The counters one charge touches: the key's own, then the account's (when the key has an owner). */
function countersFor(subjectId, key) {
  const counters = [{ scope: "key", subjectId, limits: effectiveCaps(key) }];
  if (key?.userId) counters.push({ scope: "user", subjectId: userSubject(key.userId), limits: ceilings() });
  return counters;
}

/** The first counter (bucket by bucket, key before account) the charge would push over its limit. */
function firstOverLimit(checked, entries) {
  for (const [bucket, amount] of entries) {
    const over = checked.find(({ usage, limits }) => usage.counts[bucket] + amount > limits[bucket] + EPSILON);
    if (over) return { bucket, over };
  }
  return null;
}

function doChargeAll(subjectId, key, entries) {
  const day = clock();
  const store = readStore();
  const checked = countersFor(subjectId, key).map((counter) => ({
    ...counter,
    usage: usageFor(store, counter.subjectId, day),
  }));
  // The key's own cap is checked first, so a lower per-key cap is what the agent is told about.
  const refusal = firstOverLimit(checked, entries);
  if (refusal) {
    const { bucket, over } = refusal;
    return {
      ok: false,
      bucket,
      scope: over.scope,
      used: over.usage.counts[bucket],
      limit: over.limits[bucket],
      resetsAt: nextMidnightUtc(day),
    };
  }
  const charged = checked.map(({ subjectId: id, usage }) => {
    const added = entries.map(([bucket, amount]) => [bucket, roundCount(usage.counts[bucket] + amount)]);
    return [id, { day, counts: { ...usage.counts, ...Object.fromEntries(added) } }];
  });
  const nextSubjects = { ...store.subjects, ...Object.fromEntries(charged) };
  writeStore({ ...store, subjects: nextSubjects });
  const own = nextSubjects[subjectId].counts;
  return {
    ok: true,
    used: Object.fromEntries(entries.map(([bucket]) => [bucket, own[bucket]])),
    limits: Object.fromEntries(entries.map(([bucket]) => [bucket, checked[0].limits[bucket]])),
  };
}

function assertAmount(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`caps: invalid amount ${amount}`);
  }
}

/**
 * Reserve several buckets at once, e.g. `{ renders: 1, publishes: 1 }`, for this key and for its
 * owner's account. Every bucket is checked on both counters first; when any one would exceed its cap
 * nothing is written, and the refusal names the `bucket` and the `scope` ("key" or "user").
 * Calls run one after another (one queue shared with `charge`).
 */
export async function chargeAll(subjectId, key, amounts) {
  const entries = Object.entries(amounts || {});
  if (entries.length === 0) throw new Error("caps: nothing to charge");
  for (const [bucket, amount] of entries) {
    assertBucket(bucket);
    assertAmount(amount);
  }
  const run = queue.then(() => doChargeAll(subjectId, key, entries));
  queue = run.catch(() => {});
  return run;
}

function doRefundAll(subjectId, key, entries) {
  const day = clock();
  const store = readStore();
  const refunded = countersFor(subjectId, key).map(({ subjectId: id }) => {
    const usage = usageFor(store, id, day);
    const lowered = entries.map(([bucket, amount]) => [bucket, Math.max(0, roundCount(usage.counts[bucket] - amount))]);
    return [id, { day, counts: { ...usage.counts, ...Object.fromEntries(lowered) } }];
  });
  writeStore({ ...store, subjects: { ...store.subjects, ...Object.fromEntries(refunded) } });
}

/**
 * Give back what `chargeAll` spent, e.g. `{ renders: 1 }`, on this key and on its owner's account
 * (R37: the app refused the call). A counter never goes below zero. Same queue as `chargeAll`, so a
 * refund never interleaves with a charge. An empty `amounts` does nothing.
 */
export async function refundAll(subjectId, key, amounts) {
  const entries = Object.entries(amounts || {});
  for (const [bucket, amount] of entries) {
    assertBucket(bucket);
    assertAmount(amount);
  }
  if (entries.length === 0) return;
  const run = queue.then(() => doRefundAll(subjectId, key, entries));
  queue = run.catch(() => {});
  return run;
}

/**
 * Reserve `amount` of one `bucket` for this key and for its owner's account.
 * Refuses without writing either counter when either would exceed its cap;
 * the refusal's `scope` ("key" or "user") says which.
 */
export async function charge(subjectId, key, bucket, amount = 1) {
  assertBucket(bucket);
  assertAmount(amount);
  const outcome = await chargeAll(subjectId, key, { [bucket]: amount });
  if (!outcome.ok) {
    const { bucket: _bucket, ...refusal } = outcome;
    return refusal;
  }
  return { ok: true, used: outcome.used[bucket], limit: outcome.limits[bucket] };
}

function summarise(counts, limits) {
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

/** One key's use today. @returns {{ [bucket]: { used:number, limit:number, remaining:number } }} */
export function capsSummary(subjectId, key) {
  return summarise(readKeyUsage(subjectId).counts, effectiveCaps(key));
}

/** The account's use today across all its keys, against the environment ceilings. Same shape as capsSummary. */
export function accountCapsSummary(userId) {
  return summarise(readUserUsage(userId).counts, ceilings());
}
