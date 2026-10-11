import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  FIT_COVER, FIT_CONTAIN, chooseSceneFit, normalizeStoryAspect, storyFrameSize,
  parseProbeSize, probeMediaSize, withSceneFits,
} from "./sceneFraming.js";

describe("normalizeStoryAspect", () => {
  test("keeps the three output frames the Render tab offers", () => {
    assert.equal(normalizeStoryAspect("portrait"), "portrait");
    assert.equal(normalizeStoryAspect("landscape"), "landscape");
    assert.equal(normalizeStoryAspect("square"), "square");
  });
  test("anything else, including a missing value, stays portrait", () => {
    assert.equal(normalizeStoryAspect(undefined), "portrait");
    assert.equal(normalizeStoryAspect("wide"), "portrait");
  });
});

describe("storyFrameSize", () => {
  test("defaults: portrait 720x1280, landscape 1280x720, square 1080x1080", () => {
    assert.deepEqual(storyFrameSize("portrait", {}), { width: 720, height: 1280 });
    assert.deepEqual(storyFrameSize("landscape", {}), { width: 1280, height: 720 });
    assert.deepEqual(storyFrameSize("square", {}), { width: 1080, height: 1080 });
  });
  test("each frame keeps its own env override", () => {
    assert.deepEqual(storyFrameSize("portrait", { STORY_RENDER_WIDTH: "1080", STORY_RENDER_HEIGHT: "1920" }), { width: 1080, height: 1920 });
    assert.deepEqual(storyFrameSize("landscape", { STORY_RENDER_LANDSCAPE_WIDTH: "1920", STORY_RENDER_LANDSCAPE_HEIGHT: "1080" }), { width: 1920, height: 1080 });
    assert.deepEqual(storyFrameSize("square", { STORY_RENDER_SQUARE_SIZE: "720" }), { width: 720, height: 720 });
  });
  test("an unknown aspect renders portrait", () => {
    assert.deepEqual(storyFrameSize("wide", {}), { width: 720, height: 1280 });
  });
});

describe("chooseSceneFit", () => {
  const portrait = { frameWidth: 720, frameHeight: 1280 };
  test("a landscape upload in a portrait frame is shown whole, not cropped", () => {
    assert.equal(chooseSceneFit({ mediaWidth: 1920, mediaHeight: 1080, ...portrait }), FIT_CONTAIN);
  });
  test("a picture already the frame's shape fills it as before", () => {
    assert.equal(chooseSceneFit({ mediaWidth: 1080, mediaHeight: 1920, ...portrait }), FIT_COVER);
    assert.equal(chooseSceneFit({ mediaWidth: 768, mediaHeight: 1344, ...portrait }), FIT_COVER);
  });
  test("a portrait picture in a landscape frame is shown whole", () => {
    assert.equal(chooseSceneFit({ mediaWidth: 720, mediaHeight: 1280, frameWidth: 1280, frameHeight: 720 }), FIT_CONTAIN);
  });
  test("a 4:5 photo in a 9:16 frame would lose too much to a crop", () => {
    assert.equal(chooseSceneFit({ mediaWidth: 1080, mediaHeight: 1350, ...portrait }), FIT_CONTAIN);
  });
  test("a generated image keeps the full-bleed fill unless a crop would lose about half of it", () => {
    // A provider that ignores the requested size returns a square: it was
    // always cropped to fill, and still is.
    assert.equal(chooseSceneFit({ mediaWidth: 1024, mediaHeight: 1024, ...portrait, generated: true }), FIT_COVER);
    // A portrait image in a landscape frame would lose two thirds: shown whole.
    assert.equal(chooseSceneFit({ mediaWidth: 720, mediaHeight: 1280, frameWidth: 1280, frameHeight: 720, generated: true }), FIT_CONTAIN);
  });
  test("unknown dimensions keep today's fill", () => {
    assert.equal(chooseSceneFit({ mediaWidth: null, mediaHeight: 0, ...portrait }), FIT_COVER);
  });
});

describe("parseProbeSize", () => {
  const probe = (stream) => JSON.stringify({ streams: [stream] });
  test("reads width and height", () => {
    assert.deepEqual(parseProbeSize(probe({ width: 1920, height: 1080 })), { width: 1920, height: 1080 });
  });
  test("a phone clip rotated 90 degrees is really portrait", () => {
    assert.deepEqual(parseProbeSize(probe({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] })), { width: 1080, height: 1920 });
    assert.deepEqual(parseProbeSize(probe({ width: 1920, height: 1080, tags: { rotate: "270" } })), { width: 1080, height: 1920 });
  });
  test("an anamorphic clip is measured at its display size", () => {
    // 1440x1080 stored with 4:3 pixels plays as 1920x1080.
    assert.deepEqual(parseProbeSize(probe({ width: 1440, height: 1080, sample_aspect_ratio: "4:3" })), { width: 1920, height: 1080 });
    // Square pixels, or none stated, change nothing.
    assert.deepEqual(parseProbeSize(probe({ width: 1920, height: 1080, sample_aspect_ratio: "1:1" })), { width: 1920, height: 1080 });
    assert.deepEqual(parseProbeSize(probe({ width: 1920, height: 1080, sample_aspect_ratio: "0:1" })), { width: 1920, height: 1080 });
  });
  test("garbage is null, never a throw", () => {
    assert.equal(parseProbeSize("not json"), null);
    assert.equal(parseProbeSize(JSON.stringify({ streams: [] })), null);
  });
});

describe("withSceneFits", () => {
  let dir;
  test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "framing-")); });
  test.afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test("marks each scene from its own media, measuring a shared file once", async () => {
    const wide = path.join(dir, "wide.jpg");
    const tall = path.join(dir, "tall.jpg");
    fs.writeFileSync(wide, "x");
    fs.writeFileSync(tall, "x");
    const calls = [];
    const probe = async (f) => {
      calls.push(f);
      return f === wide ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
    };
    const scenes = [{ id: "a", imagePath: wide }, { id: "b", imagePath: tall }, { id: "c", imagePath: wide }];
    const out = await withSceneFits(scenes, { width: 720, height: 1280, probe });
    assert.deepEqual(out.map((s) => s.fit), [FIT_CONTAIN, FIT_COVER, FIT_CONTAIN]);
    assert.deepEqual(calls.sort(), [tall, wide].sort());
    assert.equal(scenes[0].fit, undefined, "the input scenes are not mutated");
  });

  test("a scene playing its own clip is measured by the clip, not the poster", async () => {
    const clip = path.join(dir, "clip.mp4");
    const poster = path.join(dir, "poster.jpg");
    fs.writeFileSync(clip, "x");
    fs.writeFileSync(poster, "x");
    const probe = async (f) => (f === clip ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 });
    const [s] = await withSceneFits([{ id: "a", imagePath: poster, videoPath: clip }], { width: 720, height: 1280, probe });
    assert.equal(s.fit, FIT_CONTAIN);
  });

  test("a generated still is held to the looser rule, an upload to the tight one", async () => {
    const sq = path.join(dir, "sq.png");
    fs.writeFileSync(sq, "x");
    const probe = async () => ({ width: 1024, height: 1024 });
    const out = await withSceneFits([
      { id: "g", imagePath: sq, imageSource: "generated" },
      { id: "u", imagePath: sq, imageSource: "upload" },
      { id: "old", imagePath: sq },
    ], { width: 720, height: 1280, probe });
    assert.deepEqual(out.map((s) => s.fit), [FIT_COVER, FIT_CONTAIN, FIT_CONTAIN]);
  });

  test("measures only a few files at a time", async () => {
    const files = Array.from({ length: 20 }, (_, i) => {
      const f = path.join(dir, `f${i}.jpg`);
      fs.writeFileSync(f, "x");
      return f;
    });
    let live = 0;
    let peak = 0;
    const probe = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { width: 1920, height: 1080 };
    };
    const out = await withSceneFits(files.map((f, i) => ({ id: String(i), imagePath: f })), { width: 720, height: 1280, probe });
    assert.equal(out.length, 20);
    assert.ok(peak <= 6, `at most 6 probes at once, saw ${peak}`);
  });

  test("a probe that fails keeps the scene on today's fill", async () => {
    const f = path.join(dir, "a.jpg");
    fs.writeFileSync(f, "x");
    const [s] = await withSceneFits([{ id: "a", imagePath: f }], {
      width: 720, height: 1280, probe: async () => { throw new Error("boom"); },
    });
    assert.equal(s.fit, FIT_COVER);
  });
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

describe("probeMediaSize (real ffprobe)", () => {
  test("measures an image", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "framing-probe-"));
    try {
      const img = path.join(dir, "wide.png");
      spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", img]);
      assert.deepEqual(await probeMediaSize(img), { width: 640, height: 360 });
      assert.equal(await probeMediaSize(path.join(dir, "missing.png")), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
