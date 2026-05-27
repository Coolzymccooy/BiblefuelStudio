import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isSuperAdmin } from "./userPlan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "../..");

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(SERVER_ROOT, "data"));
export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(SERVER_ROOT, "outputs"));

/**
 * @param {{sub:string, email?:string}} user
 * @returns {string} absolute path. Super-admin => DATA_DIR (legacy). Others => DATA_DIR/users/<sub>/
 */
export function dataDirFor(user) {
  if (isSuperAdmin(user)) return DATA_DIR;
  const sub = String(user?.sub || "").trim();
  if (!sub) throw new Error("dataDirFor: user.sub required");
  return path.join(DATA_DIR, "users", sub);
}

/**
 * @param {{sub:string, email?:string}} user
 * @returns {string} absolute path. Super-admin => OUTPUT_DIR (legacy). Others => DATA_DIR/users/<sub>/outputs/
 */
export function outputDirFor(user) {
  if (isSuperAdmin(user)) return OUTPUT_DIR;
  return path.join(dataDirFor(user), "outputs");
}

/**
 * Idempotently create the per-user dirs.
 * @param {{sub:string, email?:string}} user
 */
export function ensureUserDirs(user) {
  const d = dataDirFor(user);
  const o = outputDirFor(user);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(o)) fs.mkdirSync(o, { recursive: true });
  return { dataDir: d, outputDir: o };
}

