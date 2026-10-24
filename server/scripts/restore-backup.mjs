#!/usr/bin/env node
// Restore a nightly backup into EMPTY folders, then move them into place by hand.
//
//   node scripts/restore-backup.mjs --list
//   node scripts/restore-backup.mjs --data /restore/data [--date 2026-10-24]
//   node scripts/restore-backup.mjs --outputs /restore/outputs
//
// Reads the app's bucket (Firebase credentials from server/.env) unless
// --from dir:<folder> names a local copy. It never writes into DATA_DIR or
// OUTPUT_DIR itself: restoring over live data is a decision for a person.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { restoreDataBackup, restoreOutputs, folderTarget, bucketTarget, DATA_PREFIX } from "../src/lib/ops/backup.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function target() {
  const from = opt("--from");
  const dir = from?.match(/^dir:(.+)$/)?.[1];
  if (dir) return folderTarget(dir);
  const { getStorageBucket } = await import("../src/lib/firebaseAdmin.js");
  return bucketTarget(getStorageBucket());
}

async function main() {
  const t = await target();
  if (args.includes("--list")) {
    for (const k of await t.list(DATA_PREFIX)) console.log(k);
    return;
  }
  const dataTo = opt("--data");
  const outputsTo = opt("--outputs");
  if (!dataTo && !outputsTo) {
    console.error("Say where to restore: --data <empty folder> and/or --outputs <empty folder> (or --list).");
    process.exit(2);
  }
  if (dataTo) {
    const r = await restoreDataBackup({ target: t, toDir: path.resolve(dataTo), date: opt("--date") || null });
    console.log(`Data: ${r.key} -> ${path.resolve(dataTo)} (${r.files} files)`);
  }
  if (outputsTo) {
    const r = await restoreOutputs({ target: t, toDir: path.resolve(outputsTo) });
    console.log(`Outputs: ${r.files} files -> ${path.resolve(outputsTo)} (owner/ is OUTPUT_DIR; users/<id>/ is DATA_DIR/users/<id>/outputs)`);
  }
}

main().catch((e) => {
  console.error(`Restore failed: ${e?.message || e}`);
  process.exit(1);
});
