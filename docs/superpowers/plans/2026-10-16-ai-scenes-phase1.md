# AI Scenes Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Super admins can turn any finished Story scene picture into a short BytePlus Seedance motion clip (per scene or all at once), within a monthly dollar cap. The existing Story render then plays the clips.

**Architecture:**
- A Seedance provider exposes three steps: submit, wait and download. They are kept separate so a restart can collect a paid-for task by its id.
- A spend ledger in the shared `DATA_DIR` reserves an estimate before ordering a clip, then settles against the tokens BytePlus actually reports.
- An Animate stage runs up to 3 clips at once. It saves each task id before waiting, and stores the finished clip in the scene's existing `videoPath`/`mediaKind:"video"` fields, which the render already plays.
- New routes live in their own router, mounted inside the Story router and guarded by `requireSuperAdmin`.
- On the client, a SceneCard Animate button and a StoryAnimatePanel are shown only to super admins.

**Tech Stack:**
- Server: Node ESM, Express, `node:test`.
- Client: React, TypeScript, TanStack Query, Vitest + Testing Library.
- Media: ffmpeg/ffprobe, via the existing `resolveSceneVideo`.

**Spec:** `docs/superpowers/specs/2026-10-16-ai-scenes-design.md` (Phase 1 only; Phase 2 Series toggle and Phase 3 lip sync / music videos are NOT in this plan).

**Branch:** work in worktree `C:\Users\segun\source\repos\bf-ai-scenes`. Before Task 1: `git checkout -b feat/ai-scenes` (from `docs/ai-scenes-spec`, which holds the spec and this plan). Never push without the operator's go-ahead.

## Global Constraints

**Access and spending**
- Super admins only. Every AI-scene route is behind `requireSuperAdmin` (`server/src/middleware/requireSuperAdmin.js`), and the client shows Animate controls only when `useAuth((s) => s.isSuperAdmin)` is true.
- One ledger at `<DATA_DIR>/videogen-spend.json`. Callers pass `DATA_DIR` from `server/src/lib/paths.js`, never `req.ctx.dataDir`.
- Monthly cap from `VIDEO_GEN_MONTHLY_CAP_USD`, default `30`.
- Price multiplier from `VIDEO_GEN_PRICE_MULTIPLIER`, default `1`; valid range (0, 1]. The operator may set `0.4` while the promotion runs.

**BytePlus API**
- Environment variables:
  - `BYTEPLUS_ARK_API_KEY` (required);
  - `BYTEPLUS_ARK_BASE_URL`, default `https://ark.ap-southeast.bytepluses.com/api/v3`.
- Models: Standard quality is `dreamina-seedance-2-0-mini-260615` at `720p`. High quality is `dreamina-seedance-2-0-260128` at `1080p`.
- Clip length is whole seconds, clamped to 4–12. Measured on 2026-10-16: 2 s and 16 s are refused, 4 s and 12 s are accepted.
- Every prompt ends with `No text, no captions, no logos.`
- Every request sends `generate_audio:false` and `watermark:false`.
- Image-to-video sends `{ type: "image_url", image_url: { url: "data:<mime>;base64,..." }, role: "first_frame" }`. This was verified on 2026-10-16: HTTP 200, a 4 s clip, 87,300 tokens.
- If BytePlus refuses a start frame with an error code starting `InputImageSensitiveContentDetected` ("may contain real person", seen live on 2026-10-16), resubmit the same prompt as text-to-video. Record `mode:"text"`.
- The API key never appears in any returned error or log line.

**Clips and failures**
- A finished clip is stored through the existing scene fields `videoPath`, `videoUrl` and `mediaKind:"video"`. The scene keeps its picture (`imagePath`/`imageUrl`) as the poster.
- A failed or refused clip leaves the scene's picture in place. The render never waits for animation.

**UI and process**
- UI copy is sentence case and plain language. Money uses `tabular-nums` and two decimals. Use the existing `secondaryBtnCls` and `panelCls` from `client/src/components/story/formStyles.ts`. No new colours, no glows.
- Server tests: `cd server && node --test <file>`. Client tests: `cd client && npx vitest run <file>`.
- Verify the client with `cd client && npm run build` (Coolify runs `tsc -b`), not `tsc -p .`.
- Commits use conventional types and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings (deviations from the spec, decided while planning)

- **Ruling: Seedance is not added to `listVideoProviderChain`.**
  - Why: `generateTimelineVideo` returns an R2 public URL for the Timeline, and Story calls the provider directly.
  - Risk: Putting Seedance in the chain would break Timeline video-gen when `VIDEO_GEN_PROVIDER=auto`.
  - Cost if wrong: Timeline does not get Seedance until a later change.
- **Ruling: Stop (cancel) stops ordering new clips. Clips already ordered are still collected.**
  - Why: BytePlus charges for them anyway.
  - Cost if wrong: a few extra clips arrive after Stop.
- **Ruling: a refused start frame falls back to text-to-video.**
  - Why: it was measured on 2026-10-16. Most Cinematic Bible pictures show people, and BytePlus refuses those as first frames.
  - Cost if wrong: that scene's clip matches the prompt, not the exact picture.
- **Ruling: "Animate all" skips scenes already animated. Re-rolling is per scene.**
  - Cost if wrong: one extra click to re-roll everything.
- **Ruling: the quality choice (Standard 720p / High 1080p) is a control on the Animate panel, not a stored project setting.**
  - Cost if wrong: the choice is not remembered between visits.

## Review Focus

1. **A picture with a real person in it.** BytePlus refuses it as a start frame. The scene must still animate, from its prompt, with `aiVideoMode:"text"`, rather than fail. (Task 1 test: "falls back to text when the picture may show a real person".)
2. **A server restart mid-animation (a Coolify deploy).** A scene in `generating` with a saved task id is collected on boot without a second order. A scene still `queued` with no task id is marked failed with a plain message, and its reservation is released. (Task 3 resume tests.)
3. **The cap crossed part-way through "Animate all".** The scenes that fit are made. The rest fail with the "This would take October's AI video spend to …" message. The route refuses outright only when the whole batch cannot fit. (Task 3 "cap" test; Task 4 "BUDGET" test.)
4. **A new picture chosen while that scene is animating.** The late clip must not overwrite the new picture. It is still recorded as spent, and its files are removed. (Task 3 "picture replaced mid-flight" test; Task 4 PUT test.)
5. **A non-admin account, premium included, calling the routes directly.** It must get 403 with no spend and no project change. (Task 4 "super-admin gate" test.)

**Already covered by existing code:** the spec's "preview of the clip" on a scene. `StoryScenePreview` already plays `videoUrl` for any scene with `mediaKind:"video"`, so it shows AI clips with no change.

---

### Task 1: Seedance provider

**Files:**
- Create: `server/src/lib/videoGen/providers/seedance.js`
- Test: `server/src/lib/videoGen/providers/seedance.test.js`
- Modify: `server/.env.example` (append the env block from Step 5)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `SEEDANCE_MODELS: { mini: string, standard: string }`
  - `SEEDANCE_MIN_SEC = 4`
  - `SEEDANCE_MAX_SEC = 12`
  - `NO_TEXT_LINE: string`
  - `isSeedanceConfigured(): boolean`
  - `seedanceRatio(aspect: "portrait"|"landscape"|"square"|undefined): "9:16"|"16:9"|"1:1"`
  - `clampSeedanceDuration(sec: number): number`
  - `withNoText(prompt: string): string`
  - `submitSeedanceTask({ prompt, firstFramePath?, aspect?, durationSec?, model?, resolution?, fetchImpl? }): Promise<{ ok:true, taskId:string, mode:"image"|"text" } | { ok:false, code:string, error:string }>`
  - `getSeedanceTask(taskId, { fetchImpl? }): Promise<{ status:string, videoUrl?:string|null, tokens?:number, error?:string|null, httpStatus?:number }>`
  - `waitForSeedanceTask(taskId, { fetchImpl?, pollMs?, timeoutMs?, sleep?, now? }): Promise<{ ok:true, videoUrl:string, tokens:number } | { ok:false, code:"FAILED"|"TIMEOUT"|"NOT_FOUND"|"NO_VIDEO", error:string }>`
  - `downloadSeedanceVideo(url, destFile, { fetchImpl? }): Promise<number>` (returns the bytes written)

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/videoGen/providers/seedance.test.js`:

```js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  SEEDANCE_MODELS, NO_TEXT_LINE,
  isSeedanceConfigured, seedanceRatio, clampSeedanceDuration, withNoText,
  submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "./seedance.js";

const KEY = "ark-test-key-123";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
let saved;
let tmp;

beforeEach(() => {
  saved = { key: process.env.BYTEPLUS_ARK_API_KEY, base: process.env.BYTEPLUS_ARK_BASE_URL };
  process.env.BYTEPLUS_ARK_API_KEY = KEY;
  delete process.env.BYTEPLUS_ARK_BASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedance-"));
});
afterEach(() => {
  if (saved.key === undefined) delete process.env.BYTEPLUS_ARK_API_KEY; else process.env.BYTEPLUS_ARK_API_KEY = saved.key;
  if (saved.base === undefined) delete process.env.BYTEPLUS_ARK_BASE_URL; else process.env.BYTEPLUS_ARK_BASE_URL = saved.base;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === "function" ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

describe("seedance helpers", () => {
  test("clamps clip length to whole seconds between 4 and 12", () => {
    assert.equal(clampSeedanceDuration(0), 4);
    assert.equal(clampSeedanceDuration(3.2), 4);
    assert.equal(clampSeedanceDuration(4.01), 5);
    assert.equal(clampSeedanceDuration(12), 12);
    assert.equal(clampSeedanceDuration(30), 12);
  });
  test("maps the Story frame to a Seedance ratio, portrait by default", () => {
    assert.equal(seedanceRatio("portrait"), "9:16");
    assert.equal(seedanceRatio("landscape"), "16:9");
    assert.equal(seedanceRatio("square"), "1:1");
    assert.equal(seedanceRatio(undefined), "9:16");
  });
  test("adds the no-text line once", () => {
    assert.equal(withNoText("A field at dawn."), `A field at dawn. ${NO_TEXT_LINE}`);
    assert.equal(withNoText(`A field. ${NO_TEXT_LINE}`), `A field. ${NO_TEXT_LINE}`);
  });
  test("is configured only when the key is set", () => {
    assert.equal(isSeedanceConfigured(), true);
    delete process.env.BYTEPLUS_ARK_API_KEY;
    assert.equal(isSeedanceConfigured(), false);
  });
});

describe("submitSeedanceTask", () => {
  test("without a key it refuses and makes no request", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const fetchImpl = fakeFetch([]);
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOT_CONFIGURED");
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("text-to-video sends the documented body", async () => {
    const fetchImpl = fakeFetch([jsonRes(200, { id: "cgt-1" })]);
    const r = await submitSeedanceTask({ prompt: "A lamp in a quiet room.", aspect: "landscape", durationSec: 6.2, fetchImpl });
    assert.deepEqual(r, { ok: true, taskId: "cgt-1", mode: "text" });
    const [call] = fetchImpl.calls;
    assert.equal(call.url, "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(call.body, {
      model: SEEDANCE_MODELS.mini, ratio: "16:9", resolution: "720p", duration: 7,
      generate_audio: false, watermark: false,
      content: [{ type: "text", text: `A lamp in a quiet room. ${NO_TEXT_LINE}` }],
    });
  });

  test("image-to-video attaches the picture as the first frame", async () => {
    const pic = path.join(tmp, "scene.png");
    fs.writeFileSync(pic, PNG);
    const fetchImpl = fakeFetch([jsonRes(200, { id: "cgt-2" })]);
    const r = await submitSeedanceTask({ prompt: "Slow push-in.", firstFramePath: pic, fetchImpl });
    assert.deepEqual(r, { ok: true, taskId: "cgt-2", mode: "image" });
    const item = fetchImpl.calls[0].body.content[1];
    assert.equal(item.type, "image_url");
    assert.equal(item.role, "first_frame");
    assert.ok(item.image_url.url.startsWith("data:image/png;base64,"));
  });

  test("falls back to text when the picture may show a real person", async () => {
    const pic = path.join(tmp, "face.jpg");
    fs.writeFileSync(pic, PNG);
    const fetchImpl = fakeFetch([
      jsonRes(400, { error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "may contain real person" } }),
      jsonRes(200, { id: "cgt-3" }),
    ]);
    const r = await submitSeedanceTask({ prompt: "A man prays.", firstFramePath: pic, fetchImpl });
    assert.deepEqual(r, { ok: true, taskId: "cgt-3", mode: "text" });
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[1].body.content.length, 1);
  });

  test("a refused prompt comes back as REFUSED in plain words", async () => {
    const fetchImpl = fakeFetch([jsonRes(400, { error: { code: "InputTextSensitiveContentDetected", message: "sensitive" } })]);
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.code, "REFUSED");
    assert.match(r.error, /declined this scene's prompt/);
  });

  test("other API errors keep their code", async () => {
    const fetchImpl = fakeFetch([jsonRes(400, { error: { code: "InvalidParameter", message: "duration not valid" } })]);
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.code, "InvalidParameter");
    assert.equal(r.error, "duration not valid");
  });

  test("the key never appears in an error", async () => {
    const fetchImpl = async () => { throw new Error(`socket closed for Bearer ${KEY}`); };
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.error.includes(KEY), false);
    assert.match(r.error, /\[redacted\]/);
  });
});

describe("waitForSeedanceTask", () => {
  const noSleep = async () => {};
  test("polls through queued and running to the finished clip", async () => {
    const fetchImpl = fakeFetch([
      jsonRes(200, { status: "queued" }),
      jsonRes(200, { status: "running" }),
      jsonRes(200, { status: "succeeded", content: { video_url: "https://cdn/x.mp4" }, usage: { completion_tokens: 108900 } }),
    ]);
    const r = await waitForSeedanceTask("cgt-9", { fetchImpl, sleep: noSleep });
    assert.deepEqual(r, { ok: true, videoUrl: "https://cdn/x.mp4", tokens: 108900 });
    assert.equal(fetchImpl.calls[0].url.endsWith("/contents/generations/tasks/cgt-9"), true);
  });
  test("a failed task is reported", async () => {
    const fetchImpl = fakeFetch([jsonRes(200, { status: "failed", error: { code: "X", message: "model busy" } })]);
    const r = await waitForSeedanceTask("t", { fetchImpl, sleep: noSleep });
    assert.equal(r.code, "FAILED");
    assert.equal(r.error, "model busy");
  });
  test("a task BytePlus no longer has is NOT_FOUND", async () => {
    const fetchImpl = fakeFetch([jsonRes(404, { error: { code: "NotFound", message: "no task" } })]);
    const r = await waitForSeedanceTask("t", { fetchImpl, sleep: noSleep });
    assert.equal(r.code, "NOT_FOUND");
  });
  test("gives up after the time limit", async () => {
    let t = 0;
    const fetchImpl = async () => jsonRes(200, { status: "running" });
    const r = await waitForSeedanceTask("t", { fetchImpl, sleep: async (ms) => { t += ms; }, now: () => t, pollMs: 10_000, timeoutMs: 30_000 });
    assert.equal(r.code, "TIMEOUT");
  });
});

describe("downloadSeedanceVideo", () => {
  test("writes the clip to disk", async () => {
    const dest = path.join(tmp, "clip.mp4");
    const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer });
    const n = await downloadSeedanceVideo("https://cdn/x.mp4", dest, { fetchImpl });
    assert.equal(n, 3);
    assert.deepEqual([...fs.readFileSync(dest)], [1, 2, 3]);
  });
  test("a failed download throws and leaves nothing behind", async () => {
    const dest = path.join(tmp, "clip.mp4");
    const fetchImpl = async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });
    await assert.rejects(downloadSeedanceVideo("https://cdn/x.mp4", dest, { fetchImpl }), /HTTP 403/);
    assert.equal(fs.existsSync(dest), false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test src/lib/videoGen/providers/seedance.test.js`
Expected: FAIL with `Cannot find module` … `seedance.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/lib/videoGen/providers/seedance.js`:

```js
import fs from "fs";
import path from "path";

/**
 * BytePlus ModelArk "Dreamina Seedance" video generation.
 *
 * A clip is made in three steps, kept apart so a server restart can collect a
 * paid-for task by its id instead of ordering it again:
 *   submitSeedanceTask    -> task id
 *   waitForSeedanceTask   -> the finished clip's URL and the tokens billed
 *   downloadSeedanceVideo -> the MP4 on disk (BytePlus links expire after 24 h)
 *
 * The API key never leaves this module: every message goes through redact().
 */

export const SEEDANCE_DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
export const SEEDANCE_MODELS = Object.freeze({
  mini: "dreamina-seedance-2-0-mini-260615",
  standard: "dreamina-seedance-2-0-260128",
});
// Measured 2026-10-16: 2 s and 16 s are refused, 4 s and 12 s accepted.
export const SEEDANCE_MIN_SEC = 4;
export const SEEDANCE_MAX_SEC = 12;
export const NO_TEXT_LINE = "No text, no captions, no logos.";

const RATIOS = Object.freeze({ portrait: "9:16", landscape: "16:9", square: "1:1" });
const IMAGE_MIME = Object.freeze({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" });
// BytePlus refuses a start frame that "may contain real person"; the scene
// is then made from its prompt alone.
const PERSON_REFUSAL = /^InputImageSensitiveContentDetected/;
const SENSITIVE = /SensitiveContent/;
const FAILED_STATES = new Set(["failed", "cancelled", "expired"]);
const MAX_FIRST_FRAME_BYTES = 10 * 1024 * 1024;

function apiKey() {
  return String(process.env.BYTEPLUS_ARK_API_KEY || "").trim();
}

function tasksUrl() {
  const base = String(process.env.BYTEPLUS_ARK_BASE_URL || SEEDANCE_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return `${base}/contents/generations/tasks`;
}

function headers() {
  return { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", Accept: "application/json" };
}

function redact(text) {
  const key = apiKey();
  const s = String(text ?? "");
  return key ? s.split(key).join("[redacted]") : s;
}

export function isSeedanceConfigured() {
  return apiKey() !== "";
}

export function seedanceRatio(aspect) {
  return RATIOS[aspect] || RATIOS.portrait;
}

export function clampSeedanceDuration(sec) {
  const whole = Math.ceil(Number(sec) || 0);
  return Math.min(SEEDANCE_MAX_SEC, Math.max(SEEDANCE_MIN_SEC, whole));
}

export function withNoText(prompt) {
  const p = String(prompt || "").trim();
  return p.includes(NO_TEXT_LINE) ? p : `${p} ${NO_TEXT_LINE}`.trim();
}

/** The scene's picture as a first-frame item, or null when it can't be sent. */
function firstFrameItem(file) {
  if (!file) return null;
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) return null;
  try {
    if (fs.statSync(file).size > MAX_FIRST_FRAME_BYTES) return null;
    const bytes = fs.readFileSync(file);
    return { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` }, role: "first_frame" };
  } catch {
    return null;
  }
}

/** BytePlus sends errors as { error: { code, message } } or flat { code, message }. */
function errorOf(json, status) {
  const e = json?.error && typeof json.error === "object" ? json.error : json || {};
  return { code: String(e.code || `HTTP_${status}`), message: redact(e.message || `Seedance HTTP ${status}`) };
}

function refusal(err) {
  if (SENSITIVE.test(err.code)) {
    return { ok: false, code: "REFUSED", error: "BytePlus declined this scene's prompt. Edit the prompt and try again." };
  }
  return { ok: false, code: err.code, error: err.message };
}

async function postTask(body, fetcher) {
  const res = await fetcher(tasksUrl(), { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && Boolean(json?.id), status: res.status, json };
}

export async function submitSeedanceTask({
  prompt, firstFramePath = null, aspect = "portrait", durationSec = 5,
  model = SEEDANCE_MODELS.mini, resolution = "720p", fetchImpl,
} = {}) {
  if (!isSeedanceConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", error: "AI video is not set up on this server (BYTEPLUS_ARK_API_KEY)." };
  }
  const text = withNoText(prompt);
  if (text === NO_TEXT_LINE) return { ok: false, code: "BAD_REQUEST", error: "A prompt is required." };
  const fetcher = fetchImpl || fetch;
  const base = {
    model, ratio: seedanceRatio(aspect), resolution, duration: clampSeedanceDuration(durationSec),
    generate_audio: false, watermark: false,
  };
  try {
    const frame = firstFrameItem(firstFramePath);
    if (frame) {
      const first = await postTask({ ...base, content: [{ type: "text", text }, frame] }, fetcher);
      if (first.ok) return { ok: true, taskId: first.json.id, mode: "image" };
      const err = errorOf(first.json, first.status);
      if (!PERSON_REFUSAL.test(err.code)) return refusal(err);
    }
    const plain = await postTask({ ...base, content: [{ type: "text", text }] }, fetcher);
    if (plain.ok) return { ok: true, taskId: plain.json.id, mode: "text" };
    return refusal(errorOf(plain.json, plain.status));
  } catch (e) {
    return { ok: false, code: "REQUEST_FAILED", error: redact(e?.message || e) };
  }
}

export async function getSeedanceTask(taskId, { fetchImpl } = {}) {
  const fetcher = fetchImpl || fetch;
  const res = await fetcher(`${tasksUrl()}/${encodeURIComponent(taskId)}`, { headers: headers() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = errorOf(json, res.status);
    return { status: "unknown", httpStatus: res.status, error: err.message };
  }
  return {
    status: String(json.status || "unknown"),
    videoUrl: json.content?.video_url || null,
    tokens: Number(json.usage?.completion_tokens) || 0,
    error: json.error ? redact(json.error.message || json.error.code || "failed") : null,
  };
}

export async function waitForSeedanceTask(taskId, {
  fetchImpl, pollMs = 10_000, timeoutMs = 15 * 60_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
} = {}) {
  const start = now();
  for (;;) {
    let task;
    try {
      task = await getSeedanceTask(taskId, { fetchImpl });
    } catch (e) {
      // A network blip is not a failed clip: keep polling until the limit.
      task = { status: "unknown", error: redact(e?.message || e) };
    }
    if (task.status === "succeeded") {
      if (!task.videoUrl) return { ok: false, code: "NO_VIDEO", error: "BytePlus finished the clip but sent no video." };
      return { ok: true, videoUrl: task.videoUrl, tokens: task.tokens };
    }
    if (FAILED_STATES.has(task.status)) {
      return { ok: false, code: "FAILED", error: task.error || `BytePlus reported the clip as ${task.status}.` };
    }
    if (task.httpStatus === 404) return { ok: false, code: "NOT_FOUND", error: "BytePlus no longer has this clip." };
    if (now() - start >= timeoutMs) return { ok: false, code: "TIMEOUT", error: "BytePlus took too long to make the clip." };
    await sleep(pollMs);
  }
}

export async function downloadSeedanceVideo(url, destFile, { fetchImpl } = {}) {
  const fetcher = fetchImpl || fetch;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Downloading the clip failed (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("The clip BytePlus sent was empty.");
  const tmp = `${destFile}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, destFile);
  return buf.length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test src/lib/videoGen/providers/seedance.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Document the env vars and commit**

Append to `server/.env.example`:

```
# AI scenes (BytePlus ModelArk Seedance) — super admins only
BYTEPLUS_ARK_API_KEY=
# BYTEPLUS_ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
# Monthly spend cap in US$ across every super admin (default 30)
# VIDEO_GEN_MONTHLY_CAP_USD=30
# Fraction of list price actually charged, e.g. 0.4 during a promotion (default 1)
# VIDEO_GEN_PRICE_MULTIPLIER=1
```

```bash
git add server/src/lib/videoGen/providers/seedance.js server/src/lib/videoGen/providers/seedance.test.js server/.env.example
git commit -m "feat: Seedance provider with submit, wait and download steps"
```

---

### Task 2: Spend ledger and cap

**Files:**
- Create: `server/src/lib/videoGen/spend.js`
- Test: `server/src/lib/videoGen/spend.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PRICE_PER_MILLION_USD`
  - `FRAME_SIZES`
  - `estimateTokens({ durationSec, ratio?, resolution?, fps? }): number`
  - `priceMultiplier(): number`
  - `usdForTokens({ model, resolution?, tokens }): number`
  - `usdPerSecond({ model, resolution, ratio }): number`
  - `monthlyCapUsd(): number`
  - `monthKey(now?: Date): string`
  - `capMessage(projectedUsd: number, now?: Date): string`
  - `readLedger(dir, now?)`
  - `ledgerSummary(dir, now?): { month, spentUsd, reservedUsd, capUsd, clips }`
  - `wouldExceedCap(dir, extraUsd, now?): { exceeded: boolean, projectedUsd: number, error?: string }`
  - `reserveSpend(dir, key, usd, now?): { ok:true } | { ok:false, error:string }`
  - `settleSpend(dir, key, { model, resolution, tokens }, now?): number` (returns the actual usd)
  - `releaseSpend(dir, key, now?): void`

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/videoGen/spend.test.js`:

```js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  estimateTokens, usdForTokens, usdPerSecond, priceMultiplier, monthlyCapUsd, monthKey, capMessage,
  readLedger, ledgerSummary, wouldExceedCap, reserveSpend, settleSpend, releaseSpend,
} from "./spend.js";

const MINI = "dreamina-seedance-2-0-mini-260615";
const OCT = new Date("2026-10-16T09:00:00Z");
const NOV = new Date("2026-11-01T00:00:01Z");
let dir;
let saved;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "spend-"));
  saved = { cap: process.env.VIDEO_GEN_MONTHLY_CAP_USD, mult: process.env.VIDEO_GEN_PRICE_MULTIPLIER };
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_PRICE_MULTIPLIER;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of [["VIDEO_GEN_MONTHLY_CAP_USD", saved.cap], ["VIDEO_GEN_PRICE_MULTIPLIER", saved.mult]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("pricing", () => {
  test("tokens follow BytePlus's formula (5 s at 720×1280 = 108,000)", () => {
    assert.equal(estimateTokens({ durationSec: 5, ratio: "9:16", resolution: "720p" }), 108000);
    assert.equal(estimateTokens({ durationSec: 4, ratio: "16:9", resolution: "1080p" }), 4 * 1920 * 1080 * 24 / 1024);
  });
  test("the 2026-10-16 test: 998,100 tokens on Mini", () => {
    assert.equal(usdForTokens({ model: MINI, resolution: "720p", tokens: 998100 }).toFixed(4), "3.4934");
    process.env.VIDEO_GEN_PRICE_MULTIPLIER = "0.4";
    assert.equal(usdForTokens({ model: MINI, resolution: "720p", tokens: 998100 }).toFixed(4), "1.3973");
  });
  test("an unknown model is priced at the dearest known rate, never cheaper", () => {
    assert.equal(usdForTokens({ model: "something-new", tokens: 1_000_000 }), 11.7);
  });
  test("a nonsense multiplier falls back to list price", () => {
    process.env.VIDEO_GEN_PRICE_MULTIPLIER = "5";
    assert.equal(priceMultiplier(), 1);
    process.env.VIDEO_GEN_PRICE_MULTIPLIER = "-1";
    assert.equal(priceMultiplier(), 1);
  });
  test("price per second for a quality and frame", () => {
    assert.equal(usdPerSecond({ model: MINI, resolution: "720p", ratio: "9:16" }).toFixed(4), (21600 / 1e6 * 3.5).toFixed(4));
  });
  test("cap defaults to $30 and reads the env", () => {
    assert.equal(monthlyCapUsd(), 30);
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "12.5";
    assert.equal(monthlyCapUsd(), 12.5);
  });
  test("the refusal says the month and the totals", () => {
    assert.equal(capMessage(31.2, OCT), "This would take October's AI video spend to $31.20 of $30.");
  });
});

describe("ledger", () => {
  test("starts empty", () => {
    assert.deepEqual(ledgerSummary(dir, OCT), { month: "2026-10", spentUsd: 0, reservedUsd: 0, capUsd: 30, clips: 0 });
  });
  test("reserve, then settle replaces the estimate with the real cost", () => {
    assert.deepEqual(reserveSpend(dir, "p:s1", 0.5, OCT), { ok: true });
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0.5);
    const usd = settleSpend(dir, "p:s1", { model: MINI, resolution: "720p", tokens: 108900 }, OCT);
    assert.equal(usd.toFixed(5), (108900 / 1e6 * 3.5).toFixed(5));
    const sum = ledgerSummary(dir, OCT);
    assert.equal(sum.reservedUsd, 0);
    assert.equal(sum.spentUsd.toFixed(5), usd.toFixed(5));
    assert.equal(sum.clips, 1);
  });
  test("release drops a reservation without spending", () => {
    reserveSpend(dir, "p:s1", 0.5, OCT);
    releaseSpend(dir, "p:s1", OCT);
    assert.deepEqual(ledgerSummary(dir, OCT), { month: "2026-10", spentUsd: 0, reservedUsd: 0, capUsd: 30, clips: 0 });
  });
  test("a reservation that would cross the cap is refused", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    assert.equal(reserveSpend(dir, "p:s1", 0.6, OCT).ok, true);
    const r = reserveSpend(dir, "p:s2", 0.6, OCT);
    assert.equal(r.ok, false);
    assert.equal(r.error, "This would take October's AI video spend to $1.20 of $1.");
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0.6);
  });
  test("re-reserving the same key replaces it rather than adding", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(dir, "p:s1", 0.6, OCT);
    assert.equal(reserveSpend(dir, "p:s1", 0.9, OCT).ok, true);
    assert.equal(ledgerSummary(dir, OCT).reservedUsd, 0.9);
  });
  test("wouldExceedCap checks a whole batch", () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(dir, "p:s1", 0.6, OCT);
    assert.equal(wouldExceedCap(dir, 0.3, OCT).exceeded, false);
    const over = wouldExceedCap(dir, 0.5, OCT);
    assert.equal(over.exceeded, true);
    assert.equal(over.error, "This would take October's AI video spend to $1.10 of $1.");
  });
  test("a new month starts from nothing spent but keeps clips still being made", () => {
    reserveSpend(dir, "p:s1", 0.5, OCT);
    settleSpend(dir, "p:s2", { model: MINI, resolution: "720p", tokens: 1_000_000 }, OCT);
    const nov = readLedger(dir, NOV);
    assert.equal(nov.month, "2026-11");
    assert.equal(nov.settledUsd, 0);
    assert.deepEqual(nov.reservations, { "p:s1": 0.5 });
    assert.equal(monthKey(NOV), "2026-11");
  });
  test("a corrupt ledger file reads as empty instead of throwing", () => {
    fs.writeFileSync(path.join(dir, "videogen-spend.json"), "{not json");
    assert.equal(ledgerSummary(dir, OCT).spentUsd, 0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test src/lib/videoGen/spend.test.js`
Expected: FAIL with `Cannot find module` … `spend.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/lib/videoGen/spend.js`:

```js
import fs from "fs";
import path from "path";

/**
 * What AI video has cost this month, against a cap, in one JSON file.
 *
 * One BytePlus balance pays for every clip and every super admin resolves to
 * the shared DATA_DIR, so callers pass DATA_DIR and there is one ledger.
 * Before a clip is ordered its estimated cost is reserved; when BytePlus
 * reports the real token count the reservation is replaced by the actual
 * cost (settle), or dropped when no clip was made (release). Every call
 * reads and writes synchronously (temp file + rename), so workers in this
 * process cannot interleave.
 */

const FILE = "videogen-spend.json";

/** US$ per million output tokens: BytePlus list prices of 2026-10-08. */
export const PRICE_PER_MILLION_USD = Object.freeze({
  "dreamina-seedance-2-0-mini-260615": Object.freeze({ "720p": 3.5, "1080p": 3.5 }),
  "dreamina-seedance-2-0-260128": Object.freeze({ "720p": 7.0, "1080p": 7.7 }),
  "dreamina-seedance-2-0-fast-260128": Object.freeze({ "720p": 5.6, "1080p": 5.6 }),
});
// The dearest known rate (Seedance 2.5 at 1080p), so an unknown model is never under-counted.
const FALLBACK_PER_MILLION_USD = 11.7;

export const FRAME_SIZES = Object.freeze({
  "720p": Object.freeze({ "9:16": [720, 1280], "16:9": [1280, 720], "1:1": [960, 960] }),
  "1080p": Object.freeze({ "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1440, 1440] }),
});

export function estimateTokens({ durationSec, ratio = "9:16", resolution = "720p", fps = 24 }) {
  const [w, h] = FRAME_SIZES[resolution]?.[ratio] || FRAME_SIZES["720p"]["9:16"];
  return Math.round(((Number(durationSec) || 0) * w * h * fps) / 1024);
}

export function priceMultiplier() {
  const m = Number(process.env.VIDEO_GEN_PRICE_MULTIPLIER);
  return Number.isFinite(m) && m > 0 && m <= 1 ? m : 1;
}

export function usdForTokens({ model, resolution = "720p", tokens }) {
  const rate = PRICE_PER_MILLION_USD[model]?.[resolution] ?? FALLBACK_PER_MILLION_USD;
  return ((Number(tokens) || 0) / 1_000_000) * rate * priceMultiplier();
}

export function usdPerSecond({ model, resolution, ratio }) {
  return usdForTokens({ model, resolution, tokens: estimateTokens({ durationSec: 1, ratio, resolution }) });
}

export function monthlyCapUsd() {
  const cap = Number(process.env.VIDEO_GEN_MONTHLY_CAP_USD);
  return process.env.VIDEO_GEN_MONTHLY_CAP_USD !== undefined && Number.isFinite(cap) && cap >= 0 ? cap : 30;
}

export function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

const money = (usd) => `$${(Math.round(usd * 100) / 100).toFixed(2)}`;
const capText = (cap) => (Number.isInteger(cap) ? `$${cap}` : money(cap));

export function capMessage(projectedUsd, now = new Date()) {
  const month = now.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `This would take ${month}'s AI video spend to ${money(projectedUsd)} of ${capText(monthlyCapUsd())}.`;
}

function emptyLedger(month, reservations = {}) {
  return { month, settledUsd: 0, tokens: 0, clips: 0, reservations };
}

export function readLedger(dir, now = new Date()) {
  const month = monthKey(now);
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return emptyLedger(month);
  const reservations = raw.reservations && typeof raw.reservations === "object" ? raw.reservations : {};
  // A new month starts from nothing spent; clips still being made carry over.
  if (raw.month !== month) return emptyLedger(month, reservations);
  return {
    month,
    settledUsd: Number(raw.settledUsd) || 0,
    tokens: Number(raw.tokens) || 0,
    clips: Number(raw.clips) || 0,
    reservations,
  };
}

function writeLedger(dir, ledger) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, file);
  return ledger;
}

const reservedTotal = (ledger) => Object.values(ledger.reservations).reduce((a, v) => a + (Number(v) || 0), 0);

export function ledgerSummary(dir, now = new Date()) {
  const l = readLedger(dir, now);
  return { month: l.month, spentUsd: l.settledUsd, reservedUsd: reservedTotal(l), capUsd: monthlyCapUsd(), clips: l.clips };
}

export function wouldExceedCap(dir, extraUsd, now = new Date()) {
  const l = readLedger(dir, now);
  const projectedUsd = l.settledUsd + reservedTotal(l) + (Number(extraUsd) || 0);
  if (projectedUsd > monthlyCapUsd() + 1e-9) return { exceeded: true, projectedUsd, error: capMessage(projectedUsd, now) };
  return { exceeded: false, projectedUsd };
}

export function reserveSpend(dir, key, usd, now = new Date()) {
  const l = readLedger(dir, now);
  const others = reservedTotal(l) - (Number(l.reservations[key]) || 0);
  const projected = l.settledUsd + others + usd;
  if (projected > monthlyCapUsd() + 1e-9) return { ok: false, error: capMessage(projected, now) };
  writeLedger(dir, { ...l, reservations: { ...l.reservations, [key]: usd } });
  return { ok: true };
}

export function settleSpend(dir, key, { model, resolution, tokens }, now = new Date()) {
  const l = readLedger(dir, now);
  const usd = usdForTokens({ model, resolution, tokens });
  const { [key]: _settled, ...rest } = l.reservations;
  writeLedger(dir, {
    ...l,
    reservations: rest,
    settledUsd: l.settledUsd + usd,
    tokens: l.tokens + (Number(tokens) || 0),
    clips: l.clips + 1,
  });
  return usd;
}

export function releaseSpend(dir, key, now = new Date()) {
  const l = readLedger(dir, now);
  if (!(key in l.reservations)) return;
  const { [key]: _released, ...rest } = l.reservations;
  writeLedger(dir, { ...l, reservations: rest });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test src/lib/videoGen/spend.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/videoGen/spend.js server/src/lib/videoGen/spend.test.js
git commit -m "feat: monthly AI video spend ledger with reserve, settle and cap"
```

---

### Task 3: Animate stage (clips onto scenes, restart-safe)

**Files:**
- Create: `server/src/lib/story/animateStage.js`
- Test: `server/src/lib/story/animateStage.test.js`

**Interfaces:**
- Consumes:
  - Task 1: `SEEDANCE_MODELS`, `clampSeedanceDuration`, `seedanceRatio`, `submitSeedanceTask`, `waitForSeedanceTask`, `downloadSeedanceVideo`.
  - Task 2: `estimateTokens`, `usdForTokens`, `usdPerSecond`, `reserveSpend`, `settleSpend`, `releaseSpend`.
  - Existing:
    - `readProject`, `writeProject`, `listProjects` from `./projectStore.js`;
    - `resolveSceneVideo({ outputDir, uploadPath })` from `./sceneVideo.js`. It accepts a flat file named `bg-video-<uuid>.mp4` in `outputDir` and returns `{ ok, videoPath, videoUrl, posterPath, ... }`.
- Produces:
  - `ANIMATE_CONCURRENCY = 3`
  - `AI_QUALITY: { standard: { model, resolution }, high: { model, resolution } }`
  - `qualityOf(q: unknown): "standard"|"high"`
  - `sceneClipSec(scene): number`
  - `animatePrompt(scene): string`
  - `animatableScenes(project, sceneIds?: string[]): Scene[]`. With no `sceneIds` it returns scenes not yet animated. With explicit ids it includes animated ones, for a re-roll.
  - `estimateAnimation(project, sceneIds?, quality?): { clips, seconds, usd, usdPerSecond, model, resolution, sceneIds: string[] }`
  - `startAnimation(ctx: { dataDir, outputDir }, projectId, { sceneIds?, quality?, ledgerDir, deps? }): Project | null`. It is synchronous: it marks the scenes `queued`, writes the project, and runs the clips in the background.
  - `isAnimating(projectId): boolean`
  - `cancelAnimation(projectId): void`
  - `resumeAnimations(ctx, { ledgerDir, deps? }): Promise<number>` (the number of clips being collected)
  - Scene fields written:
    - `aiVideoStatus` (`"none"|"queued"|"generating"|"done"|"error"`);
    - `aiVideoTaskId`, `aiVideoError`, `aiVideoModel`, `aiVideoResolution`;
    - `aiVideoMode` (`"image"|"text"`);
    - `aiVideoStartedAt` (ms), `aiVideoCostUsd`;
    - on success, also `videoPath`, `videoUrl`, `mediaKind:"video"`.
  - `deps` shape: `{ submit, wait, download, resolveClip, now }`. These default to the real Task 1 functions, `resolveSceneVideo` and `Date.now`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/lib/story/animateStage.test.js`:

```js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, writeProject } from "./projectStore.js";
import { ledgerSummary } from "../videoGen/spend.js";
import {
  AI_QUALITY, sceneClipSec, animatePrompt, animatableScenes, estimateAnimation,
  startAnimation, isAnimating, cancelAnimation, resumeAnimations,
} from "./animateStage.js";

let dataDir, outputDir, ledgerDir, savedCap;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-out-"));
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-ledger-"));
  savedCap = process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
  delete process.env.VIDEO_GEN_PRICE_MULTIPLIER;
});
afterEach(() => {
  if (savedCap === undefined) delete process.env.VIDEO_GEN_MONTHLY_CAP_USD; else process.env.VIDEO_GEN_MONTHLY_CAP_USD = savedCap;
  for (const d of [dataDir, outputDir, ledgerDir]) fs.rmSync(d, { recursive: true, force: true });
});

const ctx = () => ({ dataDir, outputDir });

function scene(i, over = {}) {
  const pic = path.join(outputDir, `pic-${i}.png`);
  fs.writeFileSync(pic, "png");
  return {
    id: `s${i}`, text: `Scene ${i}`, startMs: i * 5000, endMs: i * 5000 + 5000,
    imagePrompt: `prompt ${i}`, imagePath: pic, imageUrl: `/outputs/pic-${i}.png`,
    imageStatus: "done", promptEditedByUser: false, mediaKind: "image", ...over,
  };
}

function project(scenes, over = {}) {
  const p = createProject(dataDir, { title: "Philippians" });
  return writeProject(dataDir, { ...p, status: "ready_to_render", scenes, ...over });
}

async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Fake BytePlus + ffmpeg: every clip succeeds unless told otherwise. */
function fakeDeps(over = {}) {
  const calls = { submit: [], wait: [] };
  const deps = {
    submit: async (args) => { calls.submit.push(args); return { ok: true, taskId: `t-${calls.submit.length}`, mode: "image" }; },
    wait: async (taskId) => { calls.wait.push(taskId); return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 }; },
    download: async (_url, dest) => { fs.writeFileSync(dest, "mp4"); return 3; },
    resolveClip: async ({ outputDir: dir, uploadPath }) => ({
      ok: true, videoPath: path.join(dir, uploadPath), videoUrl: `/outputs/${uploadPath}`,
      posterPath: path.join(dir, `${uploadPath}-poster.jpg`), posterUrl: "/p.jpg", durationSec: 5, width: 720, height: 1280,
    }),
    now: () => Date.now(),
    ...over,
  };
  return { deps, calls };
}

const MINI_5S_USD = 108000 / 1e6 * 3.5;

describe("pricing and choice of scenes", () => {
  test("clip length is the scene length clamped to 4–12 s", () => {
    assert.equal(sceneClipSec({ startMs: 0, endMs: 2000 }), 4);
    assert.equal(sceneClipSec({ startMs: 0, endMs: 7300 }), 8);
    assert.equal(sceneClipSec({ startMs: 0, endMs: 40000 }), 12);
  });
  test("the prompt is the picture's prompt plus a motion line", () => {
    assert.equal(animatePrompt({ imagePrompt: "A lamp." }), "A lamp. Slow push-in, gentle light shift, subtle natural movement.");
  });
  test("only scenes with a finished picture, not already moving, are animated", () => {
    const p = project([
      scene(0),
      scene(1, { imageStatus: "error", imagePath: null }),
      scene(2, { aiVideoStatus: "generating" }),
      scene(3, { aiVideoStatus: "done" }),
    ]);
    assert.deepEqual(animatableScenes(p).map((s) => s.id), ["s0"]);
    assert.deepEqual(animatableScenes(p, ["s3"]).map((s) => s.id), ["s3"], "an explicit re-roll includes an animated scene");
  });
  test("the estimate prices 5 s + 10 s of Mini at 720p portrait", () => {
    const p = project([scene(0), scene(1, { endMs: 15000 })]);
    const est = estimateAnimation(p, undefined, "standard");
    assert.equal(est.clips, 2);
    assert.equal(est.seconds, 15);
    assert.equal(est.usd.toFixed(4), (15 * 21600 / 1e6 * 3.5).toFixed(4));
    assert.equal(est.model, AI_QUALITY.standard.model);
    assert.deepEqual(est.sceneIds, ["s0", "s1"]);
  });
});

describe("startAnimation", () => {
  test("marks scenes queued at once, then puts each clip on its scene", async () => {
    const p = project([scene(0), scene(1)]);
    const { deps, calls } = fakeDeps();
    const written = startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    assert.deepEqual(written.scenes.map((s) => s.aiVideoStatus), ["queued", "queued"]);
    await waitFor(() => !isAnimating(p.projectId));
    const after = readProject(dataDir, p.projectId).scenes;
    for (const s of after) {
      assert.equal(s.aiVideoStatus, "done");
      assert.equal(s.mediaKind, "video");
      assert.match(s.videoUrl, /^\/outputs\/bg-video-[0-9a-f-]{36}\.mp4$/);
      assert.ok(s.imagePath.endsWith(`pic-${s.id.slice(1)}.png`), "the picture stays as the poster");
      assert.equal(s.aiVideoCostUsd.toFixed(5), MINI_5S_USD.toFixed(5));
    }
    assert.equal(calls.submit[0].firstFramePath, after[0].imagePath);
    assert.equal(calls.submit[0].durationSec, 5);
    assert.equal(calls.submit[0].aspect, "portrait");
    const sum = ledgerSummary(ledgerDir);
    assert.equal(sum.reservedUsd, 0);
    assert.equal(sum.spentUsd.toFixed(5), (2 * MINI_5S_USD).toFixed(5));
  });

  test("the task id is saved before waiting on BytePlus", async () => {
    const p = project([scene(0)]);
    let seenDuringWait = null;
    const { deps } = fakeDeps({
      wait: async (taskId) => {
        seenDuringWait = readProject(dataDir, p.projectId).scenes[0];
        return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(seenDuringWait.aiVideoStatus, "generating");
    assert.equal(seenDuringWait.aiVideoTaskId, "t-1");
    assert.equal(seenDuringWait.aiVideoMode, "image");
  });

  test("never more than 3 clips are ordered at once", async () => {
    const p = project([0, 1, 2, 3, 4].map((i) => scene(i)));
    let live = 0, peak = 0;
    const { deps } = fakeDeps({
      wait: async (taskId) => {
        live += 1; peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 20));
        live -= 1;
        return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(peak, 3);
  });

  test("a failed clip leaves the picture and releases the reservation", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ wait: async () => ({ ok: false, code: "FAILED", error: "model busy" }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.equal(s.aiVideoError, "model busy");
    assert.equal(s.mediaKind, "image");
    assert.equal(s.videoPath, undefined);
    assert.deepEqual(ledgerSummary(ledgerDir).reservedUsd, 0);
    assert.deepEqual(ledgerSummary(ledgerDir).spentUsd, 0);
  });

  test("a refused order leaves the picture with BytePlus's reason", async () => {
    const p = project([scene(0)]);
    const { deps } = fakeDeps({ submit: async () => ({ ok: false, code: "REFUSED", error: "BytePlus declined this scene's prompt. Edit the prompt and try again." }) });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.match(s.aiVideoError, /declined/);
    assert.equal(ledgerSummary(ledgerDir).reservedUsd, 0);
  });

  test("when the cap is reached part-way, the rest fail with the budget message", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "0.5";
    const p = project([scene(0), scene(1), scene(2)]);
    const { deps, calls } = fakeDeps();
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const statuses = readProject(dataDir, p.projectId).scenes.map((s) => s.aiVideoStatus);
    assert.deepEqual(statuses, ["done", "error", "error"]);
    assert.match(readProject(dataDir, p.projectId).scenes[1].aiVideoError, /^This would take .* AI video spend to \$0\.76 of \$0\.50\.$/);
    assert.equal(calls.submit.length, 1);
  });

  test("a new picture chosen mid-flight is kept; the late clip is paid for but dropped", async () => {
    const p = project([scene(0)]);
    const newPic = path.join(outputDir, "new.png");
    fs.writeFileSync(newPic, "png");
    const { deps } = fakeDeps({
      wait: async (taskId) => {
        // What PUT /scenes/:sid/image does: new picture, AI fields reset.
        const fresh = readProject(dataDir, p.projectId);
        writeProject(dataDir, { ...fresh, scenes: fresh.scenes.map((s) => ({ ...s, imagePath: newPic, mediaKind: "image", videoPath: null, videoUrl: null, aiVideoStatus: "none", aiVideoTaskId: null, aiVideoError: null })) });
        return { ok: true, videoUrl: `https://cdn/${taskId}.mp4`, tokens: 108000 };
      },
    });
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    await waitFor(() => !isAnimating(p.projectId));
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.imagePath, newPic);
    assert.equal(s.mediaKind, "image");
    assert.equal(s.aiVideoStatus, "none");
    assert.equal(ledgerSummary(ledgerDir).spentUsd.toFixed(5), MINI_5S_USD.toFixed(5));
    assert.deepEqual(fs.readdirSync(outputDir).filter((f) => f.startsWith("bg-video-")), []);
  });

  test("Stop orders no more clips; clips already ordered still arrive", async () => {
    const p = project([0, 1, 2, 3].map((i) => scene(i)));
    const { deps, calls } = fakeDeps();
    startAnimation(ctx(), p.projectId, { ledgerDir, deps });
    cancelAnimation(p.projectId);
    await waitFor(() => !isAnimating(p.projectId));
    const scenes = readProject(dataDir, p.projectId).scenes;
    assert.equal(calls.submit.length, 3);
    assert.deepEqual(scenes.map((s) => s.aiVideoStatus), ["done", "done", "done", "error"]);
    assert.equal(scenes[3].aiVideoError, "Stopped before this clip was ordered.");
  });

  test("a second run on the same project is refused while one is going", () => {
    const p = project([scene(0), scene(1)]);
    const { deps } = fakeDeps({ wait: () => new Promise(() => {}) });
    assert.ok(startAnimation(ctx(), p.projectId, { ledgerDir, deps, sceneIds: ["s0"] }));
    assert.equal(startAnimation(ctx(), p.projectId, { ledgerDir, deps, sceneIds: ["s1"] }), null);
  });

  test("nothing to animate returns null and writes nothing", () => {
    const p = project([scene(0, { imageStatus: "error", imagePath: null })]);
    const { deps } = fakeDeps();
    assert.equal(startAnimation(ctx(), p.projectId, { ledgerDir, deps }), null);
    assert.equal(isAnimating(p.projectId), false);
  });
});

describe("resumeAnimations (after a restart)", () => {
  test("collects a paid-for clip by its saved task id without ordering another", async () => {
    const now = Date.now();
    const p = project([scene(0, { aiVideoStatus: "generating", aiVideoTaskId: "t-old", aiVideoStartedAt: now - 3600_000, aiVideoModel: AI_QUALITY.standard.model, aiVideoResolution: "720p" })]);
    const { deps, calls } = fakeDeps();
    const n = await resumeAnimations(ctx(), { ledgerDir, deps });
    assert.equal(n, 1);
    assert.equal(calls.submit.length, 0);
    assert.deepEqual(calls.wait, ["t-old"]);
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "done");
    assert.equal(s.mediaKind, "video");
  });

  test("a scene queued but never ordered is marked failed and its reservation released", async () => {
    const p = project([scene(0, { aiVideoStatus: "queued", aiVideoTaskId: null })]);
    const { deps, calls } = fakeDeps();
    await resumeAnimations(ctx(), { ledgerDir, deps });
    assert.equal(calls.wait.length, 0);
    const s = readProject(dataDir, p.projectId).scenes[0];
    assert.equal(s.aiVideoStatus, "error");
    assert.equal(s.aiVideoError, "Interrupted by a server restart before the clip was ordered. Animate it again.");
  });

  test("a clip ordered more than 24 h ago is marked expired, not polled", async () => {
    const p = project([scene(0, { aiVideoStatus: "generating", aiVideoTaskId: "t-old", aiVideoStartedAt: Date.now() - 25 * 3600_000 })]);
    const { deps, calls } = fakeDeps();
    await resumeAnimations(ctx(), { ledgerDir, deps });
    assert.equal(calls.wait.length, 0);
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoError, "This clip expired at BytePlus. Animate it again.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test src/lib/story/animateStage.test.js`
Expected: FAIL with `Cannot find module` … `animateStage.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/lib/story/animateStage.js`:

```js
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { readProject, writeProject, listProjects } from "./projectStore.js";
import { resolveSceneVideo } from "./sceneVideo.js";
import {
  SEEDANCE_MODELS, clampSeedanceDuration, seedanceRatio,
  submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "../videoGen/providers/seedance.js";
import { estimateTokens, usdForTokens, usdPerSecond, reserveSpend, settleSpend, releaseSpend } from "../videoGen/spend.js";

/**
 * Animate: turn a Story scene's finished picture into a short Seedance clip.
 *
 * The clip lands in the scene's existing videoPath / mediaKind:"video"
 * fields, which the render already plays, and the picture stays as the
 * poster. Each clip is reserved in the spend ledger before it is ordered and
 * settled against BytePlus's real token count after. The task id is saved
 * on the scene BEFORE waiting, so after a restart resumeAnimations collects
 * a paid-for clip instead of ordering it again. A clip that fails leaves the
 * picture in place; the render never waits for animation.
 */

export const ANIMATE_CONCURRENCY = 3;
export const AI_QUALITY = Object.freeze({
  standard: Object.freeze({ model: SEEDANCE_MODELS.mini, resolution: "720p" }),
  high: Object.freeze({ model: SEEDANCE_MODELS.standard, resolution: "1080p" }),
});

const MOTION_LINE = "Slow push-in, gentle light shift, subtle natural movement.";
const TASK_LIFETIME_MS = 24 * 60 * 60 * 1000;
const IN_FLIGHT = new Set(["queued", "generating"]);

const defaultDeps = Object.freeze({
  submit: submitSeedanceTask,
  wait: waitForSeedanceTask,
  download: downloadSeedanceVideo,
  resolveClip: resolveSceneVideo,
  now: () => Date.now(),
});

const runs = new Set(); // projects with an Animate run in this process
const cancels = new Set(); // projects asked to stop ordering clips

export function isAnimating(projectId) {
  return runs.has(projectId);
}

export function cancelAnimation(projectId) {
  cancels.add(projectId);
}

export function qualityOf(q) {
  return Object.hasOwn(AI_QUALITY, q) ? q : "standard";
}

export function sceneClipSec(scene) {
  return clampSeedanceDuration(((scene.endMs || 0) - (scene.startMs || 0)) / 1000);
}

export function animatePrompt(scene) {
  return `${String(scene.imagePrompt || scene.text || "").trim()} ${MOTION_LINE}`.trim();
}

const ledgerKey = (projectId, sceneId) => `${projectId}:${sceneId}`;

export function animatableScenes(project, sceneIds) {
  const wanted = Array.isArray(sceneIds) && sceneIds.length ? new Set(sceneIds) : null;
  return (project.scenes || []).filter((s) => {
    if (s.imageStatus !== "done" || !s.imagePath || IN_FLIGHT.has(s.aiVideoStatus)) return false;
    // "Animate all" skips scenes already animated; naming one re-rolls it.
    return wanted ? wanted.has(s.id) : s.aiVideoStatus !== "done";
  });
}

export function estimateAnimation(project, sceneIds, quality = "standard") {
  const { model, resolution } = AI_QUALITY[qualityOf(quality)];
  const ratio = seedanceRatio(project.aspect);
  const scenes = animatableScenes(project, sceneIds);
  let seconds = 0;
  let usd = 0;
  for (const s of scenes) {
    const sec = sceneClipSec(s);
    seconds += sec;
    usd += usdForTokens({ model, resolution, tokens: estimateTokens({ durationSec: sec, ratio, resolution }) });
  }
  return {
    clips: scenes.length, seconds, usd, model, resolution,
    usdPerSecond: usdPerSecond({ model, resolution, ratio }),
    sceneIds: scenes.map((s) => s.id),
  };
}

/** Rewrite one scene from the latest project on disk; fn returns null to leave it. */
function patchScene(dataDir, projectId, sceneId, fn) {
  const fresh = readProject(dataDir, projectId);
  if (!fresh) return null;
  let changed = null;
  const scenes = (fresh.scenes || []).map((s) => {
    if (s.id !== sceneId) return s;
    changed = fn(s);
    return changed || s;
  });
  if (!changed) return null;
  writeProject(dataDir, { ...fresh, scenes, updatedAt: Date.now() });
  return changed;
}

/** Fail a scene, but only while it is still waiting on this same order. */
function markError(dataDir, projectId, sceneId, taskId, message) {
  patchScene(dataDir, projectId, sceneId, (s) => (
    (s.aiVideoTaskId ?? null) === (taskId ?? null) && IN_FLIGHT.has(s.aiVideoStatus)
      ? { ...s, aiVideoStatus: "error", aiVideoError: message }
      : null
  ));
}

function removeClipFiles(clip) {
  for (const f of [clip.videoPath, clip.posterPath]) {
    try { if (f) fs.rmSync(f, { force: true }); } catch { /* best effort */ }
  }
}

async function finishTask(ctx, projectId, sceneId, taskId, { model, resolution, ledgerDir, deps }) {
  const key = ledgerKey(projectId, sceneId);
  const done = await deps.wait(taskId);
  if (!done.ok) {
    releaseSpend(ledgerDir, key);
    markError(ctx.dataDir, projectId, sceneId, taskId, done.error);
    return;
  }
  // Made means paid for, whatever happens to the scene now.
  const costUsd = settleSpend(ledgerDir, key, { model, resolution, tokens: done.tokens });
  const name = `bg-video-${randomUUID()}.mp4`;
  try {
    fs.mkdirSync(ctx.outputDir, { recursive: true });
    await deps.download(done.videoUrl, path.join(ctx.outputDir, name));
  } catch (e) {
    markError(ctx.dataDir, projectId, sceneId, taskId, `The clip was made but could not be downloaded: ${e?.message || e}`);
    return;
  }
  const clip = await deps.resolveClip({ outputDir: ctx.outputDir, uploadPath: name });
  if (!clip.ok) {
    markError(ctx.dataDir, projectId, sceneId, taskId, clip.error);
    return;
  }
  const applied = patchScene(ctx.dataDir, projectId, sceneId, (s) => (
    s.aiVideoTaskId === taskId && s.aiVideoStatus === "generating"
      ? { ...s, videoPath: clip.videoPath, videoUrl: clip.videoUrl, mediaKind: "video", aiVideoStatus: "done", aiVideoError: null, aiVideoCostUsd: costUsd }
      : null
  ));
  // A new picture was chosen meanwhile: keep it, and drop the late clip.
  if (!applied) removeClipFiles(clip);
}

async function animateOne(ctx, projectId, sceneId, { model, resolution }, { ledgerDir, deps }) {
  const project = readProject(ctx.dataDir, projectId);
  const scene = project?.scenes?.find((s) => s.id === sceneId);
  if (!scene || scene.aiVideoStatus !== "queued") return; // changed or removed meanwhile
  const key = ledgerKey(projectId, sceneId);
  const durationSec = sceneClipSec(scene);
  const estimate = usdForTokens({
    model, resolution,
    tokens: estimateTokens({ durationSec, ratio: seedanceRatio(project.aspect), resolution }),
  });
  const reserved = reserveSpend(ledgerDir, key, estimate);
  if (!reserved.ok) {
    markError(ctx.dataDir, projectId, sceneId, null, reserved.error);
    return;
  }
  const submitted = await deps.submit({
    prompt: animatePrompt(scene), firstFramePath: scene.imagePath, aspect: project.aspect, durationSec, model, resolution,
  });
  if (!submitted.ok) {
    releaseSpend(ledgerDir, key);
    markError(ctx.dataDir, projectId, sceneId, null, submitted.error);
    return;
  }
  // Saved before waiting: after a restart the sweep collects this paid-for clip.
  patchScene(ctx.dataDir, projectId, sceneId, (s) => (
    s.aiVideoStatus === "queued"
      ? { ...s, aiVideoStatus: "generating", aiVideoTaskId: submitted.taskId, aiVideoMode: submitted.mode, aiVideoStartedAt: deps.now() }
      : null
  ));
  await finishTask(ctx, projectId, sceneId, submitted.taskId, { model, resolution, ledgerDir, deps });
}

async function runAnimation(ctx, projectId, ids, quality, opts) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const sceneId = ids[cursor++];
      if (cancels.has(projectId)) {
        markError(ctx.dataDir, projectId, sceneId, null, "Stopped before this clip was ordered.");
        continue;
      }
      try {
        await animateOne(ctx, projectId, sceneId, quality, opts);
      } catch (e) {
        releaseSpend(opts.ledgerDir, ledgerKey(projectId, sceneId));
        markError(ctx.dataDir, projectId, sceneId, readProject(ctx.dataDir, projectId)?.scenes?.find((s) => s.id === sceneId)?.aiVideoTaskId ?? null, String(e?.message || e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ANIMATE_CONCURRENCY, ids.length) }, worker));
}

/**
 * Mark the chosen scenes queued now (the page sees it on its next poll) and
 * make their clips in the background. Returns the project as written, or
 * null when a run is already going or nothing can be animated.
 */
export function startAnimation(ctx, projectId, { sceneIds, quality = "standard", ledgerDir, deps } = {}) {
  if (runs.has(projectId)) return null;
  const project = readProject(ctx.dataDir, projectId);
  if (!project) return null;
  const q = AI_QUALITY[qualityOf(quality)];
  const ids = new Set(animatableScenes(project, sceneIds).map((s) => s.id));
  if (!ids.size) return null;
  runs.add(projectId);
  cancels.delete(projectId);
  const scenes = project.scenes.map((s) => (ids.has(s.id)
    ? { ...s, aiVideoStatus: "queued", aiVideoError: null, aiVideoTaskId: null, aiVideoModel: q.model, aiVideoResolution: q.resolution }
    : s));
  const written = writeProject(ctx.dataDir, { ...project, scenes, updatedAt: Date.now() });
  runAnimation(ctx, projectId, [...ids], q, { ledgerDir, deps: { ...defaultDeps, ...deps } })
    .catch((e) => console.warn(`[story] animate ${projectId} failed: ${e?.message || e}`))
    .finally(() => { runs.delete(projectId); cancels.delete(projectId); });
  return written;
}

/**
 * After a restart: collect clips that were ordered (task id saved), fail
 * scenes that were queued but never ordered, and expire orders over 24 h old.
 * Resolves with the number of clips being collected.
 */
export async function resumeAnimations(ctx, { ledgerDir, deps } = {}) {
  const d = { ...defaultDeps, ...deps };
  const pending = [];
  for (const summary of listProjects(ctx.dataDir)) {
    const project = readProject(ctx.dataDir, summary.projectId);
    for (const s of project?.scenes || []) {
      if (!IN_FLIGHT.has(s.aiVideoStatus)) continue;
      const key = ledgerKey(project.projectId, s.id);
      if (!s.aiVideoTaskId) {
        releaseSpend(ledgerDir, key);
        markError(ctx.dataDir, project.projectId, s.id, null, "Interrupted by a server restart before the clip was ordered. Animate it again.");
        continue;
      }
      if (d.now() - (Number(s.aiVideoStartedAt) || 0) > TASK_LIFETIME_MS) {
        releaseSpend(ledgerDir, key);
        markError(ctx.dataDir, project.projectId, s.id, s.aiVideoTaskId, "This clip expired at BytePlus. Animate it again.");
        continue;
      }
      pending.push(
        finishTask(ctx, project.projectId, s.id, s.aiVideoTaskId, {
          model: s.aiVideoModel || SEEDANCE_MODELS.mini, resolution: s.aiVideoResolution || "720p", ledgerDir, deps: d,
        }).catch((e) => console.warn(`[story] collecting clip ${s.aiVideoTaskId} failed: ${e?.message || e}`)),
      );
    }
  }
  await Promise.all(pending);
  return pending.length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test src/lib/story/animateStage.test.js`
Expected: PASS.

**Checks on the expected values:**
- **Cap test.** 2 × $0.378 = $0.756, which shows as `$0.76`. A cap of `0.5` is not an integer, so it prints as `$0.50`.
- **Stop test.** It relies on the 3 workers each passing the cancel check synchronously before the first `await`. `startAnimation` calls `runAnimation` before it returns, and the cancel check sits before `animateOne` in the loop. If the test sees 4 submits, the worker is not checking `cancels` before its first await; fix the stage, not the test.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story/animateStage.js server/src/lib/story/animateStage.test.js
git commit -m "feat: Story animate stage with spend reservations and restart resume"
```

---

### Task 4: Super-admin routes, clearing on a new picture, boot resume

**Files:**
- Create: `server/src/routes/storyAnimate.js`
- Test: `server/src/routes/storyAnimate.test.js`
- Modify: `server/src/routes/story.js`. Change `NO_SCENE_VIDEO` (line 39), export `sceneImageBlocked` (line 636), and mount the animate router just before `export default router` (line 1069).
- Modify: `server/src/routes/story.sceneImage.test.js` (add one test).
- Modify: `server/index.js`. Add imports beside line 62, and a boot call after the `reconcilePersistedJobs` block (around line 434).

**Interfaces:**
- Consumes:
  - Task 3: `estimateAnimation`, `startAnimation`, `cancelAnimation`, `isAnimating`, `qualityOf`, `resumeAnimations`.
  - Task 2: `ledgerSummary`, `wouldExceedCap`.
  - Task 1: `isSeedanceConfigured`.
- Produces:
  - **`createStoryAnimateRouter({ sceneBlocked, ledgerDir?, deps? })`.** An Express router with these routes:
    - `POST /:id/animate/estimate` takes body `{ quality?, sceneIds? }`. It returns `{ ok, configured, clips, seconds, usd, usdPerSecond, model, resolution, quality, sceneIds, month, spentUsd, reservedUsd, capUsd, clips, running }`.
    - `POST /:id/animate` takes body `{ quality?, sceneIds? }`. It returns `{ ok, project }`, or `{ ok:false, code, error }` with code `NOT_CONFIGURED` (503), `RUNNING` (409), `NOTHING_TO_ANIMATE` (400), `BUDGET` (409), or a `sceneBlocked` refusal.
    - `POST /:id/scenes/:sid/animate` takes body `{ quality? }` and responds the same way.
    - `POST /:id/animate/cancel` returns `{ ok, project }`.
  - The `ledgerSummary` key `clips` would overwrite the estimate's `clips`. The estimate route renames it to `monthClips`; see the code.

- [ ] **Step 1: Write the failing route tests**

Create `server/src/routes/storyAnimate.test.js`:

```js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createStoryAnimateRouter } from "./storyAnimate.js";
import { createProject, readProject, writeProject } from "../lib/story/projectStore.js";
import { isAnimating } from "../lib/story/animateStage.js";
import { ledgerSummary, reserveSpend } from "../lib/videoGen/spend.js";

let dataDir, outputDir, ledgerDir, saved;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-route-data-"));
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-route-out-"));
  ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "anim-route-ledger-"));
  saved = { key: process.env.BYTEPLUS_ARK_API_KEY, cap: process.env.VIDEO_GEN_MONTHLY_CAP_USD };
  process.env.BYTEPLUS_ARK_API_KEY = "ark-test";
  delete process.env.VIDEO_GEN_MONTHLY_CAP_USD;
});
afterEach(() => {
  for (const [k, v] of [["BYTEPLUS_ARK_API_KEY", saved.key], ["VIDEO_GEN_MONTHLY_CAP_USD", saved.cap]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const d of [dataDir, outputDir, ledgerDir]) fs.rmSync(d, { recursive: true, force: true });
});

const fakeDeps = {
  submit: async () => ({ ok: true, taskId: "t-1", mode: "image" }),
  wait: async () => ({ ok: true, videoUrl: "https://cdn/t.mp4", tokens: 108000 }),
  download: async (_u, dest) => { fs.writeFileSync(dest, "mp4"); return 3; },
  resolveClip: async ({ outputDir: dir, uploadPath }) => ({ ok: true, videoPath: path.join(dir, uploadPath), videoUrl: `/outputs/${uploadPath}`, posterPath: null }),
  now: () => Date.now(),
};

function router(over = {}) {
  return createStoryAnimateRouter({ sceneBlocked: () => null, ledgerDir, deps: fakeDeps, ...over });
}

/** Run every handler on the matched route in order, as Express would. */
async function call(r, method, routePath, { params = {}, body = {}, admin = true } = {}) {
  const layer = r.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no route ${method} ${routePath}`);
  const req = { params, body, ctx: { userId: "u1", dataDir, outputDir, isSuperAdmin: admin, plan: admin ? "super_admin" : "premium" } };
  const res = {
    statusCode: 200, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; },
  };
  for (const h of layer.route.stack.map((s) => s.handle)) {
    let nextCalled = false;
    await h(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  return res;
}

function project(sceneCount = 2) {
  const p = createProject(dataDir, { title: "Philippians" });
  const scenes = Array.from({ length: sceneCount }, (_, i) => {
    const pic = path.join(outputDir, `pic-${i}.png`);
    fs.writeFileSync(pic, "png");
    return { id: `s${i}`, text: `t${i}`, startMs: i * 5000, endMs: i * 5000 + 5000, imagePrompt: `p${i}`, imagePath: pic, imageUrl: `/outputs/pic-${i}.png`, imageStatus: "done", promptEditedByUser: false };
  });
  return writeProject(dataDir, { ...p, status: "ready_to_render", scenes });
}

async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("AI scene routes", () => {
  test("the super-admin gate refuses every other account, premium included", async () => {
    const p = project();
    const r = router();
    for (const [routePath, params] of [
      ["/:id/animate/estimate", { id: p.projectId }],
      ["/:id/animate", { id: p.projectId }],
      ["/:id/scenes/:sid/animate", { id: p.projectId, sid: "s0" }],
      ["/:id/animate/cancel", { id: p.projectId }],
    ]) {
      const res = await call(r, "post", routePath, { params, admin: false });
      assert.equal(res.statusCode, 403, routePath);
    }
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, undefined);
    assert.equal(ledgerSummary(ledgerDir).reservedUsd, 0);
  });

  test("the estimate prices the scenes and reports the month", async () => {
    const p = project(2);
    const res = await call(router(), "post", "/:id/animate/estimate", { params: { id: p.projectId }, body: { quality: "standard" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.configured, true);
    assert.equal(res.payload.clips, 2);
    assert.equal(res.payload.seconds, 10);
    assert.equal(res.payload.usd.toFixed(4), (2 * 108000 / 1e6 * 3.5).toFixed(4));
    assert.equal(res.payload.capUsd, 30);
    assert.equal(res.payload.spentUsd, 0);
    assert.equal(res.payload.quality, "standard");
  });

  test("animate all starts the run and marks the scenes queued", async () => {
    const p = project(2);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId }, body: {} });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    assert.deepEqual(res.payload.project.scenes.map((s) => s.aiVideoStatus), ["queued", "queued"]);
    await waitFor(() => !isAnimating(p.projectId));
    assert.deepEqual(readProject(dataDir, p.projectId).scenes.map((s) => s.aiVideoStatus), ["done", "done"]);
  });

  test("one scene can be animated, and re-rolled once done", async () => {
    const p = project(2);
    const r = router();
    const first = await call(r, "post", "/:id/scenes/:sid/animate", { params: { id: p.projectId, sid: "s1" } });
    assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
    await waitFor(() => !isAnimating(p.projectId));
    const again = await call(r, "post", "/:id/scenes/:sid/animate", { params: { id: p.projectId, sid: "s1" } });
    assert.equal(again.statusCode, 200, JSON.stringify(again.payload));
    await waitFor(() => !isAnimating(p.projectId));
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, undefined, "the other scene is untouched");
  });

  test("a batch that cannot fit under the cap is refused with BUDGET and nothing changes", async () => {
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "1";
    reserveSpend(ledgerDir, "other:s9", 0.9);
    const p = project(2);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "BUDGET");
    assert.match(res.payload.error, /^This would take .* AI video spend to \$1\.66 of \$1\.$/);
    assert.equal(readProject(dataDir, p.projectId).scenes[0].aiVideoStatus, undefined);
  });

  test("without a BytePlus key the routes say so", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const p = project(1);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "NOT_CONFIGURED");
  });

  test("a scene locked by a live render or image run is refused with its reason", async () => {
    const p = project(1);
    const r = router({ sceneBlocked: () => ({ status: 409, body: { code: "RENDERING", error: "The video is rendering." } }) });
    const res = await call(r, "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "RENDERING");
  });

  test("nothing to animate is a 400", async () => {
    const p = project(0);
    const res = await call(router(), "post", "/:id/animate", { params: { id: p.projectId } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.code, "NOTHING_TO_ANIMATE");
  });

  test("an unknown project is a 404", async () => {
    const res = await call(router(), "post", "/:id/animate/estimate", { params: { id: "nope" } });
    assert.equal(res.statusCode, 404);
  });
});
```

Add to the `describe("PUT /api/story/:id/scenes/:sid/image", …)` block in `server/src/routes/story.sceneImage.test.js`:

```js
  test("a new picture on an animated scene drops its AI clip", async () => {
    const p = quotaHitProject();
    const fresh = readProject(dataDir, p.projectId);
    writeProject(dataDir, { ...fresh, scenes: fresh.scenes.map((s) => (s.id === "s1"
      ? { ...s, imageStatus: "done", mediaKind: "video", videoPath: "/x/bg-video-a.mp4", videoUrl: "/outputs/bg-video-a.mp4", aiVideoStatus: "done", aiVideoTaskId: "t-1", aiVideoError: null }
      : s)) });
    const res = await putImage(p, "s1", { uploadPath: fakeUpload() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
    const s1 = readProject(dataDir, p.projectId).scenes[1];
    assert.equal(s1.mediaKind, "image");
    assert.equal(s1.videoPath, null);
    assert.equal(s1.aiVideoStatus, "none");
    assert.equal(s1.aiVideoTaskId, null);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test src/routes/storyAnimate.test.js src/routes/story.sceneImage.test.js`
Expected:
- `storyAnimate.test.js` fails with `Cannot find module`.
- The new sceneImage test fails on `aiVideoStatus` (`undefined !== "none"`).

- [ ] **Step 3: Write the router**

Create `server/src/routes/storyAnimate.js`:

```js
import { Router } from "express";
import { readProject } from "../lib/story/projectStore.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { DATA_DIR } from "../lib/paths.js";
import { isSeedanceConfigured } from "../lib/videoGen/providers/seedance.js";
import { ledgerSummary, wouldExceedCap } from "../lib/videoGen/spend.js";
import { estimateAnimation, startAnimation, cancelAnimation, isAnimating, qualityOf } from "../lib/story/animateStage.js";

/**
 * AI motion for Story scenes (BytePlus Seedance). Super admins only: one
 * BytePlus balance pays for every clip, so every route is behind
 * requireSuperAdmin and the spend ledger lives in the shared DATA_DIR.
 *
 * Built by a factory so story.js can hand over its scene lock
 * (sceneImageBlocked) without the two files importing each other.
 */
export function createStoryAnimateRouter({ sceneBlocked, ledgerDir = DATA_DIR, deps } = {}) {
  const router = Router();

  const sceneIdsFrom = (body) => (Array.isArray(body?.sceneIds)
    ? body.sceneIds.filter((x) => typeof x === "string").slice(0, 500)
    : undefined);

  const load = (req, res) => {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) res.status(404).json({ ok: false, error: "project not found" });
    return project;
  };

  router.post("/:id/animate/estimate", requireSuperAdmin, (req, res) => {
    const project = load(req, res);
    if (!project) return;
    const quality = qualityOf(req.body?.quality);
    const { clips: monthClips, ...month } = ledgerSummary(ledgerDir);
    return res.json({
      ok: true,
      configured: isSeedanceConfigured(),
      quality,
      running: isAnimating(project.projectId),
      ...month,
      monthClips,
      ...estimateAnimation(project, sceneIdsFrom(req.body), quality),
    });
  });

  const start = (pickIds) => (req, res) => {
    if (!isSeedanceConfigured()) {
      return res.status(503).json({ ok: false, code: "NOT_CONFIGURED", error: "AI video is not set up on this server." });
    }
    const project = load(req, res);
    if (!project) return;
    if (isAnimating(project.projectId)) {
      return res.status(409).json({ ok: false, code: "RUNNING", error: "Scenes are already being animated. Wait for them to finish, or stop ordering clips." });
    }
    const quality = qualityOf(req.body?.quality);
    const est = estimateAnimation(project, pickIds(req), quality);
    if (!est.clips) {
      return res.status(400).json({ ok: false, code: "NOTHING_TO_ANIMATE", error: "No scene with a finished picture to animate." });
    }
    for (const id of est.sceneIds) {
      const refused = sceneBlocked(project, id);
      if (refused) return res.status(refused.status).json({ ok: false, ...refused.body });
    }
    const budget = wouldExceedCap(ledgerDir, est.usd);
    if (budget.exceeded) return res.status(409).json({ ok: false, code: "BUDGET", error: budget.error });
    const written = startAnimation(req.ctx, project.projectId, { sceneIds: est.sceneIds, quality, ledgerDir, deps });
    if (!written) {
      return res.status(409).json({ ok: false, code: "RUNNING", error: "Scenes are already being animated. Wait for them to finish, or stop ordering clips." });
    }
    return res.json({ ok: true, project: written });
  };

  router.post("/:id/animate", requireSuperAdmin, start((req) => sceneIdsFrom(req.body)));
  router.post("/:id/scenes/:sid/animate", requireSuperAdmin, start((req) => [req.params.sid]));

  router.post("/:id/animate/cancel", requireSuperAdmin, (req, res) => {
    const project = load(req, res);
    if (!project) return;
    cancelAnimation(project.projectId);
    return res.json({ ok: true, project });
  });

  return router;
}
```

- [ ] **Step 4: Wire it into `story.js`**

In `server/src/routes/story.js`:

1. Replace line 39:

```js
const NO_SCENE_VIDEO = Object.freeze({ videoPath: null, videoUrl: null, mediaKind: "image" });
```

with:

```js
// A new picture also drops any AI motion clip made from the old one.
const NO_SCENE_VIDEO = Object.freeze({
  videoPath: null, videoUrl: null, mediaKind: "image",
  aiVideoStatus: "none", aiVideoTaskId: null, aiVideoError: null,
});
```

2. At line 636, change `function sceneImageBlocked(project, sceneId) {` to `export function sceneImageBlocked(project, sceneId) {`.

2b. In the `PUT /:id/scenes/:sid/image` handler, the video-upload branch builds `media` without `NO_SCENE_VIDEO`. That would leave an old AI status on a clip the operator uploaded themselves, and let a late AI clip overwrite it. Change the end of that object (lines ~682–684) from:

```js
        videoPath: clip.videoPath,
        videoUrl: clip.videoUrl,
        mediaKind: "video",
      };
```

to:

```js
        videoPath: clip.videoPath,
        videoUrl: clip.videoUrl,
        mediaKind: "video",
        // Your own clip replaces any AI clip, and a late AI clip must not land on it.
        aiVideoStatus: "none", aiVideoTaskId: null, aiVideoError: null,
      };
```

3. Add to the imports at the top:

```js
import { createStoryAnimateRouter } from "./storyAnimate.js";
```

4. Immediately above `export default router;` (line 1069), add:

```js
// AI motion clips on scenes (super admins only); see routes/storyAnimate.js.
router.use(createStoryAnimateRouter({ sceneBlocked: sceneImageBlocked }));
```

- [ ] **Step 5: Resume on boot in `server/index.js`**

Add next to the existing `reconcilePersistedJobs` import (line 62):

```js
import { resumeAnimations } from "./src/lib/story/animateStage.js";
import { isSeedanceConfigured } from "./src/lib/videoGen/providers/seedance.js";
```

Add directly after the `try { const interrupted = reconcilePersistedJobs(DATA_DIR); … } catch … {}` block (around line 434):

```js
// AI scene clips ordered before a restart are collected, not bought again.
if (isSeedanceConfigured()) {
  resumeAnimations({ dataDir: DATA_DIR, outputDir: OUTPUT_DIR }, { ledgerDir: DATA_DIR })
    .then((n) => { if (n) console.log(`[story] collecting ${n} AI scene clip(s) ordered before the restart`); })
    .catch((e) => console.warn("[story] AI clip resume skipped:", e?.message || e));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && node --test src/routes/storyAnimate.test.js src/routes/story.sceneImage.test.js src/routes/story.test.js src/routes/story.import.test.js`
Expected: PASS. The existing Story tests still pass: `NO_SCENE_VIDEO` only gained fields.

- [ ] **Step 7: Boot smoke check**

Run: `cd server && node --check index.js && node -e "import('./src/routes/story.js').then(m => console.log(typeof m.default, typeof m.sceneImageBlocked))"`
Expected: `function function`, and no import cycle error.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/storyAnimate.js server/src/routes/storyAnimate.test.js server/src/routes/story.js server/src/routes/story.sceneImage.test.js server/index.js
git commit -m "feat: super-admin routes to animate Story scenes, resume clips on boot"
```

---

### Task 5: Client data layer and the scene card's Animate button

**Files:**
- Modify: `client/src/lib/storyTypes.ts`. Add new types, and fields on `StoryScene` (after `videoUrl`, line 39).
- Modify: `client/src/lib/storyApi.ts`. Add 4 methods before `render` (line 129).
- Modify: `client/src/lib/storyWizard.ts`. Add `isAnimatingScenes` and `clipSeconds`.
- Modify: `client/src/hooks/useStoryProject.ts`. Poll while clips are being made.
- Create: `client/src/hooks/useAnimateEstimate.ts`
- Modify: `client/src/components/story/SceneCard.tsx`
- Test: `client/src/lib/__tests__/storyWizard.test.ts` (append) and `client/src/components/story/__tests__/SceneCard.test.tsx` (append).

**Interfaces:**
- Consumes: Task 4's route shapes.
- Produces:
  - `type AiVideoStatus = 'none'|'queued'|'generating'|'done'|'error'`
  - `type AnimateQuality = 'standard'|'high'`
  - `interface AnimateEstimate`
  - `storyApi.estimateAnimation(id, quality, sceneIds?)`
  - `storyApi.animate(id, quality)`
  - `storyApi.animateScene(id, sceneId, quality)`
  - `storyApi.cancelAnimation(id)`
  - `isAnimatingScenes(project): boolean`
  - `clipSeconds(scene): number`
  - `useAnimateEstimate(project, quality, enabled)`
  - New SceneCard props: `onAnimate?: (sceneId: string) => void` and `animatePriceUsd?: number`

- [ ] **Step 1: Write the failing tests**

Append to `client/src/lib/__tests__/storyWizard.test.ts` (add `isAnimatingScenes, clipSeconds` to its existing import from `'../storyWizard'`):

```ts
describe('AI motion helpers', () => {
  const base = { id: 's', text: '', startMs: 0, endMs: 5000, imagePrompt: '', imagePath: '/a.png', imageStatus: 'done' as const, promptEditedByUser: false };
  it('clip length matches the server: whole seconds, 4 to 12', () => {
    expect(clipSeconds({ ...base, endMs: 2000 })).toBe(4);
    expect(clipSeconds({ ...base, endMs: 7300 })).toBe(8);
    expect(clipSeconds({ ...base, endMs: 40000 })).toBe(12);
  });
  it('a project is animating while any scene is queued or generating', () => {
    const p = (status?: 'queued' | 'generating' | 'done') => ({ scenes: [{ ...base, aiVideoStatus: status }] }) as unknown as Parameters<typeof isAnimatingScenes>[0];
    expect(isAnimatingScenes(p('queued'))).toBe(true);
    expect(isAnimatingScenes(p('generating'))).toBe(true);
    expect(isAnimatingScenes(p('done'))).toBe(false);
    expect(isAnimatingScenes(p(undefined))).toBe(false);
  });
});
```

Append inside `describe('SceneCard', …)` in `client/src/components/story/__tests__/SceneCard.test.tsx`:

```tsx
  it('shows no Animate button unless the page offers it', () => {
    render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    expect(screen.queryByRole('button', { name: /animate scene 1/i })).toBeNull();
  });

  it('offers Animate with its price and calls back with the scene', async () => {
    const onAnimate = vi.fn();
    render(<SceneCard scene={scene()} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onAnimate={onAnimate} animatePriceUsd={0.189} />);
    const btn = screen.getByRole('button', { name: /^animate scene 1$/i });
    expect(btn).toHaveTextContent('$0.19');
    await userEvent.click(btn);
    expect(onAnimate).toHaveBeenCalledWith('scene-001');
  });

  it('while a clip is being made the button is busy and says so', () => {
    render(<SceneCard scene={scene({ aiVideoStatus: 'generating' })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onAnimate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /animate scene 1/i })).toBeDisabled();
    expect(screen.getByTestId('ai-status')).toHaveTextContent('Animating…');
  });

  it('a finished clip offers Animate again and says how it was made', () => {
    render(<SceneCard scene={scene({ aiVideoStatus: 'done', aiVideoMode: 'text', mediaKind: 'video', videoUrl: '/outputs/bg-video-x.mp4' })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onAnimate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /animate scene 1 again/i })).toBeEnabled();
    expect(screen.getByTestId('ai-status')).toHaveTextContent('Animated from the prompt');
  });

  it('a failed clip shows the reason in words', () => {
    render(<SceneCard scene={scene({ aiVideoStatus: 'error', aiVideoError: "This would take October's AI video spend to $31.20 of $30." })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onAnimate={vi.fn()} />);
    expect(screen.getByTestId('ai-status')).toHaveTextContent('Animation failed');
    expect(screen.getByText(/AI video spend to \$31\.20 of \$30/)).toBeInTheDocument();
  });

  it('a scene without a finished picture cannot be animated', () => {
    render(<SceneCard scene={scene({ imageStatus: 'error', imagePath: null, imageUrl: null })} index={0} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} onAnimate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /animate scene 1/i })).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts src/components/story/__tests__/SceneCard.test.tsx`
Expected:
- `storyWizard.test.ts` fails because `clipSeconds`/`isAnimatingScenes` are not exported.
- The new SceneCard tests fail because the Animate button and `ai-status` are not found.

- [ ] **Step 3: Types**

In `client/src/lib/storyTypes.ts`, add after the `videoUrl?: string | null;` line inside `StoryScene`:

```ts
  /** AI motion clip (BytePlus Seedance) made from this scene's picture; super admins only. */
  aiVideoStatus?: AiVideoStatus;
  /** Why the last AI clip failed, in plain words. */
  aiVideoError?: string | null;
  /** 'image' when the clip started from the picture; 'text' when BytePlus refused the picture (a real person) and it was made from the prompt. */
  aiVideoMode?: 'image' | 'text' | null;
  /** What BytePlus charged for this scene's clip, in US$. */
  aiVideoCostUsd?: number | null;
```

and add near the top of the file (after `StoryAspect`):

```ts
export type AiVideoStatus = 'none' | 'queued' | 'generating' | 'done' | 'error';
export type AnimateQuality = 'standard' | 'high';

/** POST /api/story/:id/animate/estimate */
export interface AnimateEstimate {
  configured: boolean;
  quality: AnimateQuality;
  running: boolean;
  clips: number;
  seconds: number;
  usd: number;
  usdPerSecond: number;
  model: string;
  resolution: string;
  sceneIds: string[];
  /** "2026-10" */
  month: string;
  spentUsd: number;
  reservedUsd: number;
  capUsd: number;
  monthClips: number;
}
```

- [ ] **Step 4: API methods**

In `client/src/lib/storyApi.ts`:
- Add `AnimateEstimate` and `AnimateQuality` to the existing type import from `./storyTypes`.
- Insert before `async render(`:

```ts
  // AI motion (super admins only): price it, start it, stop ordering more.
  async estimateAnimation(id: string, quality: AnimateQuality, sceneIds?: string[]): Promise<AnimateEstimate> {
    const res = await api.post(`/api/story/${id}/animate/estimate`, { quality, ...(sceneIds ? { sceneIds } : {}) });
    if (!res.ok || !res.data?.ok) throw new Error(res.data?.error || res.error || 'Could not price the animation');
    return res.data as AnimateEstimate;
  },

  async animate(id: string, quality: AnimateQuality): Promise<StoryProject> {
    const res = await api.post(`/api/story/${id}/animate`, { quality });
    if (res.ok && res.data?.project) return res.data.project as StoryProject;
    throw Object.assign(new Error(res.data?.error || res.error || 'Could not start the animation'), { code: res.data?.code as string | undefined });
  },

  async animateScene(id: string, sceneId: string, quality: AnimateQuality): Promise<StoryProject> {
    const res = await api.post(`/api/story/${id}/scenes/${sceneId}/animate`, { quality });
    if (res.ok && res.data?.project) return res.data.project as StoryProject;
    throw Object.assign(new Error(res.data?.error || res.error || 'Could not animate this scene'), { code: res.data?.code as string | undefined });
  },

  async cancelAnimation(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/animate/cancel`, {}));
  },
```

- [ ] **Step 5: Wizard helpers, polling and the estimate hook**

Append to `client/src/lib/storyWizard.ts`:

```ts
/** Any scene still waiting on its AI clip. */
export function isAnimatingScenes(project: Pick<StoryProject, 'scenes'>): boolean {
  return project.scenes.some((s) => s.aiVideoStatus === 'queued' || s.aiVideoStatus === 'generating');
}

/** The AI clip length the server orders for a scene: whole seconds, 4 to 12. */
export function clipSeconds(scene: Pick<StoryScene, 'startMs' | 'endMs'>): number {
  return Math.min(12, Math.max(4, Math.ceil(((scene.endMs || 0) - (scene.startMs || 0)) / 1000)));
}
```

(`StoryProject` and `StoryScene` are already imported in that file. If not, add them to its `import type` line from `./storyTypes`.)

Replace the body of `client/src/hooks/useStoryProject.ts` with:

```ts
import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import { isAnimatingScenes, isTransientStatus } from '../lib/storyWizard';
import type { StoryProject } from '../lib/storyTypes';

const POLL_MS = 2500;
// AI clips take minutes; a slower poll is plenty.
const ANIMATE_POLL_MS = 5000;

/** Fetch a story project; auto-poll while its status is transient or clips are being made. */
export function useStoryProject(projectId: string | null) {
  return useQuery<StoryProject>({
    queryKey: ['story-project', projectId],
    queryFn: () => storyApi.getProject(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const project = query.state.data;
      if (!project) return false;
      if (isTransientStatus(project.status)) return POLL_MS;
      return isAnimatingScenes(project) ? ANIMATE_POLL_MS : false;
    },
  });
}
```

Create `client/src/hooks/useAnimateEstimate.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import type { AnimateEstimate, AnimateQuality, StoryProject } from '../lib/storyTypes';

/**
 * The price of animating this project's scenes, and the month's spend.
 * Re-asked whenever a scene's picture or clip state changes.
 */
export function useAnimateEstimate(project: StoryProject | undefined, quality: AnimateQuality, enabled: boolean) {
  const signature = project ? project.scenes.map((s) => `${s.id}:${s.imageStatus}:${s.aiVideoStatus ?? 'none'}`).join('|') : '';
  return useQuery<AnimateEstimate>({
    queryKey: ['story-animate-estimate', project?.projectId, quality, signature],
    queryFn: () => storyApi.estimateAnimation((project as StoryProject).projectId, quality),
    enabled: enabled && Boolean(project?.projectId),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 6: SceneCard**

In `client/src/components/story/SceneCard.tsx`:

1. Add `Clapperboard` to the `lucide-react` import.

2. Add to `SceneCardProps`:

```ts
  /** Make an AI motion clip from this scene's picture (super admins only; omitted otherwise). */
  onAnimate?: (sceneId: string) => void;
  /** What one clip for this scene is expected to cost, in US$. */
  animatePriceUsd?: number;
```

3. Add `onAnimate, animatePriceUsd` to the destructured props.

4. After `const imageLocked = busy || regenerating || uploading;`, add:

```ts
  const ai = scene.aiVideoStatus ?? 'none';
  const animating = ai === 'queued' || ai === 'generating';
  const aiLabel = ai === 'queued' ? 'Waiting for AI motion'
    : ai === 'generating' ? 'Animating…'
      : ai === 'done' ? (scene.aiVideoMode === 'text' ? 'Animated from the prompt' : 'Animated')
        : ai === 'error' ? 'Animation failed' : null;
  const canAnimate = Boolean(onAnimate) && scene.imageStatus === 'done' && Boolean(scene.imagePath);
```

5. Change the Video badge's `title` to say whose clip it is:

```tsx
              title={ai === 'done' ? 'This scene plays its AI motion clip' : 'This scene plays your own video clip'}
```

6. Directly after the `{isVideo && (…)}` badge block, and before the `{missing && !tuning && ownImageButtons && …}` line, add:

```tsx
          {onAnimate && aiLabel && (
            <span
              data-testid="ai-status"
              className={`ml-2 align-middle text-xs ${ai === 'error' ? 'text-bf-danger' : ai === 'done' ? 'text-bf-success' : 'text-bf-gold'}`}
            >
              {aiLabel}
            </span>
          )}
          {onAnimate && ai === 'error' && scene.aiVideoError && (
            <p className="mt-1 text-xs text-bf-danger">{scene.aiVideoError}</p>
          )}
          {canAnimate && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => onAnimate?.(scene.id)}
                disabled={imageLocked || animating}
                aria-label={ai === 'done' ? `Animate scene ${n} again` : `Animate scene ${n}`}
                className={actionCls}
              >
                {animating ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
                {animating ? 'Animating…' : ai === 'done' ? 'Animate again' : 'Animate'}
                {!animating && animatePriceUsd != null && (
                  <span className="tabular-nums text-bf-muted">· ${animatePriceUsd.toFixed(2)}</span>
                )}
              </button>
            </div>
          )}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts src/components/story/__tests__/SceneCard.test.tsx`
Expected: PASS (old and new tests).

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/storyTypes.ts client/src/lib/storyApi.ts client/src/lib/storyWizard.ts client/src/hooks/useStoryProject.ts client/src/hooks/useAnimateEstimate.ts client/src/components/story/SceneCard.tsx client/src/lib/__tests__/storyWizard.test.ts client/src/components/story/__tests__/SceneCard.test.tsx
git commit -m "feat: Animate button and AI clip status on Story scene cards"
```

---

### Task 6: Animate panel and page wiring (super admins only)

**Files:**
- Create: `client/src/components/story/StoryAnimatePanel.tsx`
- Test: `client/src/components/story/__tests__/StoryAnimatePanel.test.tsx`
- Modify: `client/src/pages/StoryVideoPage.tsx`. Add imports, state, a handler, the panel above the scene list (line ~660), and SceneCard props (line 666).

**Interfaces:**
- Consumes:
  - Task 5: `storyApi.animate`, `storyApi.cancelAnimation`, `useAnimateEstimate`, `clipSeconds`, `isAnimatingScenes`, `AnimateEstimate`, `AnimateQuality`.
  - Existing: `useAuth` (zustand) from `client/src/hooks/useAuth.ts`, and `panelCls` / `secondaryBtnCls` from `./formStyles`.
- Produces:
  - `StoryAnimatePanel` with props `{ project, estimate, quality, onQualityChange, onChanged, busy }`
  - `CONFIRM_ABOVE_USD = 2`

- [ ] **Step 1: Write the failing tests**

Create `client/src/components/story/__tests__/StoryAnimatePanel.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryAnimatePanel } from '../StoryAnimatePanel';
import { storyApi } from '../../../lib/storyApi';
import type { AnimateEstimate, StoryProject } from '../../../lib/storyTypes';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function est(over: Partial<AnimateEstimate> = {}): AnimateEstimate {
  return {
    configured: true, quality: 'standard', running: false, clips: 6, seconds: 60, usd: 1.25, usdPerSecond: 0.0756,
    model: 'dreamina-seedance-2-0-mini-260615', resolution: '720p', sceneIds: [], month: '2026-10',
    spentUsd: 4.2, reservedUsd: 0, capUsd: 30, monthClips: 12, ...over,
  };
}
function project(over: Partial<StoryProject> = {}): StoryProject {
  return { projectId: 'p1', scenes: [], ...over } as unknown as StoryProject;
}

afterEach(() => vi.restoreAllMocks());

describe('StoryAnimatePanel', () => {
  it('shows the price and the month spend', () => {
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: /animate all 6 scenes/i })).toHaveTextContent('≈ $1.25');
    expect(screen.getByText('October: $4.20 of $30.00 used')).toBeInTheDocument();
  });

  it('starts without asking when the batch is $2 or less', async () => {
    const animate = vi.spyOn(storyApi, 'animate').mockResolvedValue(project());
    const confirm = vi.spyOn(window, 'confirm');
    const onChanged = vi.fn();
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={onChanged} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /animate all/i }));
    expect(confirm).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith('p1', 'standard');
    expect(onChanged).toHaveBeenCalled();
  });

  it('asks first above $2, and does nothing when declined', async () => {
    const animate = vi.spyOn(storyApi, 'animate').mockResolvedValue(project());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StoryAnimatePanel project={project()} estimate={est({ usd: 2.4 })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /animate all/i }));
    expect(window.confirm).toHaveBeenCalledWith('Animate 6 scenes for about $2.40? This is charged to your BytePlus balance.');
    expect(animate).not.toHaveBeenCalled();
  });

  it('while clips are being made it offers Stop instead', async () => {
    const cancel = vi.spyOn(storyApi, 'cancelAnimation').mockResolvedValue(project());
    const animating = project({ scenes: [{ id: 's', aiVideoStatus: 'generating' }] as unknown as StoryProject['scenes'] });
    render(<StoryAnimatePanel project={animating} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /stop ordering clips/i }));
    expect(cancel).toHaveBeenCalledWith('p1');
  });

  it('changing quality reports it', async () => {
    const onQualityChange = vi.fn();
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={onQualityChange} onChanged={vi.fn()} busy={false} />);
    await userEvent.selectOptions(screen.getByLabelText('AI motion quality'), 'high');
    expect(onQualityChange).toHaveBeenCalledWith('high');
  });

  it('with every scene animated there is nothing to start', () => {
    render(<StoryAnimatePanel project={project()} estimate={est({ clips: 0, usd: 0 })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: /every scene is animated/i })).toBeDisabled();
  });

  it('a server that is not set up shows nothing', () => {
    const { container } = render(<StoryAnimatePanel project={project()} estimate={est({ configured: false })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/components/story/__tests__/StoryAnimatePanel.test.tsx`
Expected: FAIL. It cannot resolve `../StoryAnimatePanel`.

- [ ] **Step 3: Write the panel**

Create `client/src/components/story/StoryAnimatePanel.tsx`:

```tsx
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Clapperboard, Loader2, Square } from 'lucide-react';
import { storyApi } from '../../lib/storyApi';
import { isAnimatingScenes } from '../../lib/storyWizard';
import type { AnimateEstimate, AnimateQuality, StoryProject } from '../../lib/storyTypes';
import { panelCls, secondaryBtnCls } from './formStyles';

/** A batch above this asks before spending. */
export const CONFIRM_ABOVE_USD = 2;

const money = (usd: number) => `$${usd.toFixed(2)}`;

interface StoryAnimatePanelProps {
  project: StoryProject;
  estimate: AnimateEstimate;
  quality: AnimateQuality;
  onQualityChange: (q: AnimateQuality) => void;
  onChanged: () => void;
  /** A page-wide operation is running. */
  busy: boolean;
}

/** Animate every scene at once (BytePlus Seedance), with its price and the month's spend. */
export function StoryAnimatePanel({ project, estimate, quality, onQualityChange, onChanged, busy }: StoryAnimatePanelProps) {
  const [starting, setStarting] = useState(false);
  if (!estimate.configured) return null;
  const animating = isAnimatingScenes(project);
  const monthLabel = new Date(`${estimate.month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

  const start = async () => {
    if (estimate.usd > CONFIRM_ABOVE_USD
      && !window.confirm(`Animate ${estimate.clips} scenes for about ${money(estimate.usd)}? This is charged to your BytePlus balance.`)) return;
    setStarting(true);
    try {
      await storyApi.animate(project.projectId, quality);
      toast.success('Animating scenes. Each clip takes a few minutes.');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    try {
      await storyApi.cancelAnimation(project.projectId);
      toast('No more clips will be ordered. Clips already started will still arrive.');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const btnCls = `${secondaryBtnCls} px-3 py-1.5 text-sm disabled:opacity-50`;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${panelCls}`}>
      <select
        aria-label="AI motion quality"
        value={quality}
        onChange={(e) => onQualityChange(e.target.value as AnimateQuality)}
        disabled={animating || starting}
        className="rounded-md border border-[rgba(216,184,120,0.18)] bg-bf-input px-2 py-1.5 text-sm text-bf-cream focus:border-[rgba(216,184,120,0.4)] focus:outline-none"
      >
        <option value="standard">Standard · 720p</option>
        <option value="high">High · 1080p</option>
      </select>
      {animating ? (
        <button type="button" onClick={stop} className={btnCls}>
          <Square size={14} aria-hidden /> Stop ordering clips
        </button>
      ) : (
        <button type="button" onClick={start} disabled={busy || starting || estimate.clips === 0} className={btnCls}>
          {starting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Clapperboard size={14} aria-hidden />}
          {estimate.clips === 0
            ? 'Every scene is animated'
            : <>Animate {estimate.clips === 1 ? 'the 1 scene left' : `all ${estimate.clips} scenes`} · <span className="tabular-nums">≈ {money(estimate.usd)}</span></>}
        </button>
      )}
      <span className="text-help tabular-nums">
        {monthLabel}: {money(estimate.spentUsd + estimate.reservedUsd)} of {money(estimate.capUsd)} used
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run the panel tests to verify they pass**

Run: `cd client && npx vitest run src/components/story/__tests__/StoryAnimatePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the page**

In `client/src/pages/StoryVideoPage.tsx`:

1. Add imports:

```tsx
import { StoryAnimatePanel } from '../components/story/StoryAnimatePanel';
import { useAnimateEstimate } from '../hooks/useAnimateEstimate';
import { useAuth } from '../hooks/useAuth';
import { clipSeconds } from '../lib/storyWizard';
import type { AnimateQuality } from '../lib/storyTypes';
```

If `storyWizard` or `storyTypes` is already imported, merge the names into the existing import line instead of adding a second one.

2. Next to the other `useState` calls near the top of the component, add:

```tsx
  const isSuperAdmin = useAuth((s) => s.isSuperAdmin);
  const [animateQuality, setAnimateQuality] = useState<AnimateQuality>('standard');
```

3. After `const { data: project } = useStoryProject(...)` (or wherever `project` is defined), add the lines below. They are hooks, so they must run on every render: put them with the other top-level hooks, before any early `return`.

```tsx
  const { data: animateEstimate } = useAnimateEstimate(project, animateQuality, isSuperAdmin);
  const canAnimate = isSuperAdmin && Boolean(animateEstimate?.configured);
```

4. Next to `onRegenerate`, add the handler:

```tsx
  const onAnimateScene = async (sceneId: string) => {
    if (!projectId) return;
    try {
      await storyApi.animateScene(projectId, sceneId, animateQuality);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
```

5. Between the "Scenes" heading block (`<div className="flex items-baseline justify-between">…</div>`) and `<div className="space-y-3">`, add:

```tsx
          {canAnimate && animateEstimate && (
            <StoryAnimatePanel
              project={project}
              estimate={animateEstimate}
              quality={animateQuality}
              onQualityChange={setAnimateQuality}
              onChanged={refresh}
              busy={busy || bulkUploading}
            />
          )}
```

6. Add to the `<SceneCard … />` props:

```tsx
                onAnimate={canAnimate ? onAnimateScene : undefined}
                animatePriceUsd={canAnimate && animateEstimate ? animateEstimate.usdPerSecond * clipSeconds(s) : undefined}
```

- [ ] **Step 6: Run the Story client tests and the build**

Run: `cd client && npx vitest run src/components/story src/pages/__tests__/StoryVideoPage.test.tsx src/lib/__tests__/storyWizard.test.ts`
Expected: PASS. If `StoryVideoPage.test.tsx` mocks `useAuth` or `storyApi` and now fails on the new `estimateAnimation` call, it should not: the estimate is only fetched when `isSuperAdmin` is true, and the test's default auth is not admin. If it does fail, add `vi.spyOn(storyApi, 'estimateAnimation').mockResolvedValue(...)` in that test's setup rather than changing the page.

Run: `cd client && npm run build`
Expected: the build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/story/StoryAnimatePanel.tsx client/src/components/story/__tests__/StoryAnimatePanel.test.tsx client/src/pages/StoryVideoPage.tsx
git commit -m "feat: Animate all panel on Story Video for super admins"
```

---

### Task 7: Spec sync, full suites, live check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-16-ai-scenes-design.md` (§4.1, §4.3 and §4.5 to match the Rulings above)

- [ ] **Step 1: Bring the spec in line with what was built**

In the spec:
- **§4.1:** replace the "`videoGen/index.js` changes" bullet with: "Seedance is called directly by the Story Animate stage and is not added to `listVideoProviderChain`. The chain serves Timeline video-gen, which expects an R2 public URL. Adding it there is later work."
- **§4.1:** add this bullet: "If BytePlus refuses the start frame because it may show a real person (`InputImageSensitiveContentDetected.*`, measured 2026-10-16), the same prompt is resubmitted as text-to-video and the scene records `aiVideoMode:"text"`."
- **§4.3 Cancel:** replace the bullet with: "Stop ends the ordering of new clips. Clips already ordered are still collected, because BytePlus charges for them."
- **§4.5:** replace the Settings (admin) paragraph with: "The quality choice (Standard: 2.0 Mini 720p; High: 2.0 1080p) sits on the Animate panel. The model ids and the price multiplier (`VIDEO_GEN_PRICE_MULTIPLIER`) are env settings. The API key is never shown."

```bash
git add docs/superpowers/specs/2026-10-16-ai-scenes-design.md
git commit -m "docs: AI scenes spec matches Phase 1 as built"
```

- [ ] **Step 2: Full server suite**

Run: `cd server && npm test`
Expected: PASS.
- The laptop runs low on memory under the full parallel suite (ffmpeg `ENOMEM`). If any ffmpeg-heavy file fails with ENOMEM, re-run that file alone (`node --test <file>`) and record both results.
- A file that fails alone is a real failure and must be fixed.

- [ ] **Step 3: Full client suite and build**

Run: `cd client && npx vitest run && npm run build`
Expected: PASS and a successful build.

- [ ] **Step 4: Live check on the local stack (costs about $0.25)**

Uses the operator's real key from `server/.env` and the pm2 dev stack (memory: `dev_stack_pm2_ngrok`). Do not edit server source while it runs.
1. Start or restart the dev stack so the server picks up the new code. Open Story Video signed in as the super admin.
2. Open a project with at least 2 scenes that have pictures. Confirm the Animate panel shows a price and "October: $… of $30.00 used".
3. Click **Animate** on one scene and wait about 1–3 minutes. The card goes from "Waiting for AI motion" to "Animating…" to "Animated" (or "Animated from the prompt" if the picture shows a person).
4. Render the project. The animated scene moves in the output, and the other scenes are still pictures.
5. Compare `server/data/videogen-spend.json` `tokens` with the BytePlus console Usage page for that task. They should match exactly.
6. Restart the server mid-clip (`pm2 restart` the server only) while a second scene is "Animating…". After the restart it must reach "Animated" without a second task appearing in the BytePlus console.
7. Sign in as a non-admin test account. Confirm there is no Animate panel and no Animate button, and that `POST /api/story/<id>/animate` returns 403.

- [ ] **Step 5: Final review and hand-off**

- Dispatch the whole-branch review (subagent-driven-development final review).
- Then use superpowers:finishing-a-development-branch.
- Open a PR against `master` with `Closes` lines for any Dunni issue.
- Wait for the Codex review and address it. Merge only on the operator's go-ahead.
- Warn that merging restarts production, which kills any running render (#55).
