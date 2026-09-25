/**
 * Gumroad generation history — multi-tenant, one entry per (freeTitle+paidTitle).
 * Mirrors transcriptStore.js: per-user dataDir JSON, atomic temp-file + rename
 * writes, corruption-tolerant reads (return []), 50-record cap per user.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const MAX_RECENT = 50;

function filePath(dataDir) {
  if (!dataDir) throw new Error("gumroad: dataDir required");
  return path.join(dataDir, "gumroad-history.json");
}
function tmpPath(dataDir) { return path.join(dataDir, "gumroad-history.json.tmp"); }
function ensureDir(dataDir) { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); }

export function readGumroadPacks(dataDir) {
  ensureDir(dataDir);
  const f = filePath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(parsed?.packs) ? parsed.packs : [];
  } catch {
    return [];
  }
}

function writeAll(dataDir, list) {
  ensureDir(dataDir);
  fs.writeFileSync(tmpPath(dataDir), JSON.stringify({ packs: list }, null, 2), "utf-8");
  fs.renameSync(tmpPath(dataDir), filePath(dataDir));
}

export function listGumroadPacks(dataDir, userId, limit = MAX_RECENT) {
  const uid = String(userId || "").trim();
  const cap = Math.max(1, Math.min(MAX_RECENT, Number(limit) || MAX_RECENT));
  return readGumroadPacks(dataDir)
    .filter((p) => String(p?.userId || "") === uid)
    .slice(0, cap);
}

function keyOf(freeTitle, paidTitle) {
  return `${String(freeTitle || "").trim()} ${String(paidTitle || "").trim()}`;
}

/**
 * Upsert by (userId, freeTitle+paidTitle). Updates in place + moves to front on
 * a repeat; preserves createdAt. `now` is injectable for deterministic tests.
 */
export function upsertGumroadPack(dataDir, userId, input) {
  const uid = String(userId || "").trim();
  const freeTitle = String(input?.freeTitle || "").trim();
  const paidTitle = String(input?.paidTitle || "").trim();
  if (!freeTitle) throw new Error("freeTitle required");
  if (!paidTitle) throw new Error("paidTitle required");
  const freeMarkdown = String(input?.freeMarkdown || "");
  const paidMarkdown = String(input?.paidMarkdown || "");
  const now = input?.now || new Date().toISOString();

  const list = readGumroadPacks(dataDir);
  const idx = list.findIndex(
    (p) => String(p?.userId || "") === uid && keyOf(p?.freeTitle, p?.paidTitle) === keyOf(freeTitle, paidTitle),
  );
  const prev = idx >= 0 ? list[idx] : null;
  const record = {
    id: prev?.id || randomUUID(),
    userId: uid,
    freeTitle,
    paidTitle,
    freeMarkdown,
    paidMarkdown,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  const rest = idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list;
  const updated = [record, ...rest];

  const byUser = {};
  for (const p of updated) {
    const u = String(p?.userId || "");
    if (!byUser[u]) byUser[u] = [];
    byUser[u].push(p);
  }
  for (const u in byUser) byUser[u] = byUser[u].slice(0, MAX_RECENT);
  const next = Object.values(byUser).flat();

  writeAll(dataDir, next);
  return record;
}

export function deleteGumroadPack(dataDir, userId, id) {
  const uid = String(userId || "").trim();
  const list = readGumroadPacks(dataDir);
  const next = list.filter((p) => !(String(p?.id) === String(id) && String(p?.userId || "") === uid));
  const removed = next.length !== list.length;
  if (removed) writeAll(dataDir, next);
  return removed;
}
