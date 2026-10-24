import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { addClip, readLibrary, getClip, updateClip, removeClip, searchClips, similarClips, clipFile, isClipId, aspectOf, leadsOf, setPoster } from "./store.js";

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

  test("filters by tag, lowest rating and the lead character", () => {
    const lead = "a Black Nigerian man in his late thirties";
    const a = addClip(ctx, { file: tmpClip("a.mp4"), prompt: `${lead} kneels in prayer`, lead, tags: ["Grace"] });
    const b = addClip(ctx, { file: tmpClip("b.mp4"), prompt: `Wide shot: ${lead.toUpperCase()} walks at dawn`, tags: ["grace", "dawn"] });
    const c = addClip(ctx, { file: tmpClip("c.mp4"), prompt: "A golden sunrise over hills", tags: ["dawn"] });
    updateClip(ctx.dataDir, a.id, { rating: 5 });
    updateClip(ctx.dataDir, c.id, { rating: 3 });
    const ids = (opts) => searchClips(ctx.dataDir, opts).map((x) => x.id).sort();
    assert.deepEqual(ids({ tag: "grace" }), [a.id, b.id].sort());
    assert.deepEqual(ids({ minRating: 4 }), [a.id]);
    assert.deepEqual(ids({ minRating: 3 }), [a.id, c.id].sort());
    assert.deepEqual(ids({ lead }), [a.id, b.id].sort(), "the descriptor in the prompt counts, in any case");
    assert.deepEqual(ids({ lead, tag: "dawn" }), [b.id]);
  });

  test("lists the lead characters it knows, with how many clips show each", () => {
    const lead = "a young woman in a red headwrap";
    addClip(ctx, { file: tmpClip("a.mp4"), prompt: `${lead} sings`, lead });
    addClip(ctx, { file: tmpClip("b.mp4"), prompt: `Close-up of ${lead}` });
    addClip(ctx, { file: tmpClip("c.mp4"), prompt: "A river", lead: "  " });
    assert.deepEqual(leadsOf(ctx.dataDir), [{ lead, clips: 2 }]);
  });

  test("gives a clip without a poster its poster", () => {
    const clip = addClip(ctx, { file: tmpClip("a.mp4"), prompt: "x" });
    assert.equal(clip.posterUrl, null);
    const jpg = path.join(root, "p.jpg");
    fs.writeFileSync(jpg, "jpg");
    const updated = setPoster(ctx, clip.id, jpg);
    assert.equal(updated.posterUrl, `/outputs/visual-library/${clip.id}/poster.jpg`);
    assert.ok(fs.existsSync(path.join(ctx.outputDir, "visual-library", clip.id, "poster.jpg")));
    assert.equal(getClip(ctx.dataDir, clip.id).posterUrl, updated.posterUrl);
    assert.equal(fs.existsSync(jpg), false, "the made poster is moved in");
  });
});

describe("aspectOf", () => {
  test("names a clip by its shape", () => {
    assert.equal(aspectOf(720, 1280), "portrait");
    assert.equal(aspectOf(1280, 720), "landscape");
    assert.equal(aspectOf(960, 960), "square");
    assert.equal(aspectOf(1000, 1050), "square");
    assert.equal(aspectOf(0, 0), "portrait");
  });

});
