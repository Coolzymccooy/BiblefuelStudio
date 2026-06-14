import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, OUTPUT_DIR, dataDirFor, outputDirFor } from "../paths.js";

/**
 * Execution ctx for a schedule's owner. Ownership is by LOCATION: the root
 * store belongs to the super-admin (global dirs); every users/<id>/ store
 * belongs to that tenant (per-user dirs, never super-admin).
 *
 * @param {{ ownerId: string|null, isSuperAdmin: boolean }} owner
 * @returns {{ userId: string|null, dataDir: string, outputDir: string, isSuperAdmin: boolean }}
 */
export function scheduleOwnerCtx(owner) {
  if (owner?.isSuperAdmin) {
    return { userId: owner.ownerId ?? null, dataDir: DATA_DIR, outputDir: OUTPUT_DIR, isSuperAdmin: true };
  }
  const user = { sub: String(owner?.ownerId || "") };
  return {
    userId: user.sub,
    dataDir: dataDirFor(user),
    outputDir: outputDirFor(user),
    isSuperAdmin: false,
  };
}

/**
 * Enumerate every schedule-source directory: the root store (super-admin)
 * plus each users/<id>/ that has a social.json. Returns owner descriptors —
 * NOT ctx — so the caller decides when to derive dirs via scheduleOwnerCtx.
 *
 * @param {string} [baseDir] defaults to DATA_DIR; injectable for tests.
 * @returns {Array<{ ownerId: string|null, isSuperAdmin: boolean }>}
 */
export function listScheduleSources(baseDir = DATA_DIR) {
  const sources = [];
  if (fs.existsSync(path.join(baseDir, "social.json"))) {
    sources.push({ ownerId: null, isSuperAdmin: true });
  }
  const usersDir = path.join(baseDir, "users");
  let entries = [];
  try {
    entries = fs.readdirSync(usersDir, { withFileTypes: true });
  } catch {
    return sources; // no users/ dir yet
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const storePath = path.join(usersDir, ent.name, "social.json");
    if (fs.existsSync(storePath)) {
      sources.push({ ownerId: ent.name, isSuperAdmin: false });
    }
  }
  return sources;
}
