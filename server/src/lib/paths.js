import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isSuperAdmin, isOwner } from "./userPlan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "../..");

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(SERVER_ROOT, "data"));
export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(SERVER_ROOT, "outputs"));

/**
 * @param {{sub:string, email?:string}} user
 * @returns {string} absolute path. The owner => DATA_DIR (legacy). Everyone else, other super-admins included => DATA_DIR/users/<sub>/
 */
export function dataDirFor(user) {
  if (isOwner(user)) return DATA_DIR;
  const sub = String(user?.sub || "").trim();
  if (!sub) throw new Error("dataDirFor: user.sub required");
  return path.join(DATA_DIR, "users", sub);
}

/**
 * @param {{sub:string, email?:string}} user
 * @returns {string} absolute path. The owner => OUTPUT_DIR (legacy). Everyone else => DATA_DIR/users/<sub>/outputs/
 */
export function outputDirFor(user) {
  if (isOwner(user)) return OUTPUT_DIR;
  return path.join(dataDirFor(user), "outputs");
}

/**
 * Is this deployment running single-tenant?
 *
 * Multi-tenancy is ON by default — a fresh deploy must isolate user data, or
 * every new sign-up sees every other account's jobs and library. The escape
 * hatch is for the original operator-only shape and must be opted into.
 */
export function isSingleTenant() {
  const flag = String(process.env.MULTITENANT || "").toLowerCase().trim();
  return flag === "false" || flag === "0" || flag === "off";
}

/**
 * THE one place that decides which directories a user reads and writes.
 *
 * Every caller must come through here. `withUserScope` is the usual route,
 * but requests that arrive without a JWT — the YouTube OAuth callback, which
 * Google redirects to with only `?code=&state=` — have to resolve the same
 * answer independently. When those two disagree the failure is silent and
 * almost undiagnosable: the write succeeds, to a path the read never visits.
 * That shipped once already (the callback's state token omitted the email, so
 * the admin resolved DATA_DIR when authenticated and DATA_DIR/users/<sub> in
 * the callback, and YouTube read "Not connected" forever).
 *
 * @param {{sub:string, email?:string}} user
 * @returns {{ dataDir: string, outputDir: string, isSuperAdmin: boolean, isOwner: boolean }}
 */
export function resolveScopeDirs(user) {
  // Single-tenant treats everyone as the operator, on the legacy paths.
  if (isSingleTenant()) {
    return { dataDir: DATA_DIR, outputDir: OUTPUT_DIR, isSuperAdmin: true, isOwner: true };
  }
  // The owner keeps the legacy paths so the operator's existing library and
  // jobs are not orphaned. Everyone else is isolated per user, OTHER
  // SUPER-ADMINS INCLUDED: they keep their admin rights, but sharing the
  // owner's folder let them see, clear and publish the operator's work.
  if (isOwner(user)) {
    return { dataDir: DATA_DIR, outputDir: OUTPUT_DIR, isSuperAdmin: true, isOwner: true };
  }
  const { dataDir, outputDir } = ensureUserDirs(user);
  return { dataDir, outputDir, isSuperAdmin: isSuperAdmin(user), isOwner: false };
}

/**
 * Does this request or job ctx act as the owner? An explicit ctx.isOwner
 * wins. A ctx saved before isOwner existed (persisted jobs) is the owner's
 * only when it is a super-admin's AND ran in the main workspace, which until
 * this change only the owner's could.
 *
 * @param {{ isOwner?: boolean, isSuperAdmin?: boolean, dataDir?: string }|null|undefined} ctx
 * @returns {boolean}
 */
export function isOwnerCtx(ctx) {
  if (!ctx) return false;
  if (typeof ctx.isOwner === "boolean") return ctx.isOwner;
  return Boolean(ctx.isSuperAdmin) && Boolean(ctx.dataDir) && path.resolve(String(ctx.dataDir)) === DATA_DIR;
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

