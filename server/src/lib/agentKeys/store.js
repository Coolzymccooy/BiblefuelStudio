import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../paths.js";
import { getUsersStore } from "../../auth.js";
import { sameSecret } from "../secrets.js";

/**
 * Agent API keys for the MCP endpoint.
 *
 * Layout: DATA_DIR/agent-keys.json  ->  { keys: KeyRecord[] }
 * Only a SHA-256 hash of each key is stored; the plain key is shown once at creation.
 *
 * @typedef {{ renders: number, aiVideoUsd: number, images: number, tts: number, publishes: number }} Caps
 * @typedef {{
 *   id: string, hash: string, prefix: string, userId: string, name: string,
 *   createdAt: string, lastUsedAt: string | null, revokedAt: string | null,
 *   publishAllowed: boolean, caps: Partial<Caps>
 * }} KeyRecord
 * @typedef {Omit<KeyRecord, "hash">} PublicKey
 */

const KEY_PREFIX = "bfk_";
const PREFIX_LENGTH = 12;
const MAX_LIVE_KEYS = 10;
const MAX_NAME_LENGTH = 60;
const LAST_USED_THROTTLE_MS = 60_000;
const CAP_FIELDS = ["renders", "aiVideoUsd", "images", "tts", "publishes"];

function keysFilePath() {
  return path.join(DATA_DIR, "agent-keys.json");
}

function readKeys() {
  let raw;
  try {
    raw = fs.readFileSync(keysFilePath(), "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.keys) ? parsed.keys : [];
}

function writeKeys(keys) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(keysFilePath(), JSON.stringify({ keys }, null, 2));
}

function hashKey(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

/** @returns {{ plain: string, hash: string }} */
export function generateKey() {
  const plain = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  return { plain, hash: hashKey(plain) };
}

/**
 * The only shape that may leave this module: the hash is dropped.
 * @param {KeyRecord} record
 * @returns {PublicKey}
 */
export function toPublic(record) {
  const { hash: _hash, ...rest } = record;
  return rest;
}

/**
 * @param {string} userId
 * @param {string} name
 * @returns {{ key: PublicKey, plain: string }}
 */
export function createKey(userId, name) {
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (cleanName.length < 1 || cleanName.length > MAX_NAME_LENGTH) throw new Error("KEY_NAME");

  const keys = readKeys();
  const live = keys.filter((k) => k.userId === userId && !k.revokedAt);
  if (live.length >= MAX_LIVE_KEYS) throw new Error("KEY_LIMIT");

  const { plain, hash } = generateKey();
  /** @type {KeyRecord} */
  const key = {
    id: `ak_${crypto.randomBytes(8).toString("hex")}`,
    hash,
    prefix: plain.slice(0, PREFIX_LENGTH),
    userId,
    name: cleanName,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    publishAllowed: false,
    caps: {},
  };
  writeKeys([...keys, key]);
  return { key: toPublic(key), plain };
}

/** @param {string} userId @returns {PublicKey[]} */
export function listKeys(userId) {
  return readKeys()
    .filter((k) => k.userId === userId && !k.revokedAt)
    .map(toPublic);
}

/** @returns {boolean} true when a live key of this user was revoked */
export function revokeKey(userId, id) {
  const keys = readKeys();
  const index = keys.findIndex((k) => k.id === id && k.userId === userId && !k.revokedAt);
  if (index === -1) return false;
  const next = keys.map((k, i) => (i === index ? { ...k, revokedAt: new Date().toISOString() } : k));
  writeKeys(next);
  return true;
}

function sanitizeCaps(caps) {
  const out = {};
  if (!caps || typeof caps !== "object") return out;
  for (const field of CAP_FIELDS) {
    const value = caps[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[field] = value;
  }
  return out;
}

/**
 * @param {string} userId
 * @param {string} id
 * @param {{ publishAllowed?: boolean, caps?: Partial<Caps> }} patch
 * @returns {PublicKey | null}
 */
export function updateKey(userId, id, patch) {
  const keys = readKeys();
  const index = keys.findIndex((k) => k.id === id && k.userId === userId && !k.revokedAt);
  if (index === -1) return null;

  const current = keys[index];
  const updated = {
    ...current,
    publishAllowed:
      typeof patch?.publishAllowed === "boolean" ? patch.publishAllowed : current.publishAllowed,
    caps: { ...current.caps, ...sanitizeCaps(patch?.caps) },
  };
  writeKeys(keys.map((k, i) => (i === index ? updated : k)));
  return toPublic(updated);
}

/**
 * Looks a plain key up. Hashes the input once and compares against every stored
 * hash (no early exit) so timing does not reveal which key matched.
 * @param {string} plain
 * @returns {KeyRecord | null}
 */
export function findByPlainKey(plain) {
  if (typeof plain !== "string" || !plain.startsWith(KEY_PREFIX)) return null;

  const keys = readKeys();
  const inputHash = hashKey(plain);
  let matchIndex = -1;
  keys.forEach((k, i) => {
    if (sameSecret(k.hash, inputHash)) matchIndex = i;
  });
  if (matchIndex === -1) return null;

  const match = keys[matchIndex];
  if (match.revokedAt) return null;

  const users = getUsersStore().users || [];
  if (!users.some((u) => u.id === match.userId)) return null;

  const lastUsed = match.lastUsedAt ? Date.parse(match.lastUsedAt) : NaN;
  if (Number.isNaN(lastUsed) || Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
    const stamped = { ...match, lastUsedAt: new Date().toISOString() };
    writeKeys(keys.map((k, i) => (i === matchIndex ? stamped : k)));
    return stamped;
  }
  return match;
}
