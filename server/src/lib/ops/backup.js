import fs from "fs";
import os from "os";
import path from "path";
import * as tar from "tar";
import { writeJsonAtomic } from "../atomicFile.js";
import { DISPOSABLE_FILES, DISPOSABLE_DIRS } from "./disposableCleanup.js";

/**
 * Nightly backups to a storage bucket (the app's Firebase/GCS bucket on the
 * server; a folder in tests and for a local restore drill).
 *
 * - Data: every record in DATA_DIR (users, plans, projects, ledgers, the
 *   library index) as one dated tar.gz, backups/data/<YYYY-MM-DD>.tar.gz.
 *   The last BACKUP_KEEP_DAYS (default 14) are kept. Media and caches are
 *   left out; they are covered by the outputs backup or re-made on demand.
 * - Outputs: every finished file in the owner's and each user's outputs
 *   folder, copied once to backups/outputs/<owner|users/id>/<path>. A file
 *   already copied with the same size and time is skipped, and one night
 *   copies at most BACKUP_OUTPUTS_MAX_GB (default 5), so the first copy of a
 *   large disk spreads over several nights instead of starving renders.
 *
 * A target is { put(localFile, key), list(prefix), remove(key), get(key, localFile) }.
 */

export const DATA_PREFIX = "backups/data/";
export const OUTPUTS_PREFIX = "backups/outputs/";
const MEDIA_EXT = new Set([".mp4", ".mov", ".webm", ".m4v", ".mkv", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".ttf", ".otf"]);
// Folders in DATA_DIR that hold files, not records.
const DATA_SKIP_DIRS = new Set(["outputs", "tmp", "temp", "cache", "bibleCache", "stems-work", "node_modules"]);
const DATA_MAX_FILE_BYTES = 25 * 1024 * 1024;
// Folders in an outputs folder that are scratch space or caches.
const OUTPUTS_SKIP_DIRS = new Set(["tmp", "temp", "cache", "stems-work"]);

const GB = 1024 ** 3;
const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

function walk(root, rel, skipDir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!skipDir(r, e.name)) walk(root, r, skipDir, visit);
    } else if (e.isFile()) {
      visit(r);
    }
  }
}

/** The DATA_DIR files a data backup holds, as paths relative to dataDir (forward slashes). */
export function dataBackupFiles(dataDir) {
  const files = [];
  walk(dataDir, "", (_r, name) => DATA_SKIP_DIRS.has(name), (rel) => {
    if (MEDIA_EXT.has(path.extname(rel).toLowerCase()) || rel.endsWith(".tmp")) return;
    try {
      if (fs.statSync(path.join(dataDir, rel)).size > DATA_MAX_FILE_BYTES) return;
    } catch {
      return;
    }
    files.push(rel.split(path.sep).join("/"));
  });
  return files.sort();
}

const dayKey = (now) => new Date(now).toISOString().slice(0, 10);

export async function runDataBackup({ dataDir, target, now = Date.now(), env = process.env, tmpDir = os.tmpdir() }) {
  const files = dataBackupFiles(dataDir);
  const key = `${DATA_PREFIX}${dayKey(now)}.tar.gz`;
  const archive = path.join(tmpDir, `bf-data-backup-${process.pid}-${now}.tar.gz`);
  try {
    // A file that vanishes between listing and packing is skipped, not fatal.
    await tar.create({ gzip: true, file: archive, cwd: dataDir, portable: true, noDirRecurse: true, onWarn: () => {} }, files);
    const bytes = fs.statSync(archive).size;
    await target.put(archive, key);
    const keep = Math.floor(num(env.BACKUP_KEEP_DAYS, 14));
    const old = (await target.list(DATA_PREFIX)).filter((k) => k.endsWith(".tar.gz")).sort().slice(0, -keep);
    for (const k of old) await target.remove(k);
    return { key, bytes, files: files.length, pruned: old.length };
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

/** Each outputs folder with the label its files are stored under. */
export function outputRoots(dataDir, outputDir) {
  const roots = [{ dir: outputDir, label: "owner" }];
  try {
    for (const e of fs.readdirSync(path.join(dataDir, "users"), { withFileTypes: true })) {
      if (e.isDirectory()) roots.push({ dir: path.join(dataDir, "users", e.name, "outputs"), label: `users/${e.name}` });
    }
  } catch {
    // no users yet
  }
  return roots;
}

function readManifest(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

export async function runOutputsBackup({ roots, target, manifestFile, env = process.env }) {
  const maxBytes = num(env.BACKUP_OUTPUTS_MAX_GB, 5) * GB;
  const manifest = readManifest(manifestFile);
  let copied = 0;
  let bytes = 0;
  let pending = 0;
  const skipDir = (rel, name) => OUTPUTS_SKIP_DIRS.has(name) || DISPOSABLE_DIRS.some((d) => rel === d || rel.startsWith(d + path.sep));
  try {
    for (const { dir, label } of roots) {
      const todo = [];
      walk(dir, "", skipDir, (rel) => {
        const name = path.basename(rel);
        if (name.endsWith(".tmp") || name.endsWith(".part")) return;
        if (!rel.includes(path.sep) && DISPOSABLE_FILES.some((re) => re.test(name))) return;
        todo.push(rel);
      });
      for (const rel of todo) {
        const local = path.join(dir, rel);
        let st;
        try {
          st = fs.statSync(local);
        } catch {
          continue;
        }
        const key = `${OUTPUTS_PREFIX}${label}/${rel.split(path.sep).join("/")}`;
        const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
        if (manifest[key] === stamp) continue;
        if (bytes + st.size > maxBytes && copied > 0) {
          pending += 1;
          continue;
        }
        await target.put(local, key);
        manifest[key] = stamp;
        copied += 1;
        bytes += st.size;
      }
    }
  } finally {
    // Whatever was copied is remembered, even when a later copy failed.
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    writeJsonAtomic(manifestFile, manifest);
  }
  return { copied, bytes, pending };
}

/** Unpack the data backup of `date` (YYYY-MM-DD; the newest when omitted) into an empty folder. */
export async function restoreDataBackup({ target, toDir, date = null, tmpDir = os.tmpdir() }) {
  const keys = (await target.list(DATA_PREFIX)).filter((k) => k.endsWith(".tar.gz")).sort();
  const key = date ? `${DATA_PREFIX}${date}.tar.gz` : keys[keys.length - 1];
  if (!key || !keys.includes(key)) throw new Error(date ? `No data backup for ${date}.` : "No data backups found.");
  fs.mkdirSync(toDir, { recursive: true });
  if (fs.readdirSync(toDir).length) throw new Error(`${toDir} is not empty; restore into an empty folder and move it into place.`);
  const archive = path.join(tmpDir, `bf-restore-${process.pid}-${Date.now()}.tar.gz`);
  try {
    await target.get(key, archive);
    await tar.extract({ file: archive, cwd: toDir, strict: true });
  } finally {
    fs.rmSync(archive, { force: true });
  }
  return { key, files: dataBackupFiles(toDir).length };
}

/** Copy every backed-up output file under `toDir/<owner|users/id>/...`. */
export async function restoreOutputs({ target, toDir }) {
  let files = 0;
  const root = path.resolve(toDir);
  for (const key of await target.list(OUTPUTS_PREFIX)) {
    const dest = path.resolve(root, key.slice(OUTPUTS_PREFIX.length));
    if (!dest.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await target.get(key, dest);
    files += 1;
  }
  return { files };
}

/** A backup target in a local folder: tests, and a restore drill on a laptop. */
export function folderTarget(root) {
  const abs = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error(`Bad backup key: ${key}`);
    return p;
  };
  return {
    async put(local, key) {
      fs.mkdirSync(path.dirname(abs(key)), { recursive: true });
      fs.copyFileSync(local, abs(key));
    },
    async list(prefix) {
      const out = [];
      walk(root, "", () => false, (rel) => {
        const key = rel.split(path.sep).join("/");
        if (key.startsWith(prefix)) out.push(key);
      });
      return out.sort();
    },
    async remove(key) {
      fs.rmSync(abs(key), { force: true });
    },
    async get(key, local) {
      fs.copyFileSync(abs(key), local);
    },
  };
}

/** The app's Firebase/GCS bucket as a backup target. */
export function bucketTarget(bucket) {
  return {
    async put(local, key) {
      await bucket.upload(local, { destination: key, resumable: fs.statSync(local).size > 8 * 1024 * 1024 });
    },
    async list(prefix) {
      const [files] = await bucket.getFiles({ prefix });
      return files.map((f) => f.name).sort();
    },
    async remove(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
    async get(key, local) {
      await bucket.file(key).download({ destination: local });
    },
  };
}
