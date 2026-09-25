# Image Reuse Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Story scene asks a per-tenant image library for a picture before it asks a generator, and every generated picture joins that library.

**Architecture:** A new `imageLibrary.js` owns a per-tenant index (`<dataDir>/imageLibrary.json`) and a content-addressed pool (`<outputDir>/imageLib/<sha256>.png`). `imagesStage` in `routes/story.js` consults it before calling `generateBibleImage` and harvests every fresh generate into it. Matching is cosine similarity over OpenAI embeddings of the image's prompt, with the existing keyword categories as a no-key fallback.

**Tech Stack:** Node 24 ESM, Express, `node:test` + `node:assert/strict`, supertest; React/Vite + Vitest on the client. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-image-reuse-library-design.md`

## Global Constraints

- All route I/O goes through `req.ctx.dataDir` / `req.ctx.outputDir` — one tenant never reads another's library.
- Reuse freely across videos; **never the same image twice in one video**.
- A harvest failure must never fail a scene — catch, log, swallow.
- Scripture is never LLM-generated (unchanged by this work).
- Provider modules return `{ ok, provider, imageBuffer?, error? }`.
- Test seams follow the existing pattern: module-level `_x` plus `_setXImpl` / `_resetXImpl`.
- Prod ffmpeg is 5.1 — not touched here.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run server tests with a glob, never a bare directory: `node --test "src/lib/imageGen/*.test.js"`.

---

### Task 1: Library index and harvest

**Files:**
- Create: `server/src/lib/imageGen/imageLibrary.js`
- Create: `server/src/lib/imageGen/imageLibrary.test.js`

**Interfaces:**
- Consumes: `classifySearchQuery(query): string[]` from `server/src/lib/categorize.js`.
- Produces:
  - `libraryIndexPath(dataDir): string`
  - `poolDir(outputDir): string`
  - `readLibrary(dataDir): { items: LibraryImage[] }`
  - `registerImage({ dataDir, outputDir, sourcePath, prompt, style, aspect, provider, projectId }): Promise<LibraryImage|null>`
  - `pruneLibrary({ dataDir, outputDir, max }): number` (returns count evicted)
  - `_setEmbedImpl(fn)` / `_resetEmbedImpl()` where `fn(text): Promise<number[]|null>`
  - `LibraryImage` = `{ id, hash, path, publicUrl, prompt, style, aspect, categories, embedding, provider, projectId, createdAt, lastUsedAt, useCount }` — `embedding` is a base64 string or `""`.

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/imageGen/imageLibrary.test.js
import { test, describe, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { readLibrary, registerImage, pruneLibrary, _setEmbedImpl, _resetEmbedImpl } from "./imageLibrary.js";

let dataDir; let outputDir;
beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imglib-"));
  dataDir = path.join(root, "data"); outputDir = path.join(root, "out");
  fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(outputDir, { recursive: true });
  _setEmbedImpl(async () => [1, 0, 0]);
});
afterEach(() => _resetEmbedImpl());

const writeImage = (name, bytes) => {
  const p = path.join(outputDir, name);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
};

describe("registerImage", () => {
  test("copies the image into the pool and indexes it", async () => {
    const src = writeImage("a.png", [1, 2, 3]);
    const entry = await registerImage({ dataDir, outputDir, sourcePath: src, prompt: "still waters at dusk, peace", style: "cinematic-bible", aspect: "landscape", provider: "cloudflare", projectId: "p1" });
    assert.ok(entry, "an entry came back");
    assert.equal(entry.style, "cinematic-bible");
    assert.equal(entry.aspect, "landscape");
    assert.equal(entry.useCount, 1);
    assert.ok(entry.publicUrl.startsWith("/outputs/imageLib/"));
    assert.ok(fs.existsSync(entry.path), "the pool file exists");
    assert.notEqual(entry.path, src, "the pool holds a COPY, not the original");
    assert.ok(entry.categories.includes("peace"), "auto-tagged from the prompt");
    assert.ok(entry.embedding.length > 0, "the prompt embedding was stored");
    assert.equal(readLibrary(dataDir).items.length, 1);
  });

  test("de-duplicates by content hash — identical bytes make one entry", async () => {
    const a = writeImage("a.png", [9, 9, 9]);
    const b = writeImage("b.png", [9, 9, 9]);
    const first = await registerImage({ dataDir, outputDir, sourcePath: a, prompt: "one", style: "s", aspect: "landscape", provider: "x", projectId: "p1" });
    const second = await registerImage({ dataDir, outputDir, sourcePath: b, prompt: "two", style: "s", aspect: "landscape", provider: "x", projectId: "p2" });
    assert.equal(second.id, first.id);
    assert.equal(readLibrary(dataDir).items.length, 1);
  });

  test("a missing source file yields null rather than throwing", async () => {
    const entry = await registerImage({ dataDir, outputDir, sourcePath: path.join(outputDir, "nope.png"), prompt: "x", style: "s", aspect: "landscape", provider: "x", projectId: "p" });
    assert.equal(entry, null);
  });

  test("an unreadable index is treated as empty", () => {
    fs.writeFileSync(path.join(dataDir, "imageLibrary.json"), "{ not json");
    assert.deepEqual(readLibrary(dataDir), { items: [] });
  });
});

describe("pruneLibrary", () => {
  test("evicts least-recently-used entries and deletes their files", async () => {
    const entries = [];
    for (let i = 0; i < 3; i++) {
      entries.push(await registerImage({ dataDir, outputDir, sourcePath: writeImage(`n${i}.png`, [i]), prompt: `p${i}`, style: "s", aspect: "landscape", provider: "x", projectId: "p" }));
    }
    // Make entry 0 the oldest use.
    const lib = readLibrary(dataDir);
    lib.items[0].lastUsedAt = 1;
    fs.writeFileSync(path.join(dataDir, "imageLibrary.json"), JSON.stringify(lib));
    const evicted = pruneLibrary({ dataDir, outputDir, max: 2 });
    assert.equal(evicted, 1);
    assert.equal(readLibrary(dataDir).items.length, 2);
    assert.equal(fs.existsSync(entries[0].path), false, "the evicted pool file was deleted");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && node --test src/lib/imageGen/imageLibrary.test.js`
Expected: FAIL — `Cannot find module './imageLibrary.js'`.

- [ ] **Step 3: Implement**

```js
// server/src/lib/imageGen/imageLibrary.js
/**
 * Per-tenant library of generated images, so a scene can reuse a picture we
 * already own instead of spending image quota on a new one.
 *
 * Two pieces:
 *   - a content-addressed pool at <outputDir>/imageLib/<sha256>.png. It holds
 *     COPIES: outputs/genImg/<projectId>/ is purged on every re-segment, so an
 *     index pointing in there would lose images out from under other projects.
 *   - an index at <dataDir>/imageLibrary.json, separate from library.json so
 *     the existing (video) library is untouched.
 *
 * Matching lives in the same module (see findReusableImage) because it reads
 * the same index and must agree with it about shape.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { classifySearchQuery } from "../categorize.js";

const INDEX_FILE = "imageLibrary.json";
const POOL_DIR = "imageLib";
const DEFAULT_MAX_ITEMS = 2000;

export function libraryIndexPath(dataDir) { return path.join(dataDir, INDEX_FILE); }
export function poolDir(outputDir) { return path.join(outputDir, POOL_DIR); }

/** Read the index. A missing or corrupt file reads as empty — never throws. */
export function readLibrary(dataDir) {
  try {
    const raw = fs.readFileSync(libraryIndexPath(dataDir), "utf8");
    const parsed = JSON.parse(raw);
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
 * which case callers fall back to keyword categories. 512 dimensions keeps
 * the index small (~2.7 KB per entry) at no meaningful accuracy cost here.
 */
async function defaultEmbed(text) {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: String(text || "").slice(0, 8000), dimensions: 512 }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const vec = json?.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch {
    return null;
  }
}

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
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
  } catch {
    return null;
  }
}

/**
 * Copy a generated image into the pool and index it. Returns the entry, or
 * null when there is nothing to harvest. Never throws: the image already
 * exists on disk and the index is only an optimisation.
 */
export async function registerImage({ dataDir, outputDir, sourcePath, prompt, style, aspect, provider, projectId }) {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const bytes = fs.readFileSync(sourcePath);
    if (!bytes.length) return null;
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");

    const lib = readLibrary(dataDir);
    const existing = lib.items.find((it) => it.hash === hash);
    if (existing) return existing;

    const dir = poolDir(outputDir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${hash}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);

    const now = Date.now();
    const entry = {
      id: `img_${hash.slice(0, 16)}`,
      hash,
      path: file,
      publicUrl: `/outputs/${POOL_DIR}/${hash}.png`,
      prompt: String(prompt || ""),
      style: String(style || ""),
      aspect: String(aspect || ""),
      categories: classifySearchQuery(String(prompt || "")),
      embedding: encodeEmbedding(await _embed(String(prompt || ""))),
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
export function pruneLibrary({ dataDir, outputDir, max = DEFAULT_MAX_ITEMS }) {
  try {
    const lib = readLibrary(dataDir);
    if (lib.items.length <= max) return 0;
    const sorted = [...lib.items].sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0));
    const keep = sorted.slice(0, max);
    const evict = sorted.slice(max);
    for (const item of evict) {
      try { fs.rmSync(item.path, { force: true }); } catch { /* the index is the record; a stuck file is harmless */ }
    }
    writeLibrary(dataDir, { items: keep });
    return evict.length;
  } catch (e) {
    console.warn(`[imageLib] prune failed: ${e?.message || e}`);
    return 0;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test src/lib/imageGen/imageLibrary.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/imageGen/imageLibrary.js server/src/lib/imageGen/imageLibrary.test.js
git commit -m "feat(imageGen): per-tenant image library — content-addressed pool and index"
```

---

### Task 2: Matching

**Files:**
- Modify: `server/src/lib/imageGen/imageLibrary.js` (append)
- Modify: `server/src/lib/imageGen/imageLibrary.test.js` (append)

**Interfaces:**
- Consumes: `readLibrary`, `decodeEmbedding`, `_embed` from Task 1.
- Produces:
  - `cosine(a: number[], b: number[]): number`
  - `findReusableImages({ dataDir, prompt, style, aspect, excludeIds, limit }): Promise<Array<{ entry: LibraryImage, score: number }>>` — ranked best-first, already filtered by threshold, aspect, style and `excludeIds`. Returns a **list** so a caller running scenes concurrently can take the best candidate no other scene has claimed.
  - `markUsed({ dataDir, id }): void`
  - `reuseThreshold(): number` and `isReuseEnabled(): boolean`

- [ ] **Step 1: Write the failing test**

```js
// append to server/src/lib/imageGen/imageLibrary.test.js
import { findReusableImages, cosine, markUsed } from "./imageLibrary.js";

describe("findReusableImages", () => {
  const seed = async (rows) => {
    for (const r of rows) {
      _setEmbedImpl(async () => r.vec);
      await registerImage({ dataDir, outputDir, sourcePath: writeImage(`${r.name}.png`, r.bytes), prompt: r.prompt, style: r.style || "cinematic-bible", aspect: r.aspect || "landscape", provider: "x", projectId: "p1" });
    }
  };

  test("returns the closest match above the threshold, best first", async () => {
    await seed([
      { name: "near", bytes: [1], vec: [1, 0, 0], prompt: "still waters" },
      { name: "far", bytes: [2], vec: [0, 1, 0], prompt: "desert noon" },
    ]);
    _setEmbedImpl(async () => [1, 0, 0]);
    const hits = await findReusableImages({ dataDir, prompt: "quiet water", style: "cinematic-bible", aspect: "landscape" });
    assert.equal(hits.length, 1, "only the near one clears the threshold");
    assert.equal(hits[0].entry.prompt, "still waters");
    assert.ok(hits[0].score > 0.99);
  });

  test("filters on aspect and style before scoring", async () => {
    await seed([
      { name: "portrait", bytes: [3], vec: [1, 0, 0], prompt: "still waters", aspect: "portrait" },
      { name: "otherstyle", bytes: [4], vec: [1, 0, 0], prompt: "still waters", style: "modern-devotional" },
    ]);
    _setEmbedImpl(async () => [1, 0, 0]);
    const hits = await findReusableImages({ dataDir, prompt: "quiet water", style: "cinematic-bible", aspect: "landscape" });
    assert.deepEqual(hits, []);
  });

  test("excludeIds drops an otherwise winning entry (no image twice in one video)", async () => {
    await seed([{ name: "only", bytes: [5], vec: [1, 0, 0], prompt: "still waters" }]);
    _setEmbedImpl(async () => [1, 0, 0]);
    const all = await findReusableImages({ dataDir, prompt: "quiet water", style: "cinematic-bible", aspect: "landscape" });
    const excluded = await findReusableImages({ dataDir, prompt: "quiet water", style: "cinematic-bible", aspect: "landscape", excludeIds: [all[0].entry.id] });
    assert.equal(excluded.length, 0);
  });

  test("falls back to keyword categories when there is no embedding", async () => {
    _setEmbedImpl(async () => null);
    await registerImage({ dataDir, outputDir, sourcePath: writeImage("k.png", [6]), prompt: "a candle burning, peace and light", style: "cinematic-bible", aspect: "landscape", provider: "x", projectId: "p1" });
    const hits = await findReusableImages({ dataDir, prompt: "candle light, peace", style: "cinematic-bible", aspect: "landscape" });
    assert.equal(hits.length, 1, "category overlap carried the match");
    const miss = await findReusableImages({ dataDir, prompt: "a busy city street", style: "cinematic-bible", aspect: "landscape" });
    assert.equal(miss.length, 0);
  });

  test("markUsed bumps lastUsedAt and useCount", async () => {
    _setEmbedImpl(async () => [1, 0, 0]);
    const e = await registerImage({ dataDir, outputDir, sourcePath: writeImage("m.png", [7]), prompt: "x", style: "s", aspect: "landscape", provider: "x", projectId: "p" });
    markUsed({ dataDir, id: e.id });
    const after = readLibrary(dataDir).items.find((it) => it.id === e.id);
    assert.equal(after.useCount, 2);
    assert.ok(after.lastUsedAt >= e.lastUsedAt);
  });
});

describe("cosine", () => {
  test("is 1 for identical, 0 for orthogonal, and 0 for a length mismatch", () => {
    assert.ok(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.equal(cosine([1, 0], [1, 0, 0]), 0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && node --test src/lib/imageGen/imageLibrary.test.js`
Expected: FAIL — `findReusableImages is not a function`.

- [ ] **Step 3: Implement**

```js
// append to server/src/lib/imageGen/imageLibrary.js

const DEFAULT_THRESHOLD = 0.82;
// Category overlap is a blunt instrument, so it needs a clear majority before
// it may stand in for a real embedding match.
const CATEGORY_THRESHOLD = 0.6;

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
  const A = new Set(a || []); const B = new Set(b || []);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += 1;
  return shared / new Set([...A, ...B]).size;
}

/**
 * Candidates for reuse, best first, already above threshold. A LIST rather
 * than one winner: scenes are generated concurrently, so the caller claims
 * the best candidate no sibling scene has taken.
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
    const items = lib.items.map((it) => (it.id === id ? { ...it, lastUsedAt: Date.now(), useCount: (Number(it.useCount) || 0) + 1 } : it));
    writeLibrary(dataDir, { items });
  } catch (e) {
    console.warn(`[imageLib] markUsed failed: ${e?.message || e}`);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test src/lib/imageGen/imageLibrary.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/imageGen/imageLibrary.js server/src/lib/imageGen/imageLibrary.test.js
git commit -m "feat(imageGen): embedding match with keyword fallback for image reuse"
```

---

### Task 3: Ask the library before generating

**Files:**
- Modify: `server/src/routes/story.js` (`imagesStage`, around lines 163–228)
- Modify: `server/src/routes/story.test.js`

**Interfaces:**
- Consumes: `findReusableImages`, `markUsed`, `registerImage`, `pruneLibrary` from Tasks 1–2.
- Produces: scene fields `imageSource: "library" | "generated"` and `imageReuseScore: number | null`; test seam `_setImageLibraryImpl({ find, mark, register })` / `_resetImageLibraryImpl()`.

- [ ] **Step 1: Write the failing test**

```js
// append inside the existing story route describe in server/src/routes/story.test.js
test("a scene reuses a library image instead of generating, and never twice in one video", async () => {
  const generated = [];
  _setImageGenImpl(async ({ partNumber }) => { generated.push(partNumber); return { ok: true, path: `C:/tmp/p${partNumber}.png`, publicUrl: `/outputs/genImg/x/part-${partNumber}.png`, provider: "cloudflare" }; });
  const claimed = [];
  _setImageLibraryImpl({
    // One library image that matches everything: the second scene must NOT get it.
    find: async ({ excludeIds }) => (excludeIds.includes("img_a") ? [] : [{ entry: { id: "img_a", path: "C:/tmp/lib/a.png", publicUrl: "/outputs/imageLib/a.png" }, score: 0.91 }]),
    mark: ({ id }) => claimed.push(id),
    register: async () => null,
  });
  const project = await seedProjectWithScenes(2); // two scenes, both pending
  const res = await request(app).post(`/api/story/${project.projectId}/images`).send({});
  assert.equal(res.status, 200);
  const done = await waitForImages(project.projectId);
  assert.equal(done.scenes[0].imageSource, "library");
  assert.equal(done.scenes[0].imageUrl, "/outputs/imageLib/a.png");
  assert.equal(done.scenes[1].imageSource, "generated", "the only library image was already used by scene 1");
  assert.deepEqual(claimed, ["img_a"]);
  assert.equal(generated.length, 1, "only the second scene cost quota");
});

test("a generated scene is harvested into the library, and a harvest failure still leaves it done", async () => {
  _setImageGenImpl(async ({ partNumber }) => ({ ok: true, path: `C:/tmp/p${partNumber}.png`, publicUrl: `/outputs/genImg/x/part-${partNumber}.png`, provider: "cloudflare", prompt: "still waters" }));
  const harvested = [];
  _setImageLibraryImpl({
    find: async () => [],
    mark: () => {},
    register: async (args) => { harvested.push(args.sourcePath); throw new Error("disk full"); },
  });
  const project = await seedProjectWithScenes(1);
  await request(app).post(`/api/story/${project.projectId}/images`).send({});
  const done = await waitForImages(project.projectId);
  assert.equal(done.scenes[0].imageStatus, "done", "a harvest failure never fails the scene");
  assert.equal(harvested.length, 1);
});
```

Note for the implementer: `seedProjectWithScenes(n)` and `waitForImages(id)` are local helpers — if the existing test file has equivalents under different names, use those instead of adding duplicates. `_setImageGenImpl` already exists in this file.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && node --test src/routes/story.test.js`
Expected: FAIL — `_setImageLibraryImpl is not exported`.

- [ ] **Step 3: Implement**

Add near the other seams at the top of `server/src/routes/story.js`:

```js
import { findReusableImages, markUsed, registerImage, pruneLibrary } from "../lib/imageGen/imageLibrary.js";

// Injectable so route tests can drive reuse without touching disk or OpenAI.
let _imageLib = { find: findReusableImages, mark: markUsed, register: registerImage };
export function _setImageLibraryImpl(impl) { _imageLib = { ..._imageLib, ...impl }; }
export function _resetImageLibraryImpl() { _imageLib = { find: findReusableImages, mark: markUsed, register: registerImage }; }
```

Inside `imagesStage`, before the worker loop:

```js
  // Images already claimed by THIS video. Scenes run concurrently, so a claim
  // is taken synchronously after the await — two workers must never land on
  // the same picture.
  const claimedIds = new Set((scenes || []).map((s) => s.imageLibraryId).filter(Boolean));
```

Replace the body of the `worker()` loop's try/catch with:

```js
      const i = pending[cursor++];
      const style = String(project.style || "");
      const aspect = imageAspectFor(project);
      let result;
      let reused = null;

      // 1. Ask the library first — a hit costs no quota.
      try {
        const candidates = await _imageLib.find({ dataDir: ctx.dataDir, prompt: scenes[i].imagePrompt, style, aspect, excludeIds: [...claimedIds] });
        for (const c of candidates) {
          if (claimedIds.has(c.entry.id)) continue; // a sibling scene took it while we awaited
          claimedIds.add(c.entry.id);               // claim synchronously
          reused = c;
          break;
        }
      } catch (err) {
        console.warn(`[story] scene ${i + 1} library lookup failed: ${err?.message || err}`);
      }

      if (reused) {
        try { _imageLib.mark({ dataDir: ctx.dataDir, id: reused.entry.id }); } catch { /* usage stats are not worth failing a scene */ }
        console.log(`[story] scene ${i + 1} reused ${reused.entry.id} (score ${reused.score.toFixed(3)})`);
        scenes[i] = { ...scenes[i], imagePath: reused.entry.path, imageUrl: reused.entry.publicUrl, imageStatus: "done", imageError: null, imageSource: "library", imageLibraryId: reused.entry.id, imageReuseScore: reused.score };
        writeProject(ctx.dataDir, { ...project, scenes });
        continue;
      }

      // 2. Nothing fit — generate, then harvest the result for next time.
      try {
        result = await withTimeout(
          _imageGenFn({ seriesId: project.projectId, partNumber: i + 1, rawPrompt: scenes[i].imagePrompt, aspect }),
          timeoutMs,
          `image gen for scene ${i + 1} timed out after ${timeoutMs}ms`,
        );
      } catch (err) {
        console.warn(`[story] scene ${i + 1} image gen failed: ${err?.message || err}`);
        result = { ok: false, error: String(err?.message || err) };
      }

      if (result?.ok) {
        let entry = null;
        try {
          entry = await _imageLib.register({ dataDir: ctx.dataDir, outputDir: ctx.outputDir, sourcePath: result.path, prompt: scenes[i].imagePrompt, style, aspect, provider: result.provider, projectId: project.projectId });
          if (entry) claimedIds.add(entry.id);
        } catch (err) {
          // The picture exists; the index is only an optimisation.
          console.warn(`[story] scene ${i + 1} harvest failed: ${err?.message || err}`);
        }
        scenes[i] = { ...scenes[i], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done", imageError: null, imageSource: "generated", imageLibraryId: entry?.id || null, imageReuseScore: null };
      } else {
        scenes[i] = { ...scenes[i], imageStatus: "error", imageError: shortImageError(result?.error) };
      }
      writeProject(ctx.dataDir, { ...project, scenes });
```

After `await Promise.all(...)`, before the cancel check:

```js
  try { pruneLibrary({ dataDir: ctx.dataDir, outputDir: ctx.outputDir }); } catch { /* pruning is housekeeping */ }
```

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test src/routes/story.test.js`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Run the whole server suite**

Run: `cd server && npm test`
Expected: PASS. If `cancel stops a long image run` fails, re-run it alone — it is a known CPU-timing flake.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/story.js server/src/routes/story.test.js
git commit -m "feat(story): reuse a library image before spending image quota"
```

---

### Task 4: Together AI free provider

**Files:**
- Create: `server/src/lib/imageGen/providers/together.js`
- Create: `server/src/lib/imageGen/providers/together.test.js`
- Modify: `server/src/lib/imageGen/index.js` (`listProviderChain`, the chain switch, the header comment)
- Modify: `server/.env.example`

**Interfaces:**
- Produces: `generateImageTogether({ prompt, seed, aspect, model, signal }): Promise<ImageGenResult>` and `isTogetherConfigured(): boolean`. Chain order becomes cloudflare → together → pollinations → imagen.

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/imageGen/providers/together.test.js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateImageTogether, isTogetherConfigured } from "./together.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.TOGETHER_API_KEY; });

describe("together provider", () => {
  test("is unconfigured without a key, and says so instead of throwing", async () => {
    assert.equal(isTogetherConfigured(), false);
    const r = await generateImageTogether({ prompt: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /TOGETHER_API_KEY/);
  });

  test("posts the free schnell model with landscape dimensions and returns the decoded image", async () => {
    process.env.TOGETHER_API_KEY = "k";
    let sent;
    globalThis.fetch = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] }) };
    };
    const r = await generateImageTogether({ prompt: "still waters", aspect: "landscape", seed: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.provider, "together");
    assert.deepEqual([...r.imageBuffer], [1, 2, 3]);
    assert.match(sent.body.model, /FLUX\.1-schnell-Free/);
    assert.equal(sent.body.width, 1344);
    assert.equal(sent.body.height, 768);
    assert.equal(sent.body.seed, 7);
  });

  test("surfaces an API error as a named failure", async () => {
    process.env.TOGETHER_API_KEY = "k";
    globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
    const r = await generateImageTogether({ prompt: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /429/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && node --test src/lib/imageGen/providers/together.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/imageGen/providers/together.js
/**
 * Together AI — FLUX.1-schnell-Free.
 *
 * A third free generator behind Cloudflare, so a spent daily quota does not
 * stop a render. Quality sits below Lucid Origin (it is the same FLUX schnell
 * class as Cloudflare's older default), so it is a fallback, never the primary.
 */
import { toDimensions } from "../dimensions.js";

const ENDPOINT = "https://api.together.xyz/v1/images/generations";
const DEFAULT_MODEL = "black-forest-labs/FLUX.1-schnell-Free";
const REQUEST_TIMEOUT_MS = 60_000;

export function isTogetherConfigured() {
  return String(process.env.TOGETHER_API_KEY || "").trim().length > 0;
}

/**
 * @param {{ prompt: string, seed?: number, aspect?: string, model?: string, signal?: AbortSignal }} args
 * @returns {Promise<import("./cloudflare.js").ImageGenResult>}
 */
export async function generateImageTogether({ prompt, seed, aspect, model, signal }) {
  if (!isTogetherConfigured()) return { ok: false, provider: "together", error: "Together not configured (set TOGETHER_API_KEY)" };
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) return { ok: false, provider: "together", error: "prompt required" };

  const { width, height } = toDimensions(aspect);
  const modelId = String(model || process.env.TOGETHER_IMAGE_MODEL || DEFAULT_MODEL).trim();
  const body = { model: modelId, prompt: prompt.trim().slice(0, 4000), width, height, n: 1, response_format: "b64_json" };
  if (Number.isFinite(seed)) body.seed = Number(seed);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${String(process.env.TOGETHER_API_KEY).trim()}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, provider: "together", model: modelId, error: `Together ${resp.status}: ${text.slice(0, 200)}` };
    }
    const json = await resp.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, provider: "together", model: modelId, error: "Together returned no image data" };
    return { ok: true, provider: "together", model: modelId, imageBuffer: Buffer.from(b64, "base64") };
  } catch (e) {
    return { ok: false, provider: "together", model: modelId, error: `Together request failed: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
```

Then in `server/src/lib/imageGen/index.js`: import `generateImageTogether, isTogetherConfigured`; add `if (isTogetherConfigured()) all.push("together");` immediately after the Cloudflare push in `listProviderChain`; add `"together"` to the `requested` whitelist array; add a `: provider === "together" ? await generateImageTogether({ prompt, seed, aspect })` branch to the chain switch; and add Together to the priority list in the file header comment. Also add `isTogetherConfigured()` to the `isImageGenEnabled()` default.

In `server/.env.example`, under the image-gen section:

```
# Together AI — free FLUX.1-schnell endpoint, used when the Cloudflare daily
# image quota is spent. https://api.together.xyz
TOGETHER_API_KEY=
# Image reuse: a scene reuses a library image at or above this cosine score.
IMAGE_REUSE_THRESHOLD=0.82
IMAGE_REUSE_ENABLED=true
```

- [ ] **Step 4: Run the tests**

Run: `cd server && node --test "src/lib/imageGen/*.test.js" "src/lib/imageGen/providers/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/imageGen/providers/together.js server/src/lib/imageGen/providers/together.test.js server/src/lib/imageGen/index.js server/.env.example
git commit -m "feat(imageGen): Together FLUX.1-schnell-Free as a third free provider"
```

---

### Task 5: Show which scenes were reused

**Files:**
- Modify: `client/src/lib/storyTypes.ts` (`StoryScene`)
- Modify: `client/src/components/story/StoryScenePreview.tsx`
- Modify: `client/src/components/story/__tests__/StoryScenePreview.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `imageSource` and `imageReuseScore` written by Task 3.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/story/__tests__/StoryScenePreview.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StoryScenePreview } from '../StoryScenePreview';

const scene = { id: 's1', text: 'still waters', startMs: 0, endMs: 1000, imagePrompt: 'still waters', imagePath: '/x.png', imageUrl: '/outputs/imageLib/a.png', imageStatus: 'done' as const, promptEditedByUser: false };

describe('StoryScenePreview', () => {
  it('marks a reused image so the operator knows it cost no quota', () => {
    render(<StoryScenePreview scene={{ ...scene, imageSource: 'library' }} />);
    expect(screen.getByText(/reused/i)).toBeInTheDocument();
  });
  it('says nothing for a freshly generated image', () => {
    render(<StoryScenePreview scene={{ ...scene, imageSource: 'generated' }} />);
    expect(screen.queryByText(/reused/i)).not.toBeInTheDocument();
  });
});
```

Note for the implementer: `StoryScenePreview` takes more props than `scene` in the real component — read its props interface and pass whatever else is required, keeping the assertions above.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd client && npx vitest run src/components/story/__tests__/StoryScenePreview.test.tsx`
Expected: FAIL — no "reused" text.

- [ ] **Step 3: Implement**

In `client/src/lib/storyTypes.ts`, add to `StoryScene`:

```ts
  /** Where this picture came from: reused from the library, or freshly generated. */
  imageSource?: 'library' | 'generated';
  /** Cosine score of the library match, when imageSource === 'library'. */
  imageReuseScore?: number | null;
  /** Library entry id, so the same image is never used twice in one video. */
  imageLibraryId?: string | null;
```

In `StoryScenePreview.tsx`, beside the existing scene meta, render:

```tsx
{scene.imageSource === 'library' && (
  <span className="text-meta" title="Reused from your library — this scene cost no image quota">Reused</span>
)}
```

- [ ] **Step 4: Run the tests**

Run: `cd client && npx vitest run src/components/story && npx tsc --noEmit -p .`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/storyTypes.ts client/src/components/story/StoryScenePreview.tsx client/src/components/story/__tests__/StoryScenePreview.test.tsx
git commit -m "feat(story): mark scenes whose image was reused from the library"
```

---

## Verification

- [ ] `cd server && npm test` — full suite green.
- [ ] `cd client && npx vitest run && npx tsc --noEmit -p .` — green and clean.
- [ ] Manual: draft a long-form project, let it generate images, then draft a second project on the same theme and confirm from the server log that scenes report `reused <id> (score …)` and that fewer provider calls are made.
