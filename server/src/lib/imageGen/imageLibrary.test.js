import { test, describe, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { readLibrary, registerImage, pruneLibrary, findReusableImages, markUsed, cosine, _setEmbedImpl, _resetEmbedImpl, _defaultEmbed } from "./imageLibrary.js";

let dataDir;
let outputDir;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "imglib-"));
  dataDir = path.join(root, "data");
  outputDir = path.join(root, "out");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
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
    const entry = await registerImage({ dataDir, outputDir, sourcePath: src, prompt: "still waters at dusk, a candle burning", style: "cinematic-bible", aspect: "landscape", provider: "cloudflare", projectId: "p1" });
    assert.ok(entry, "an entry came back");
    assert.equal(entry.style, "cinematic-bible");
    assert.equal(entry.aspect, "landscape");
    assert.equal(entry.useCount, 1);
    assert.equal(entry.publicUrl, `/outputs/imagelib-${entry.hash}.png`);
    assert.equal(entry.publicUrl.slice("/outputs/".length).includes("/"), false, "index.js only serves per-user outputs by bare filename");
    assert.ok(fs.existsSync(entry.path), "the pool file exists");
    assert.notEqual(entry.path, src, "the pool holds a COPY, not the original");
    assert.ok(entry.categories.includes("candle"), "auto-tagged from the prompt");
    assert.ok(entry.embedding.length > 0, "the prompt embedding was stored");
    assert.equal(readLibrary(dataDir).items.length, 1);
  });

  test("keeps a JPEG a .jpg, so nothing downstream has to guess from a wrong extension", async () => {
    // Uploads can be JPEG or WebP. Stored as imagelib-<hash>.png they would
    // rely on ffmpeg and browsers sniffing content over the name.
    const src = writeImage("photo.jpg", [0xff, 0xd8, 0xff, 1]);
    const entry = await registerImage({ dataDir, outputDir, sourcePath: src, prompt: "", style: "", aspect: "landscape", provider: "upload", projectId: "p1", ext: "jpg" });
    assert.ok(entry.path.endsWith(`imagelib-${entry.hash}.jpg`));
    assert.equal(entry.publicUrl, `/outputs/imagelib-${entry.hash}.jpg`);
  });

  test("an extension outside png/jpg/webp falls back to png rather than naming a file anything", async () => {
    const src = writeImage("x.bin", [7, 7, 7]);
    const entry = await registerImage({ dataDir, outputDir, sourcePath: src, prompt: "p", style: "s", aspect: "landscape", provider: "x", projectId: "p", ext: "../../evil" });
    assert.equal(entry.publicUrl, `/outputs/imagelib-${entry.hash}.png`);
  });

  test("de-duplicates by content hash — identical bytes make one entry", async () => {
    const a = writeImage("a.png", [9, 9, 9]);
    const b = writeImage("b.png", [9, 9, 9]);
    const first = await registerImage({ dataDir, outputDir, sourcePath: a, prompt: "one", style: "s", aspect: "landscape", provider: "x", projectId: "p1" });
    const second = await registerImage({ dataDir, outputDir, sourcePath: b, prompt: "two", style: "s", aspect: "landscape", provider: "x", projectId: "p2" });
    assert.equal(second.id, first.id);
    assert.equal(readLibrary(dataDir).items.length, 1);
  });

  test("parallel harvests all land in the index — no lost update", async () => {
    // Scenes generate concurrently and embedding is a network call: two
    // harvests that both read the index before either writes would lose one.
    _setEmbedImpl(async (text) => { await new Promise((r) => setTimeout(r, 5)); return [text.length, 0, 0]; });
    const entries = await Promise.all([1, 2, 3, 4].map((n) =>
      registerImage({ dataDir, outputDir, sourcePath: writeImage(`c${n}.png`, [n, n, n]), prompt: "x".repeat(n), style: "s", aspect: "landscape", provider: "x", projectId: "p" })));
    assert.equal(new Set(entries.map((e) => e.id)).size, 4, "four distinct images");
    assert.equal(readLibrary(dataDir).items.length, 4, "every one is indexed");
    for (const e of entries) assert.ok(fs.existsSync(e.path), `${e.id} has its pool file`);
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
    const lib = readLibrary(dataDir);
    lib.items[0].lastUsedAt = 1;
    fs.writeFileSync(path.join(dataDir, "imageLibrary.json"), JSON.stringify(lib));
    const evicted = pruneLibrary({ dataDir, max: 2 });
    assert.equal(evicted, 1);
    assert.equal(readLibrary(dataDir).items.length, 2);
    assert.equal(fs.existsSync(entries[0].path), false, "the evicted pool file was deleted");
  });

  test("does nothing when the library is under the cap", async () => {
    await registerImage({ dataDir, outputDir, sourcePath: writeImage("one.png", [4]), prompt: "p", style: "s", aspect: "landscape", provider: "x", projectId: "p" });
    assert.equal(pruneLibrary({ dataDir, max: 10 }), 0);
    assert.equal(readLibrary(dataDir).items.length, 1);
  });
});

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

  test("IMAGE_REUSE_ENABLED=false turns lookup off without touching harvest", async () => {
    await seed([{ name: "off", bytes: [8], vec: [1, 0, 0], prompt: "still waters" }]);
    _setEmbedImpl(async () => [1, 0, 0]);
    process.env.IMAGE_REUSE_ENABLED = "false";
    try {
      assert.deepEqual(await findReusableImages({ dataDir, prompt: "quiet water", style: "cinematic-bible", aspect: "landscape" }), []);
    } finally {
      delete process.env.IMAGE_REUSE_ENABLED;
    }
    assert.equal(readLibrary(dataDir).items.length, 1, "the harvested entry is still indexed");
  });
});

describe("cosine", () => {
  test("is 1 for identical, 0 for orthogonal, and 0 for a length mismatch", () => {
    assert.ok(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.equal(cosine([1, 0], [1, 0, 0]), 0);
  });
});

describe("the embedding request is bounded", () => {
  // An embeddings call that never answered held the image stage (and its
  // worker) forever: the per-image timeout only covers generation.
  test("a request that never answers gives up and falls back, instead of hanging", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    let aborted = false;
    const hang = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    });
    try {
      const started = Date.now();
      const vec = await _defaultEmbed("still waters", { fetchImpl: hang, timeoutMs: 40 });
      assert.equal(vec, null, "no vector: callers fall back to keyword matching");
      assert.ok(Date.now() - started < 1000);
      assert.equal(aborted, true, "the request itself is cancelled, not left running");
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
    }
  });

  test("a fetch that ignores cancellation still can't hold the caller", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    try {
      const vec = await _defaultEmbed("still waters", { fetchImpl: () => new Promise(() => {}), timeoutMs: 40 });
      assert.equal(vec, null);
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
    }
  });

  test("a prompt embeds normally when the service answers", async () => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    try {
      const ok = async () => ({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) });
      assert.deepEqual(await _defaultEmbed("x", { fetchImpl: ok, timeoutMs: 1000 }), [0.1, 0.2]);
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved;
    }
  });
});

