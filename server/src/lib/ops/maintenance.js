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
 *   outputs (backup.js), and alert when a backup fails or none has worked for
 *   36 hours.
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

export function createMaintenance({ dataDir, outputDir, alert, backupTarget = null, env = process.env, now = () => Date.now(), log = console }) {
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
    const readings = dirs.map((d) => ({ dir: d, s: diskStatus(d, { env }) })).filter((x) => x.s);
    if (!readings.length) return null;
    const worst = readings.reduce((a, b) => (b.s.freeGb < a.s.freeGb ? b : a));
    status.disk = worst.s;
    if (worst.s.low) {
      busy.delete("disk");
      await cleanup();
      const after = diskStatus(worst.dir, { env }) || worst.s;
      status.disk = after;
      if (after.low) {
        alert("disk-low", `Disk nearly full: ${after.freeGb} GB free of ${after.totalGb} GB`,
          `${worst.dir} has ${after.freePercent}% free after cleaning up throwaway files.\nRenders fail when the disk fills. Free space or grow the volume.`);
      }
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
    const state = { ...status.backup, lastAttemptDay: day, lastAttemptAt: new Date(started).toISOString() };
    try {
      const data = await runDataBackup({ dataDir, target: backupTarget, now: started, env });
      const outputs = await runOutputsBackup({ roots: outputRoots(dataDir, outputDir), target: backupTarget, manifestFile: path.join(dataDir, "backup-manifest.json"), env });
      Object.assign(state, { lastOkAt: new Date(now()).toISOString(), lastError: null, data, outputs });
      log.log?.(`[maintenance] backup done: ${data.files} record file(s) (${(data.bytes / 1024).toFixed(0)} KB), ${outputs.copied} output file(s) copied, ${outputs.pending} waiting`);
    } catch (e) {
      state.lastError = String(e?.message || e);
      alert("backup-failed", "The nightly backup failed", state.lastError);
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
    if (d.getUTCHours() >= backupHour() && status.backup.lastAttemptDay !== today) ran = await backupNow();
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
