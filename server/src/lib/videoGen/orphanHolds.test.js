import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { releaseOrphanHolds } from "./orphanHolds.js";
import { holdSpend, reserveSpend, readLedger } from "./spend.js";
import { filmHoldKey } from "../cartoon/filmStage.js";
import { shotsHoldKey } from "../sceneScript/shotStage.js";

const INDEX_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../index.js");

describe("orphan holds at boot (issue #124)", () => {
  let root;
  let saved;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "orphan-holds-"));
    saved = { key: process.env.BYTEPLUS_ARK_API_KEY, cap: process.env.VIDEO_GEN_MONTHLY_CAP_USD };
    delete process.env.BYTEPLUS_ARK_API_KEY;
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
  });
  afterEach(() => {
    for (const [k, v] of [["BYTEPLUS_ARK_API_KEY", saved.key], ["VIDEO_GEN_MONTHLY_CAP_USD", saved.cap]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("releases cartoon and scene-script holds with AI video off and no project folders, and nothing else", () => {
    const ledgerDir = path.join(root, "data");
    holdSpend(ledgerDir, filmHoldKey("c1"), 1.2);
    holdSpend(ledgerDir, shotsHoldKey("s1"), 0.8);
    reserveSpend(ledgerDir, "cartoon:c2:sh1", 0.3);
    reserveSpend(ledgerDir, "veo:job", 6);
    assert.equal(fs.existsSync(path.join(ledgerDir, "cartoons")), false);
    assert.equal(fs.existsSync(path.join(ledgerDir, "scene-scripts")), false);
    assert.equal(releaseOrphanHolds(ledgerDir), 2);
    const ledger = readLedger(ledgerDir);
    assert.deepEqual(ledger.reservations, { "cartoon:c2:sh1": 0.3, "veo:job": 6 }, "clip and Veo reservations resume their own way");
    assert.equal(ledger.settledUsd, 0, "a hold is never charged");
    assert.equal(releaseOrphanHolds(ledgerDir), 0);
  });

  test("an empty or missing ledger is fine", () => {
    assert.equal(releaseOrphanHolds(path.join(root, "nothing-here")), 0);
  });

  test("the server sweeps at boot beside the Veo settle, outside the AI video gate", () => {
    const src = fs.readFileSync(INDEX_FILE, "utf8");
    const sweep = src.indexOf("releaseOrphanHolds(DATA_DIR)");
    const veo = src.indexOf("settleStaleReservations(DATA_DIR, VEO_LEDGER_PREFIX)");
    const gate = src.indexOf("if (isSeedanceConfigured())", veo);
    assert.ok(sweep > 0, "index.js calls releaseOrphanHolds(DATA_DIR)");
    assert.ok(veo > 0 && gate > veo);
    assert.ok(sweep > veo && sweep < gate, "the sweep runs after the Veo settle and before the Seedance gate");
  });
});
