#!/usr/bin/env node
/**
 * Vocal removal for the live site, done on this laptop.
 *
 *   npm run stems-worker            (from server/)
 *
 * Needs STEMS_WORKER_TOKEN (the same value as on the server, in Coolify) and,
 * optionally, BIBLEFUEL_URL — both read from the environment or server/.env.
 * scripts/install-stems-worker.ps1 starts it automatically at log-on.
 */
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", ".env") });

const { makeWorkerApi, runWorker } = await import("../src/lib/stems/worker.js");
const { removeVocals, separatorAvailable } = await import("../src/lib/stems/separator.js");

const baseUrl = process.env.BIBLEFUEL_URL?.trim() || "https://biblefuel.tiwaton.co.uk";
const token = process.env.STEMS_WORKER_TOKEN?.trim() || "";
const stamp = () => new Date().toLocaleTimeString();
const log = (m) => console.log(`[${stamp()}] ${m}`);

if (token.length < 32) {
  console.error("STEMS_WORKER_TOKEN is missing or too short (32+ characters). Put it in server/.env.");
  process.exit(1);
}
const sep = await separatorAvailable();
if (!sep?.ok) {
  console.error("The vocal separator is not set up on this machine — see docs/vocal-removal.md.");
  process.exit(1);
}

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { log("stopping"); controller.abort(); });

log(`removing vocals for ${baseUrl} — leave this running`);
await runWorker({
  api: makeWorkerApi({ baseUrl, token }),
  remove: removeVocals,
  tmpRoot: os.tmpdir(),
  signal: controller.signal,
  log,
});
