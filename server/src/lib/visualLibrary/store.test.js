import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { addClip, readLibrary, getClip, updateClip, removeClip, searchClips, similarClips, clipFile, isClipId } from "./store.js";

describe("visual library", () => {
  let ctx;
  let root;
  const tmpClip = (name = "dl.mp4") => {
    const f = path.join(root, name);
    fs.writeFileSync(f, "mp4");
    return f;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vlib-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test("keeps a clip with its prompt and serves it from an unguessable folder", () => {
    const clip = addClip(ctx, { file: tmpClip(), prompt: "A man kneels in prayer by a lamp", costUsd: 0.5, aspect: "portrait" });
    assert.ok(isClipId(clip.id));
    assert.equal(clip.url, `/outputs/visual-library/${clip.id}/clip.mp4`);
    assert.ok(clipFile(ctx, clip));
    assert.equal(getClip(ctx.dataDir, clip.id).prompt, "A man kneels in prayer by a lamp");
    assert.equal(fs.existsSync(path.join(root, "dl.mp4")), false, "the download is moved, not copied twice");
  });

  test("adds a re-roll beside the original instead of replacing it", () => {
    addClip(ctx, { file: tmpClip("a.mp4"), prompt: "Sunrise over hills" });
    addClip(ctx, { file: tmpClip("b.mp4"), prompt: "Sunrise over hills, wider" });
    assert.equal(readLibrary(ctx.dataDir).length, 2);
  });

  test("searches by prompt words and tags, and filters by frame", () => {
    addClip(ctx, { file: tmpClip("a.mp4"), prompt: "Golden sunrise over the savannah", aspect: "portrait" });
    const kneel = addClip(ctx, { file: tmpClip("b.mp4"), prompt: "A man kneels in prayer", tags: ["Prayer", "night"], aspect: "portrait" });
    addClip(ctx, { file: tmpClip("c.mp4"), prompt: "Prayer meeting in a church", aspect: "landscape" });
    const hits = searchClips(ctx.dataDir, { q: "prayer", aspect: "portrait" });
    assert.deepEqual(hits.map((c) => c.id), [kneel.id]);
    assert.equal(searchClips(ctx.dataDir).length, 3);
  });

  test("offers a close match before a new clip is ordered", () => {
    const sunrise = addClip(ctx, { file: tmpClip("a.mp4"), prompt: "Beautiful golden sunrise over a peaceful African savannah with acacia trees" });
    addClip(ctx, { file: tmpClip("b.mp4"), prompt: "A busy city street at night in the rain" });
    const close = similarClips(ctx.dataDir, "Wide shot. Golden sunrise over a peaceful savannah with acacia trees. Cinematic film still");
    assert.deepEqual(close.map((x) => x.clip.id), [sunrise.id]);
  });

  test("tags and rates a clip, and removes it with its files", () => {
    const clip = addClip(ctx, { file: tmpClip(), prompt: "x y z words" });
    assert.deepEqual(updateClip(ctx.dataDir, clip.id, { tags: ["Hope", "hope", " dawn "], rating: 4 }).tags, ["hope", "dawn"]);
    assert.equal(updateClip(ctx.dataDir, clip.id, { rating: 9 }).rating, null);
    assert.equal(removeClip(ctx, clip.id), true);
    assert.equal(readLibrary(ctx.dataDir).length, 0);
    assert.equal(fs.existsSync(path.join(ctx.outputDir, "visual-library", clip.id)), false);
  });
});
