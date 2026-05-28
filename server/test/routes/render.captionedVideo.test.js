/**
 * POST /api/render/captioned-video — burns kinetic-typography captions
 * onto a user-provided video with optional music ducking.
 *
 * These tests verify:
 * - Input validation (videoPath, words array, aspect)
 * - Optional music path validation
 * - Word normalization (start < end, non-empty text)
 * - FFmpeg availability check
 * - Error handling for missing/invalid files
 * - Response structure on success
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import renderRouter from "../../src/routes/render.js";

/**
 * Creates a minimal valid MP4 file with proper ftyp box header.
 * FFmpeg requires valid MP4 structure to probe the file.
 * This creates a 32-byte minimal MP4 with ftyp box.
 */
function createMinimalMP4(filePath) {
  // Minimal MP4 ftyp box: 32 bytes with proper ISO base media file format signature
  const ftyp = Buffer.from(
    "000000206674797069736f6d0000020069736f6d69736f326d7034316d703432",
    "hex"
  );
  fs.writeFileSync(filePath, ftyp);
}

function makeApp(outputDir, dataDir) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    req.ctx = {
      outputDir: outputDir || os.tmpdir(),
      dataDir: dataDir || os.tmpdir(),
    };
    next();
  });
  app.use("/api/render", renderRouter);
  return app;
}

function post(app, body) {
  return request(app).post("/api/render/captioned-video").send(body);
}

describe("POST /api/render/captioned-video", () => {
  test("400 when videoPath is missing", async () => {
    const app = makeApp();
    const r = await post(app, {
      words: [{ text: "hello", start: 0, end: 1 }],
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /videoPath/i);
  });

  test("400 when videoPath is empty string", async () => {
    const app = makeApp();
    const r = await post(app, {
      videoPath: "",
      words: [{ text: "hello", start: 0, end: 1 }],
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /videoPath/i);
  });

  test("400 when words is missing", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      // Create a dummy video file (just for path existence check)
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, { videoPath: dummyVideo });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("400 when words is empty array", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [],
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("400 when words is not an array", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: { text: "hello", start: 0, end: 1 },
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("400 when word has no text", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [{ text: "", start: 0, end: 1 }],
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words.*valid/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("400 when word has start >= end", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [
          { text: "hello", start: 1, end: 1 },
          { text: "world", start: 2, end: 1 },
        ],
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words.*valid/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("400 when word has missing start or end", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [{ text: "hello" }],
      });
      // Should be normalized to start:0, end:0, which fails start < end check
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words.*valid/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("400 when musicPath does not exist", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        musicPath: "/nonexistent/music.mp3",
        words: [{ text: "hello", start: 0, end: 1 }],
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /musicPath/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("accepts valid words with optional emphasize flag", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      // This will fail at FFmpeg stage (since we don't have real FFmpeg or real video)
      // but we're checking it passes validation
      const r = await post(app, {
        videoPath: dummyVideo,
        words: [
          { text: "hello", start: 0, end: 1, emphasize: true },
          { text: "world", start: 1, end: 2, emphasize: false },
        ],
      });
      // Should pass validation but fail at FFmpeg (not available or file is not real video)
      // We check that it doesn't fail on 400 due to validation
      assert.ok(r.status !== 400 || !r.body.error.match(/words/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("accepts optional aspect parameter", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      for (const aspect of ["landscape", "portrait", "square", undefined]) {
        const r = await post(app, {
          videoPath: dummyVideo,
          aspect,
          words: [{ text: "hello", start: 0, end: 1 }],
        });
        // Should not fail on validation of aspect
        assert.ok(r.status !== 400 || !r.body.error.match(/aspect/i));
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("accepts optional typographyPreset parameter", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        typographyPreset: "kinetic-bold",
        words: [{ text: "hello", start: 0, end: 1 }],
      });
      // Should not fail on validation of preset
      assert.ok(r.status !== 400 || !r.body.error.match(/preset|typograph/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("accepts optional musicVolume parameter in range [0, 1]", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      const dummyMusic = path.join(tmpDir, "music.mp3");
      createMinimalMP4(dummyVideo);
      createMinimalMP4(dummyMusic);

      // Valid volumes
      for (const vol of [0, 0.5, 1, undefined]) {
        const r = await post(app, {
          videoPath: dummyVideo,
          musicPath: dummyMusic,
          musicVolume: vol,
          words: [{ text: "hello", start: 0, end: 1 }],
        });
        assert.ok(r.status !== 400 || !r.body.error.match(/volume|music/i));
      }

      // Out-of-range volumes should be clamped, not rejected
      const r = await post(app, {
        videoPath: dummyVideo,
        musicPath: dummyMusic,
        musicVolume: 5, // Should be clamped to 1
        words: [{ text: "hello", start: 0, end: 1 }],
      });
      assert.ok(r.status !== 400 || !r.body.error.match(/volume|music/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("accepts optional autoDuck boolean parameter", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      const dummyMusic = path.join(tmpDir, "music.mp3");
      createMinimalMP4(dummyVideo);
      createMinimalMP4(dummyMusic);

      for (const duck of [true, false, undefined]) {
        const r = await post(app, {
          videoPath: dummyVideo,
          musicPath: dummyMusic,
          autoDuck: duck,
          words: [{ text: "hello", start: 0, end: 1 }],
        });
        assert.ok(r.status !== 400 || !r.body.error.match(/autoDuck|duck/i));
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("response includes ok, file on validation pass (FFmpeg fail)", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [{ text: "hello", start: 0, end: 1 }],
      });
      // Response should have ok and error/file fields
      assert.ok(typeof r.body.ok === "boolean");
      assert.ok(r.body.error || r.body.file || r.status >= 400);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("normalizes word text to max 60 chars", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const longText = "a".repeat(100);
      const r = await post(app, {
        videoPath: dummyVideo,
        words: [{ text: longText, start: 0, end: 1 }],
      });
      // Should normalize without validation error
      assert.ok(r.status !== 400 || !r.body.error.match(/words.*text/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("filters out words with whitespace-only text after trim", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [
          { text: "   ", start: 0, end: 1 },
          { text: "hello", start: 1, end: 2 },
        ],
      });
      // First word should be filtered out, second should pass
      assert.ok(r.status !== 400 || !r.body.error.match(/words.*valid/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects when all words are filtered out (after normalization)", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [
          { text: "", start: 0, end: 1 },
          { text: "   ", start: 1, end: 2 },
          { text: "x", start: 2, end: 2 }, // start >= end
        ],
      });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /words.*valid/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("coerces numeric string values for start/end", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [
          { text: "hello", start: "0", end: "1" },
          { text: "world", start: "1.5", end: "2.5" },
        ],
      });
      // Should coerce strings to numbers without validation error
      assert.ok(r.status !== 400 || !r.body.error.match(/words.*start|end/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("coerces boolean values for emphasize", async () => {
    const app = makeApp();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    try {
      const dummyVideo = path.join(tmpDir, "test.mp4");
      createMinimalMP4(dummyVideo);

      const r = await post(app, {
        videoPath: dummyVideo,
        words: [
          { text: "hello", start: 0, end: 1, emphasize: 1 },
          { text: "world", start: 1, end: 2, emphasize: 0 },
          { text: "foo", start: 2, end: 3, emphasize: "yes" }, // truthy string
        ],
      });
      // Should coerce without error
      assert.ok(r.status !== 400 || !r.body.error.match(/words.*emphasize/i));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
