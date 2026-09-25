import fs from "fs";
import path from "path";
import crypto from "crypto";

const INDEX_FILE = "musicLibrary.json";
const REF_PREFIX = "mylib:";

/** Where this tenant's uploaded-track index lives. */
export function musicIndexPath(dataDir) {
  return path.join(dataDir, INDEX_FILE);
}

/**
 * The tenant's uploaded tracks.
 *
 * A missing or corrupt index reads as empty: a music picker that renders
 * nothing is recoverable, a request that throws mid-listing is not.
 */
export function readMusicLibrary(dataDir) {
  try {
    const raw = fs.readFileSync(musicIndexPath(dataDir), "utf8");
    const parsed = JSON.parse(raw);
    return { items: Array.isArray(parsed?.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

/**
 * Write the index atomically: write to a temp file in the same directory,
 * then rename over the target. A plain `writeFileSync` leaves a window where
 * a crash mid-write truncates/corrupts the file — and `readMusicLibrary`
 * treats any corrupt file as an empty library, silently vanishing the
 * operator's whole index. `rename` on the same filesystem is atomic, so the
 * target is always either the old complete file or the new complete one.
 */
function writeMusicLibrary(dataDir, lib) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = musicIndexPath(dataDir);
  const tmp = `${target}.tmp`;
  const payload = JSON.stringify(lib, null, 2);
  let fd;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, payload, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, target);
  } finally {
    if (typeof fd === "number") {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* rename already consumed it */ }
  }
}

/**
 * Remember an already-uploaded file as a reusable track.
 *
 * Identity is the absolute path, so saving the same file twice returns the
 * first entry rather than filling the picker with duplicates.
 *
 * `licence` defaults to "unknown" on purpose. On a long music-led video a
 * Content ID claim takes the revenue for the whole video, so the dangerous
 * assumption is "cleared" — the operator has to say so.
 */
export function registerTrack(dataDir, { file, label, mood, licence, durationSec }) {
  const abs = String(file || "").trim();
  if (!abs) throw new Error("file is required");
  const lib = readMusicLibrary(dataDir);
  const existing = lib.items.find((t) => t.file === abs);
  if (existing) return existing;

  const track = {
    id: crypto.randomUUID(),
    label: String(label || path.basename(abs)).trim(),
    mood: String(mood || "calm").trim(),
    file: abs,
    durationSec: Number.isFinite(Number(durationSec)) ? Number(durationSec) : null,
    source: "upload",
    licence: String(licence || "unknown").trim() || "unknown",
    addedAt: Date.now(),
  };
  lib.items.push(track);
  writeMusicLibrary(dataDir, lib);
  return track;
}

/** Patch a track's metadata. Returns the updated track, or null if unknown. */
export function updateTrack(dataDir, id, patch = {}) {
  const lib = readMusicLibrary(dataDir);
  const idx = lib.items.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const patched = { ...lib.items[idx] };
  for (const key of ["label", "mood", "licence"]) {
    if (patch[key] !== undefined) patched[key] = String(patch[key]).trim();
  }
  const items = lib.items.slice();
  items[idx] = patched;
  writeMusicLibrary(dataDir, { items });
  return patched;
}

/**
 * Forget a track. The audio file itself is left alone — it is the operator's
 * upload and may be referenced by a project we cannot see from here.
 */
export function removeTrack(dataDir, id) {
  const lib = readMusicLibrary(dataDir);
  const next = lib.items.filter((t) => t.id !== id);
  if (next.length === lib.items.length) return false;
  writeMusicLibrary(dataDir, { items: next });
  return true;
}

/**
 * Resolve a `mylib:<id>` ref to a file on disk.
 *
 * Bundled tracks keep their own `library:` prefix and resolve without tenant
 * context; these cannot, which is exactly why they are spelled differently.
 */
export function resolveTenantTrack(dataDir, ref) {
  const s = String(ref || "").trim();
  if (!s.startsWith(REF_PREFIX)) return null;
  const id = s.slice(REF_PREFIX.length);
  const track = readMusicLibrary(dataDir).items.find((t) => t.id === id);
  if (!track) return null;
  return fs.existsSync(track.file) ? track.file : null;
}
