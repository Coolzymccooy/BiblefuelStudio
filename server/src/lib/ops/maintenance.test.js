import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMaintenance, backupsEnabled } from "./maintenance.js";
import { folderTarget, DATA_PREFIX } from "./backup.js";

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const quiet = { log() {}, warn() {} };
const HOUR = 3_600_000;

function rig({ env = {}, target = undefined, start = Date.parse("2026-10-24T01:00:00Z") } = {}) {
  const dataDir = tmp("mt-data-");
  const outputDir = tmp("mt-out-");
  fs.writeFileSync(path.join(dataDir, "users.json"), "{\"users\":[]}");
  fs.writeFileSync(path.join(outputDir, "video.mp4"), "V");
  const alerts = [];
  let t = start;
  const store = tmp("mt-store-");
  const m = createMaintenance({
    dataDir, outputDir, env, log: quiet,
    alert: (kind, subject, detail) => alerts.push({ kind, subject, detail }),
    backupTarget: target === undefined ? folderTarget(store) : target,
    now: () => t,
  });
  return { m, alerts, dataDir, outputDir, store, advance: (ms) => { t += ms; } };
}

test("backups run in production, or when switched on, and never by accident on a laptop", () => {
  assert.equal(backupsEnabled({ NODE_ENV: "production" }), true);
  assert.equal(backupsEnabled({ NODE_ENV: "production", BACKUP_ENABLED: "false" }), false);
  assert.equal(backupsEnabled({ NODE_ENV: "development" }), false);
  assert.equal(backupsEnabled({ BACKUP_ENABLED: "true" }), true);
});

test("the nightly backup runs once, at the backup hour, and records how it went", async () => {
  const { m, store, advance, dataDir } = rig();
  assert.equal(await m.backupIfDue(), null, "01:00 is before the 03:00 backup hour");
  advance(2 * HOUR);
  const state = await m.backupIfDue();
  assert.ok(state.lastOkAt);
  assert.equal(state.data.key, `${DATA_PREFIX}2026-10-24.tar.gz`);
  assert.equal(state.outputs.copied, 1);
  assert.ok(fs.existsSync(path.join(store, "backups/data/2026-10-24.tar.gz")));
  advance(HOUR);
  assert.equal(await m.backupIfDue(), null, "once a day");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "backup-state.json"), "utf8")).lastAttemptDay, "2026-10-24", "survives a restart");
  advance(24 * HOUR);
  assert.ok((await m.backupIfDue())?.lastOkAt, "and again the next night");
});

test("a failed backup raises an alert, and so do 36 hours without a good one", async () => {
  const broken = { put: async () => { throw new Error("bucket says 403"); }, list: async () => [], remove: async () => {}, get: async () => {} };
  const { m, alerts, advance } = rig({ target: broken, start: Date.parse("2026-10-24T03:30:00Z") });
  await m.backupIfDue();
  assert.equal(alerts[0].kind, "backup-failed");
  assert.match(alerts[0].detail, /403/);
  advance(37 * HOUR);
  await m.backupIfDue();
  assert.ok(alerts.some((a) => a.kind === "backup-stale"));
});

test("with no backup target nothing runs and nothing complains", async () => {
  const { m, alerts, advance } = rig({ target: null });
  advance(50 * HOUR);
  assert.equal(await m.backupIfDue(), null);
  assert.deepEqual(alerts, []);
  assert.equal(m.status().backupsOn, false);
});

test("low disk cleans up first, then alerts if it is still low", async () => {
  const { m, alerts } = rig({ env: { DISK_ALARM_MIN_FREE_PERCENT: "100" } });
  const disk = await m.checkDisk();
  assert.equal(disk.low, true);
  assert.ok(m.status().lastCleanup, "cleanup ran before the alert");
  assert.equal(alerts[0].kind, "disk-low");
  assert.match(alerts[0].subject, /GB free of/);

  const ok = rig({ env: { DISK_ALARM_MIN_FREE_PERCENT: "0", DISK_ALARM_MIN_FREE_GB: "0" } });
  assert.equal((await ok.m.checkDisk()).low, false);
  assert.deepEqual(ok.alerts, []);
});

test("start() sets unref'd timers that stop() clears", () => {
  const { m } = rig();
  const made = [];
  const fakeTimer = () => { const t = { unref() { t.unrefd = true; } }; made.push(t); return t; };
  m.start({ every: fakeTimer, after: fakeTimer });
  assert.equal(made.length, 5);
  assert.ok(made.every((t) => t.unrefd));
  m.stop();
});
