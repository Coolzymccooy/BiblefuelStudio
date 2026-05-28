# Sermon Clip Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload a sermon (audio or video), auto-transcribe it with word-level timestamps, render kinetic-typography captions over the original video or a chosen background, and mix in an optional music bed with auto-ducking.

**Architecture:** Reuse what already exists — the Whisper integration at [server/src/lib/voice/alignment.js](../../../server/src/lib/voice/alignment.js), the kinetic typography filters at [server/src/lib/videoFilters.js](../../../server/src/lib/videoFilters.js), the `musicPath / autoDuck` sidechaincompress chain in [server/src/routes/jobs.js](../../../server/src/routes/jobs.js), and the existing [client/src/pages/TimelinePage.tsx](../../../client/src/pages/TimelinePage.tsx) shell. Add three things only: (1) a transcription entry point that takes user-uploaded media (with video→audio extraction + chunking for long sermons), (2) a render route that treats user video as the primary visual instead of a looped background, (3) UI for source media + captions + music on TimelinePage.

**Tech Stack:** Node 20 + Express server (ESM), `node:test` + `node:assert/strict` for tests, supertest for HTTP roundtrips, FFmpeg + ffprobe shelled out via `child_process.spawn`, OpenAI Whisper REST API for STT, React + TypeScript + lucide-react on the client, `api.post / api.get` from `client/src/lib/api.ts`.

**Spec:** [docs/superpowers/specs/2026-05-28-sermon-clip-studio-review.md](../specs/2026-05-28-sermon-clip-studio-review.md)

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `server/src/lib/transcode.js` | **Create** | `extractAudioToMp3(videoPath, outDir)` — strip a video's audio to MP3 for transcription. Pure shell-out around FFmpeg; no Whisper, no captions. |
| `server/test/lib/transcode.test.js` | **Create** | Unit + integration tests for `extractAudioToMp3`. |
| `server/src/lib/voice/alignment.js` | **Modify** | Add `transcribeAudio(audioPath)` returning `{ words: [{ text, startMs, endMs }] }`. Add `chunkAudioForTranscription(audioPath, outDir)` returning `[{ path, offsetMs }]` for files >24 MB. |
| `server/test/voice/alignment.test.js` | **Modify** | Add tests for `transcribeAudio` and the chunk stitcher. |
| `server/src/routes/media.js` | **Modify** | Add `POST /upload-source-video` route — accepts mp4/mov/webm, **preserves video tracks** (the existing `/upload-audio` strips video with `-vn`). |
| `server/src/routes/transcribe.js` | **Create** | `POST /api/transcribe` — body `{ mediaPath }`. Extracts audio if video, calls Whisper (chunked if needed), returns normalised words. |
| `server/test/routes/transcribe.test.js` | **Create** | Route tests with the Whisper fetch stubbed. |
| `server/index.js` | **Modify** | Mount the transcribe router. |
| `server/src/routes/render.js` | **Modify** | Add `POST /api/render/captioned-video` — primary video input (no loop), duration from the input, kinetic captions burned via existing `buildSceneGraph`. |
| `client/src/pages/TimelinePage.tsx` | **Modify** | Add "Source Media" card (upload audio/video), "Transcribe & Caption" action, editable line list, music bed slot with auto-duck toggle, "Render Captioned Video" action. |
| `client/src/lib/api.ts` | **Modify (if needed)** | Add typed wrappers `uploadSourceVideo`, `transcribe`, `renderCaptionedVideo` if the existing `api.post` shape isn't sufficient. |

---

## Task 1: Audio extraction helper

**Why first:** Both the transcribe route and the captioned-video render need to derive audio from a user-uploaded video. Extract it once, in a tested unit.

**Files:**
- Create: `server/src/lib/transcode.js`
- Test: `server/test/lib/transcode.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/lib/transcode.test.js`:

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { extractAudioToMp3 } from "../../src/lib/transcode.js";

function ffmpegAvailable() {
  const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

describe("extractAudioToMp3", () => {
  test("returns a path ending in .mp3 inside outDir", async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg not available");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcode-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    // Synthesise a 1s silent webm so the test doesn't require fixtures.
    const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const src = path.join(outDir, "src.webm");
    spawnSync(bin, [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
      "-f", "lavfi", "-i", "color=size=64x64:rate=10:color=black",
      "-t", "1", "-c:v", "libvpx", "-c:a", "libvorbis", src,
    ], { stdio: "ignore" });

    const result = await extractAudioToMp3(src, outDir);
    assert.match(result, /\.mp3$/);
    assert.ok(fs.existsSync(result), "extracted mp3 should exist");
    assert.ok(fs.statSync(result).size > 0, "extracted mp3 should be non-empty");
  });

  test("rejects when source does not exist", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcode-"));
    try {
      await assert.rejects(
        () => extractAudioToMp3(path.join(outDir, "missing.webm"), outDir),
        /not found|ENOENT/i,
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd server && npm test -- --test-name-pattern="extractAudioToMp3"
```

Expected: FAIL with `Cannot find module '../../src/lib/transcode.js'`.

- [ ] **Step 3: Implement the helper**

Create `server/src/lib/transcode.js`:

```javascript
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";

/**
 * Extract the audio track of a video (or re-encode a non-MP3 audio file) to
 * MP3 at 22.05 kHz mono — small enough for Whisper, lossy enough that long
 * sermons stay under the 25 MB API limit.
 *
 * Resolves to the absolute path of the new MP3. Rejects if the source is
 * missing or FFmpeg exits non-zero.
 *
 * @param {string} sourcePath  Absolute path to an audio or video file.
 * @param {string} outDir      Directory where the MP3 will be written.
 * @returns {Promise<string>}
 */
export async function extractAudioToMp3(sourcePath, outDir) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`source not found: ${sourcePath}`);
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const outFile = path.join(outDir, `extract-${uuid()}.mp3`);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      "-y", "-i", sourcePath,
      "-vn",
      "-ac", "1",
      "-ar", "22050",
      "-b:a", "64k",
      outFile,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });

  return outFile;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd server && npm test -- --test-name-pattern="extractAudioToMp3"
```

Expected: 2 tests pass (or 1 pass + 1 skip if FFmpeg isn't on PATH).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/transcode.js server/test/lib/transcode.test.js
git commit -m "feat(transcribe): add extractAudioToMp3 helper for Sermon Clip Studio"
```

---

## Task 2: Transcribe audio via Whisper

**Files:**
- Modify: `server/src/lib/voice/alignment.js`
- Test: `server/test/voice/alignment.test.js`

The existing `alignAudioWithText(audioPath, _text)` already calls Whisper and returns a **char-level** alignment. The new `transcribeAudio` reuses that fetch logic but returns the **word-level** contract used by the captions pipeline. We keep them as separate functions so the existing TTS-alignment path stays byte-for-byte unchanged.

- [ ] **Step 1: Write the failing test**

Append to `server/test/voice/alignment.test.js` (or create if it doesn't yet test the alignment module — verify with `Grep` first):

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { transcribeAudio } from "../../src/lib/voice/alignment.js";

describe("transcribeAudio", () => {
  test("returns null when OPENAI_API_KEY is absent", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await transcribeAudio("/nonexistent.mp3");
      assert.equal(result, null);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  test("maps Whisper words to { text, startMs, endMs } when fetch is stubbed", async (t) => {
    process.env.OPENAI_API_KEY = "sk-test";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    const audioPath = path.join(dir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.from("not-real-mp3-bytes"));
    t.after(() => {
      delete process.env.OPENAI_API_KEY;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        words: [
          { word: "Grace", start: 0.0, end: 0.42 },
          { word: "abounds", start: 0.42, end: 1.10 },
        ],
      }),
    });

    const result = await transcribeAudio(audioPath, { _fetchImpl: fakeFetch });
    assert.deepEqual(result, {
      words: [
        { text: "Grace", startMs: 0, endMs: 420 },
        { text: "abounds", startMs: 420, endMs: 1100 },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd server && npm test -- --test-name-pattern="transcribeAudio"
```

Expected: FAIL with `transcribeAudio is not a function` (or import error).

- [ ] **Step 3: Implement `transcribeAudio`**

Append to `server/src/lib/voice/alignment.js`:

```javascript
/**
 * Public transcription entry point. Same Whisper call as `alignAudioWithText`,
 * but returns the normalised word contract used by captions/render
 * (`{ words: [{ text, startMs, endMs }] }`) instead of the char-level
 * forced-alignment shape.
 *
 * Returns null when OPENAI_API_KEY is unset or Whisper returns no words —
 * callers must treat null as "transcription unavailable", never as an error.
 *
 * `_fetchImpl` is a unit-test seam; in production it falls back to the
 * runtime's `fetch`.
 *
 * @param {string} audioPath
 * @param {{ _fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ words: Array<{ text: string, startMs: number, endMs: number }> } | null>}
 */
export async function transcribeAudio(audioPath, options = {}) {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) return null;

  const fetchImpl = options._fetchImpl || fetch;

  if (!audioPath || !fs.existsSync(audioPath)) {
    console.warn(`[transcribe] audio file not found: ${audioPath}`);
    return null;
  }

  try {
    const bytes = fs.readFileSync(audioPath);
    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.set(
      "file",
      new File([bytes], path.basename(audioPath), { type: mimeFromPath(audioPath) }),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetchImpl(WHISPER_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text?.().catch?.(() => "") || "";
      console.warn(`[transcribe] whisper error ${resp.status}: ${String(errText).slice(0, 200)}`);
      return null;
    }

    const payload = await resp.json();
    const raw = Array.isArray(payload?.words) ? payload.words : [];
    if (raw.length === 0) return null;

    const words = raw
      .map((w) => ({
        text: String(w?.word ?? "").trim(),
        startMs: Math.round(Number(w?.start ?? 0) * 1000),
        endMs: Math.round(Number(w?.end ?? 0) * 1000),
      }))
      .filter((w) => w.text && Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs > w.startMs);

    return words.length ? { words } : null;
  } catch (err) {
    console.warn(`[transcribe] failed: ${err?.message || err}`);
    return null;
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd server && npm test -- --test-name-pattern="transcribeAudio"
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/voice/alignment.js server/test/voice/alignment.test.js
git commit -m "feat(transcribe): add transcribeAudio with normalised word contract"
```

---

## Task 3: Chunk long audio for Whisper

Whisper's REST API rejects uploads over 25 MB. At our 22.05 kHz mono / 64 kbps MP3 setting that's ~52 minutes per chunk; comfortable headroom is 40 minutes per chunk. We split on 40-min boundaries and offset the returned word timings.

**Files:**
- Modify: `server/src/lib/voice/alignment.js`
- Test: `server/test/voice/alignment.test.js`

- [ ] **Step 1: Write the failing test**

Append to `server/test/voice/alignment.test.js`:

```javascript
import { stitchTranscriptions, CHUNK_DURATION_MS } from "../../src/lib/voice/alignment.js";

describe("stitchTranscriptions", () => {
  test("offsets word timings by chunk start and concatenates", () => {
    const chunks = [
      { offsetMs: 0,    transcription: { words: [{ text: "Grace",   startMs:   0, endMs: 400 }] } },
      { offsetMs: 60_000, transcription: { words: [{ text: "abounds", startMs: 100, endMs: 500 }] } },
    ];
    const stitched = stitchTranscriptions(chunks);
    assert.deepEqual(stitched.words, [
      { text: "Grace",   startMs:        0, endMs:      400 },
      { text: "abounds", startMs:   60_100, endMs:   60_500 },
    ]);
  });

  test("skips chunks with null transcription (whisper failure)", () => {
    const chunks = [
      { offsetMs: 0,    transcription: { words: [{ text: "Hi", startMs: 0, endMs: 100 }] } },
      { offsetMs: 1000, transcription: null },
    ];
    const stitched = stitchTranscriptions(chunks);
    assert.equal(stitched.words.length, 1);
  });

  test("CHUNK_DURATION_MS leaves headroom under Whisper 25MB limit", () => {
    // 40 minutes at 64 kbps mono = ~19.2 MB. Sanity-check the constant.
    assert.ok(CHUNK_DURATION_MS <= 40 * 60 * 1000, "chunk must be ≤ 40 minutes");
    assert.ok(CHUNK_DURATION_MS >= 5 * 60 * 1000, "chunk must be at least 5 minutes");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd server && npm test -- --test-name-pattern="stitchTranscriptions"
```

Expected: FAIL — exports don't exist.

- [ ] **Step 3: Implement chunking + stitching**

Append to `server/src/lib/voice/alignment.js`:

```javascript
import { spawn } from "child_process";

export const CHUNK_DURATION_MS = 40 * 60 * 1000;

/**
 * Split an audio file into ≤CHUNK_DURATION_MS chunks. Returns the list of
 * { path, offsetMs }, suitable for parallel transcription + stitching.
 *
 * Files at or below the chunk threshold are returned as a single entry with
 * offsetMs=0 so callers don't need to special-case short sermons.
 *
 * @param {string} audioPath
 * @param {string} outDir
 * @param {number} durationMs   Actual duration of the source (caller probes it).
 * @returns {Promise<Array<{ path: string, offsetMs: number }>>}
 */
export async function chunkAudioForTranscription(audioPath, outDir, durationMs) {
  if (durationMs <= CHUNK_DURATION_MS) {
    return [{ path: audioPath, offsetMs: 0 }];
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const chunkSec = CHUNK_DURATION_MS / 1000;
  const base = path.basename(audioPath, path.extname(audioPath));
  const pattern = path.join(outDir, `${base}-chunk-%03d.mp3`);

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      "-y", "-i", audioPath,
      "-f", "segment",
      "-segment_time", String(chunkSec),
      "-c", "copy",
      pattern,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg segment exited ${code}: ${stderr.slice(-400)}`)));
  });

  return fs.readdirSync(outDir)
    .filter((name) => name.startsWith(`${base}-chunk-`) && name.endsWith(".mp3"))
    .sort()
    .map((name, idx) => ({
      path: path.join(outDir, name),
      offsetMs: idx * CHUNK_DURATION_MS,
    }));
}

/**
 * Stitch the per-chunk transcription results back together, offsetting each
 * word by its chunk's start time.
 *
 * @param {Array<{ offsetMs: number, transcription: { words: Array<{ text: string, startMs: number, endMs: number }> } | null }>} chunks
 * @returns {{ words: Array<{ text: string, startMs: number, endMs: number }> }}
 */
export function stitchTranscriptions(chunks) {
  const words = [];
  for (const c of chunks) {
    if (!c?.transcription?.words) continue;
    for (const w of c.transcription.words) {
      words.push({
        text: w.text,
        startMs: w.startMs + c.offsetMs,
        endMs: w.endMs + c.offsetMs,
      });
    }
  }
  return { words };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd server && npm test -- --test-name-pattern="stitchTranscriptions"
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/voice/alignment.js server/test/voice/alignment.test.js
git commit -m "feat(transcribe): chunk long audio + stitch word timings"
```

---

## Task 4: Upload-source-video route

The existing `POST /upload-audio` always strips video tracks (`-vn`) and re-encodes to MP3. Sermon Clip Studio's video-overlay mode needs the original video preserved.

**Files:**
- Modify: `server/src/routes/media.js`
- Test: `server/test/routes/media.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/routes/media.test.js`:

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import mediaRouter from "../../src/routes/media.js";

function tinyMp4Base64() {
  // Minimal valid MP4 ftyp box — 32 bytes. Whisper isn't invoked here; this
  // just needs to pass the ≥128 byte length gate so we know the route is wired.
  const ftyp = Buffer.concat([
    Buffer.alloc(4, 0), Buffer.from("ftypisom"), Buffer.alloc(8, 0),
    Buffer.from("isomiso2avc1mp41"), Buffer.alloc(96, 0),
  ]);
  ftyp.writeUInt32BE(ftyp.length, 0);
  return `data:video/mp4;base64,${ftyp.toString("base64")}`;
}

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/media", mediaRouter);
  return app;
}

describe("POST /api/media/upload-source-video", () => {
  test("writes the bytes verbatim (no audio strip) and returns the file path", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const app = makeApp(outDir);
    const res = await request(app)
      .post("/api/media/upload-source-video")
      .send({ dataUrl: tinyMp4Base64(), filename: "sermon.mp4" });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.file, /\.mp4$/);
    assert.ok(fs.existsSync(res.body.file));
  });

  test("rejects empty / undersized payloads", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const app = makeApp(outDir);
    const res = await request(app)
      .post("/api/media/upload-source-video")
      .send({ dataUrl: "data:video/mp4;base64,AAAA" });

    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd server && npm test -- --test-name-pattern="upload-source-video"
```

Expected: FAIL — 404 from the route, no handler registered.

- [ ] **Step 3: Implement the route**

In `server/src/routes/media.js`, **above** the trailing `export default router;`, add:

```javascript
const videoMimeToExt = (mime, hint) => {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("webm")) return "webm";
  return videoExtensions.has(`.${hint}`) ? hint : "mp4";
};

router.post("/upload-source-video", async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || "");
    const fileNameHint = String(req.body?.filename || "").trim();
    const parsed = parseDataUrlPayload(dataUrl);
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error || "Invalid dataUrl" });

    const decoded = Buffer.from(parsed.b64 || "", "base64");
    if (!decoded.length || decoded.length < 128) {
      return res.status(400).json({ ok: false, error: "Video payload is empty or too small" });
    }

    const extHint = fileNameHint ? path.extname(fileNameHint).replace(".", "").toLowerCase() : "";
    const ext = videoMimeToExt(parsed.mime, extHint);

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `source-video-${uuid()}.${ext}`);
    fs.writeFileSync(outFile, decoded);

    return res.json({ ok: true, file: outFile.replace(/\\/g, "/"), mime: parsed.mime || `video/${ext}` });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd server && npm test -- --test-name-pattern="upload-source-video"
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/media.js server/test/routes/media.test.js
git commit -m "feat(media): add upload-source-video route preserving original tracks"
```

---

## Task 5: Transcribe route

Wires the helpers from Tasks 1-3 into a single endpoint.

**Files:**
- Create: `server/src/routes/transcribe.js`
- Create: `server/test/routes/transcribe.test.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/routes/transcribe.test.js`:

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";

// We stub the alignment module so the route test never hits Whisper.
import { mock } from "node:test";
import * as alignment from "../../src/lib/voice/alignment.js";
import transcribeRouter from "../../src/routes/transcribe.js";

function makeApp(outDir) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/transcribe", transcribeRouter);
  return app;
}

describe("POST /api/transcribe", () => {
  test("returns 400 when mediaPath is missing", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir)).post("/").send({});
    assert.equal(res.status, 400);
  });

  test("returns words contract when transcribeAudio resolves", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    const audioPath = path.join(outDir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const stub = mock.method(alignment, "transcribeAudio", async () => ({
      words: [{ text: "Grace", startMs: 0, endMs: 400 }],
    }));
    t.after(() => stub.mock.restore());

    const res = await request(makeApp(outDir)).post("/").send({ mediaPath: audioPath });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.words, [{ text: "Grace", startMs: 0, endMs: 400 }]);
  });

  test("returns 502 when transcribeAudio returns null", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tx-"));
    const audioPath = path.join(outDir, "fake.mp3");
    fs.writeFileSync(audioPath, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const stub = mock.method(alignment, "transcribeAudio", async () => null);
    t.after(() => stub.mock.restore());

    const res = await request(makeApp(outDir)).post("/").send({ mediaPath: audioPath });
    assert.equal(res.status, 502);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd server && npm test -- --test-name-pattern="POST /api/transcribe"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `server/src/routes/transcribe.js`:

```javascript
import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { extractAudioToMp3 } from "../lib/transcode.js";
import {
  transcribeAudio,
  chunkAudioForTranscription,
  stitchTranscriptions,
  CHUNK_DURATION_MS,
} from "../lib/voice/alignment.js";

const router = Router();
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200);

function isFileTooLarge(p) {
  try { return fs.statSync(p).size > MAX_INPUT_MB * 1024 * 1024; } catch { return false; }
}

function probeDurationMs(filePath) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const sec = Number(String(out).trim());
      resolve(Number.isFinite(sec) ? Math.round(sec * 1000) : null);
    });
  });
}

router.post("/", async (req, res) => {
  try {
    const mediaPath = String(req.body?.mediaPath || "").trim();
    if (!mediaPath) return res.status(400).json({ ok: false, error: "mediaPath is required" });
    if (!fs.existsSync(mediaPath)) return res.status(400).json({ ok: false, error: "mediaPath not found" });
    if (isFileTooLarge(mediaPath)) return res.status(400).json({ ok: false, error: `mediaPath too large (>${MAX_INPUT_MB}MB)` });

    const outDir = req.ctx.outputDir;
    const isVideo = videoExtensions.has(path.extname(mediaPath).toLowerCase());
    const audioPath = isVideo ? await extractAudioToMp3(mediaPath, outDir) : mediaPath;

    const durationMs = (await probeDurationMs(audioPath)) ?? 0;
    const chunks = await chunkAudioForTranscription(audioPath, outDir, durationMs);

    const transcribed = await Promise.all(
      chunks.map(async (c) => ({ offsetMs: c.offsetMs, transcription: await transcribeAudio(c.path) })),
    );
    const stitched = stitchTranscriptions(transcribed);

    if (!stitched.words.length) {
      return res.status(502).json({ ok: false, error: "Transcription returned no words (Whisper unavailable or audio silent)" });
    }

    return res.json({ ok: true, audioPath, durationMs, words: stitched.words });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
```

- [ ] **Step 4: Mount the router**

In `server/index.js`, find where the other routers are mounted (search for `app.use("/api/media"` or `app.use("/api/render"`) and add alongside them:

```javascript
import transcribeRouter from "./src/routes/transcribe.js";
// ... existing router imports ...

app.use("/api/transcribe", transcribeRouter);
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
cd server && npm test -- --test-name-pattern="POST /api/transcribe"
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/transcribe.js server/test/routes/transcribe.test.js server/index.js
git commit -m "feat(transcribe): add /api/transcribe route with video extraction + chunking"
```

---

## Task 6: Captioned-video render route

Sibling of `/api/render/video`. Differences from the existing route:

- Treats `videoPath` as the primary visual layer (no `-stream_loop`).
- Reads duration from the input video instead of the request body.
- Accepts a `words[]` array (already-aligned word timings from the transcribe step) and uses `buildSceneGraph` to drive kinetic captions.
- Same music-bed + auto-duck plumbing as the existing route.

**Files:**
- Modify: `server/src/routes/render.js`
- Test: `server/test/routes/render.captionedVideo.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `server/test/routes/render.captionedVideo.test.js`:

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import renderRouter from "../../src/routes/render.js";

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/render", renderRouter);
  return app;
}

describe("POST /api/render/captioned-video — validation", () => {
  test("rejects when videoPath is missing", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({ words: [{ text: "Hi", startMs: 0, endMs: 200 }] });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /videoPath/);
  });

  test("rejects when words[] is empty", async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const vid = path.join(outDir, "v.mp4");
    fs.writeFileSync(vid, Buffer.alloc(200, 0));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const res = await request(makeApp(outDir))
      .post("/api/render/captioned-video")
      .send({ videoPath: vid, words: [] });
    assert.equal(res.status, 400);
    assert.match(res.body.error || "", /words/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd server && npm test -- --test-name-pattern="captioned-video"
```

Expected: FAIL — 404 on the route.

- [ ] **Step 3: Implement the route**

In `server/src/routes/render.js`, **above** the trailing `export default router;`, add:

```javascript
router.post("/captioned-video", async (req, res) => {
  try {
    if (!ensureFfmpegAvailable()) {
      return res.status(500).json({ ok: false, error: "FFmpeg not available on server" });
    }

    const rawVideoPath = req.body?.videoPath;
    const rawMusicPath = req.body?.musicPath;
    const words = Array.isArray(req.body?.words) ? req.body.words : [];
    const typographyPreset = String(req.body?.typographyPreset || "default");
    const musicVolume = req.body?.musicVolume;
    const autoDuck = Boolean(req.body?.autoDuck);

    if (!rawVideoPath) {
      return res.status(400).json({ ok: false, error: "videoPath is required" });
    }
    if (!words.length) {
      return res.status(400).json({ ok: false, error: "words[] is required and must be non-empty" });
    }

    const videoPath = resolveAssetPath(req.ctx.dataDir, rawVideoPath);
    const musicPath = rawMusicPath ? resolveAssetPath(req.ctx.dataDir, rawMusicPath) : null;

    if (!videoPath || !isLocalOrRemote(videoPath)) {
      return res.status(400).json({ ok: false, error: `videoPath not found: ${rawVideoPath}` });
    }
    if (isFileTooLarge(videoPath)) {
      return res.status(400).json({ ok: false, error: `videoPath too large (>${MAX_INPUT_MB}MB)` });
    }
    if (musicPath && !isLocalOrRemote(musicPath)) {
      return res.status(400).json({ ok: false, error: `musicPath not found: ${rawMusicPath}` });
    }

    const durationSec = await probeAudioDuration(videoPath);
    if (!durationSec || durationSec <= 0) {
      return res.status(400).json({ ok: false, error: "Could not probe video duration" });
    }

    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `captioned-${uuid()}.mp4`);

    const sceneFilters = buildSceneGraph({ words, preset: typographyPreset });

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const args = ["-y", "-i", videoPath];
    if (musicPath) args.push("-i", musicPath);

    const musicVol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.25)));
    const vFilter = `[0:v]${sceneFilters}[vout]`;
    const aFilter = musicPath
      ? autoDuck
        ? `[0:a]volume=1.0[a1];[1:a]volume=${musicVol}[m1];[m1][a1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];[a1][ducked]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
        : `[0:a]volume=1.0[a1];[1:a]volume=${musicVol}[a2];[a1][a2]amix=inputs=2:duration=shortest:dropout_transition=2[aout]`
      : `[0:a]anull[aout]`;

    const preset = process.env.FFMPEG_PRESET || "fast";
    const hwaccel = process.env.FFMPEG_HWACCEL;
    const vcodec = hwaccel === "nvenc" ? "h264_nvenc" : hwaccel === "qsv" ? "h264_qsv" : "libx264";

    args.push(
      "-filter_complex", `${vFilter};${aFilter}`,
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", vcodec,
      "-preset", preset,
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-shortest",
      outFile,
    );

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, args);
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`)));
    });

    return res.json({ ok: true, file: outFile.replace(/\\/g, "/"), durationSec });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd server && npm test -- --test-name-pattern="captioned-video"
```

Expected: 2 validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/render.js server/test/routes/render.captionedVideo.test.js
git commit -m "feat(render): add captioned-video route with kinetic caption burn-in"
```

---

## Task 7: Client — Source Media card

Adds a new card at the top of `TimelinePage` that accepts a user-uploaded audio *or* video file and stores its server path in component state.

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Add state + handler at the top of `TimelinePage`**

In `client/src/pages/TimelinePage.tsx`, immediately after the existing `useState` block (around line 60), add:

```typescript
const [sourceMediaPath, setSourceMediaPath] = useState<string | null>(null);
const [sourceMediaKind, setSourceMediaKind] = useState<'audio' | 'video' | null>(null);
const [isUploading, setIsUploading] = useState(false);

const handleSourceUpload = async (file: File) => {
    const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    setIsUploading(true);
    try {
        const dataUrl: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });

        const endpoint = isVideo ? '/api/media/upload-source-video' : '/api/media/upload-audio';
        const response = await api.post(endpoint, { dataUrl, filename: file.name });
        if (!response.ok || !response.data?.file) {
            toast.error(response.error || 'Upload failed');
            return;
        }
        setSourceMediaPath(response.data.file);
        setSourceMediaKind(isVideo ? 'video' : 'audio');
        toast.success(`${isVideo ? 'Video' : 'Audio'} uploaded`);
    } catch (err) {
        toast.error('Upload failed');
    } finally {
        setIsUploading(false);
    }
};
```

- [ ] **Step 2: Render the Source Media card**

Inside the existing JSX return, immediately above the existing `<Card title="Rendered Audio">` block (around line 220), insert:

```tsx
<Card title="Source Media">
    <p className="text-xs text-gray-400 mb-3">
        Upload an audio sermon (mp3, wav, m4a) or a recorded video (mp4, mov, webm).
    </p>
    <label className="inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-primary-500/10 border border-primary-500/30 text-primary-200 cursor-pointer hover:bg-primary-500/20">
        <Film size={16} />
        <span className="text-sm">{isUploading ? 'Uploading...' : 'Choose file'}</span>
        <input
            type="file"
            className="hidden"
            accept=".mp3,.wav,.m4a,.mp4,.mov,.webm,.m4v"
            disabled={isUploading}
            onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSourceUpload(f);
            }}
        />
    </label>
    {sourceMediaPath && (
        <div className="mt-3 text-xs text-gray-300">
            <span className="text-gray-500">Loaded ({sourceMediaKind}):</span>{' '}
            <span className="font-mono break-all">{sourceMediaPath.split(/[\\/]/).pop()}</span>
        </div>
    )}
</Card>
```

- [ ] **Step 3: Verify the build still compiles**

```bash
cd client && npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TimelinePage.tsx
git commit -m "feat(ui): add Source Media card to TimelinePage"
```

---

## Task 8: Client — Transcribe & Caption flow

Calls `/api/transcribe`, stores the returned words, and renders an editable line list. Each "line" is a contiguous run of words; users can edit text without losing timing data because we keep the original word array and only re-derive lines on demand.

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Add transcription state and helpers**

Just after the source-media state from Task 7, add:

```typescript
interface TranscriptWord {
    text: string;
    startMs: number;
    endMs: number;
}

const [transcript, setTranscript] = useState<TranscriptWord[] | null>(null);
const [isTranscribing, setIsTranscribing] = useState(false);
const [editedLines, setEditedLines] = useState<string[]>([]);

const handleTranscribe = async () => {
    if (!sourceMediaPath) {
        toast.error('Upload a sermon first');
        return;
    }
    setIsTranscribing(true);
    const toastId = toast.loading('Transcribing — this can take a minute...');
    try {
        const response = await api.post('/api/transcribe', { mediaPath: sourceMediaPath });
        if (!response.ok || !Array.isArray(response.data?.words)) {
            toast.error(response.error || 'Transcription failed', { id: toastId });
            return;
        }
        const words: TranscriptWord[] = response.data.words;
        setTranscript(words);
        setEditedLines(groupWordsIntoLines(words, 8));
        toast.success(`Transcribed ${words.length} words`, { id: toastId });
    } catch (err) {
        toast.error('Transcription failed', { id: toastId });
    } finally {
        setIsTranscribing(false);
    }
};

function groupWordsIntoLines(words: TranscriptWord[], wordsPerLine: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerLine) {
        out.push(words.slice(i, i + wordsPerLine).map((w) => w.text).join(' '));
    }
    return out;
}
```

- [ ] **Step 2: Render the action and editable lines**

Below the Source Media card from Task 7, insert:

```tsx
<Card title="Transcribe & Caption">
    <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-xs text-gray-400">
            Pull a word-level transcript with timings, then edit the lines below.
        </p>
        <Button
            variant="secondary"
            onClick={handleTranscribe}
            disabled={!sourceMediaPath || isTranscribing}
            className="h-9 text-xs"
        >
            <Waves size={14} className="mr-2" />
            {isTranscribing ? 'Transcribing...' : 'Transcribe'}
        </Button>
    </div>
    {editedLines.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
            {editedLines.map((line, idx) => (
                <input
                    key={idx}
                    type="text"
                    value={line}
                    onChange={(e) => {
                        const next = [...editedLines];
                        next[idx] = e.target.value;
                        setEditedLines(next);
                    }}
                    className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-primary-500/40 focus:outline-none"
                />
            ))}
        </div>
    )}
</Card>
```

- [ ] **Step 3: Verify the build**

```bash
cd client && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TimelinePage.tsx
git commit -m "feat(ui): add Transcribe & Caption action with editable line list"
```

---

## Task 9: Client — Music bed slot with auto-duck

Mirrors the server's existing `musicPath` / `musicVolume` / `autoDuck` parameters. No new server work — just expose what's already there.

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Add music state**

After the transcription state from Task 8, add:

```typescript
const [musicPath, setMusicPath] = useState<string | null>(null);
const [musicVolume, setMusicVolume] = useState(0.25);
const [autoDuck, setAutoDuck] = useState(true);

const handleMusicUpload = async (file: File) => {
    setIsUploading(true);
    try {
        const dataUrl: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
        const response = await api.post('/api/media/upload-audio', { dataUrl, filename: file.name });
        if (!response.ok || !response.data?.file) {
            toast.error(response.error || 'Music upload failed');
            return;
        }
        setMusicPath(response.data.file);
        toast.success('Music uploaded');
    } catch {
        toast.error('Music upload failed');
    } finally {
        setIsUploading(false);
    }
};
```

- [ ] **Step 2: Render the Music Bed card**

Below the Transcribe & Caption card from Task 8, insert:

```tsx
<Card title="Music Bed">
    <div className="space-y-4">
        <label className="inline-flex items-center gap-3 px-4 py-2 rounded-lg bg-primary-500/10 border border-primary-500/30 text-primary-200 cursor-pointer hover:bg-primary-500/20">
            <Music size={16} />
            <span className="text-sm">{musicPath ? 'Replace music' : 'Choose music file'}</span>
            <input
                type="file"
                className="hidden"
                accept=".mp3,.wav,.m4a"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleMusicUpload(f);
                }}
            />
        </label>
        {musicPath && (
            <p className="text-xs text-gray-300 font-mono break-all">
                {musicPath.split(/[\\/]/).pop()}
            </p>
        )}
        <div>
            <label className="block text-xs text-gray-400 mb-1">
                Music volume: {Math.round(musicVolume * 100)}%
            </label>
            <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={musicVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))}
                className="w-full"
            />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
                type="checkbox"
                checked={autoDuck}
                onChange={(e) => setAutoDuck(e.target.checked)}
            />
            Auto-duck music under speech (sidechain compression)
        </label>
    </div>
</Card>
```

- [ ] **Step 3: Verify the build**

```bash
cd client && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TimelinePage.tsx
git commit -m "feat(ui): add Music Bed card with volume + auto-duck"
```

---

## Task 10: Client — Render captioned video

Re-derives words from the (possibly edited) lines and calls `/api/render/captioned-video`. If lines were edited we re-distribute the original word timings proportionally so timings stay continuous — perfect alignment is sacrificed for editability, which is the right trade for sermon recaptioning.

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Add render handler**

After the music handlers from Task 9:

```typescript
const [renderedVideo, setRenderedVideo] = useState<string | null>(null);
const [isRenderingVideo, setIsRenderingVideo] = useState(false);
const [typographyPreset, setTypographyPreset] = useState<string>('default');

function reflowWordsFromEditedLines(
    originalWords: TranscriptWord[],
    lines: string[],
): TranscriptWord[] {
    const lineWords = lines.flatMap((l) => l.split(/\s+/).filter(Boolean));
    if (!originalWords.length || !lineWords.length) return [];

    const totalStart = originalWords[0].startMs;
    const totalEnd = originalWords[originalWords.length - 1].endMs;
    const span = Math.max(1, totalEnd - totalStart);
    const step = span / lineWords.length;

    return lineWords.map((text, idx) => ({
        text,
        startMs: Math.round(totalStart + idx * step),
        endMs: Math.round(totalStart + (idx + 1) * step),
    }));
}

const handleRenderCaptionedVideo = async () => {
    if (!sourceMediaPath || sourceMediaKind !== 'video') {
        toast.error('Captioned video render requires an uploaded video source');
        return;
    }
    if (!transcript || !transcript.length) {
        toast.error('Transcribe the sermon first');
        return;
    }

    const words = reflowWordsFromEditedLines(transcript, editedLines);
    setIsRenderingVideo(true);
    const toastId = toast.loading('Rendering captioned video...');
    try {
        const response = await api.post('/api/render/captioned-video', {
            videoPath: sourceMediaPath,
            words,
            typographyPreset,
            musicPath: musicPath || undefined,
            musicVolume,
            autoDuck,
        });
        if (response.ok && response.data?.file) {
            const fileName = response.data.file.split(/[\\/]/).pop();
            setRenderedVideo(`${api.baseUrl}/outputs/${fileName}`);
            toast.success('Captioned video ready', { id: toastId });
        } else {
            toast.error(response.error || 'Render failed', { id: toastId });
        }
    } catch {
        toast.error('Render failed', { id: toastId });
    } finally {
        setIsRenderingVideo(false);
    }
};
```

- [ ] **Step 1b: Add typography preset picker**

Add this import at the top of `client/src/pages/TimelinePage.tsx` (alongside the other imports):

```typescript
import { AnimationPicker } from '../components/voicelab/AnimationPicker';
```

And render it inside the Transcribe & Caption card from Task 8, immediately above the `editedLines.length > 0 && (...)` block:

```tsx
<div className="mb-4">
    <p className="text-xs text-gray-400 mb-2">Kinetic typography style</p>
    <AnimationPicker value={typographyPreset} onChange={setTypographyPreset} />
</div>
```

If `AnimationPicker`'s prop names differ (open the component to confirm), adapt to match — the existing component is the source of truth.

- [ ] **Step 2: Add the render button + preview**

In the existing header action row (where `<Button onClick={handleRender}>Render Audio</Button>` lives, around line 213), add a sibling button:

```tsx
<Button
    onClick={handleRenderCaptionedVideo}
    disabled={isRenderingVideo || !sourceMediaPath || sourceMediaKind !== 'video' || !transcript}
    className="w-full sm:w-auto"
>
    <Film size={16} className="mr-2" />
    {isRenderingVideo ? 'Rendering...' : 'Render Captioned Video'}
</Button>
```

And below the existing "Rendered Audio" card, add a "Rendered Video" card:

```tsx
{renderedVideo && (
    <Card title="Rendered Captioned Video">
        <video controls src={renderedVideo} className="w-full rounded-lg" />
        <Button
            variant="secondary"
            onClick={() => window.open(renderedVideo, '_blank')}
            className="text-xs h-9 mt-3"
        >
            <Download size={16} className="mr-2" />
            Open
        </Button>
    </Card>
)}
```

- [ ] **Step 3: Verify the build**

```bash
cd client && npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TimelinePage.tsx
git commit -m "feat(ui): wire Render Captioned Video action on TimelinePage"
```

---

## Task 11: End-to-end smoke test

A single Node test that drives the whole pipeline against the real server with Whisper stubbed, so a future regression in any one piece surfaces here even if the unit tests still pass.

**Files:**
- Create: `server/test/routes/sermonClipStudio.smoke.test.js`

- [ ] **Step 1: Write the smoke test**

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import express from "express";
import request from "supertest";
import { mock } from "node:test";
import mediaRouter from "../../src/routes/media.js";
import transcribeRouter from "../../src/routes/transcribe.js";
import renderRouter from "../../src/routes/render.js";
import * as alignment from "../../src/lib/voice/alignment.js";

function ffmpegAvailable() {
  try { return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0; }
  catch { return false; }
}

function makeApp(outDir) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => { req.ctx = { outputDir: outDir, dataDir: outDir }; next(); });
  app.use("/api/media", mediaRouter);
  app.use("/api/transcribe", transcribeRouter);
  app.use("/api/render", renderRouter);
  return app;
}

describe("Sermon Clip Studio — end-to-end (Whisper stubbed)", () => {
  test("upload video → transcribe → render captioned video", async (t) => {
    if (!ffmpegAvailable()) return t.skip("ffmpeg not available");

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "scs-"));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));

    // 1. Synthesise a 2s test video with silent audio.
    const fixture = path.join(outDir, "fixture.mp4");
    const r = spawnSync("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=size=320x180:rate=10:color=black",
      "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono",
      "-t", "2", "-pix_fmt", "yuv420p", fixture,
    ], { stdio: "ignore" });
    assert.equal(r.status, 0, "fixture generation must succeed");

    // 2. Upload as a source video.
    const app = makeApp(outDir);
    const dataUrl = `data:video/mp4;base64,${fs.readFileSync(fixture).toString("base64")}`;
    const upload = await request(app)
      .post("/api/media/upload-source-video")
      .send({ dataUrl, filename: "fixture.mp4" });
    assert.equal(upload.status, 200);

    // 3. Stub Whisper, run transcribe.
    const stub = mock.method(alignment, "transcribeAudio", async () => ({
      words: [
        { text: "Test", startMs: 0,   endMs: 500 },
        { text: "verse", startMs: 500, endMs: 1500 },
      ],
    }));
    t.after(() => stub.mock.restore());

    const tx = await request(app).post("/api/transcribe").send({ mediaPath: upload.body.file });
    assert.equal(tx.status, 200, JSON.stringify(tx.body));
    assert.ok(Array.isArray(tx.body.words) && tx.body.words.length > 0);

    // 4. Render captioned video.
    const render = await request(app)
      .post("/api/render/captioned-video")
      .send({ videoPath: upload.body.file, words: tx.body.words });
    assert.equal(render.status, 200, JSON.stringify(render.body));
    assert.ok(fs.existsSync(render.body.file), "rendered file must exist on disk");
    assert.ok(fs.statSync(render.body.file).size > 0, "rendered file must be non-empty");
  });
});
```

- [ ] **Step 2: Run the smoke test**

```bash
cd server && npm test -- --test-name-pattern="Sermon Clip Studio"
```

Expected: 1 test passes (or skips if FFmpeg isn't installed locally).

- [ ] **Step 3: Run the full server test suite to confirm no regressions**

```bash
cd server && npm test
```

Expected: all existing tests still green; new tests from Tasks 1-6 + the smoke test pass.

- [ ] **Step 4: Build the client**

```bash
cd client && npm run build
```

Per the [biblefuel build workflow](../../memory/biblefuel_build_workflow.md), the built client is committed under `server/public/**` before deploy.

- [ ] **Step 5: Commit the smoke test + built client**

```bash
git add server/test/routes/sermonClipStudio.smoke.test.js server/public
git commit -m "test(sermon-clip-studio): end-to-end smoke + rebuild client"
```

---

## Out-of-scope (deferred)

These came up in the spec but are deliberately not in this plan:

- **Per-user transcription quota.** The `usageStore` + `quota` middleware already exists; metering Whisper minutes is a config wiring task, not a feature. Add only when the bill warrants it.
- **Whisper provider abstraction.** If/when we add a second STT provider, factor `transcribeAudio` behind an interface — until then YAGNI.
- **Server-side scripture/verse detection inside transcripts.** Useful, but a different feature (auto-link sermon quotes to the bible reference UI). Out of scope here.
- **Dynamic auto-duck curve.** Current `sidechaincompress` curve is fixed; expose threshold/ratio only if real users complain.
- **Async job model for long renders.** A 45-minute sermon render synchronous on a request will time out behind most reverse proxies. If users hit this, port the route into the existing `jobs.js` queue (the auto-duck filter graph from Task 6 is already structured to copy directly into a job handler). Track separately.
