/**
 * Transcription history store — multi-tenant, one entry per source file.
 *
 * Mirrors series/seriesStore.js: per-user dataDir, atomic temp-file + rename
 * writes, corruption-tolerant reads (return []), 50-record cap. Records carry
 * userId so the legacy single-dir (admin) mode stays correctly partitioned.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const MAX_RECENT = 50;

function filePath(dataDir) {
  if (!dataDir) throw new Error("transcripts: dataDir required");
  return path.join(dataDir, "transcripts.json");
}
function tmpPath(dataDir) { return path.join(dataDir, "transcripts.json.tmp"); }
function ensureDir(dataDir) { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); }

export function readTranscripts(dataDir) {
  ensureDir(dataDir);
  const f = filePath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(parsed?.transcripts) ? parsed.transcripts : [];
  } catch {
    return [];
  }
}

function writeAll(dataDir, list) {
  ensureDir(dataDir);
  fs.writeFileSync(tmpPath(dataDir), JSON.stringify({ transcripts: list }, null, 2), "utf-8");
  fs.renameSync(tmpPath(dataDir), filePath(dataDir));
}

export function listTranscripts(dataDir, userId, limit = MAX_RECENT) {
  const uid = String(userId || "").trim();
  const cap = Math.max(1, Math.min(MAX_RECENT, Number(limit) || MAX_RECENT));
  return readTranscripts(dataDir)
    .filter((t) => String(t?.userId || "") === uid)
    .slice(0, cap);
}

/**
 * Upsert by (userId, basename(sourceFile)). Updates in place + moves to front
 * on a repeat; preserves createdAt. `now` is injectable for deterministic tests.
 * Caps at MAX_RECENT per userId.
 */
export function upsertTranscript(dataDir, userId, input) {
  const uid = String(userId || "").trim();
  const sourceFile = path.basename(String(input?.sourceFile || "").trim());
  if (!sourceFile) throw new Error("sourceFile required");
  const words = Array.isArray(input?.words) ? input.words : [];
  const editedLines = Array.isArray(input?.editedLines) ? input.editedLines.map(String) : [];
  const now = input?.now || new Date().toISOString();

  const list = readTranscripts(dataDir);
  const idx = list.findIndex(
    (t) => String(t?.userId || "") === uid && path.basename(String(t?.sourceFile || "")) === sourceFile,
  );
  const prev = idx >= 0 ? list[idx] : null;
  const record = {
    id: prev?.id || randomUUID(),
    userId: uid,
    sourceFile,
    label: editedLines.find((l) => l && l.trim())?.trim().slice(0, 60) || sourceFile,
    words,
    editedLines,
    typographyPreset: input?.typographyPreset ?? prev?.typographyPreset ?? null,
    durationSec: input?.durationSec ?? prev?.durationSec ?? null,
    lineCount: editedLines.length,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  const rest = idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list;
  const updated = [record, ...rest];

  // Cap per-user: keep only MAX_RECENT per userId across all records
  const byUser = {};
  for (const t of updated) {
    const u = String(t?.userId || "");
    if (!byUser[u]) byUser[u] = [];
    byUser[u].push(t);
  }
  for (const u in byUser) {
    byUser[u] = byUser[u].slice(0, MAX_RECENT);
  }
  const next = Object.values(byUser).flat();

  writeAll(dataDir, next);
  return record;
}

export function deleteTranscript(dataDir, userId, id) {
  const uid = String(userId || "").trim();
  const list = readTranscripts(dataDir);
  const next = list.filter((t) => !(String(t?.id) === String(id) && String(t?.userId || "") === uid));
  const removed = next.length !== list.length;
  if (removed) writeAll(dataDir, next);
  return removed;
}
