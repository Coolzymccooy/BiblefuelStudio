import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  estimateTokens, usdForTokens, usdPerSecond, priceMultiplier, monthlyCapUsd, monthKey, capMessage,
  readLedger, ledgerSummary, wouldExceedCap, reserveSpend, settleSpend, releaseSpend,
  settleSpendUsd, settleStaleReservations,
} from "./spend.js";

const MINI = "dreamina-seedance-2-0-mini-260615";
const OCT = new Date("2026-10-16T09:00:00Z");
const NOV = new Date("2026-11-01T00:00:01Z");
let dir;
let saved;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spend-"));
  saved = { cap: process.env.VIDEO_GEN_MONTHLY_CAP_USD, mult: process.env.VIDEO_GEN_PRICE_MULTIPLIER };
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_PRICE_MULTIPLIER;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [["VIDEO_GEN_MONTHLY_CAP_USD", saved.cap], ["VIDEO_GEN_PRICE_MULTIPLIER", saved.mult]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("pricing", () => {
  test("tokens follow BytePlus's formula (5 s at 720×1280 = 108,000)", () => {
    assert.equal(estimateTokens({ durationSec: 5, ratio: "9:16", resolution: "720p" }), 108000);
    assert.equal(estimateTokens({ durationSec: 4, ratio: "16:9", resolution: "1080p" }), 4 * 1920 * 1080 * 24 / 1024);
  });
  test("the 2026-10-16 test: 998,100 tokens on Mini", () => {
    assert.ok(Math.abs(usdForTokens({ model: MINI, resolution: "720p", tokens: 998100 }) - 3.49335) < 1e-9);
    process.env.VIDEO_GEN_PRICE_MULTIPLIER = "0.4";
    assert.ok(Math.abs(usdForTokens({ model: MINI, resolution: "720p", tokens: 998100 }) - 1.39734) < 1e-9);
  });
  test("an unknown model is priced at the dearest known rate, never cheaper", () => {
    assert.equal(usdForTokens({ model: "something-new", tokens: 1_000_000 }), 11.7);
  });
  test("a nonsense multiplier falls back to list price", () => {
    process.env.VIDEO_GEN_PRICE_MULTIPLIER = "5";
    assert.equal(priceMultiplier(), 1);
    process.env.VIDEO_GEN_PRICE_MULTIPLIER = "-1";
    assert.equal(priceMultiplier(), 1);
  });
  test("price per second for a quality and frame", () => {
    assert.equal(usdPerSecond({ model: MINI, resolution: "720p", ratio: "9:16" }).toFixed(4), (21600 / 1e6 * 3.5).toFixed(4));
  });
  test("cap defaults to $30 and reads the env", () => {
    assert.equal(monthlyCapUsd(), 30);
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "12.5";
    assert.equal(monthlyCapUsd(), 12.5);
  });
  test("the refusal says the month and the totals", () => {
    assert.equal(capMessage(31.2, OCT), "This would take October's AI video spend to $31.20 of $30.");
    // The Story page's AI motion line (client storyAiMotionNote) spots a cap failure by this phrase.
    assert.match(capMessage(31.2, OCT), /AI video spend/);
  });
});

describe("ledger", () => {
  test("starts empty", () => {
    assert.deepEqual(ledgerSummary(dir, OCT), { month: "2026-10", spentUsd: 0, reservedUsd: 0, capUsd: 30, clips: 0 });
  });
  test("reserve, then settle replaces the estimate with the real cost", () => {
    assert.deepEqual(reserveSpend(dir, "p:s1", 0.5, OCT), { ok: true });
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0.5);
    const usd = settleSpend(dir, "p:s1", { model: MINI, resolution: "720p", tokens: 108900 }, OCT);
    assert.equal(usd.toFixed(5), (108900 / 1e6 * 3.5).toFixed(5));
    const sum = ledgerSummary(dir, OCT);
    assert.equal(sum.reservedUsd, 0);
    assert.equal(sum.spentUsd.toFixed(5), usd.toFixed(5));
    assert.equal(sum.clips, 1);
  });
  test("release drops a reservation without spending", () => {
    reserveSpend(dir, "p:s1", 0.5, OCT);
    releaseSpend(dir, "p:s1", OCT);
    assert.deepEqual(ledgerSummary(dir, OCT), { month: "2026-10", spentUsd: 0, reservedUsd: 0, capUsd: 30, clips: 0 });
  });
  test("a reservation that would cross the cap is refused", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    assert.equal(reserveSpend(dir, "p:s1", 0.6, OCT).ok, true);
    const r = reserveSpend(dir, "p:s2", 0.6, OCT);
    assert.equal(r.ok, false);
    assert.equal(r.error, "This would take October's AI video spend to $1.20 of $1.");
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0.6);
  });
  test("a cost that is not a real amount is refused and nothing is written", () => {
    for (const bad of [NaN, Infinity, -0.5, undefined, "0.5"]) {
      assert.deepEqual(reserveSpend(dir, "p:s1", bad, OCT), { ok: false, error: "Invalid cost estimate." }, String(bad));
    }
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0);
    assert.equal(fs.existsSync(path.join(dir, "videogen-spend.json")), false);
    assert.equal(reserveSpend(dir, "p:s1", 0, OCT).ok, true, "a free clip is still a valid estimate");
  });
  test("re-reserving the same key replaces it rather than adding", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(dir, "p:s1", 0.6, OCT);
    assert.equal(reserveSpend(dir, "p:s1", 0.9, OCT).ok, true);
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0.9);
  });
  test("wouldExceedCap checks a whole batch", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(dir, "p:s1", 0.6, OCT);
    assert.equal(wouldExceedCap(dir, 0.3, OCT).exceeded, false);
    const over = wouldExceedCap(dir, 0.5, OCT);
    assert.equal(over.exceeded, true);
    assert.equal(over.error, "This would take October's AI video spend to $1.10 of $1.");
  });
  test("a new month starts from nothing spent but keeps clips still being made", () => {
    reserveSpend(dir, "p:s1", 0.5, OCT);
    settleSpend(dir, "p:s2", { model: MINI, resolution: "720p", tokens: 1_000_000 }, OCT);
    const nov = readLedger(dir, NOV);
    assert.equal(nov.month, "2026-11");
    assert.equal(nov.settledUsd, 0);
    assert.deepEqual(nov.reservations, { "p:s1": 0.5 });
    assert.equal(monthKey(NOV), "2026-11");
  });
  test("a corrupt ledger file reads as empty instead of throwing", () => {
    fs.writeFileSync(path.join(dir, "videogen-spend.json"), "{not json");
    assert.equal(ledgerSummary(dir, OCT).spentUsd, 0);
  });

  test("settleSpendUsd charges a known amount and drops the reservation", () => {
    reserveSpend(dir, "veo:a", 6, OCT);
    assert.equal(settleSpendUsd(dir, "veo:a", 6, OCT), 6);
    const l = readLedger(dir, OCT);
    assert.equal(l.settledUsd, 6);
    assert.equal(l.clips, 1);
    assert.deepEqual(l.reservations, {});
  });

  test("settleSpendUsd refuses a cost that is not a number", () => {
    reserveSpend(dir, "veo:a", 6, OCT);
    assert.throws(() => settleSpendUsd(dir, "veo:a", Number.NaN, OCT), /cost/);
    assert.equal(readLedger(dir, OCT).settledUsd, 0);
  });

  test("settleStaleReservations charges only the keys with the prefix", () => {
    reserveSpend(dir, "veo:a", 6, OCT);
    reserveSpend(dir, "veo:b", 3, OCT);
    reserveSpend(dir, "story:x", 1, OCT);
    assert.deepEqual(settleStaleReservations(dir, "veo:", OCT), { count: 2, usd: 9 });
    const l = readLedger(dir, OCT);
    assert.equal(l.settledUsd, 9);
    assert.deepEqual(Object.keys(l.reservations), ["story:x"], "other kinds still resume their own way");
    assert.deepEqual(settleStaleReservations(dir, "veo:", OCT), { count: 0, usd: 0 });
  });
});
