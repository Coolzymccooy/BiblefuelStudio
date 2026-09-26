/**
 * Per-tenant library of generated images, so a scene can reuse a picture we
 * already own instead of spending image quota on a new one.
 *
 * Two pieces:
 *   - a content-addressed pool of COPIES at <outputDir>/imagelib-<sha256>.png.
 *     Copies, because outputs/genImg/<projectId>/ is purged on every
 *     re-segment and an index pointing in there would lose images out from
 *     under other projects. Flat, because index.js serves a nested per-user
 *     output only when its path carries an unguessable id (perUserOutputs.js).
 *   - an index at <dataDir>/imageLibrary.json, separate from library.json so
 *     the existing (video) library needs no migration.
 *
 * Matching lives in this module too, because it reads the same index and has
 * to agree with it about shape.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { classifySearchQuery } from "../categorize.js";

const INDEX_FILE = "imageLibrary.json";
// Pool files sit FLAT in the tenant's outputs with a distinctive prefix.
// index.js serves a nested per-user output only when its path carries an
// unguessable id (perUserOutputs.js); a plain pool subdirectory would 404 for
// every non-admin tenant and the preview would show a broken image.
const POOL_PREFIX = "imagelib-";
const DEFAULT_MAX_ITEMS = 2000;
const DEFAULT_THRESHOLD = 0.82;
// Category overlap is a blunt instrument, so it needs a clear majority before
// it may stand in for a real embedding match.
const CATEGORY_THRESHOLD = 0.6;

export function libraryIndexPath(dataDir) { return path.join(dataDir, INDEX_FILE); }
// Uploads keep their real type; everything generated has always been PNG.
const POOL_EXTS = new Set(["png", "jpg", "webp"]);
export function poolFileFor(outputDir, hash, ext = "png") { return path.join(outputDir, `${POOL_PREFIX}${hash}.${ext}`); }

/** Read the index. A missing or corrupt file reads as empty — never throws. */
export function readLibrary(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryIndexPath(dataDir), "utf8"));
    return { items: Array.isArray(parsed?.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function writeLibrary(dataDir, lib) {
  const file = libraryIndexPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ items: lib.items }, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Embed a prompt for similarity search. Returns null when no key is set, in
 * which case callers fall back to keyword categories. 512 dimensions keeps the
 * index small (~2.7 KB per entry) at no meaningful accuracy cost here.
 */
const EMBED_TIMEOUT_MS = 8000;
async function defaultEmbed(text, { fetchImpl = fetch, timeoutMs = EMBED_TIMEOUT_MS } = {}) {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  // Bounded: the image stage awaits this outside the per-image timeout, so an
  // embeddings call that never answered held the stage and its worker forever.
  // Past the bound it gives up like a missing key: keyword matching instead.
  const controller = new AbortController();
  let timer;
  const gaveUp = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
  });
  const call = (async () => {
    try {
      const resp = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "text-embedding-3-small", input: String(text || "").slice(0, 8000), dimensions: 512 }),
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      const vec = json?.data?.[0]?.embedding;
      return Array.isArray(vec) ? vec : null;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([call, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
/** Test seam: the real embedding call, with its fetch and bound injectable. */
export const _defaultEmbed = defaultEmbed;

let _embed = defaultEmbed;
export function _setEmbedImpl(fn) { _embed = fn; }
export function _resetEmbedImpl() { _embed = defaultEmbed; }

export function encodeEmbedding(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return "";
  return Buffer.from(new Float32Array(vec).buffer).toString("base64");
}

export function decodeEmbedding(b64) {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 0 || buf.length % 4 !== 0) return null;
    const copy = new Uint8Array(buf.length);
    copy.set(buf);
    return Array.from(new Float32Array(copy.buffer));
  } catch {
    return null;
  }
}

/**
 * Copy a generated image into the pool and index it. Returns the entry, or
 * null when there is nothing to harvest. Never throws: the image already
 * exists on disk and the index is only an optimisation.
 *
 * @param {{ dataDir: string, outputDir: string, sourcePath: string, prompt: string,
 *           style: string, aspect: string, provider?: string, projectId?: string,
 *           ext?: "png"|"jpg"|"webp" }} args
 */
export async function registerImage({ dataDir, outputDir, sourcePath, prompt, style, aspect, provider, projectId, ext = "png" }) {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const bytes = fs.readFileSync(sourcePath);
    if (!bytes.length) return null;
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");

    // Embed FIRST. Everything after this point is synchronous, so the
    // read-modify-write of the index cannot interleave with another worker's
    // — scenes harvest in parallel, and a stale write would silently drop an
    // entry and orphan its pool file forever.
    const embedding = encodeEmbedding(await _embed(String(prompt || "")));

    const lib = readLibrary(dataDir);
    const existing = lib.items.find((it) => it?.hash === hash);
    if (existing) return existing;

    fs.mkdirSync(outputDir, { recursive: true });
    const safeExt = POOL_EXTS.has(ext) ? ext : "png";
    const file = poolFileFor(outputDir, hash, safeExt);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);

    const now = Date.now();
    const entry = {
      id: `img_${hash.slice(0, 16)}`,
      hash,
      path: file,
      publicUrl: `/outputs/${POOL_PREFIX}${hash}.${safeExt}`,
      prompt: String(prompt || ""),
      style: String(style || ""),
      aspect: String(aspect || ""),
      categories: classifySearchQuery(String(prompt || "")),
      embedding,
      provider: String(provider || ""),
      projectId: String(projectId || ""),
      createdAt: now,
      lastUsedAt: now,
      useCount: 1,
    };
    writeLibrary(dataDir, { items: [...lib.items, entry] });
    return entry;
  } catch (e) {
    console.warn(`[imageLib] harvest failed: ${e?.message || e}`);
    return null;
  }
}

/** Cap the library, evicting least-recently-used entries and their files. */
export function pruneLibrary({ dataDir, max = DEFAULT_MAX_ITEMS }) {
  try {
    const lib = readLibrary(dataDir);
    if (lib.items.length <= max) return 0;
    const sorted = [...lib.items].sort((a, b) => (Number(b?.lastUsedAt) || 0) - (Number(a?.lastUsedAt) || 0));
    const keep = sorted.slice(0, max);
    const evict = sorted.slice(max);
    for (const item of evict) {
      // The index is the record; a file we cannot delete is harmless.
      try { fs.rmSync(item.path, { force: true }); } catch { /* ignore */ }
    }
    writeLibrary(dataDir, { items: keep });
    return evict.length;
  } catch (e) {
    console.warn(`[imageLib] prune failed: ${e?.message || e}`);
    return 0;
  }
}

export function isReuseEnabled() {
  const flag = String(process.env.IMAGE_REUSE_ENABLED || "").trim().toLowerCase();
  return !(flag === "false" || flag === "0" || flag === "no");
}

export function reuseThreshold() {
  const n = Number(process.env.IMAGE_REUSE_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_THRESHOLD;
}

/** Cosine similarity. Mismatched or empty vectors score 0 rather than NaN. */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function jaccard(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += 1;
  return shared / new Set([...A, ...B]).size;
}

/**
 * Candidates for reuse, best first, already above threshold and filtered by
 * aspect, style and `excludeIds`. A LIST rather than one winner: scenes are
 * generated concurrently, so the caller claims the best candidate no sibling
 * scene has taken.
 *
 * @param {{ dataDir: string, prompt: string, style: string, aspect: string,
 *           excludeIds?: string[], limit?: number }} args
 * @returns {Promise<Array<{ entry: object, score: number }>>}
 */
export async function findReusableImages({ dataDir, prompt, style, aspect, excludeIds = [], limit = 5 }) {
  if (!isReuseEnabled()) return [];
  const exclude = new Set(excludeIds);
  const pool = readLibrary(dataDir).items.filter((it) =>
    it && !exclude.has(it.id) && String(it.aspect) === String(aspect) && String(it.style) === String(style));
  if (pool.length === 0) return [];

  const vec = await _embed(String(prompt || ""));
  const scored = [];
  if (vec) {
    const min = reuseThreshold();
    for (const entry of pool) {
      const other = decodeEmbedding(entry.embedding);
      if (!other) continue;
      const score = cosine(vec, other);
      if (score >= min) scored.push({ entry, score });
    }
  } else {
    // No embeddings available — keyword categories are the honest fallback.
    const cats = classifySearchQuery(String(prompt || ""));
    for (const entry of pool) {
      const score = jaccard(cats, entry.categories);
      if (score >= CATEGORY_THRESHOLD) scored.push({ entry, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Record that an entry was used again (drives LRU pruning). */
export function markUsed({ dataDir, id }) {
  try {
    const lib = readLibrary(dataDir);
    const items = lib.items.map((it) => (it?.id === id
      ? { ...it, lastUsedAt: Date.now(), useCount: (Number(it.useCount) || 0) + 1 }
      : it));
    writeLibrary(dataDir, { items });
  } catch (e) {
    console.warn(`[imageLib] markUsed failed: ${e?.message || e}`);
  }
}
