import { test, describe, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { readLibrary, registerImage, pruneLibrary, findReusableImages, markUsed, cosine, _setEmbedImpl, _resetEmbedImpl } from "./imageLibrary.js";

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
    assert.ok(entry.publicUrl.startsWith("/outputs/imageLib/"));
    assert.ok(fs.existsSync(entry.path), "the pool file exists");
    assert.notEqual(entry.path, src, "the pool holds a COPY, not the original");
    assert.ok(entry.categories.includes("candle"), "auto-tagged from the prompt");
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
    const lib = readLibrary(dataDir);
    lib.items[0].lastUsedAt = 1;
    fs.writeFileSync(path.join(dataDir, "imageLibrary.json"), JSON.stringify(lib));
    const evicted = pruneLibrary({ dataDir, outputDir, max: 2 });
    assert.equal(evicted, 1);
    assert.equal(readLibrary(dataDir).items.length, 2);
    assert.equal(fs.existsSync(entries[0].path), false, "the evicted pool file was deleted");
  });

  test("does nothing when the library is under the cap", async () => {
    await registerImage({ dataDir, outputDir, sourcePath: writeImage("one.png", [4]), prompt: "p", style: "s", aspect: "landscape", provider: "x", projectId: "p" });
    assert.equal(pruneLibrary({ dataDir, outputDir, max: 10 }), 0);
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
