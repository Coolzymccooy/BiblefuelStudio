# Story Video Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side pipeline that turns an uploaded sermon into a captioned, AI-illustrated MP4: a persisted project document, an LLM scene segmenter, an N-scene timed render builder, durable restart-aware jobs, and the wizard's REST endpoints.

**Architecture:** A *Story Video Project* is a JSON document persisted per-user. Each pipeline stage (transcribe → segment → images → render) reads/writes the project and is idempotent, so the only fragile step (FFmpeg) runs entirely on already-cached inputs. Re-running an interrupted render is cheap because nothing upstream re-runs. The render is a dedicated builder (not the existing 4-background `/captioned-video` endpoint) that reuses the lower-level caption/Ken-Burns/audio libs to assemble 25–40 precisely-timed image scenes.

**Tech Stack:** Node.js, Express, ES modules, `node:test`, FFmpeg (spawn), gpt-4o-mini + gemini-2.0-flash (existing keys), Whisper (existing transcribe route), existing image-gen orchestrator.

**Spec:** `docs/superpowers/specs/2026-06-07-story-video-script-to-visuals-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/src/lib/story/projectStore.js` | Project-doc CRUD, atomic write, multi-tenant path resolution | Create |
| `server/src/lib/story/projectStore.test.js` | Unit tests for the store | Create |
| `server/src/lib/story/sceneSegmenter.js` | transcript words → scenes + image prompts (LLM, injected + mockable), deterministic fallback, style anchors | Create |
| `server/src/lib/story/sceneSegmenter.test.js` | Unit tests for the segmenter | Create |
| `server/src/lib/story/styleAnchors.js` | The 4 v1 visual-style anchor strings | Create |
| `server/src/lib/story/storyRender.js` | scenes + images → FFmpeg arg array for N timed segments; spawn + progress wiring | Create |
| `server/src/lib/story/storyRender.test.js` | Unit tests for arg building (pure) | Create |
| `server/src/lib/renderJobs.js` | Extend: persist job record + boot reconciliation | Modify |
| `server/src/lib/renderJobs.test.js` | Unit tests for persistence + reconciliation | Create |
| `server/src/routes/story.js` | Wizard endpoints (create/transcribe/segment/images/regenerate/patch/render/get) | Create |
| `server/src/routes/story.test.js` | Integration tests (providers mocked) | Create |
| `server/index.js` | Register `/api/story` router | Modify |

**Conventions to follow (from existing code):**
- Tests use `node:test` + `node:assert/strict`, run via `node --test <file>`.
- Mockable seams use the `_setXImpl(impl)` / `_resetXImpl()` pattern (see `transcribe.js:16-18`).
- Per-user paths come from `req.ctx.dataDir` / `req.ctx.outputDir` (see `middleware/userScope.js`). Never build `DATA_DIR/users/...` by hand in a route.
- API responses use `{ ok: true, ... }` / `{ ok: false, error }`.
- Routes are mounted with `requireAuth, withUserScope` (see `index.js:343-378`).

---

## Task 1: Project store (CRUD + atomic write)

**Files:**
- Create: `server/src/lib/story/projectStore.js`
- Test: `server/src/lib/story/projectStore.test.js`

The store owns all project-doc I/O. It takes an explicit `baseDir` (the caller passes `req.ctx.dataDir`) so it never reaches into multi-tenant internals. Writes are atomic (temp file + rename) so a crash mid-write can't corrupt a project.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/story/projectStore.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createProject,
  readProject,
  writeProject,
  listProjects,
  STORY_STATUS,
} from "./projectStore.js";

let baseDir;
beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-store-"));
});
afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("projectStore", () => {
  test("createProject persists a draft with a generated id", () => {
    const p = createProject(baseDir, { title: "Trusting God", style: "cinematic-bible" });
    assert.ok(p.projectId);
    assert.equal(p.title, "Trusting God");
    assert.equal(p.style, "cinematic-bible");
    assert.equal(p.status, STORY_STATUS.DRAFT);
    assert.deepEqual(p.scenes, []);
    const onDisk = readProject(baseDir, p.projectId);
    assert.equal(onDisk.projectId, p.projectId);
  });

  test("writeProject is atomic — no .tmp left behind", () => {
    const p = createProject(baseDir, { title: "A", style: "cinematic-bible" });
    writeProject(baseDir, { ...p, title: "B" });
    assert.equal(readProject(baseDir, p.projectId).title, "B");
    const dir = path.join(baseDir, "story-projects");
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  test("readProject returns null for a missing id", () => {
    assert.equal(readProject(baseDir, "nope"), null);
  });

  test("readProject returns null for a corrupt file instead of throwing", () => {
    const dir = path.join(baseDir, "story-projects");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.json"), "{ not json");
    assert.equal(readProject(baseDir, "bad"), null);
  });

  test("listProjects returns summaries newest-first", () => {
    const a = createProject(baseDir, { title: "A", style: "cinematic-bible" });
    const b = createProject(baseDir, { title: "B", style: "cinematic-bible" });
    writeProject(baseDir, { ...b, updatedAt: 2000 });
    writeProject(baseDir, { ...a, updatedAt: 1000 });
    const list = listProjects(baseDir);
    assert.equal(list[0].projectId, b.projectId);
    assert.equal(list.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/src/lib/story/projectStore.test.js`
Expected: FAIL — "Cannot find module './projectStore.js'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/src/lib/story/projectStore.js
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

/** Project lifecycle states. */
export const STORY_STATUS = {
  DRAFT: "draft",
  TRANSCRIBING: "transcribing",
  SEGMENTING: "segmenting",
  GENERATING_IMAGES: "generating_images",
  READY_TO_RENDER: "ready_to_render",
  RENDERING: "rendering",
  DONE: "done",
  ERROR: "error",
};

function projectsDir(baseDir) {
  return path.join(baseDir, "story-projects");
}

function projectPath(baseDir, projectId) {
  const safe = String(projectId || "").replace(/[^a-z0-9_-]/gi, "");
  return path.join(projectsDir(baseDir), `${safe}.json`);
}

/**
 * Create + persist a fresh draft project.
 * @param {string} baseDir  the caller's req.ctx.dataDir
 * @param {{title?:string, style?:string}} opts
 */
export function createProject(baseDir, { title = "Untitled", style = "cinematic-bible" } = {}) {
  const now = Date.now();
  const project = {
    projectId: uuid(),
    title: String(title).slice(0, 200),
    style: String(style),
    status: STORY_STATUS.DRAFT,
    source: { audioPath: null, durationMs: 0 },
    transcript: { words: [], hash: null },
    scenes: [],
    music: { path: null, volume: 0.3 },
    captionPreset: "default",
    render: { jobId: null, outputPath: null, status: null },
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  writeProject(baseDir, project);
  return project;
}

/** Read a project by id. Returns null if missing or unreadable/corrupt. */
export function readProject(baseDir, projectId) {
  const file = projectPath(baseDir, projectId);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Atomically persist a project (temp file + rename). Bumps updatedAt. */
export function writeProject(baseDir, project) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = { ...project, updatedAt: project.updatedAt || Date.now() };
  const file = projectPath(baseDir, next.projectId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}

/** List project summaries (no scenes/words), newest updatedAt first. */
export function listProjects(baseDir) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return {
          projectId: p.projectId,
          title: p.title,
          status: p.status,
          style: p.style,
          updatedAt: p.updatedAt || 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/src/lib/story/projectStore.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story/projectStore.js server/src/lib/story/projectStore.test.js
git commit -m "feat(story): project document store with atomic writes"
```

---

## Task 2: Style anchors

**Files:**
- Create: `server/src/lib/story/styleAnchors.js`
- Test: covered indirectly by Task 3; add a tiny direct test here.

A pure lookup of the 4 v1 style anchor suffixes appended to every image prompt for visual coherence. Adding a 5th style later is a one-line edit.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/story/styleAnchors.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STYLE_ANCHORS, anchorFor, listStyles } from "./styleAnchors.js";

describe("styleAnchors", () => {
  test("has the 4 v1 styles", () => {
    assert.deepEqual(
      listStyles().sort(),
      ["ancient-scripture", "cinematic-bible", "heavenly-atmosphere", "modern-devotional"],
    );
  });

  test("anchorFor returns the style's suffix", () => {
    assert.ok(anchorFor("cinematic-bible").includes("cinematic"));
  });

  test("anchorFor falls back to cinematic-bible for an unknown style", () => {
    assert.equal(anchorFor("nonsense"), STYLE_ANCHORS["cinematic-bible"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/src/lib/story/styleAnchors.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/src/lib/story/styleAnchors.js
// Suffix appended to every scene image prompt so all 25-40 images in one video
// share a coherent look. "no text" keeps generated art clean for caption overlay.
export const STYLE_ANCHORS = {
  "cinematic-bible":
    "cinematic biblical scene, dramatic warm lighting, film still, photorealistic, vertical 9:16, no text, no watermark",
  "modern-devotional":
    "modern devotional aesthetic, soft natural light, minimal clean composition, calm tones, vertical 9:16, no text, no watermark",
  "heavenly-atmosphere":
    "heavenly atmosphere, glowing light rays, soft clouds, ethereal and serene, vertical 9:16, no text, no watermark",
  "ancient-scripture":
    "ancient near-eastern setting, weathered textures, golden-hour desert light, historical, vertical 9:16, no text, no watermark",
};

const DEFAULT_STYLE = "cinematic-bible";

export function listStyles() {
  return Object.keys(STYLE_ANCHORS);
}

export function anchorFor(style) {
  return STYLE_ANCHORS[style] || STYLE_ANCHORS[DEFAULT_STYLE];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/src/lib/story/styleAnchors.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story/styleAnchors.js server/src/lib/story/styleAnchors.test.js
git commit -m "feat(story): v1 visual style anchors"
```

---

## Task 3: Scene segmenter (LLM transform + deterministic fallback)

**Files:**
- Create: `server/src/lib/story/sceneSegmenter.js`
- Test: `server/src/lib/story/sceneSegmenter.test.js`

Pure transform: transcript word array → scenes with derived timings and style-anchored prompts. The LLM call is **injected** (`_setLlmImpl`) so tests run offline. The LLM only chooses word-index boundaries + writes prompts; timings are always derived from the real word timings (never invented). On any LLM failure/invalid output, a deterministic ~8s-window fallback fires so the feature never dead-ends.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/story/sceneSegmenter.test.js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  segmentScenes,
  _setLlmImpl,
  _resetLlmImpl,
} from "./sceneSegmenter.js";

const WORDS = Array.from({ length: 30 }, (_, i) => ({
  text: `w${i}`,
  startMs: i * 1000,
  endMs: i * 1000 + 900,
}));

afterEach(() => _resetLlmImpl());

describe("segmentScenes", () => {
  test("derives scene timings from word indices, never from the LLM", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({
        scenes: [
          { text: "first", startWordIndex: 0, endWordIndex: 9, imagePrompt: "a sunrise" },
          { text: "second", startWordIndex: 10, endWordIndex: 29, imagePrompt: "a valley" },
        ],
      }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[0].endMs, WORDS[9].endMs);
    assert.equal(scenes[1].startMs, WORDS[10].startMs);
    assert.equal(scenes[1].endMs, WORDS[29].endMs);
  });

  test("appends the style anchor to every image prompt", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [{ text: "x", startWordIndex: 0, endWordIndex: 29, imagePrompt: "a lamp" }] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "heavenly-atmosphere" });
    assert.ok(scenes[0].imagePrompt.startsWith("a lamp"));
    assert.ok(/heavenly/i.test(scenes[0].imagePrompt));
  });

  test("clamps out-of-range word indices instead of crashing", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [{ text: "x", startWordIndex: -5, endWordIndex: 999, imagePrompt: "p" }] }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes[0].startMs, WORDS[0].startMs);
    assert.equal(scenes[0].endMs, WORDS[WORDS.length - 1].endMs);
  });

  test("falls back to fixed windows when the LLM returns invalid JSON", async () => {
    _setLlmImpl(async () => "not json at all");
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible", targetSec: 8 });
    // 30s of words at ~8s/scene -> ~4 scenes, fully covering the audio.
    assert.ok(scenes.length >= 3 && scenes.length <= 5);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes[scenes.length - 1].endMs, WORDS[WORDS.length - 1].endMs);
    for (const s of scenes) assert.ok(s.imagePrompt.length > 0);
  });

  test("falls back when the LLM throws", async () => {
    _setLlmImpl(async () => { throw new Error("network down"); });
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.ok(scenes.length >= 1);
  });

  test("each scene gets a unique id and covers contiguous words", async () => {
    _setLlmImpl(async () =>
      JSON.stringify({
        scenes: [
          { text: "a", startWordIndex: 0, endWordIndex: 14, imagePrompt: "p1" },
          { text: "b", startWordIndex: 15, endWordIndex: 29, imagePrompt: "p2" },
        ],
      }),
    );
    const scenes = await segmentScenes({ words: WORDS, style: "cinematic-bible" });
    assert.equal(scenes[0].id, "scene-001");
    assert.equal(scenes[1].id, "scene-002");
    assert.equal(scenes[0].endMs <= scenes[1].startMs, true);
  });

  test("empty words -> empty scenes (no throw)", async () => {
    const scenes = await segmentScenes({ words: [], style: "cinematic-bible" });
    assert.deepEqual(scenes, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/src/lib/story/sceneSegmenter.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/src/lib/story/sceneSegmenter.js
import { anchorFor } from "./styleAnchors.js";

// Injected LLM completion: (prompt:string) => Promise<string>. Default does the
// gpt-4o-mini -> gemini-2.0-flash fallback. Mockable in tests via _setLlmImpl
// (mirrors the _setTranscribeAudioImpl seam in routes/transcribe.js).
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

const TARGET_SEC_DEFAULT = 8;

/**
 * @param {object} args
 * @param {Array<{text:string,startMs:number,endMs:number}>} args.words
 * @param {string} args.style
 * @param {number} [args.targetSec=8]
 * @returns {Promise<Array<object>>} scene objects
 */
export async function segmentScenes({ words, style, targetSec = TARGET_SEC_DEFAULT }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const anchor = anchorFor(style);

  let llmScenes = null;
  try {
    const raw = await _llm(buildSegmentPrompt(words, targetSec));
    llmScenes = parseLlmScenes(raw);
  } catch {
    llmScenes = null;
  }

  const ranges =
    llmScenes && llmScenes.length > 0
      ? llmScenes.map((s) => ({
          text: String(s.text || "").trim(),
          start: clampIndex(s.startWordIndex, words.length),
          end: clampIndex(s.endWordIndex, words.length),
          imagePrompt: String(s.imagePrompt || "").trim(),
        }))
      : fallbackRanges(words, targetSec);

  return ranges.map((r, i) => {
    const start = Math.min(r.start, r.end);
    const end = Math.max(r.start, r.end);
    const text = r.text || words.slice(start, end + 1).map((w) => w.text).join(" ");
    const prompt = (r.imagePrompt || text).trim();
    return {
      id: `scene-${String(i + 1).padStart(3, "0")}`,
      text,
      startMs: words[start].startMs,
      endMs: words[end].endMs,
      imagePrompt: `${prompt}, ${anchor}`,
      imagePath: null,
      imageStatus: "pending",
      promptEditedByUser: false,
    };
  });
}

function clampIndex(idx, len) {
  const n = Number(idx);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(len - 1, Math.floor(n)));
}

// Split words into contiguous windows whose spoken duration is ~targetSec.
function fallbackRanges(words, targetSec) {
  const ranges = [];
  let startIdx = 0;
  const windowMs = targetSec * 1000;
  for (let i = 0; i < words.length; i++) {
    const spanMs = words[i].endMs - words[startIdx].startMs;
    const isLast = i === words.length - 1;
    if (spanMs >= windowMs || isLast) {
      ranges.push({ start: startIdx, end: i, text: "", imagePrompt: "" });
      startIdx = i + 1;
    }
  }
  return ranges;
}

function buildSegmentPrompt(words, targetSec) {
  const indexed = words.map((w, i) => `${i}:${w.text}`).join(" ");
  return [
    "You are segmenting a sermon transcript into visual scenes for a short video.",
    `Group the numbered words below into consecutive scenes, each about ${targetSec} seconds of speech,`,
    "split on meaning (one image per idea). For each scene return the inclusive startWordIndex and",
    "endWordIndex (referencing the numbers), the scene's caption text, and a vivid, concrete imagePrompt",
    "describing a single photographic image for that scene (no text in the image).",
    'Respond ONLY with JSON: {"scenes":[{"text","startWordIndex","endWordIndex","imagePrompt"}]}.',
    "",
    "Words:",
    indexed,
  ].join("\n");
}

function parseLlmScenes(raw) {
  if (!raw || typeof raw !== "string") return null;
  // Tolerate ```json fences / leading prose by extracting the first {...} block.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;
  return parsed.scenes;
}

// Default dual-provider completion. Mirrors generateScripts.js openai/gemini.
async function defaultLlmComplete(prompt) {
  return (await openaiComplete(prompt)) ?? (await geminiComplete(prompt)) ?? "";
}

async function openaiComplete(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function geminiComplete(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/src/lib/story/sceneSegmenter.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story/sceneSegmenter.js server/src/lib/story/sceneSegmenter.test.js
git commit -m "feat(story): LLM scene segmenter with deterministic fallback"
```

---

## Task 4: Story render builder (N timed image scenes → FFmpeg args)

**Files:**
- Create: `server/src/lib/story/storyRender.js`
- Test: `server/src/lib/story/storyRender.test.js`

The existing `/captioned-video` caps at 4 backgrounds and can't express per-scene timing for 25–40 images. This builder assembles N image inputs, each shown for its `[startMs,endMs]` window (Ken Burns motion), concatenated to the audio length, with word-level captions drawn over the top. **Step 1 covers only the pure arg-building function** (`buildStoryFfmpegArgs`) so it's fully unit-testable; the spawn/progress wrapper (`runStoryRender`) reuses `renderJobs` exactly like `render.js` and is exercised by the Task 6 integration test.

The captions reuse the existing `buildWordDrawtext` from `lib/videoFilters.js`, and Ken Burns reuses `kenBurnsFilter` from `lib/kenBurns.js`.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/story/storyRender.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildStoryFfmpegArgs, sceneSegmentsSec } from "./storyRender.js";

const SCENES = [
  { id: "scene-001", startMs: 0, endMs: 8000, imagePath: "/tmp/a.png" },
  { id: "scene-002", startMs: 8000, endMs: 16000, imagePath: "/tmp/b.png" },
  { id: "scene-003", startMs: 16000, endMs: 20000, imagePath: "/tmp/c.png" },
];
const WORDS = [
  { text: "hello", startMs: 0, endMs: 500 },
  { text: "world", startMs: 600, endMs: 1200 },
];

describe("storyRender arg building", () => {
  test("sceneSegmentsSec converts scene ms windows to second durations", () => {
    const segs = sceneSegmentsSec(SCENES);
    assert.deepEqual(segs.map((s) => s.durationSec), [8, 8, 4]);
    assert.equal(segs.length, 3);
  });

  test("builds one -i per scene image plus the audio input", () => {
    const { args } = buildStoryFfmpegArgs({
      scenes: SCENES,
      words: WORDS,
      audioPath: "/tmp/voice.mp3",
      musicPath: null,
      width: 1080,
      height: 1920,
      outPath: "/tmp/out.mp4",
    });
    const inputCount = args.filter((a) => a === "-i").length;
    assert.equal(inputCount, SCENES.length + 1); // 3 images + 1 audio
    assert.ok(args.includes("/tmp/voice.mp3"));
    assert.ok(args.includes("/tmp/out.mp4"));
  });

  test("adds a music input when musicPath is provided", () => {
    const { args } = buildStoryFfmpegArgs({
      scenes: SCENES,
      words: WORDS,
      audioPath: "/tmp/voice.mp3",
      musicPath: "/tmp/music.mp3",
      width: 1080,
      height: 1920,
      outPath: "/tmp/out.mp4",
    });
    assert.ok(args.includes("/tmp/music.mp3"));
  });

  test("output is capped to the audio/scene length via -t", () => {
    const { args, totalDurationSec } = buildStoryFfmpegArgs({
      scenes: SCENES,
      words: WORDS,
      audioPath: "/tmp/voice.mp3",
      musicPath: null,
      width: 1080,
      height: 1920,
      outPath: "/tmp/out.mp4",
    });
    assert.equal(totalDurationSec, 20); // last scene endMs
    const tIdx = args.indexOf("-t");
    assert.ok(tIdx >= 0);
    assert.equal(args[tIdx + 1], "20.000");
  });

  test("throws when a scene is missing its image", () => {
    const bad = [{ id: "scene-001", startMs: 0, endMs: 8000, imagePath: null }];
    assert.throws(
      () => buildStoryFfmpegArgs({
        scenes: bad, words: WORDS, audioPath: "/tmp/voice.mp3",
        musicPath: null, width: 1080, height: 1920, outPath: "/tmp/out.mp4",
      }),
      /missing image/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/src/lib/story/storyRender.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/src/lib/story/storyRender.js
import { spawn } from "child_process";
import { buildWordDrawtext } from "../videoFilters.js";
import { kenBurnsFilter } from "../kenBurns.js";
import { markRunning, markProgress, markDone, markError } from "../renderJobs.js";

/** Convert scenes' ms windows into per-scene second durations. */
export function sceneSegmentsSec(scenes) {
  return scenes.map((s) => ({
    id: s.id,
    durationSec: Math.max(0.1, (s.endMs - s.startMs) / 1000),
    imagePath: s.imagePath,
  }));
}

/**
 * Build the FFmpeg argv for an N-scene story video.
 * Each scene image is shown for its window with a slow Ken Burns zoom; the
 * scenes are concatenated, then word captions are drawn over the full length,
 * with the voice track (and optional ducked music) mixed underneath.
 *
 * @returns {{args:string[], totalDurationSec:number}}
 */
export function buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, width, height, outPath }) {
  if (!scenes.length) throw new Error("story render: no scenes");
  for (const s of scenes) {
    if (!s.imagePath) throw new Error(`story render: scene ${s.id} missing image`);
  }
  const segs = sceneSegmentsSec(scenes);
  const totalDurationSec = Number((scenes[scenes.length - 1].endMs / 1000).toFixed(3));

  const args = ["-y"];
  // One looped image input per scene, each limited to its own duration.
  segs.forEach((seg) => {
    args.push("-loop", "1", "-t", seg.durationSec.toFixed(3), "-i", seg.imagePath);
  });
  args.push("-i", audioPath);
  const audioInputIdx = segs.length;
  let musicInputIdx = -1;
  if (musicPath) {
    args.push("-i", musicPath);
    musicInputIdx = segs.length + 1;
  }

  // Per-scene: scale/crop to canvas + Ken Burns zoom, normalized to 30fps.
  const sceneLabels = [];
  const filterParts = [];
  segs.forEach((seg, i) => {
    const kb = kenBurnsFilter(width, height, seg.durationSec, 30);
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},${kb},setsar=1[s${i}]`,
    );
    sceneLabels.push(`[s${i}]`);
  });
  // Concatenate all scene clips into one video stream.
  filterParts.push(`${sceneLabels.join("")}concat=n=${segs.length}:v=1:a=0[vcat]`);

  // Word captions over the concatenated video. buildWordDrawtext expects
  // { text, start, end } in SECONDS, so convert from ms.
  const drawWords = words
    .filter((w) => w && w.text && Number.isFinite(w.startMs) && Number.isFinite(w.endMs))
    .map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 }));
  const drawtext = buildWordDrawtext({ words: drawWords, width, height });
  filterParts.push(`[vcat]${drawtext}[vout]`);

  // Audio: voice (+ optional music). Keep it simple — voice as-is; music lowered.
  let audioMap;
  if (musicInputIdx >= 0) {
    filterParts.push(
      `[${musicInputIdx}:a]volume=0.3[mlow];` +
        `[${audioInputIdx}:a][mlow]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    );
    audioMap = "[aout]";
  } else {
    audioMap = `${audioInputIdx}:a`;
  }

  args.push(
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]",
    "-map", audioMap,
    "-c:v", "libx264",
    "-preset", process.env.FFMPEG_PRESET || "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", totalDurationSec.toFixed(3),
    outPath,
  );
  return { args, totalDurationSec };
}

/**
 * Spawn FFmpeg for a story render, wiring progress into the existing job
 * registry exactly like routes/render.js. Resolves with { ok, file } / { ok:false }.
 */
export function runStoryRender({ jobId, scenes, words, audioPath, musicPath, width, height, outPath }) {
  return new Promise((resolve) => {
    let built;
    try {
      built = buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, width, height, outPath });
    } catch (err) {
      markError(jobId, err?.message || err);
      return resolve({ ok: false, error: String(err?.message || err) });
    }
    markRunning(jobId);
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, built.args);
    let stderrTail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderrTail = (stderrTail + s).slice(-2000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && built.totalDurationSec > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        markProgress(jobId, (sec / built.totalDurationSec) * 100);
      }
    });
    proc.on("error", (err) => {
      markError(jobId, err?.message || err);
      resolve({ ok: false, error: String(err?.message || err) });
    });
    proc.on("close", (code) => {
      if (code === 0) {
        markDone(jobId, outPath);
        resolve({ ok: true, file: outPath });
      } else {
        markError(jobId, `ffmpeg exited ${code}: ${stderrTail.slice(-400)}`);
        resolve({ ok: false, error: `ffmpeg exited ${code}` });
      }
    });
  });
}
```

> **Integration note for the implementer:** confirm the exact `buildWordDrawtext` signature in `lib/videoFilters.js` before running — if it expects a different option shape (e.g. `preset`, `layout`), adapt the call in `buildStoryFfmpegArgs` accordingly. The arg-building unit tests assert input/output counts and `-t`, which hold regardless of the drawtext internals.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/src/lib/story/storyRender.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story/storyRender.js server/src/lib/story/storyRender.test.js
git commit -m "feat(story): N-scene timed FFmpeg render builder"
```

---

## Task 5: Durable jobs (persist + boot reconciliation)

**Files:**
- Modify: `server/src/lib/renderJobs.js`
- Test: `server/src/lib/renderJobs.test.js`

Extend the in-memory registry with a thin on-disk mirror (per state transition, not per progress tick) and a boot reconciliation that flips orphaned `running`/`queued` jobs to `interrupted`. Persistence takes an explicit `baseDir`, kept optional so existing callers (the in-memory-only `/captioned-video` path) are unaffected.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/lib/renderJobs.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createJob, markRunning, markDone, getJob, _resetJobs,
  persistJob, reconcilePersistedJobs, readPersistedJob,
} from "./renderJobs.js";

let baseDir;
beforeEach(() => {
  _resetJobs();
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-jobs-"));
});
afterEach(() => fs.rmSync(baseDir, { recursive: true, force: true }));

describe("durable render jobs", () => {
  test("persistJob writes a thin record to disk", () => {
    const job = createJob("user-1", { durationSec: 20 });
    persistJob(baseDir, { ...job, projectId: "proj-1" });
    const rec = readPersistedJob(baseDir, job.jobId);
    assert.equal(rec.jobId, job.jobId);
    assert.equal(rec.projectId, "proj-1");
    assert.equal(rec.status, "queued");
  });

  test("reconcilePersistedJobs flips running/queued to interrupted", () => {
    const a = createJob("user-1", { durationSec: 20 });
    persistJob(baseDir, { ...a, projectId: "p", status: "running" });
    const b = createJob("user-1", { durationSec: 20 });
    persistJob(baseDir, { ...b, projectId: "p2", status: "done" });

    const changed = reconcilePersistedJobs(baseDir);
    assert.equal(readPersistedJob(baseDir, a.jobId).status, "interrupted");
    assert.equal(readPersistedJob(baseDir, b.jobId).status, "done"); // untouched
    assert.ok(changed.some((c) => c.jobId === a.jobId));
  });

  test("in-memory job API still works (back-compat)", () => {
    const job = createJob("user-1", { durationSec: 10 });
    markRunning(job.jobId);
    markDone(job.jobId, "/tmp/out.mp4");
    assert.equal(getJob(job.jobId).status, "done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/src/lib/renderJobs.test.js`
Expected: FAIL — `persistJob`/`reconcilePersistedJobs`/`readPersistedJob` not exported.

- [ ] **Step 3: Add the persistence functions to `renderJobs.js`**

Append to `server/src/lib/renderJobs.js` (keep all existing code; add imports at top):

```javascript
// --- add at top, after the existing `import { v4 as uuid }` line ---
import fs from "fs";
import path from "path";

// --- append at the end of the file ---

function jobsPersistDir(baseDir) {
  return path.join(baseDir, "render-jobs");
}

/**
 * Persist a thin job record (status transitions only, NOT every progress tick).
 * @param {string} baseDir  caller's req.ctx.dataDir
 * @param {object} job      a JobRecord plus optional { projectId, outputPath }
 */
export function persistJob(baseDir, job) {
  const dir = jobsPersistDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const thin = {
    jobId: job.jobId,
    userId: job.userId,
    projectId: job.projectId || null,
    status: job.status,
    outputPath: job.outputPath || job.file || null,
    updatedAt: Date.now(),
  };
  const file = path.join(dir, `${job.jobId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(thin, null, 2));
  fs.renameSync(tmp, file);
  return thin;
}

export function readPersistedJob(baseDir, jobId) {
  const file = path.join(jobsPersistDir(baseDir), `${String(jobId).replace(/[^a-z0-9-]/gi, "")}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * On boot, any persisted job still marked running/queued had its ffmpeg child
 * killed by the restart. Flip those to 'interrupted' so the UI can offer Resume.
 * @returns {Array<{jobId:string, projectId:string|null}>} the changed records
 */
export function reconcilePersistedJobs(baseDir) {
  const dir = jobsPersistDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  const changed = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const file = path.join(dir, f);
    try {
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      if (rec.status === "running" || rec.status === "queued") {
        rec.status = "interrupted";
        rec.updatedAt = Date.now();
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
        fs.renameSync(tmp, file);
        changed.push({ jobId: rec.jobId, projectId: rec.projectId || null });
      }
    } catch {
      // skip corrupt record
    }
  }
  return changed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/src/lib/renderJobs.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/renderJobs.js server/src/lib/renderJobs.test.js
git commit -m "feat(story): durable render jobs with boot reconciliation"
```

---

## Task 6: Story routes (the wizard API)

**Files:**
- Create: `server/src/routes/story.js`
- Test: `server/src/routes/story.test.js`

Wires the stages together. Reuses `req.ctx.dataDir`/`outputDir`. Transcription is called via the injected seam (so the route doesn't duplicate Whisper logic) — for the route we call the existing alignment lib the same way `transcribe.js` does, behind a mockable `_setTranscribeImpl`. Image generation calls `generateBibleImage` with cache key `{ seriesId: projectId, partNumber: sceneIndex+1 }`.

The integration test drives the router with a stubbed Express `req`/`res` and mocked transcription/LLM/image-gen — no network, no FFmpeg.

- [ ] **Step 1: Write the failing test**

```javascript
// server/src/routes/story.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import storyRouter, {
  _setTranscribeImpl, _resetTranscribeImpl,
  _setImageGenImpl, _resetImageGenImpl,
} from "./story.js";
import { _setLlmImpl, _resetLlmImpl } from "../lib/story/sceneSegmenter.js";
import { readProject } from "../lib/story/projectStore.js";

// Minimal Express harness: find the route handler by method+path and invoke it.
function handlerFor(method, routePath) {
  const layer = storyRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method],
  );
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockReqRes({ params = {}, body = {}, dataDir, outputDir }) {
  const req = { params, body, ctx: { userId: "user-1", dataDir, outputDir } };
  const res = {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  return { req, res };
}

let dataDir, outputDir;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-route-out-"));
});
afterEach(() => {
  _resetTranscribeImpl(); _resetImageGenImpl(); _resetLlmImpl();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("story routes", () => {
  test("POST / creates a draft project", async () => {
    const { req, res } = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(req, res);
    assert.equal(res.payload.ok, true);
    assert.ok(res.payload.project.projectId);
    assert.equal(res.payload.project.status, "draft");
  });

  test("segment populates scenes and advances status", async () => {
    // seed a project with a transcript
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;

    // inject a transcript directly via writeProject for the test
    const { writeProject } = await import("../lib/story/projectStore.js");
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      source: { audioPath: "/tmp/voice.mp3", durationMs: 20000 },
      transcript: {
        words: Array.from({ length: 20 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 900 })),
        hash: "abc",
      },
    });

    _setLlmImpl(async () =>
      JSON.stringify({ scenes: [
        { text: "a", startWordIndex: 0, endWordIndex: 9, imagePrompt: "p1" },
        { text: "b", startWordIndex: 10, endWordIndex: 19, imagePrompt: "p2" },
      ] }),
    );
    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/segment")(req, res);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.project.scenes.length, 2);
    assert.equal(res.payload.project.status, "generating_images");
  });

  test("images stage is idempotent — already-done scenes are skipped", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const { writeProject } = await import("../lib/story/projectStore.js");
    const proj = readProject(dataDir, id);
    writeProject(dataDir, {
      ...proj,
      scenes: [
        { id: "scene-001", text: "a", startMs: 0, endMs: 8000, imagePrompt: "p1", imagePath: "/already.png", imageStatus: "done", promptEditedByUser: false },
        { id: "scene-002", text: "b", startMs: 8000, endMs: 16000, imagePrompt: "p2", imagePath: null, imageStatus: "pending", promptEditedByUser: false },
      ],
    });
    let calls = 0;
    _setImageGenImpl(async () => { calls += 1; return { ok: true, path: "/new.png" }; });

    const { req, res } = mockReqRes({ params: { id }, body: {}, dataDir, outputDir });
    await handlerFor("post", "/:id/images")(req, res);
    assert.equal(res.payload.ok, true);
    assert.equal(calls, 1); // only the pending scene
    const after = readProject(dataDir, id);
    assert.equal(after.scenes[1].imageStatus, "done");
    assert.equal(after.scenes[1].imagePath, "/new.png");
  });

  test("GET /:id returns the project; unknown id 404s", async () => {
    const { req, res } = mockReqRes({ params: { id: "missing" }, dataDir, outputDir });
    await handlerFor("get", "/:id")(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.ok, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/src/routes/story.test.js`
Expected: FAIL — `./story.js` not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// server/src/routes/story.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  createProject, readProject, writeProject, listProjects, STORY_STATUS,
} from "../lib/story/projectStore.js";
import { segmentScenes } from "../lib/story/sceneSegmenter.js";
import { runStoryRender } from "../lib/story/storyRender.js";
import { createJob, persistJob } from "../lib/renderJobs.js";
import { generateBibleImage } from "../lib/imageGen/index.js";
import { extractAudioToMp3 } from "../lib/transcode.js";
import {
  transcribeAudio, chunkAudioForTranscription, stitchTranscriptions,
} from "../lib/voice/alignment.js";

// Mockable seams (mirror routes/transcribe.js).
let _transcribeFn = transcribeAudio;
export function _setTranscribeImpl(impl) { _transcribeFn = impl; }
export function _resetTranscribeImpl() { _transcribeFn = transcribeAudio; }

let _imageGenFn = generateBibleImage;
export function _setImageGenImpl(impl) { _imageGenFn = impl; }
export function _resetImageGenImpl() { _imageGenFn = generateBibleImage; }

const router = Router();
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function storyOutDir(outputDir, projectId) {
  return path.join(outputDir, "story", String(projectId).replace(/[^a-z0-9_-]/gi, ""));
}

// POST /  — create a draft
router.post("/", (req, res) => {
  try {
    const { title, style } = req.body || {};
    const project = createProject(req.ctx.dataDir, { title, style });
    return res.json({ ok: true, project });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /  — list summaries
router.get("/", (req, res) => {
  return res.json({ ok: true, projects: listProjects(req.ctx.dataDir) });
});

// GET /:id — full project
router.get("/:id", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  return res.json({ ok: true, project });
});

// POST /:id/transcribe — body { mediaPath }
router.post("/:id/transcribe", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const mediaPath = String(req.body?.mediaPath || "").trim();
    if (!mediaPath || !fs.existsSync(mediaPath)) {
      return res.status(400).json({ ok: false, error: "mediaPath required and must exist" });
    }
    writeProject(req.ctx.dataDir, { ...project, status: STORY_STATUS.TRANSCRIBING, error: null });

    const isVideo = VIDEO_EXT.has(path.extname(mediaPath).toLowerCase());
    const audioPath = isVideo ? await extractAudioToMp3(mediaPath, req.ctx.outputDir) : mediaPath;
    const chunks = await chunkAudioForTranscription(audioPath, req.ctx.outputDir, 0);
    const transcribed = await Promise.all(
      chunks.map(async (c) => ({ offsetMs: c.offsetMs, transcription: await _transcribeFn(c.path) })),
    );
    const stitched = stitchTranscriptions(transcribed);
    if (!stitched.words.length) {
      writeProject(req.ctx.dataDir, { ...readProject(req.ctx.dataDir, req.params.id), status: STORY_STATUS.ERROR, error: "transcription returned no words" });
      return res.status(502).json({ ok: false, error: "Transcription returned no words" });
    }
    const durationMs = stitched.words[stitched.words.length - 1].endMs;
    const updated = writeProject(req.ctx.dataDir, {
      ...readProject(req.ctx.dataDir, req.params.id),
      source: { audioPath, durationMs },
      transcript: { words: stitched.words, hash: String(durationMs) + ":" + stitched.words.length },
      status: STORY_STATUS.SEGMENTING,
    });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/segment
router.post("/:id/segment", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const words = project.transcript?.words || [];
    if (!words.length) return res.status(400).json({ ok: false, error: "no transcript to segment" });
    const scenes = await segmentScenes({ words, style: project.style });
    const updated = writeProject(req.ctx.dataDir, {
      ...project, scenes, status: STORY_STATUS.GENERATING_IMAGES,
    });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/images — generate images for all pending scenes (idempotent)
router.post("/:id/images", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const scenes = [...(project.scenes || [])];
    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].imageStatus === "done" && scenes[i].imagePath) continue;
      scenes[i] = { ...scenes[i], imageStatus: "generating" };
      const result = await _imageGenFn({
        seriesId: project.projectId,
        partNumber: i + 1,
        rawPrompt: scenes[i].imagePrompt, // scene prompt already carries the style anchor (see implementer note)
        aspect: "portrait",
      });
      scenes[i] = result?.ok
        ? { ...scenes[i], imagePath: result.path, imageStatus: "done" }
        : { ...scenes[i], imageStatus: "error" };
    }
    const allDone = scenes.every((s) => s.imageStatus === "done");
    const updated = writeProject(req.ctx.dataDir, {
      ...project, scenes,
      status: allDone ? STORY_STATUS.READY_TO_RENDER : STORY_STATUS.GENERATING_IMAGES,
    });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/scenes/:sid/regenerate — one scene's image
router.post("/:id/scenes/:sid/regenerate", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const idx = (project.scenes || []).findIndex((s) => s.id === req.params.sid);
    if (idx < 0) return res.status(404).json({ ok: false, error: "scene not found" });
    const scenes = [...project.scenes];
    // Force regen: delete any cached file so generateBibleImage re-creates it.
    const out = storyOutDir(req.ctx.outputDir, project.projectId);
    const cached = path.join(out, `regen-${req.params.sid}.png`);
    try { if (fs.existsSync(cached)) fs.unlinkSync(cached); } catch {}
    scenes[idx] = { ...scenes[idx], imageStatus: "generating" };
    const result = await _imageGenFn({
      seriesId: `${project.projectId}-${req.params.sid}-${Date.now()}`,
      partNumber: 1,
      rawPrompt: scenes[idx].imagePrompt,
      aspect: "portrait",
    });
    scenes[idx] = result?.ok
      ? { ...scenes[idx], imagePath: result.path, imageStatus: "done" }
      : { ...scenes[idx], imageStatus: "error" };
    const updated = writeProject(req.ctx.dataDir, { ...project, scenes });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /:id/scenes/:sid — edit text/prompt
router.patch("/:id/scenes/:sid", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  const idx = (project.scenes || []).findIndex((s) => s.id === req.params.sid);
  if (idx < 0) return res.status(404).json({ ok: false, error: "scene not found" });
  const scenes = [...project.scenes];
  const patch = {};
  if (typeof req.body?.text === "string") patch.text = req.body.text;
  if (typeof req.body?.imagePrompt === "string") {
    patch.imagePrompt = req.body.imagePrompt;
    patch.promptEditedByUser = true;
  }
  scenes[idx] = { ...scenes[idx], ...patch };
  const updated = writeProject(req.ctx.dataDir, { ...project, scenes });
  return res.json({ ok: true, project: updated });
});

// POST /:id/render — kick off the durable render job
router.post("/:id/render", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const scenes = project.scenes || [];
    if (!scenes.length || scenes.some((s) => s.imageStatus !== "done")) {
      return res.status(400).json({ ok: false, error: "every scene needs a generated image before render" });
    }
    const out = storyOutDir(req.ctx.outputDir, project.projectId);
    if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
    const outPath = path.join(out, "video.mp4");
    const durationSec = scenes[scenes.length - 1].endMs / 1000;
    const job = createJob(req.ctx.userId, { durationSec });
    persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
    writeProject(req.ctx.dataDir, {
      ...project, status: STORY_STATUS.RENDERING,
      render: { jobId: job.jobId, outputPath: null, status: "running" },
    });

    // Fire-and-forget; the SSE/status endpoint (reuse /api/render progress) polls the job.
    runStoryRender({
      jobId: job.jobId,
      scenes,
      words: project.transcript?.words || [],
      audioPath: project.source?.audioPath,
      musicPath: project.music?.path || null,
      width: 1080, height: 1920,
      outPath,
    }).then((r) => {
      const fresh = readProject(req.ctx.dataDir, project.projectId);
      if (!fresh) return;
      const done = r.ok;
      writeProject(req.ctx.dataDir, {
        ...fresh,
        status: done ? STORY_STATUS.DONE : STORY_STATUS.ERROR,
        error: done ? null : (r.error || "render failed"),
        render: { jobId: job.jobId, outputPath: done ? outPath : null, status: done ? "done" : "error" },
      });
      persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: done ? "done" : "error", outputPath: done ? outPath : null });
    });

    return res.json({ ok: true, jobId: job.jobId, project: readProject(req.ctx.dataDir, project.projectId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/src/routes/story.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/story.js server/src/routes/story.test.js
git commit -m "feat(story): wizard pipeline REST endpoints"
```

---

## Task 7: Register the router + boot reconciliation

**Files:**
- Modify: `server/index.js`

Mount `/api/story` with the same auth/scope/quota middleware as `/api/render`, and run `reconcilePersistedJobs` for the operator's data dir on boot so interrupted renders surface after a redeploy.

- [ ] **Step 1: Add the import (near the other route imports, ~line 29)**

```javascript
import storyRouter from "./src/routes/story.js";
```

- [ ] **Step 2: Mount the router (near the other app.use lines, ~line 366)**

```javascript
app.use("/api/story", requireAuth, withUserScope, requireVerifiedEmail, quota("render"), storyRouter);
```

- [ ] **Step 3: Reconcile persisted jobs on boot (after routes are mounted, before app.listen)**

```javascript
import { reconcilePersistedJobs } from "./src/lib/renderJobs.js";
import { DATA_DIR } from "./src/lib/paths.js";
try {
  const interrupted = reconcilePersistedJobs(DATA_DIR);
  if (interrupted.length) console.warn(`[story] reconciled ${interrupted.length} interrupted render job(s)`);
} catch (e) {
  console.warn("[story] job reconciliation skipped:", e?.message || e);
}
```

> Note: per-user dirs are reconciled lazily on first project read in a future enhancement; the operator dir covers the single-tenant + super-admin case for v1.

- [ ] **Step 4: Verify the server boots and the route responds**

Run: `cd server && node index.js` (or the repo's start script). In another shell:
`curl -s -X POST localhost:5051/api/story -H 'content-type: application/json' -d '{}'`
Expected: a 401 (no auth) — proves the route is mounted and guarded. (A full authed call is covered by the e2e in Plan 2.)

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(story): mount /api/story router + boot job reconciliation"
```

---

## Task 8: Full backend test sweep

- [ ] **Step 1: Run every new test file**

Run:
```bash
node --test \
  server/src/lib/story/projectStore.test.js \
  server/src/lib/story/styleAnchors.test.js \
  server/src/lib/story/sceneSegmenter.test.js \
  server/src/lib/story/storyRender.test.js \
  server/src/lib/renderJobs.test.js \
  server/src/routes/story.test.js
```
Expected: all suites PASS.

- [ ] **Step 2: Run the repo's existing test command to confirm no regressions**

Run: `npm test` (from repo root or `server/`, per the repo's package.json).
Expected: existing suites still PASS.

> Memory note: `npm test` in this workspace deletes `outputs/lumina-tutorial/` — irrelevant here, but copy any renders you care about out of `outputs/` first.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A
git commit -m "test(story): backend pipeline green"
```

---

## Notes for the Implementer

- **Image-gen prompt path (IMPORTANT — verify before Task 6):** `generateBibleImage` builds its *own* prompt internally via `buildBiblePrompt({ beatType, verseText, styleAnchor })` and, because of `const anchor = styleAnchor || chooseStyleAnchor(...)`, an **empty-string `styleAnchor` is falsy and gets replaced by a random series anchor**. Passing the scene's already-anchored `imagePrompt` as `verseText` would therefore double-wrap and double-anchor it, mangling the prompt. **Before implementing Task 6, open `lib/imageGen/index.js` + `lib/imageGen/prompt.js` and add a raw-prompt passthrough** — the cleanest option is a new optional arg `rawPrompt` on `generateBibleImage` that, when present, skips `buildBiblePrompt` and feeds the prompt straight to the provider (the cache-key/disk-write logic is unchanged). Then in Task 6 call `_imageGenFn({ seriesId: project.projectId, partNumber: i + 1, rawPrompt: scenes[i].imagePrompt, aspect: "portrait" })`. Add a one-line unit test in `imageGen/index.test.js` asserting `rawPrompt` bypasses `buildBiblePrompt`. This is a small, additive change (no behavior change for existing callers) and it is the correct fix rather than abusing `verseText`.
- **`buildWordDrawtext` signature:** Task 4 assumes `buildWordDrawtext({ words, width, height })`. Open `lib/videoFilters.js` and confirm the real option names before running the render; adapt the single call site if they differ. The unit tests don't depend on the drawtext internals.
- **`chunkAudioForTranscription` duration arg:** `transcribe.js` passes a real `durationMs`; the story route passes `0` and lets the chunker probe. If the chunker requires a real duration, add a `probeDurationMs` call (copy from `transcribe.js:28-45`) before chunking.
- **Quota:** `/api/story` shares the `"render"` quota bucket. If you want story renders metered separately, add a `"story"` bucket in `middleware/quota.js` — out of scope for v1.
- **Deployment:** this is server-only; no client bundle rebuild needed yet. Plan 2 (the wizard UI) will require the `npm run build` + commit-bundle step per `biblefuel-deploy-prebuilt-bundle`.
