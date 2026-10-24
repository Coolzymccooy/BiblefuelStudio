import fs from "fs";
import path from "path";
import { writeJsonAtomic } from "../atomicFile.js";
import { cleanupDisposableFiles, allOutputDirs } from "./disposableCleanup.js";
import { diskStatus } from "./disk.js";
import { runDataBackup, runOutputsBackup, outputRoots } from "./backup.js";

/**
 * The server's housekeeping, run on timers inside the web process:
 * - every 15 minutes, check free disk space; when it is low, clean up and alert;
 * - every 6 hours, delete old throwaway files (disposableCleanup.js);
 * - once a night at BACKUP_HOUR_UTC (default 3), back up the data and the
 *   outputs (backup.js). A failed night is tried again hourly, three tries a
 *   day; a failure, or 36 hours with no good backup, raises an alert.
 * Each job runs one at a time, and none of them can throw into the server.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const STATE_FILE = "backup-state.json";

export function backupsEnabled(env = process.env) {
  const flag = String(env.BACKUP_ENABLED || "").trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(flag)) return false;
  // A laptop with the real bucket's credentials must not back its test data up over production's.
  return env.NODE_ENV === "production" || ["true", "1", "yes", "on"].includes(flag);
}

export function createMaintenance({ dataDir, outputDir, alert, backupTarget = null, env = process.env, now = () => Date.now(), log = console, statfs = undefined }) {
  const stateFile = path.join(dataDir, STATE_FILE);
  const readState = () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8")) || {};
    } catch {
      return {};
    }
  };
  const status = { disk: null, lastCleanup: null, backup: readState() };
  const startedAt = now();
  const busy = new Set();
  const once = async (name, fn) => {
    if (busy.has(name)) return undefined;
    busy.add(name);
    try {
      return await fn();
    } catch (e) {
      log.warn?.(`[maintenance] ${name} failed: ${e?.message || e}`);
      return undefined;
    } finally {
      busy.delete(name);
    }
  };

  const cleanup = () => once("cleanup", async () => {
    const r = cleanupDisposableFiles(allOutputDirs(dataDir, outputDir), { now: now(), env });
    status.lastCleanup = { at: new Date(now()).toISOString(), ...r };
    if (r.removed) log.log?.(`[maintenance] removed ${r.removed} old throwaway file(s), ${(r.bytes / 1024 ** 2).toFixed(1)} MB`);
    return r;
  });

  const checkDisk = () => once("disk", async () => {
    const dirs = [...new Set([outputDir, dataDir])];
    const readings = dirs.map((d) => ({ dir: d, s: diskStatus(d, { env, statfs }) })).filter((x) => x.s);
    if (!readings.length) return null;
    // Every volume is checked. The one reported is a low one if any is low
    // (a small disk can be low in GB while holding the larger share free),
    // else the one with the smallest share free.
    const worstOf = (list) => list.reduce((a, b) => {
      if (a.s.low !== b.s.low) return b.s.low ? b : a;
      return b.s.freePercent < a.s.freePercent ? b : a;
    });
    status.disk = worstOf(readings).s;
    if (!readings.some((r) => r.s.low)) return status.disk;
    await cleanup();
    const after = readings.map((r) => ({ dir: r.dir, s: diskStatus(r.dir, { env, statfs }) || r.s }));
    status.disk = worstOf(after).s;
    for (const { dir, s: d } of after.filter((r) => r.s.low)) {
      alert("disk-low", `Disk nearly full: ${d.freeGb} GB free of ${d.totalGb} GB`,
        `${dir} has ${d.freePercent}% free after cleaning up throwaway files.\nRenders fail when the disk fills. Free space or grow the volume.`);
    }
    return status.disk;
  });

  const backupHour = () => {
    const h = Number(env.BACKUP_HOUR_UTC);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 3;
  };

  const backupNow = () => once("backup", async () => {
    if (!backupTarget) return null;
    const started = now();
    const day = new Date(started).toISOString().slice(0, 10);
    const failedToday = status.backup.failedDay === day ? Number(status.backup.failedCount) || 0 : 0;
    const state = { ...status.backup, lastAttemptAt: new Date(started).toISOString() };
    try {
      const data = await runDataBackup({ dataDir, target: backupTarget, now: started, env });
      const outputs = await runOutputsBackup({ roots: outputRoots(dataDir, outputDir), target: backupTarget, manifestFile: path.join(dataDir, "backup-manifest.json"), env });
      Object.assign(state, { lastOkAt: new Date(now()).toISOString(), lastOkDay: day, lastError: null, failedDay: null, failedCount: 0, data, outputs });
      log.log?.(`[maintenance] backup done: ${data.files} record file(s) (${(data.bytes / 1024).toFixed(0)} KB), ${outputs.copied} output file(s) copied, ${outputs.pending} waiting`);
      if (outputs.failed) alert("backup-failed", `${outputs.failed} output file(s) could not be backed up`, "They are tried again next night.");
    } catch (e) {
      Object.assign(state, { lastError: String(e?.message || e), failedDay: day, failedCount: failedToday + 1 });
      alert("backup-failed", "The nightly backup failed", `${state.lastError}\n(Attempt ${failedToday + 1} of 3 today.)`);
    }
    status.backup = state;
    try {
      writeJsonAtomic(stateFile, state);
    } catch {
      // the state is a convenience; the backup itself is in the bucket
    }
    return state;
  });

  /** Run the nightly backup when it is due, and complain when backups have stopped working. */
  const backupIfDue = async () => {
    if (!backupTarget) return null;
    const t = now();
    const d = new Date(t);
    const today = d.toISOString().slice(0, 10);
    let ran = null;
    // Due once the backup hour has passed and today has no good backup. A failed
    // night is tried again an hour later, up to three tries a day.
    const b = status.backup;
    const failedToday = b.failedDay === today ? Number(b.failedCount) || 0 : 0;
    const sinceAttempt = t - (Date.parse(b.lastAttemptAt || "") || 0);
    if (d.getUTCHours() >= backupHour() && b.lastOkDay !== today && failedToday < 3 && (failedToday === 0 || sinceAttempt >= HOUR)) {
      ran = await backupNow();
    }
    const lastOk = Date.parse(status.backup.lastOkAt || "");
    const sinceStart = t - startedAt;
    if ((Number.isFinite(lastOk) ? t - lastOk : sinceStart) > 36 * HOUR) {
      alert("backup-stale", "No backup has worked for 36 hours", `Last good backup: ${status.backup.lastOkAt || "never"}. Last error: ${status.backup.lastError || "none"}.`);
    }
    return ran;
  };

  const timers = [];
  return {
    status: () => ({ ...status, backupsOn: Boolean(backupTarget) }),
    cleanup,
    checkDisk,
    backupNow,
    backupIfDue,
    start({ every = setInterval, after = setTimeout } = {}) {
      const keep = (t) => { t?.unref?.(); timers.push(t); };
      keep(after(() => void checkDisk(), MIN));
      keep(every(() => void checkDisk(), 15 * MIN));
      keep(after(() => void cleanup(), 10 * MIN));
      keep(every(() => void cleanup(), 6 * HOUR));
      keep(every(() => void backupIfDue(), 10 * MIN));
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
  };
}
