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
