import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { sweepStaleInstrumentals } from "./sweep.js";
import { registerTrack } from "../musicLibraryStore.js";

test("removes unkept instrumentals older than a week, keeps kept and recent ones", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sweep-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  const old = path.join(outputDir, "instrumental-old.m4a");
  const kept = path.join(outputDir, "instrumental-kept.m4a");
  const fresh = path.join(outputDir, "instrumental-new.m4a");
  const other = path.join(outputDir, "video.mp4");
  for (const f of [old, kept, fresh, other]) fs.writeFileSync(f, "x");
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  for (const f of [old, kept, other]) fs.utimesSync(f, eightDaysAgo, eightDaysAgo);
  registerTrack(dataDir, { file: kept, label: "Kept" });
  sweepStaleInstrumentals({ dataDir, outputDir });
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(kept), true);
  assert.equal(fs.existsSync(fresh), true);
  assert.equal(fs.existsSync(other), true);
});

test("removes stems-work folders older than a week (Ruling 5)", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sweep-work-"));
  const outputDir = path.join(dataDir, "out");
  const workRoot = path.join(outputDir, "stems-work");
  fs.mkdirSync(workRoot, { recursive: true });
  const oldWork = path.join(workRoot, "job-old");
  const freshWork = path.join(workRoot, "job-fresh");
  fs.mkdirSync(oldWork);
  fs.mkdirSync(freshWork);
  fs.writeFileSync(path.join(oldWork, "leftover.wav"), "x");
  fs.writeFileSync(path.join(freshWork, "leftover.wav"), "x");
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  fs.utimesSync(oldWork, eightDaysAgo, eightDaysAgo);
  sweepStaleInstrumentals({ dataDir, outputDir });
  assert.equal(fs.existsSync(oldWork), false);
  assert.equal(fs.existsSync(freshWork), true);
});

test("a missing stems-work folder is not an error", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-sweep-nowork-"));
  const outputDir = path.join(dataDir, "out");
  fs.mkdirSync(outputDir);
  assert.doesNotThrow(() => sweepStaleInstrumentals({ dataDir, outputDir }));
});
