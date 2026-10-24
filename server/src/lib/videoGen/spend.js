import fs from "fs";
import path from "path";

/**
 * What AI video has cost this month, against a cap, in one JSON file.
 *
 * One BytePlus balance pays for every clip and every super admin resolves to
 * the shared DATA_DIR, so callers pass DATA_DIR and there is one ledger.
 * Before a clip is ordered its estimated cost is reserved; when BytePlus
 * reports the real token count the reservation is replaced by the actual
 * cost (settle), or dropped when no clip was made (release). Every call
 * reads and writes synchronously (temp file + rename), so workers in this
 * process cannot interleave.
 */

const FILE = "videogen-spend.json";

/** US$ per million output tokens: BytePlus list prices of 2026-10-08. */
export const PRICE_PER_MILLION_USD = Object.freeze({
  "dreamina-seedance-2-0-mini-260615": Object.freeze({ "720p": 3.5, "1080p": 3.5 }),
  "dreamina-seedance-2-0-260128": Object.freeze({ "720p": 7.0, "1080p": 7.7 }),
  "dreamina-seedance-2-0-fast-260128": Object.freeze({ "720p": 5.6, "1080p": 5.6 }),
});
// The dearest known rate (Seedance 2.5 at 1080p), so an unknown model is never under-counted.
const FALLBACK_PER_MILLION_USD = 11.7;

export const FRAME_SIZES = Object.freeze({
  "720p": Object.freeze({ "9:16": [720, 1280], "16:9": [1280, 720], "1:1": [960, 960] }),
  "1080p": Object.freeze({ "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1440, 1440] }),
});

export function estimateTokens({ durationSec, ratio = "9:16", resolution = "720p", fps = 24 }) {
  const [w, h] = FRAME_SIZES[resolution]?.[ratio] || FRAME_SIZES["720p"]["9:16"];
  return Math.round(((Number(durationSec) || 0) * w * h * fps) / 1024);
}

export function priceMultiplier() {
  const m = Number(process.env.VIDEO_GEN_PRICE_MULTIPLIER);
  return Number.isFinite(m) && m > 0 && m <= 1 ? m : 1;
}

export function usdForTokens({ model, resolution = "720p", tokens }) {
  const rate = PRICE_PER_MILLION_USD[model]?.[resolution] ?? FALLBACK_PER_MILLION_USD;
  return ((Number(tokens) || 0) / 1_000_000) * rate * priceMultiplier();
}

export function usdPerSecond({ model, resolution, ratio }) {
  return usdForTokens({ model, resolution, tokens: estimateTokens({ durationSec: 1, ratio, resolution }) });
}

export function monthlyCapUsd() {
  const cap = Number(process.env.VIDEO_GEN_MONTHLY_CAP_USD);
  return process.env.VIDEO_GEN_MONTHLY_CAP_USD !== undefined && Number.isFinite(cap) && cap >= 0 ? cap : 30;
}

export function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

const money = (usd) => `$${(Math.round(usd * 100) / 100).toFixed(2)}`;
const capText = (cap) => (Number.isInteger(cap) ? `$${cap}` : money(cap));

export function capMessage(projectedUsd, now = new Date()) {
  const month = now.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `This would take ${month}'s AI video spend to ${money(projectedUsd)} of ${capText(monthlyCapUsd())}.`;
}

function emptyLedger(month, reservations = {}) {
  return { month, settledUsd: 0, tokens: 0, clips: 0, reservations };
}

export function readLedger(dir, now = new Date()) {
  const month = monthKey(now);
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return emptyLedger(month);
  const reservations = raw.reservations && typeof raw.reservations === "object" ? raw.reservations : {};
  // A new month starts from nothing spent; clips still being made carry over.
  if (raw.month !== month) return emptyLedger(month, reservations);
  return {
    month,
    settledUsd: Number(raw.settledUsd) || 0,
    tokens: Number(raw.tokens) || 0,
    clips: Number(raw.clips) || 0,
    reservations,
  };
}

function writeLedger(dir, ledger) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, file);
  return ledger;
}

const reservedTotal = (ledger) => Object.values(ledger.reservations).reduce((a, v) => a + (Number(v) || 0), 0);

export function ledgerSummary(dir, now = new Date()) {
  const l = readLedger(dir, now);
  return { month: l.month, spentUsd: l.settledUsd, reservedUsd: reservedTotal(l), capUsd: monthlyCapUsd(), clips: l.clips };
}

export function wouldExceedCap(dir, extraUsd, now = new Date()) {
  const l = readLedger(dir, now);
  const projectedUsd = l.settledUsd + reservedTotal(l) + (Number(extraUsd) || 0);
  if (projectedUsd > monthlyCapUsd() + 1e-9) return { exceeded: true, projectedUsd, error: capMessage(projectedUsd, now) };
  return { exceeded: false, projectedUsd };
}

export function reserveSpend(dir, key, usd, now = new Date()) {
  // NaN would pass the cap check and poison every later total.
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return { ok: false, error: "Invalid cost estimate." };
  const l = readLedger(dir, now);
  const others = reservedTotal(l) - (Number(l.reservations[key]) || 0);
  const projected = l.settledUsd + others + usd;
  if (projected > monthlyCapUsd() + 1e-9) return { ok: false, error: capMessage(projected, now) };
  writeLedger(dir, { ...l, reservations: { ...l.reservations, [key]: usd } });
  return { ok: true };
}

const validUsd = (usd) => typeof usd === "number" && Number.isFinite(usd) && usd >= 0;
const withoutKeys = (reservations, keys) => Object.fromEntries(Object.entries(reservations).filter(([k]) => !keys.includes(k)));

/**
 * Hold money for a batch of clips (a whole film) before any of them is
 * ordered. The cap check and the hold are one synchronous write, so a batch
 * started a moment later already counts this one and cannot also pass.
 * `checkUsd` (never less than `usd`) is what must fit under the cap; only
 * `usd` is held. Holding the same key again replaces it.
 */
export function holdSpend(dir, key, usd, { checkUsd = usd, now = new Date() } = {}) {
  if (!validUsd(usd) || !validUsd(checkUsd)) return { ok: false, error: "Invalid cost estimate." };
  const l = readLedger(dir, now);
  const others = reservedTotal(l) - (Number(l.reservations[key]) || 0);
  const projected = l.settledUsd + others + Math.max(usd, checkUsd);
  if (projected > monthlyCapUsd() + 1e-9) return { ok: false, error: capMessage(projected, now) };
  writeLedger(dir, { ...l, reservations: { ...l.reservations, [key]: usd } });
  return { ok: true };
}

/**
 * Reserve one clip's estimate out of a hold, in one write: the hold shrinks by
 * what the clip takes, so the hold plus the clips never count more than was
 * held. What the hold covers was checked when it was made and is never refused
 * here, even if the cap has fallen since; only an amount beyond what is left of
 * the hold is checked against the cap. With no hold this is reserveSpend.
 */
export function drawSpend(dir, holdKey, key, usd, now = new Date()) {
  if (!validUsd(usd)) return { ok: false, error: "Invalid cost estimate." };
  const l = readLedger(dir, now);
  const held = Number(l.reservations[holdKey]) || 0;
  const taken = Math.min(held, usd);
  const left = held - taken;
  if (usd - taken > 1e-9) {
    const others = reservedTotal(l) - held - (Number(l.reservations[key]) || 0);
    const projected = l.settledUsd + others + left + usd;
    if (projected > monthlyCapUsd() + 1e-9) return { ok: false, error: capMessage(projected, now) };
  }
  const rest = withoutKeys(l.reservations, [holdKey, key]);
  const reservations = left > 1e-9 ? { ...rest, [holdKey]: left, [key]: usd } : { ...rest, [key]: usd };
  writeLedger(dir, { ...l, reservations });
  return { ok: true };
}

/**
 * Drop every reservation whose key starts with `prefix`, except those `keep`
 * names, charging nothing. Only for holds: a hold stands for clips not yet
 * ordered, so one left by a run a restart cut off covers no order at all.
 * Returns how many were dropped.
 */
export function releaseReservations(dir, prefix, keep = () => false, now = new Date()) {
  const l = readLedger(dir, now);
  const gone = Object.keys(l.reservations).filter((k) => k.startsWith(prefix) && !keep(k));
  if (!gone.length) return 0;
  writeLedger(dir, { ...l, reservations: withoutKeys(l.reservations, gone) });
  return gone.length;
}

export function settleSpend(dir, key, { model, resolution, tokens }, now = new Date()) {
  const l = readLedger(dir, now);
  const usd = usdForTokens({ model, resolution, tokens });
  const { [key]: _settled, ...rest } = l.reservations;
  writeLedger(dir, {
    ...l,
    reservations: rest,
    settledUsd: l.settledUsd + usd,
    tokens: l.tokens + (Number(tokens) || 0),
    clips: l.clips + 1,
  });
  return usd;
}

/**
 * Settle a reservation at a known cost, for providers that report no token
 * count (Veo). The estimate the caller reserved is the usual amount.
 */
export function settleSpendUsd(dir, key, usd, now = new Date()) {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) throw new Error("Invalid cost to settle.");
  const l = readLedger(dir, now);
  const { [key]: _settled, ...rest } = l.reservations;
  writeLedger(dir, { ...l, reservations: rest, settledUsd: l.settledUsd + usd, clips: l.clips + 1 });
  return usd;
}

/**
 * At start-up, charge every reservation whose key starts with `prefix` at its
 * estimate. They belong to requests a restart cut off, and the order may have
 * been placed, so they are counted as spent rather than left reserved for ever.
 */
export function settleStaleReservations(dir, prefix, now = new Date()) {
  const l = readLedger(dir, now);
  const stale = Object.entries(l.reservations).filter(([k]) => k.startsWith(prefix));
  if (!stale.length) return { count: 0, usd: 0 };
  const usd = stale.reduce((a, [, v]) => a + (Number(v) || 0), 0);
  const reservations = Object.fromEntries(Object.entries(l.reservations).filter(([k]) => !k.startsWith(prefix)));
  writeLedger(dir, { ...l, reservations, settledUsd: l.settledUsd + usd, clips: l.clips + stale.length });
  return { count: stale.length, usd };
}

/** True while key holds a reservation. Settling removes it, so this tells a caller whether a clip is still unpaid. */
export function isReserved(dir, key, now = new Date()) {
  return key in readLedger(dir, now).reservations;
}

export function releaseSpend(dir, key, now = new Date()) {
  const l = readLedger(dir, now);
  if (!(key in l.reservations)) return;
  const { [key]: _released, ...rest } = l.reservations;
  writeLedger(dir, { ...l, reservations: rest });
}
