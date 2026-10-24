import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { chargeTaskOnce } from "./chargeOnce.js";
import { readLedger, reserveSpend, usdForTokens } from "./spend.js";

const SPEND = { model: "dreamina-seedance-2-0-mini-260615", resolution: "720p", tokens: 100000 };

describe("chargeTaskOnce", () => {
  let root;
  let ledgerDir;
  let project;
  const update = (fn) => {
    const next = fn(project);
    if (next) project = next;
    return next;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "charge-once-"));
    ledgerDir = path.join(root, "ledger");
    project = { spentUsd: 1, shots: [{ id: "sh1", clip: { taskId: "t1" } }, { id: "sh2", clip: null }] };
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
  });
  afterEach(() => {
    delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("settles the reservation and books the project in one go, once per task", () => {
    reserveSpend(ledgerDir, "k", 0.5);
    const usd = chargeTaskOnce({ ledgerDir, key: "k", spend: SPEND, shotId: "sh1", taskId: "t1", update });
    assert.equal(usd, usdForTokens(SPEND));
    assert.equal(project.spentUsd, 1 + usd);
    assert.equal(project.shots[0].clip.chargedTaskId, "t1");
    assert.equal(project.shots[1].clip, null, "other shots are untouched");

    chargeTaskOnce({ ledgerDir, key: "k", spend: SPEND, shotId: "sh1", taskId: "t1", update });
    assert.equal(project.spentUsd, 1 + usd, "the same task is not booked twice");
    const ledger = readLedger(ledgerDir);
    assert.equal(ledger.clips, 1);
    assert.deepEqual(ledger.reservations, {});
  });

  test("a new task for the same shot is charged again", () => {
    chargeTaskOnce({ ledgerDir, key: "k", spend: SPEND, shotId: "sh1", taskId: "t1", update });
    chargeTaskOnce({ ledgerDir, key: "k", spend: SPEND, shotId: "sh1", taskId: "t2", update });
    assert.equal(project.shots[0].clip.chargedTaskId, "t2");
    assert.ok(Math.abs(project.spentUsd - (1 + 2 * usdForTokens(SPEND))) < 1e-9);
  });

  test("an unknown shot changes nothing in the project", () => {
    const before = project;
    chargeTaskOnce({ ledgerDir, key: "k", spend: SPEND, shotId: "nope", taskId: "t1", update });
    assert.equal(project, before);
  });
});
