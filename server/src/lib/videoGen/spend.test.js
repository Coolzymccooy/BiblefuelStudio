import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  estimateTokens, usdForTokens, usdPerSecond, priceMultiplier, monthlyCapUsd, monthKey, capMessage,
  readLedger, ledgerSummary, wouldExceedCap, reserveSpend, settleSpend, releaseSpend,
  settleSpendUsd, settleStaleReservations, holdSpend, drawSpend, releaseReservations, shrinkHold,
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

describe("holds", () => {
  test("a hold is checked and written in one step, so a second batch sees the first", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "3";
    assert.deepEqual(holdSpend(dir, "film:a", 2, { now: OCT }), { ok: true });
    const second = holdSpend(dir, "film:b", 2, { now: OCT });
    assert.equal(second.ok, false);
    assert.equal(second.error, "This would take October's AI video spend to $4.00 of $3.");
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 2);
  });
  test("a hold can be checked against more than it holds", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "3";
    assert.equal(holdSpend(dir, "film:a", 1, { checkUsd: 4, now: OCT }).ok, false);
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0, "nothing held when refused");
    assert.deepEqual(holdSpend(dir, "film:a", 1, { checkUsd: 2.5, now: OCT }), { ok: true });
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 1, "only the hold's own amount is reserved");
  });
  test("a hold refuses an amount that is not real", () => {
    assert.deepEqual(holdSpend(dir, "film:a", NaN, { now: OCT }), { ok: false, error: "Invalid cost estimate." });
    assert.equal(fs.existsSync(path.join(dir, "videogen-spend.json")), false);
  });
  test("drawing moves a clip's estimate out of the hold, leaving the total unchanged", () => {
    holdSpend(dir, "film:a", 1.5, { now: OCT });
    assert.deepEqual(drawSpend(dir, "film:a", "c:1", 0.5, OCT), { ok: true });
    assert.deepEqual(readLedger(dir, OCT).reservations, { "film:a": 1, "c:1": 0.5 });
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 1.5);
    drawSpend(dir, "film:a", "c:2", 1, OCT);
    assert.deepEqual(readLedger(dir, OCT).reservations, { "c:1": 0.5, "c:2": 1 }, "an empty hold is dropped");
  });
  test("a draw within the hold is never refused by the cap, even when the cap has since fallen", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "2";
    holdSpend(dir, "film:a", 2, { now: OCT });
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    assert.deepEqual(drawSpend(dir, "film:a", "c:1", 1.25, OCT), { ok: true });
    assert.deepEqual(readLedger(dir, OCT).reservations, { "film:a": 0.75, "c:1": 1.25 });
  });
  test("only what goes beyond the hold is checked against the cap", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    holdSpend(dir, "film:a", 0.5, { now: OCT });
    reserveSpend(dir, "other", 0.4, OCT);
    const over = drawSpend(dir, "film:a", "c:1", 0.7, OCT);
    assert.equal(over.ok, false);
    assert.equal(over.error, "This would take October's AI video spend to $1.10 of $1.");
    assert.deepEqual(readLedger(dir, OCT).reservations, { "film:a": 0.5, other: 0.4 }, "a refused draw leaves the hold");
    assert.deepEqual(drawSpend(dir, "film:a", "c:1", 0.6, OCT), { ok: true });
    assert.deepEqual(readLedger(dir, OCT).reservations, { other: 0.4, "c:1": 0.6 });
  });
  test("drawing without a hold works as a plain reservation", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    assert.deepEqual(drawSpend(dir, "film:none", "c:1", 0.6, OCT), { ok: true });
    assert.equal(drawSpend(dir, "film:none", "c:2", 0.6, OCT).ok, false);
    assert.equal(drawSpend(dir, "film:none", "c:3", -1, OCT).ok, false);
  });
  test("shrinkHold gives back a share no clip will draw, and drops an emptied hold", () => {
    holdSpend(dir, "film:a", 1.5, { now: OCT });
    assert.equal(shrinkHold(dir, "film:a", 0.5, OCT), 0.5);
    assert.deepEqual(readLedger(dir, OCT).reservations, { "film:a": 1 });
    assert.equal(shrinkHold(dir, "film:a", 4, OCT), 1, "never more than is held");
    assert.deepEqual(readLedger(dir, OCT).reservations, {});
    assert.equal(shrinkHold(dir, "film:a", 1, OCT), 0, "no hold, nothing to give back");
    assert.equal(shrinkHold(dir, "film:a", NaN, OCT), 0);
    assert.equal(readLedger(dir, OCT).settledUsd, 0);
  });
  test("releaseReservations drops the prefix's keys except those kept, and charges nothing", () => {
    holdSpend(dir, "film:a", 1, { now: OCT });
    holdSpend(dir, "film:b", 2, { now: OCT });
    reserveSpend(dir, "c:1", 0.5, OCT);
    assert.equal(releaseReservations(dir, "film:", (key) => key === "film:b", OCT), 1);
    const l = readLedger(dir, OCT);
    assert.deepEqual(l.reservations, { "film:b": 2, "c:1": 0.5 });
    assert.equal(l.settledUsd, 0);
    assert.equal(releaseReservations(dir, "film:", () => false, OCT), 1);
    assert.equal(releaseReservations(dir, "film:", () => false, OCT), 0);
  });
});
