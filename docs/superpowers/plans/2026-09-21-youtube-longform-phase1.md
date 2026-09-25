# YouTube Long-form — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship scripted 30/60-minute 16:9 scripture sleep sessions from the Story Video pipeline to the @Biblefuel YouTube channel with full metadata, a thumbnail and a scheduled publish time — plus an "inspiration → draft" entry point.

**Architecture:** Three new server modules (`lib/social/youtube*.js` for publish, `lib/longform/*` for templates + planner + chunked narration + section timings) feed the *existing* Story Video pipeline (`routes/story.js`) through its `import-script` seam. A new `routes/longform.js` owns draft/narrate. The client gets one shared `YoutubePublishPanel` and a Long-form tab on the Story page. No new render engine.

**Tech Stack:** Node 18+ ESM, Express, `node:test` + `supertest` (server), React + Vite + Vitest + Testing Library (client), `googleapis`, ffmpeg (prod is **5.1**), zod.

**Spec:** `docs/superpowers/specs/2026-09-21-youtube-longform-design.md`

## Global Constraints

- Prod ffmpeg is **5.1**: never use `-/filter_complex`; use `-filter_complex_script` (already the pattern in `storyRender.js`). Validate any new flag against 5.1.
- Immutability: return new objects; never mutate inputs (project code style).
- Every new module ≤ 400 lines; functions ≤ 50 lines where practical.
- Multi-tenant: all file I/O goes through `req.ctx.dataDir` / `req.ctx.outputDir`; never `DATA_DIR`/`OUTPUT_DIR` directly in new route code.
- Test seams follow the existing pattern: `_setXImpl(fn)` / `_resetXImpl()` module-level overrides.
- Server tests: `cd server && npm test` (runs `node --test "test/**/*.test.js" "src/**/*.test.js"`). Run a single file with `node --test src/path/file.test.js`.
- Client tests: `cd client && npx vitest run <path>`.
- `publishAt` ⇒ `privacyStatus` **must** be `private` (YouTube API rule).
- Scripture text is **never** LLM-generated; it comes from `lib/bible/scriptureApi.js` `lookupVerses`.
- Commit messages: conventional commits, end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Do **not** push or deploy; the operator decides. Client build (`npm run build`) + committing `server/public/**` happens only when the operator says so.

---

## File Structure

**Section 1 — publish**
- Create `server/src/lib/social/youtubeMetadata.js` — pure: validate metadata, build description with chapters.
- Create `server/src/lib/social/youtubeMetadata.test.js`
- Create `server/src/lib/social/youtubeUpload.js` — googleapis wrapper: `videos.insert` + non-fatal `thumbnails.set`; injectable client.
- Create `server/src/lib/social/youtubeUpload.test.js`
- Modify `server/src/routes/social.js` — streaming download; `postToYoutube` delegates to the two modules; `dispatchPost` passes new fields.
- Create `server/src/routes/social.youtube.test.js`
- Create `client/src/components/share/YoutubePublishPanel.tsx` + `__tests__/YoutubePublishPanel.test.tsx`
- Modify `client/src/components/render/RenderSharePanel.tsx`, `client/src/components/timeline/ShareKitPanel.tsx`, `client/src/pages/StoryVideoPage.tsx` (DonePanel).

**Section 2 — long-form**
- Create `server/src/lib/longform/templates.js` (+ test)
- Create `server/src/lib/longform/scriptPlanner.js` (+ test)
- Create `server/src/lib/longform/chunker.js` (+ test) — pure text splitting
- Create `server/src/lib/longform/narration.js` (+ test) — synth, silences, concat, cache
- Create `server/src/lib/longform/sectionTimings.js` (+ test)
- Modify `server/src/lib/story/projectStore.js` — new statuses + fields
- Modify `server/src/lib/story/sceneSegmenter.js` — `maxScenes` override
- Modify `server/src/lib/story/storyRender.js` — `captions: "none"`
- Modify `server/src/routes/story.js` — aspect-aware images/render, segment overrides
- Create `server/src/routes/longform.js` (+ test); modify `server/index.js` to mount
- Client: `client/src/lib/longformApi.ts`, `client/src/components/story/LongformForm.tsx`, `client/src/components/story/OutlineEditor.tsx`, modify `StoryVideoPage.tsx`, `storyTypes.ts`, `ProjectHistory.tsx`.

**Section 3 — inspiration**
- Modify `server/src/routes/longform.js` — voice-note `audioPath` on `/draft`; template suggestion
- Create `server/src/lib/longform/suggestTemplate.js` (+ test)
- Client: inspiration mode inside `LongformForm.tsx`.

---

## Section 1 — YouTube publish upgrade

### Task 1: YouTube metadata validation + description builder (pure)

**Files:**
- Create: `server/src/lib/social/youtubeMetadata.js`
- Test: `server/src/lib/social/youtubeMetadata.test.js`

**Interfaces:**
- Produces:
  - `validateYoutubeMetadata(input, { now = Date.now() } = {}) → { ok: true, value: YoutubeMetadata } | { ok: false, error: string }`
    where `YoutubeMetadata = { title, description, tags: string[], categoryId: string, privacyStatus: 'private'|'unlisted'|'public', publishAt?: string, forcedPrivate: boolean }`
  - `buildYoutubeDescription({ summary, chapters, links, hashtags }) → string`
    where `chapters = Array<{ startMs: number, title: string }>`
  - `formatChapterTimestamp(ms) → "MM:SS" | "H:MM:SS"`

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/social/youtubeMetadata.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateYoutubeMetadata, buildYoutubeDescription, formatChapterTimestamp } from "./youtubeMetadata.js";

describe("formatChapterTimestamp", () => {
  test("formats under an hour as MM:SS", () => {
    assert.equal(formatChapterTimestamp(0), "00:00");
    assert.equal(formatChapterTimestamp(65_000), "01:05");
  });
  test("formats an hour or more as H:MM:SS", () => {
    assert.equal(formatChapterTimestamp(3_725_000), "1:02:05");
  });
});

describe("buildYoutubeDescription", () => {
  test("emits chapters only when there are at least three, starting at 00:00", () => {
    const out = buildYoutubeDescription({
      summary: "A calm hour of Psalms.",
      chapters: [{ startMs: 0, title: "Welcome" }, { startMs: 90_000, title: "Psalm 23" }, { startMs: 600_000, title: "Psalm 91" }],
      links: ["https://biblefuel.tiwaton.co.uk"],
      hashtags: ["sleep", "psalms"],
    });
    assert.match(out, /^A calm hour of Psalms\./);
    assert.match(out, /\n00:00 Welcome\n01:30 Psalm 23\n10:00 Psalm 91/);
    assert.match(out, /https:\/\/biblefuel\.tiwaton\.co\.uk/);
    assert.match(out, /#sleep #psalms/);
  });
  test("drops the chapter block when fewer than three chapters", () => {
    const out = buildYoutubeDescription({ summary: "x", chapters: [{ startMs: 0, title: "Only" }], links: [], hashtags: [] });
    assert.doesNotMatch(out, /00:00/);
  });
  test("forces the first chapter to 00:00 when the first section starts late", () => {
    const out = buildYoutubeDescription({
      summary: "x",
      chapters: [{ startMs: 1_200, title: "A" }, { startMs: 60_000, title: "B" }, { startMs: 120_000, title: "C" }],
      links: [], hashtags: [],
    });
    assert.match(out, /00:00 A/);
  });
  test("never exceeds 5000 characters", () => {
    const out = buildYoutubeDescription({ summary: "y".repeat(6000), chapters: [], links: [], hashtags: [] });
    assert.ok(out.length <= 5000);
  });
});

describe("validateYoutubeMetadata", () => {
  const now = Date.parse("2026-09-21T10:00:00Z");
  test("accepts a minimal payload and applies defaults", () => {
    const r = validateYoutubeMetadata({ title: "Psalms for sleep" }, { now });
    assert.equal(r.ok, true);
    assert.equal(r.value.categoryId, "22");
    assert.equal(r.value.privacyStatus, "private");
    assert.deepEqual(r.value.tags, []);
    assert.equal(r.value.forcedPrivate, false);
  });
  test("rejects a title over 100 characters by name", () => {
    const r = validateYoutubeMetadata({ title: "t".repeat(101) }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /title.*100/i);
  });
  test("rejects an empty title", () => {
    const r = validateYoutubeMetadata({ title: "   " }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /title/i);
  });
  test("rejects tags over 500 characters total", () => {
    const r = validateYoutubeMetadata({ title: "ok", tags: Array.from({ length: 30 }, (_, i) => "tag".repeat(6) + i) }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /tags.*500/i);
  });
  test("publishAt in the past is rejected", () => {
    const r = validateYoutubeMetadata({ title: "ok", publishAt: "2026-09-20T10:00:00Z" }, { now });
    assert.equal(r.ok, false);
    assert.match(r.error, /publishAt.*future/i);
  });
  test("publishAt in the future forces private and flags it", () => {
    const r = validateYoutubeMetadata({ title: "ok", publishAt: "2026-09-22T10:00:00Z", privacyStatus: "public" }, { now });
    assert.equal(r.ok, true);
    assert.equal(r.value.privacyStatus, "private");
    assert.equal(r.value.forcedPrivate, true);
    assert.equal(r.value.publishAt, "2026-09-22T10:00:00.000Z");
  });
  test("unknown privacy falls back to private", () => {
    const r = validateYoutubeMetadata({ title: "ok", privacyStatus: "friends" }, { now });
    assert.equal(r.value.privacyStatus, "private");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test src/lib/social/youtubeMetadata.test.js`
Expected: FAIL — `Cannot find module './youtubeMetadata.js'`

- [ ] **Step 3: Implement**

```js
// server/src/lib/social/youtubeMetadata.js
/**
 * YouTube metadata rules, kept pure so scheduled uploads fail with a NAMED
 * reason before any bytes move. Limits are YouTube Data API v3 limits.
 */
export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;
export const YT_TAGS_TOTAL_MAX = 500;
export const YT_DEFAULT_CATEGORY = "22"; // People & Blogs
const PRIVACY = new Set(["private", "unlisted", "public"]);
const MIN_CHAPTERS = 3;

export function formatChapterTimestamp(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function chapterLines(chapters) {
  const list = (Array.isArray(chapters) ? chapters : [])
    .filter((c) => c && Number.isFinite(Number(c.startMs)) && String(c.title || "").trim())
    .sort((a, b) => Number(a.startMs) - Number(b.startMs));
  if (list.length < MIN_CHAPTERS) return [];
  // YouTube only recognises chapters when the first one is 00:00.
  const normalised = list.map((c, i) => (i === 0 ? { ...c, startMs: 0 } : c));
  return normalised.map((c) => `${formatChapterTimestamp(c.startMs)} ${String(c.title).trim()}`);
}

export function buildYoutubeDescription({ summary = "", chapters = [], links = [], hashtags = [] } = {}) {
  const blocks = [];
  const s = String(summary || "").trim();
  if (s) blocks.push(s);
  const ch = chapterLines(chapters);
  if (ch.length) blocks.push(ch.join("\n"));
  const ls = (Array.isArray(links) ? links : []).map((l) => String(l).trim()).filter(Boolean);
  if (ls.length) blocks.push(ls.join("\n"));
  const hs = (Array.isArray(hashtags) ? hashtags : [])
    .map((h) => String(h).trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((h) => `#${h}`);
  if (hs.length) blocks.push(hs.join(" "));
  return blocks.join("\n\n").slice(0, YT_DESCRIPTION_MAX);
}

function parsePublishAt(raw, now) {
  const text = String(raw || "").trim();
  if (!text) return { ok: true, value: undefined };
  const t = Date.parse(text);
  if (!Number.isFinite(t)) return { ok: false, error: "publishAt must be an ISO 8601 datetime" };
  if (t <= now) return { ok: false, error: "publishAt must be in the future" };
  return { ok: true, value: new Date(t).toISOString() };
}

export function validateYoutubeMetadata(input = {}, { now = Date.now() } = {}) {
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > YT_TITLE_MAX) return { ok: false, error: `title must be ${YT_TITLE_MAX} characters or fewer (got ${title.length})` };

  const description = String(input.description || "").slice(0, YT_DESCRIPTION_MAX);

  const tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim()).filter(Boolean);
  const tagsTotal = tags.reduce((n, t) => n + t.length, 0);
  if (tagsTotal > YT_TAGS_TOTAL_MAX) return { ok: false, error: `tags must total ${YT_TAGS_TOTAL_MAX} characters or fewer (got ${tagsTotal})` };

  const categoryId = String(input.categoryId || YT_DEFAULT_CATEGORY).trim() || YT_DEFAULT_CATEGORY;
  const requested = String(input.privacyStatus || "private").trim().toLowerCase();
  let privacyStatus = PRIVACY.has(requested) ? requested : "private";

  const publish = parsePublishAt(input.publishAt, now);
  if (!publish.ok) return publish;
  const forcedPrivate = Boolean(publish.value) && privacyStatus !== "private";
  if (publish.value) privacyStatus = "private";

  return {
    ok: true,
    value: { title, description, tags, categoryId, privacyStatus, publishAt: publish.value, forcedPrivate },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test src/lib/social/youtubeMetadata.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/social/youtubeMetadata.js server/src/lib/social/youtubeMetadata.test.js
git commit -m "feat(social): pure YouTube metadata validation and chapter description builder"
```

---

### Task 2: googleapis upload wrapper with non-fatal thumbnail

**Files:**
- Create: `server/src/lib/social/youtubeUpload.js`
- Test: `server/src/lib/social/youtubeUpload.test.js`

**Interfaces:**
- Consumes: `YoutubeMetadata` from Task 1.
- Produces:
  - `uploadToYoutube({ credentials: { clientId, clientSecret, refreshToken }, filePath, metadata, thumbnailPath? }) → Promise<{ videoId, videoUrl, thumbnailError?: string, data }>`
  - `_setGoogleImpl(fakeGoogle)` / `_resetGoogleImpl()` — the fake must expose `{ auth: { OAuth2 }, youtube(opts) → { videos: { insert }, thumbnails: { set } } }`.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/social/youtubeUpload.test.js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { uploadToYoutube, _setGoogleImpl, _resetGoogleImpl } from "./youtubeUpload.js";

afterEach(() => _resetGoogleImpl());

function tmpFile(name, bytes = "vid") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-up-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

function fakeGoogle({ insertResult = { data: { id: "abc123" } }, thumbError = null } = {}) {
  const calls = { insert: [], set: [], creds: [] };
  class OAuth2 { setCredentials(c) { calls.creds.push(c); } }
  const google = {
    auth: { OAuth2 },
    youtube: () => ({
      videos: { insert: async (args) => { calls.insert.push(args); return insertResult; } },
      thumbnails: { set: async (args) => { calls.set.push(args); if (thumbError) throw new Error(thumbError); return { data: {} }; } },
    }),
  };
  return { google, calls };
}

const creds = { clientId: "id", clientSecret: "sec", refreshToken: "ref" };
const metadata = { title: "T", description: "D", tags: ["a"], categoryId: "22", privacyStatus: "private", publishAt: "2026-09-22T10:00:00.000Z", forcedPrivate: false };

describe("uploadToYoutube", () => {
  test("inserts with snippet+status and returns the watch URL", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata });
    assert.equal(out.videoId, "abc123");
    assert.equal(out.videoUrl, "https://www.youtube.com/watch?v=abc123");
    assert.deepEqual(calls.creds[0], { refresh_token: "ref" });
    const body = calls.insert[0].requestBody;
    assert.deepEqual(body.snippet, { title: "T", description: "D", tags: ["a"], categoryId: "22" });
    assert.deepEqual(body.status, { privacyStatus: "private", publishAt: "2026-09-22T10:00:00.000Z", selfDeclaredMadeForKids: false });
    assert.deepEqual(calls.insert[0].part, ["snippet", "status"]);
    assert.equal(calls.set.length, 0);
  });
  test("omits publishAt from status when not scheduled", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata: { ...metadata, publishAt: undefined } });
    assert.equal("publishAt" in calls.insert[0].requestBody.status, false);
  });
  test("sets the thumbnail after insert when given", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: tmpFile("t.png") });
    assert.equal(calls.set[0].videoId, "abc123");
    assert.equal(calls.set[0].media.mimeType, "image/png");
    assert.equal(out.thumbnailError, undefined);
  });
  test("a thumbnail failure does not fail the upload", async () => {
    const { google } = fakeGoogle({ thumbError: "channel not verified" });
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: tmpFile("t.jpg") });
    assert.equal(out.videoId, "abc123");
    assert.match(out.thumbnailError, /channel not verified/);
  });
  test("a missing thumbnail file is reported, not thrown", async () => {
    const { google, calls } = fakeGoogle();
    _setGoogleImpl(google);
    const out = await uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata, thumbnailPath: "/nope/missing.png" });
    assert.equal(calls.set.length, 0);
    assert.match(out.thumbnailError, /not found/i);
  });
  test("throws a named error when insert returns no id", async () => {
    const { google } = fakeGoogle({ insertResult: { data: {} } });
    _setGoogleImpl(google);
    await assert.rejects(
      () => uploadToYoutube({ credentials: creds, filePath: tmpFile("v.mp4"), metadata }),
      /YouTube did not return a video id/,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --test src/lib/social/youtubeUpload.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// server/src/lib/social/youtubeUpload.js
import fs from "fs";
import path from "path";
import { google as realGoogle } from "googleapis";

let _google = realGoogle;
export function _setGoogleImpl(impl) { _google = impl; }
export function _resetGoogleImpl() { _google = realGoogle; }

const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function buildRequestBody(metadata) {
  const status = { privacyStatus: metadata.privacyStatus, selfDeclaredMadeForKids: false };
  if (metadata.publishAt) status.publishAt = metadata.publishAt;
  return {
    snippet: {
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: metadata.categoryId,
    },
    status,
  };
}

async function setThumbnail(youtube, videoId, thumbnailPath) {
  if (!thumbnailPath) return undefined;
  if (!fs.existsSync(thumbnailPath)) return `thumbnail not found: ${thumbnailPath}`;
  const mimeType = MIME_BY_EXT[path.extname(thumbnailPath).toLowerCase()] || "image/jpeg";
  try {
    await youtube.thumbnails.set({ videoId, media: { mimeType, body: fs.createReadStream(thumbnailPath) } });
    return undefined;
  } catch (e) {
    // Custom thumbnails need a phone-verified channel. The video is already
    // up; report the reason instead of failing a successful upload.
    return String(e?.message || e);
  }
}

/**
 * Upload one video with full metadata, then (best-effort) its thumbnail.
 * Throws only when the video itself cannot be uploaded.
 */
export async function uploadToYoutube({ credentials, filePath, metadata, thumbnailPath }) {
  const oauth2 = new _google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2.setCredentials({ refresh_token: credentials.refreshToken });
  const youtube = _google.youtube({ version: "v3", auth: oauth2 });

  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: buildRequestBody(metadata),
    media: { body: fs.createReadStream(filePath) },
  });
  const videoId = String(result?.data?.id || "").trim();
  if (!videoId) throw new Error("YouTube did not return a video id — the upload may have been rejected");

  const thumbnailError = await setThumbnail(youtube, videoId, thumbnailPath);
  return {
    data: result.data,
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    ...(thumbnailError ? { thumbnailError } : {}),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && node --test src/lib/social/youtubeUpload.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/social/youtubeUpload.js server/src/lib/social/youtubeUpload.test.js
git commit -m "feat(social): googleapis upload wrapper with non-fatal thumbnail set"
```

---

### Task 3: Wire `social.js` — streaming download, metadata, thumbnail passthrough

**Files:**
- Modify: `server/src/routes/social.js` (`resolveVideoInputForUpload` ~line 67, `postToYoutube` ~line 374, `dispatchPost` ~line 425)
- Test: `server/src/routes/social.youtube.test.js`

**Interfaces:**
- Consumes: Task 1 `validateYoutubeMetadata`, `buildYoutubeDescription`; Task 2 `uploadToYoutube`, `_setGoogleImpl`.
- Produces: `POST /api/social/post` with `destination: "youtube"` now accepts
  `{ videoUrl, title, caption?, description?, tags?, categoryId?, privacyStatus?, publishAt?, thumbnailPath?, chapters? }` and responds `{ ok, videoId, videoUrl, thumbnailError?, forcedPrivate }`.
  `caption` remains the description fallback (backwards compatible with the Timeline share).

- [ ] **Step 1: Write the failing route test**

```js
// server/src/routes/social.youtube.test.js
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import socialRouter, { _setFetchImpl, _resetFetchImpl } from "./social.js";
import { _setGoogleImpl, _resetGoogleImpl } from "../lib/social/youtubeUpload.js";
import { writeSocialStore } from "../lib/socialStore.js";

function app() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-yt-"));
  const outputDir = path.join(dataDir, "outputs");
  fs.mkdirSync(outputDir);
  writeSocialStore(dataDir, { direct: { youtube: { clientId: "id", clientSecret: "sec", refreshToken: "ref" } } });
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir, isSuperAdmin: false }; next(); });
  a.use("/api/social", socialRouter);
  return { a, dataDir, outputDir };
}

function fakeGoogle() {
  const calls = { insert: [], set: [] };
  class OAuth2 { setCredentials() {} }
  return {
    calls,
    google: {
      auth: { OAuth2 },
      youtube: () => ({
        videos: { insert: async (args) => { calls.insert.push(args); return { data: { id: "vid1" } }; } },
        thumbnails: { set: async (args) => { calls.set.push(args); return { data: {} }; } },
      }),
    },
  };
}

describe("POST /api/social/post destination=youtube", () => {
  let fake;
  beforeEach(() => { fake = fakeGoogle(); _setGoogleImpl(fake.google); });
  afterEach(() => { _resetGoogleImpl(); _resetFetchImpl(); });

  test("uploads a local output with full metadata and a thumbnail", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    fs.writeFileSync(path.join(outputDir, "thumb.png"), "img");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube",
      videoUrl: "/outputs/long.mp4",
      title: "Psalms for Sleep",
      description: "One hour of Psalms.",
      tags: ["psalms", "sleep"],
      chapters: [{ startMs: 0, title: "Welcome" }, { startMs: 60000, title: "Psalm 23" }, { startMs: 120000, title: "Psalm 91" }],
      publishAt: new Date(Date.now() + 86_400_000).toISOString(),
      privacyStatus: "public",
      thumbnailPath: "/outputs/thumb.png",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.videoId, "vid1");
    assert.equal(res.body.forcedPrivate, true);
    const body = fake.calls.insert[0].requestBody;
    assert.equal(body.snippet.title, "Psalms for Sleep");
    assert.match(body.snippet.description, /00:00 Welcome\n01:00 Psalm 23\n02:00 Psalm 91/);
    assert.deepEqual(body.snippet.tags, ["psalms", "sleep"]);
    assert.equal(body.status.privacyStatus, "private");
    assert.equal(fake.calls.set[0].videoId, "vid1");
  });

  test("falls back to caption as description and title when only caption is sent (Timeline share)", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", caption: "Be still\nPsalm 46:10", privacyStatus: "unlisted",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = fake.calls.insert[0].requestBody;
    assert.equal(body.snippet.title, "Be still");
    assert.equal(body.snippet.description, "Be still\nPsalm 46:10");
    assert.equal(body.status.privacyStatus, "unlisted");
  });

  test("names the validation failure and never calls YouTube", async () => {
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "clip.mp4"), "vid");
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "/outputs/clip.mp4", title: "x".repeat(101),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /title must be 100/);
    assert.equal(fake.calls.insert.length, 0);
  });

  test("streams a remote videoUrl to disk instead of buffering it", async () => {
    const { a } = app();
    const { Readable } = await import("node:stream");
    let streamed = false;
    _setFetchImpl(async () => ({
      ok: true,
      status: 200,
      body: Readable.from([Buffer.from("part1"), Buffer.from("part2")]).once("end", () => { streamed = true; }),
    }));
    const res = await request(a).post("/api/social/post").send({
      destination: "youtube", videoUrl: "https://cdn.example.com/v.mp4", title: "Remote",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(streamed, true);
    assert.equal(fake.calls.insert.length, 1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --test src/routes/social.youtube.test.js`
Expected: FAIL — `_setFetchImpl` is not exported / metadata not honoured

- [ ] **Step 3: Implement in `social.js`**

Add imports near the top (after the existing `import { google } from "googleapis";` — that import can now be removed if nothing else uses it; check with `grep -n "google\." server/src/routes/social.js` and keep it if `channels.list` still uses it):

```js
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { validateYoutubeMetadata, buildYoutubeDescription } from "../lib/social/youtubeMetadata.js";
import { uploadToYoutube } from "../lib/social/youtubeUpload.js";

// Injectable fetch so the streaming download path is testable without a network.
let _fetch = fetch;
export function _setFetchImpl(impl) { _fetch = impl; }
export function _resetFetchImpl() { _fetch = fetch; }
```

Replace the remote branch of `resolveVideoInputForUpload` (the block from `const resp = await fetch(absoluteUrl);` to the `return { filePath: outFile, cleanup }`) with:

```js
  const resp = await _fetch(absoluteUrl);
  if (!resp.ok) {
    const errText = typeof resp.text === "function" ? await resp.text() : "";
    throw new Error(`Failed to fetch video: ${resp.status} ${errText}`);
  }
  if (!resp.body) throw new Error("Fetched video has no body");

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, `youtube-upload-${uuid()}.mp4`);
  // Stream to disk. A 60-minute 1080p file is gigabytes; buffering it with
  // arrayBuffer() took the whole process down.
  const source = typeof resp.body.pipe === "function" ? resp.body : Readable.fromWeb(resp.body);
  await pipeline(source, fs.createWriteStream(outFile));
  if (!fs.statSync(outFile).size) { try { fs.unlinkSync(outFile); } catch {} throw new Error("Fetched video is empty"); }

  return {
    filePath: outFile,
    cleanup: async () => { try { fs.unlinkSync(outFile); } catch {} },
  };
```

Replace `postToYoutube` entirely:

```js
async function postToYoutube(payload, req, store) {
  const { caption, videoUrl, title, description, tags, categoryId, privacyStatus, publishAt, thumbnailPath, chapters, links, hashtags } = payload || {};
  const yt = store.direct?.youtube || {};
  const clientId = String(yt.clientId || "").trim();
  const clientSecret = String(yt.clientSecret || "").trim();
  const refreshToken = String(yt.refreshToken || "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [
      !clientId && "client ID",
      !clientSecret && "client secret",
      !refreshToken && "refresh token (click Connect YouTube in Settings)",
    ].filter(Boolean).join(", ");
    throw new Error(`YouTube is not connected — missing ${missing}. Posts to YouTube will keep failing until this is fixed.`);
  }

  // Timeline/Render shares send only a caption: keep using its first line as
  // the title and the whole caption as the description.
  const summary = String(description || caption || "").trim();
  const validated = validateYoutubeMetadata({
    title: titleFromCaption(title, caption),
    description: (chapters?.length || links?.length || hashtags?.length)
      ? buildYoutubeDescription({ summary, chapters, links, hashtags })
      : summary,
    tags, categoryId, privacyStatus, publishAt,
  });
  if (!validated.ok) throw new Error(validated.error);

  const upload = await resolveVideoInputForUpload(videoUrl, req);
  try {
    const thumbLocal = thumbnailPath ? resolveOutputAlias(String(thumbnailPath)) : null;
    const result = await uploadToYoutube({
      credentials: { clientId, clientSecret, refreshToken },
      filePath: upload.filePath,
      metadata: validated.value,
      thumbnailPath: thumbLocal || (thumbnailPath ? String(thumbnailPath) : undefined),
    });
    return { ...result, forcedPrivate: validated.value.forcedPrivate };
  } finally {
    await upload.cleanup();
  }
}
```

In `dispatchPost`, change the youtube branch to pass the whole payload:

```js
  if (destination === "youtube") {
    return postToYoutube(payload, req, store);
  }
```

Note: `resolveOutputAlias` already exists in `social.js` (~line 50) and handles `/outputs/...`, `server/outputs/...` and bare filenames — reuse it for `thumbnailPath`.

Note on the 400 status: the `/post` handler already maps every thrown error to 400, so the validation test's `assert.equal(res.status, 400)` holds without changes.

- [ ] **Step 4: Run the new test and the existing social tests**

Run: `cd server && node --test src/routes/social.youtube.test.js src/routes/social.schedules.test.js`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/social.js server/src/routes/social.youtube.test.js
git commit -m "feat(social): YouTube upload with metadata, thumbnail, publishAt and streamed download"
```

---

### Task 4: `YoutubePublishPanel` (client)

**Files:**
- Create: `client/src/components/share/YoutubePublishPanel.tsx`
- Test: `client/src/components/share/__tests__/YoutubePublishPanel.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface YoutubePublishFields {
  title: string; description: string; tags: string[]; privacyStatus: 'private'|'unlisted'|'public';
  publishAt: string;            // '' or ISO string from <input type="datetime-local">
  thumbnailPath: string;        // '' or an /outputs/... alias
}
export interface YoutubePublishPanelProps {
  videoUrl: string;                       // absolute or /outputs alias of the rendered file
  initial?: Partial<YoutubePublishFields>;
  thumbnailOptions?: Array<{ label: string; path: string }>; // e.g. Story scene images
  chapters?: Array<{ startMs: number; title: string }>;
  onPublished?: (r: { videoId: string; videoUrl: string; forcedPrivate: boolean; thumbnailError?: string }) => void;
}
export function YoutubePublishPanel(props: YoutubePublishPanelProps): JSX.Element
```
  Posts to `POST /api/social/post` with `destination: 'youtube'` and the Task 3 payload.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/share/__tests__/YoutubePublishPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api';
import { YoutubePublishPanel } from '../YoutubePublishPanel';

beforeEach(() => vi.restoreAllMocks());

describe('YoutubePublishPanel', () => {
  it('posts title, tags, schedule and thumbnail to the YouTube destination', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'https://www.youtube.com/watch?v=v1', forcedPrivate: true } } as any);
    const onPublished = vi.fn();
    render(
      <YoutubePublishPanel
        videoUrl="/outputs/story/p1/video.mp4"
        initial={{ title: 'Psalms for Sleep', description: 'One hour.' }}
        thumbnailOptions={[{ label: 'Scene 1', path: '/outputs/genImg/p1/part-1.png' }]}
        chapters={[{ startMs: 0, title: 'Welcome' }]}
        onPublished={onPublished}
      />,
    );
    await user.type(screen.getByLabelText(/tags/i), 'psalms, sleep');
    await user.type(screen.getByLabelText(/publish at/i), '2030-01-01T09:00');
    await user.selectOptions(screen.getByLabelText(/thumbnail/i), '/outputs/genImg/p1/part-1.png');
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));

    expect(post).toHaveBeenCalledWith('/api/social/post', expect.objectContaining({
      destination: 'youtube',
      videoUrl: '/outputs/story/p1/video.mp4',
      title: 'Psalms for Sleep',
      description: 'One hour.',
      tags: ['psalms', 'sleep'],
      thumbnailPath: '/outputs/genImg/p1/part-1.png',
      chapters: [{ startMs: 0, title: 'Welcome' }],
      publishAt: expect.stringMatching(/^2030-01-01T/),
    }));
    expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'v1', forcedPrivate: true }));
  });

  it('tells the user when a schedule forced the video private', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'u', forcedPrivate: true } } as any);
    const success = vi.spyOn(toast, 'success');
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/scheduled.*private until/i));
  });

  it('surfaces a thumbnail error without hiding the successful upload', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false, thumbnailError: 'channel not verified' } } as any);
    const err = vi.spyOn(toast, 'error');
    const success = vi.spyOn(toast, 'success');
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(success).toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/thumbnail.*channel not verified/i));
  });

  it('blocks publish with an empty title and does not call the API', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post');
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/components/share/__tests__/YoutubePublishPanel.test.tsx`
Expected: FAIL — cannot resolve `../YoutubePublishPanel`

- [ ] **Step 3: Implement**

```tsx
// client/src/components/share/YoutubePublishPanel.tsx
import { useState } from 'react';
import { Loader2, Youtube } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

export type YoutubePrivacy = 'private' | 'unlisted' | 'public';

export interface YoutubePublishFields {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: YoutubePrivacy;
  publishAt: string;
  thumbnailPath: string;
}

export interface YoutubePublishResult {
  videoId: string;
  videoUrl: string;
  forcedPrivate: boolean;
  thumbnailError?: string;
}

export interface YoutubePublishPanelProps {
  videoUrl: string;
  initial?: Partial<YoutubePublishFields>;
  thumbnailOptions?: Array<{ label: string; path: string }>;
  chapters?: Array<{ startMs: number; title: string }>;
  onPublished?: (r: YoutubePublishResult) => void;
}

const inputCls = 'mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none';

export function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/** datetime-local gives a local wall-clock string; YouTube wants an ISO instant. */
export function toIsoPublishAt(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function YoutubePublishPanel({ videoUrl, initial, thumbnailOptions = [], chapters, onPublished }: YoutubePublishPanelProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(', '));
  const [privacy, setPrivacy] = useState<YoutubePrivacy>(initial?.privacyStatus ?? 'private');
  const [publishAtLocal, setPublishAtLocal] = useState(initial?.publishAt ?? '');
  const [thumbnailPath, setThumbnailPath] = useState(initial?.thumbnailPath ?? thumbnailOptions[0]?.path ?? '');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const publish = async () => {
    if (busy) return;
    if (!title.trim()) { setFieldError('Title is required'); return; }
    if (title.trim().length > 100) { setFieldError('Title must be 100 characters or fewer'); return; }
    setFieldError('');
    setBusy(true);
    try {
      const res = await api.post<YoutubePublishResult>('/api/social/post', {
        destination: 'youtube',
        videoUrl,
        title: title.trim(),
        description,
        tags: parseTags(tagsRaw),
        privacyStatus: privacy,
        publishAt: toIsoPublishAt(publishAtLocal),
        thumbnailPath,
        chapters,
      });
      if (!res.ok || !res.data) { toast.error(res.error || 'YouTube upload failed'); return; }
      const r = res.data;
      if (r.forcedPrivate) toast.success('Scheduled — the video stays private until its publish time.');
      else toast.success('Uploaded to YouTube');
      if (r.thumbnailError) toast.error(`Uploaded, but the thumbnail was rejected: ${r.thumbnailError}`);
      onPublished?.(r);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-300">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-300">
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputCls} />
      </label>
      <label className="block text-sm text-gray-300">
        Tags (comma separated)
        <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm text-gray-300">
          Privacy
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value as YoutubePrivacy)} className={inputCls}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="block text-sm text-gray-300">
          Publish at (optional)
          <input type="datetime-local" value={publishAtLocal} onChange={(e) => setPublishAtLocal(e.target.value)} className={inputCls} />
        </label>
      </div>
      {thumbnailOptions.length > 0 && (
        <label className="block text-sm text-gray-300">
          Thumbnail
          <select value={thumbnailPath} onChange={(e) => setThumbnailPath(e.target.value)} className={inputCls}>
            {thumbnailOptions.map((o) => <option key={o.path} value={o.path}>{o.label}</option>)}
          </select>
        </label>
      )}
      {fieldError && <p className="text-sm text-red-300">{fieldError}</p>}
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Youtube size={16} />}
        Publish to YouTube
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `cd client && npx vitest run src/components/share/__tests__/YoutubePublishPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/share/YoutubePublishPanel.tsx client/src/components/share/__tests__/YoutubePublishPanel.test.tsx
git commit -m "feat(client): shared YoutubePublishPanel with metadata, schedule and thumbnail"
```

---

### Task 5: Mount the panel in Timeline and Story Video

**Files:**
- Modify: `client/src/components/render/RenderSharePanel.tsx` (the `postDestination === 'youtube'` branch ~line 142)
- Modify: `client/src/components/timeline/ShareKitPanel.tsx`
- Modify: `client/src/pages/StoryVideoPage.tsx` (`DonePanel` ~line 590)
- Test: `client/src/components/timeline/__tests__/ShareKitPanel.test.tsx` (extend), `client/src/pages/__tests__/StoryVideoPage.publish.test.tsx` (new)

**Interfaces:**
- Consumes: Task 4 `YoutubePublishPanel`.
- `RenderSharePanel` gains an optional prop `youtubePanel?: React.ReactNode`; when `postDestination === 'youtube'` and `youtubePanel` is provided it renders that node **instead of** the privacy `<Select>` and hides the generic share button for that destination.

- [ ] **Step 1: Extend the ShareKitPanel test**

Append to `client/src/components/timeline/__tests__/ShareKitPanel.test.tsx`:

```tsx
  it('shows the YouTube publish panel with the video and caption prefilled when YouTube is chosen', async () => {
    const user = userEvent.setup();
    mockGets();
    render(<ShareKitPanel lines={'Be still\nPsalm 46:10'} latestRenderFile="C:/srv/outputs/video-1.mp4" />);
    await screen.findByRole('option', { name: 'Zapier hook' });
    await user.selectOptions(screen.getByLabelText(/destination/i), 'youtube');
    expect(await screen.findByRole('button', { name: /publish to youtube/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^title/i)).toHaveValue('Be still');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Be still\nPsalm 46:10');
  });
```

(If `RenderSharePanel`'s destination select has no accessible label yet, add `aria-label="Destination"` to it in this task.)

- [ ] **Step 2: Run to verify failure**

Run: `cd client && npx vitest run src/components/timeline/__tests__/ShareKitPanel.test.tsx`
Expected: the new case FAILS (no "Publish to YouTube" button)

- [ ] **Step 3: Implement**

In `RenderSharePanel.tsx`: add `youtubePanel?: React.ReactNode` to the props interface; in the JSX where `postDestination === 'youtube'` renders the privacy `<Select>`, change to:

```tsx
          ) : postDestination === 'youtube' ? (
            youtubePanel ?? (
              <Select value={youtubePrivacy} onChange={(e) => onYoutubePrivacyChange(e.target.value as YoutubePrivacy)}>
                {/* existing options unchanged */}
              </Select>
            )
          ) : (
```

and wrap the existing share/post button so it is hidden when `postDestination === 'youtube' && youtubePanel` (the panel has its own button). Add `aria-label="Destination"` to the destination select if absent.

In `ShareKitPanel.tsx`, compute the prefill and pass the panel:

```tsx
import { toOutputUrl } from '../../lib/storage';
import { YoutubePublishPanel } from '../share/YoutubePublishPanel';
// ...inside the component, before return:
const effectivePath = shareVideoPath || latestRenderFile || '';
const captionText = lines.split('\n').filter(Boolean).join('\n');
const youtubePanel = effectivePath ? (
  <YoutubePublishPanel
    videoUrl={toOutputUrl(effectivePath, api.mediaBaseUrl)}
    initial={{ title: captionText.split('\n')[0] || '', description: captionText, privacyStatus: youtubePrivacy }}
  />
) : null;
// ...and pass youtubePanel={youtubePanel} to <RenderSharePanel />
```

In `StoryVideoPage.tsx` `DonePanel`, accept the project and render the panel under the `<video>`:

```tsx
function DonePanel({ project }: { project: StoryProject }) {
  const token = api.getToken();
  const base = `${api.mediaBaseUrl}/outputs/story/${project.projectId}/video.mp4`;
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  const thumbnailOptions = (project.scenes || [])
    .filter((s) => s.imageStatus === 'done' && s.imageUrl)
    .map((s, i) => ({ label: `Scene ${i + 1}`, path: s.imageUrl as string }));
  const chapters = (project.longform?.sections || []).map((s) => ({ startMs: s.startMs ?? 0, title: s.heading }));
  return (
    <div className="space-y-3">
      <video src={url} controls className="w-full rounded-xl border border-white/10" />
      {/* existing download/share controls stay here unchanged */}
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="mb-2 text-sm font-medium text-white">Publish to YouTube</h3>
        <YoutubePublishPanel
          videoUrl={`/outputs/story/${project.projectId}/video.mp4`}
          initial={{ title: project.title, description: project.longform?.summary ?? '' }}
          thumbnailOptions={thumbnailOptions}
          chapters={chapters.length >= 3 ? chapters : undefined}
        />
      </div>
    </div>
  );
}
```

Update the call site: `<DonePanel project={project} />`. `project.longform` is typed in Task 13; until then declare it optional in `storyTypes.ts` now:

```ts
export interface LongformSection { heading: string; reference?: string | null; verseText?: string; text: string; targetSec: number; startMs?: number; endMs?: number }
export interface StoryLongform { templateId: string; idea?: string; summary?: string; sections: LongformSection[] }
// add to StoryProject:
  longform?: StoryLongform;
  aspect?: 'portrait' | 'landscape';
  captions?: 'none' | 'static' | 'kinetic';
```

- [ ] **Step 4: Run client tests**

Run: `cd client && npx vitest run src/components/timeline src/components/share src/pages`
Expected: PASS (existing Story page tests still pass; DonePanel is only rendered when `status === 'done'`)

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): YouTube publish panel in Timeline share kit and Story Video output"
```

---

## Section 2 — Long-form templates + chunked narration

### Task 6: Long-form templates (pure)

**Files:**
- Create: `server/src/lib/longform/templates.js`
- Test: `server/src/lib/longform/templates.test.js`

**Interfaces:**
- Produces:
```js
// LongformTemplate
{ id, label, kind: 'sleep'|'minidoc', targetSec, wpm, structurePrompt,
  scene: { targetSceneSec, maxScenes, captions: 'none'|'static'|'kinetic' },
  voice: { preferredProviders: string[], rate: string, pauseMs: number, maxChunkChars: number },
  music: { volume: number, autoDuck: boolean },
  thumbnailPrompt: string }
export const LONGFORM_TEMPLATES
export function longformTemplateById(id) → LongformTemplate | null
export function wordBudget(template, targetSec = template.targetSec) → number
```

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/longform/templates.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LONGFORM_TEMPLATES, longformTemplateById, wordBudget } from "./templates.js";

describe("longform templates", () => {
  test("ships sleep-30 and sleep-60 with landscape-safe scene policies", () => {
    const ids = LONGFORM_TEMPLATES.map((t) => t.id);
    assert.deepEqual(ids, ["sleep-30", "sleep-60"]);
    for (const t of LONGFORM_TEMPLATES) {
      assert.equal(t.kind, "sleep");
      assert.equal(t.scene.captions, "none");
      assert.ok(t.scene.maxScenes >= 8 && t.scene.maxScenes <= 16);
      assert.ok(t.voice.pauseMs >= 3000);
      assert.ok(t.voice.maxChunkChars >= 300 && t.voice.maxChunkChars <= 4500);
      assert.equal(t.music.autoDuck, false);
    }
  });
  test("sleep-60 is twice sleep-30", () => {
    assert.equal(longformTemplateById("sleep-30").targetSec, 1800);
    assert.equal(longformTemplateById("sleep-60").targetSec, 3600);
  });
  test("unknown id returns null", () => {
    assert.equal(longformTemplateById("nope"), null);
  });
  test("wordBudget follows wpm and target seconds", () => {
    const t = longformTemplateById("sleep-30");
    assert.equal(wordBudget(t), Math.round(1800 / 60 * t.wpm));
    assert.equal(wordBudget(t, 60), t.wpm);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --test src/lib/longform/templates.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// server/src/lib/longform/templates.js
/**
 * Long-form formats. Pure data: the planner reads structurePrompt + wpm, the
 * narrator reads voice, the Story pipeline reads scene + music.
 *
 * Sleep sessions are deliberately slow and sparse: ~110 wpm, long pauses,
 * a dozen scenes with long crossfades, no captions. Watch-hours content.
 */
const SLEEP_STRUCTURE = [
  "You are writing a calm, slow scripture session for someone falling asleep.",
  "Structure: a gentle welcome (about 1 minute) → repeated cycles of one scripture passage read slowly, then a short reflection of 2–4 sentences, then rest → a closing blessing.",
  "Reflections are quiet reassurance, second person, present tense, no exclamation marks, no questions, no calls to action.",
  "Never paraphrase or invent scripture; the verse text is supplied verbatim and must be used as given.",
].join(" ");

const sleep = (id, minutes) => Object.freeze({
  id,
  label: `Scripture Sleep Session · ${minutes} min`,
  kind: "sleep",
  targetSec: minutes * 60,
  wpm: 110,
  structurePrompt: SLEEP_STRUCTURE,
  scene: { targetSceneSec: Math.round((minutes * 60) / 12), maxScenes: 12, captions: "none" },
  voice: { preferredProviders: ["chatterbox", "azure", "edge"], rate: "-15%", pauseMs: 5000, maxChunkChars: 1200 },
  music: { volume: 0.22, autoDuck: false },
  thumbnailPrompt: "soft moonlit night sky over still water, warm candle glow, peaceful, cinematic, no text",
});

export const LONGFORM_TEMPLATES = Object.freeze([sleep("sleep-30", 30), sleep("sleep-60", 60)]);

export function longformTemplateById(id) {
  return LONGFORM_TEMPLATES.find((t) => t.id === String(id || "")) || null;
}

export function wordBudget(template, targetSec = template.targetSec) {
  return Math.round((Number(targetSec) / 60) * Number(template.wpm));
}
```

- [ ] **Step 4: Run tests** — `cd server && node --test src/lib/longform/templates.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/longform/templates.js server/src/lib/longform/templates.test.js
git commit -m "feat(longform): sleep-30 and sleep-60 template definitions"
```

---

### Task 7: Script planner (outline → sections, scripture from the Bible API)

**Files:**
- Create: `server/src/lib/longform/scriptPlanner.js`
- Test: `server/src/lib/longform/scriptPlanner.test.js`

**Interfaces:**
- Consumes: Task 6 `LongformTemplate`, `wordBudget`; existing `lookupVerses(reference, translation)` from `../bible/scriptureApi.js` (returns `{ ok, verses: [{ verse, text }], canonical }`); the LLM completion function shape used by `story/scriptRefine.js` (`defaultLlmComplete(prompt) → Promise<string>` — import it from there, or copy the gpt-4o-mini → gemini fallback if it is not exported; **prefer exporting it from `scriptRefine.js`**).
- Produces:
```js
export async function planLongformScript({ idea, template, translation = "kjv", targetSec })
  → { title, summary, sections: Array<{ heading, reference: string|null, verseText: string, text: string, targetSec: number }> }
export function _setLlmImpl(fn) / _resetLlmImpl()
export function _setVerseLookupImpl(fn) / _resetVerseLookupImpl()
export function parseOutline(raw) → { title, summary, sections: [{ heading, reference|null, targetSec }] }   // pure, exported for tests
```
  `text` is the **full spoken text** of the section: for a section with a reference it is `"<reference>. <verseText> <reflection>"`; for intro/closing it is the reflection alone.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/longform/scriptPlanner.test.js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { planLongformScript, parseOutline, _setLlmImpl, _resetLlmImpl, _setVerseLookupImpl, _resetVerseLookupImpl } from "./scriptPlanner.js";
import { longformTemplateById } from "./templates.js";

afterEach(() => { _resetLlmImpl(); _resetVerseLookupImpl(); });

const outlineJson = JSON.stringify({
  title: "Psalms for a Restless Night",
  summary: "Slow readings from the Psalms with quiet reflections.",
  sections: [
    { heading: "Welcome", reference: null, targetSec: 60 },
    { heading: "Psalm 23", reference: "Psalm 23:1-4", targetSec: 420 },
    { heading: "Closing blessing", reference: null, targetSec: 60 },
  ],
});

describe("parseOutline", () => {
  test("parses JSON, tolerating a ```json fence", () => {
    const out = parseOutline("```json\n" + outlineJson + "\n```");
    assert.equal(out.title, "Psalms for a Restless Night");
    assert.equal(out.sections.length, 3);
    assert.equal(out.sections[1].reference, "Psalm 23:1-4");
  });
  test("throws a named error on garbage", () => {
    assert.throws(() => parseOutline("not json"), /outline/i);
  });
});

describe("planLongformScript", () => {
  test("fetches verse text from the Bible API and never lets the LLM write scripture", async () => {
    const prompts = [];
    _setLlmImpl(async (p) => {
      prompts.push(p);
      if (prompts.length === 1) return outlineJson;
      return "Rest now. You are held.";
    });
    const lookups = [];
    _setVerseLookupImpl(async (ref, tr) => {
      lookups.push([ref, tr]);
      return { ok: true, canonical: "Psalm 23:1-4", verses: [{ verse: 1, text: "The LORD is my shepherd; I shall not want." }, { verse: 2, text: "He maketh me to lie down in green pastures." }] };
    });
    const t = longformTemplateById("sleep-30");
    const plan = await planLongformScript({ idea: "psalms for when I can't sleep", template: t, translation: "kjv" });
    assert.deepEqual(lookups, [["Psalm 23:1-4", "kjv"]]);
    assert.equal(plan.sections.length, 3);
    const psalm = plan.sections[1];
    assert.equal(psalm.verseText, "The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures.");
    assert.match(psalm.text, /^Psalm 23:1-4\. The LORD is my shepherd/);
    assert.match(psalm.text, /Rest now\. You are held\.$/);
    assert.equal(plan.sections[0].text, "Rest now. You are held.");
    // section prompts carry the verse verbatim and the word budget
    assert.match(prompts[2], /The LORD is my shepherd/);
    assert.match(prompts[2], /\b\d{2,4} words\b/);
    // outline prompt carries the idea, the template structure and the total budget
    assert.match(prompts[0], /can't sleep/);
    assert.match(prompts[0], /falling asleep/);
    assert.match(prompts[0], /1800/);
  });
  test("a verse lookup failure surfaces as a named error, not silent paraphrase", async () => {
    _setLlmImpl(async () => outlineJson);
    _setVerseLookupImpl(async () => { throw new Error("api.bible down"); });
    await assert.rejects(
      () => planLongformScript({ idea: "x", template: longformTemplateById("sleep-30") }),
      /Psalm 23:1-4.*api\.bible down/,
    );
  });
  test("targetSec override scales the outline budget", async () => {
    let seen = "";
    _setLlmImpl(async (p) => { if (!seen) seen = p; return outlineJson.replace(/"targetSec": ?\d+/g, '"targetSec": 60'); });
    _setVerseLookupImpl(async () => ({ ok: true, canonical: "Psalm 23:1-4", verses: [{ verse: 1, text: "v" }] }));
    await planLongformScript({ idea: "x", template: longformTemplateById("sleep-30"), targetSec: 600 });
    assert.match(seen, /600/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd server && node --test src/lib/longform/scriptPlanner.test.js` → FAIL (module not found)

- [ ] **Step 3: Implement**

First, in `server/src/lib/story/scriptRefine.js`, export the default completion so it can be shared: change `function defaultLlmComplete(` to `export function defaultLlmComplete(` (or `export async function` matching its current form). Run `node --test src/lib/story/scriptRefine.test.js` to confirm nothing broke.

```js
// server/src/lib/longform/scriptPlanner.js
import { defaultLlmComplete } from "../story/scriptRefine.js";
import { lookupVerses } from "../bible/scriptureApi.js";
import { wordBudget } from "./templates.js";

let _llm = defaultLlmComplete;
export function _setLlmImpl(fn) { _llm = fn; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

let _lookup = lookupVerses;
export function _setVerseLookupImpl(fn) { _lookup = fn; }
export function _resetVerseLookupImpl() { _lookup = lookupVerses; }

const MIN_SECTIONS = 3;
const MAX_SECTIONS = 40;

function stripFence(s) {
  return String(s || "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
}

export function parseOutline(raw) {
  let obj;
  try { obj = JSON.parse(stripFence(raw)); } catch { throw new Error("outline: model did not return valid JSON"); }
  const sections = Array.isArray(obj?.sections) ? obj.sections : [];
  if (sections.length < MIN_SECTIONS) throw new Error(`outline: expected at least ${MIN_SECTIONS} sections`);
  return {
    title: String(obj.title || "").trim().slice(0, 100) || "Scripture Session",
    summary: String(obj.summary || "").trim(),
    sections: sections.slice(0, MAX_SECTIONS).map((s) => ({
      heading: String(s.heading || "").trim() || "Section",
      reference: s.reference ? String(s.reference).trim() : null,
      targetSec: Math.max(20, Math.round(Number(s.targetSec) || 60)),
    })),
  };
}

function outlinePrompt({ idea, template, targetSec }) {
  return [
    template.structurePrompt,
    `Total length: ${targetSec} seconds of narration at about ${template.wpm} words per minute.`,
    "Return ONLY JSON: {\"title\": string (≤100 chars, a YouTube title a real person would click), \"summary\": string (2 sentences for the video description), \"sections\": [{\"heading\": string, \"reference\": string|null (a Bible reference like \"Psalm 23:1-4\" for scripture sections, null for welcome/closing), \"targetSec\": number}]}.",
    "Section targetSec values must add up to the total length.",
    "",
    "Seed idea:",
    String(idea || "").trim(),
  ].join("\n");
}

function sectionPrompt({ template, section, verseText, words }) {
  return [
    template.structurePrompt,
    `Write ONLY the reflection for the section "${section.heading}" — about ${words} words.`,
    verseText
      ? `The listener has just heard this passage read verbatim (do not repeat or paraphrase it):\n${verseText}`
      : "There is no passage in this section.",
    "Return ONLY the spoken text — no headings, no markdown, no quotes, no stage directions.",
  ].join("\n");
}

async function fetchVerseText(reference, translation) {
  try {
    const r = await _lookup(reference, translation);
    const verses = Array.isArray(r?.verses) ? r.verses : [];
    const text = verses.map((v) => String(v.text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
    if (!text) throw new Error("no verse text returned");
    return text;
  } catch (e) {
    throw new Error(`scripture lookup failed for ${reference}: ${e?.message || e}`);
  }
}

async function writeSection({ template, section, translation }) {
  const verseText = section.reference ? await fetchVerseText(section.reference, translation) : "";
  // Verse reading time comes out of the section budget before the reflection is sized.
  const verseWords = verseText ? verseText.split(/\s+/).length : 0;
  const reflectionWords = Math.max(30, wordBudget(template, section.targetSec) - verseWords);
  const reflection = stripFence(await _llm(sectionPrompt({ template, section, verseText, words: reflectionWords })));
  const text = verseText ? `${section.reference}. ${verseText} ${reflection}`.trim() : reflection;
  return { ...section, verseText, text };
}

/**
 * Plan a long-form script: outline → per-section text. Scripture is fetched,
 * never generated. Sections are written sequentially (LLM rate limits).
 */
export async function planLongformScript({ idea, template, translation = "kjv", targetSec }) {
  const total = Number(targetSec) > 0 ? Number(targetSec) : template.targetSec;
  const outline = parseOutline(await _llm(outlinePrompt({ idea, template, targetSec: total })));
  const sections = [];
  for (const section of outline.sections) {
    sections.push(await writeSection({ template, section, translation }));
  }
  return { title: outline.title, summary: outline.summary, sections };
}
```

- [ ] **Step 4: Run tests** — `cd server && node --test src/lib/longform/scriptPlanner.test.js src/lib/story/scriptRefine.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/longform/scriptPlanner.js server/src/lib/longform/scriptPlanner.test.js server/src/lib/story/scriptRefine.js
git commit -m "feat(longform): two-step script planner with scripture fetched from the Bible API"
```

---

### Task 8: Text chunker (pure)

**Files:**
- Create: `server/src/lib/longform/chunker.js`
- Test: `server/src/lib/longform/chunker.test.js`

**Interfaces:**
- Produces: `splitForProvider(text, maxChars) → string[]` — sentence-boundary chunks, each ≤ `maxChars`, never empty, preserving order; a single sentence longer than `maxChars` is split at the last space before the limit.

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/longform/chunker.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitForProvider } from "./chunker.js";

describe("splitForProvider", () => {
  test("returns one chunk when the text fits", () => {
    assert.deepEqual(splitForProvider("Rest now. You are held.", 100), ["Rest now. You are held."]);
  });
  test("splits at sentence boundaries under the limit", () => {
    const out = splitForProvider("One two three. Four five six. Seven eight nine.", 30);
    assert.deepEqual(out, ["One two three. Four five six.", "Seven eight nine."]);
    for (const c of out) assert.ok(c.length <= 30);
  });
  test("splits a single over-long sentence at a space, never mid-word", () => {
    const out = splitForProvider("alpha beta gamma delta epsilon", 12);
    assert.deepEqual(out, ["alpha beta", "gamma delta", "epsilon"]);
  });
  test("collapses whitespace and drops empty pieces", () => {
    assert.deepEqual(splitForProvider("  A.   \n\n  B.  ", 100), ["A. B."]);
    assert.deepEqual(splitForProvider("   ", 100), []);
  });
  test("round-trips: joined chunks equal the normalised input", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = splitForProvider(text, 90);
    assert.equal(out.join(" "), text);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd server && node --test src/lib/longform/chunker.test.js` → FAIL

- [ ] **Step 3: Implement**

```js
// server/src/lib/longform/chunker.js
/**
 * Split narration text into provider-sized pieces at sentence boundaries.
 * Pure. Joining the output with a single space reproduces the normalised input.
 */
const SENTENCE_END = /(?<=[.!?…]["')\]]?)\s+/;

function splitLongSentence(sentence, maxChars) {
  const out = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const cut = rest.lastIndexOf(" ", maxChars);
    const at = cut > 0 ? cut : maxChars;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitForProvider(text, maxChars) {
  const limit = Math.max(20, Number(maxChars) || 1000);
  const normalised = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalised) return [];
  const sentences = normalised.split(SENTENCE_END).flatMap((s) => splitLongSentence(s.trim(), limit)).filter(Boolean);

  const chunks = [];
  let current = "";
  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length <= limit) { current = candidate; continue; }
    if (current) chunks.push(current);
    current = s;
  }
  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: Run tests** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/longform/chunker.js server/src/lib/longform/chunker.test.js
git commit -m "feat(longform): sentence-boundary chunker for provider character limits"
```

---

### Task 9: Chunked narration with pauses, concat and resumable cache

**Files:**
- Create: `server/src/lib/longform/narration.js`
- Test: `server/src/lib/longform/narration.test.js`

**Interfaces:**
- Consumes: Task 6 template `voice`; Task 8 `splitForProvider`; existing `synthesize(req)` from `../voice/index.js` (returns `{ ok, file, provider, voice }`); existing `probeAudioDurationSec(filePath)` from `../story/storyRender.js`.
- Produces:
```js
export async function narrateSections({ sections, template, voiceId, workDir }, deps = {})
  → { audioPath, durationMs, sections: Array<section & { startMs, endMs }>, provider }
// deps (all optional, for tests): { synthesize, probeDurationSec, runFfmpeg }
//   synthesize(req) → { ok, file, provider }
//   probeDurationSec(path) → number (seconds)
//   runFfmpeg(args: string[]) → Promise<void>
export function chunkCacheKey({ provider, voiceId, rate, text }) → string   // sha1 hex
```
  Layout under `workDir`: `chunks/<key>.mp3`, `silence-<ms>.mp3`, `concat.txt`, `narration.mp3`.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/longform/narration.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { narrateSections, chunkCacheKey } from "./narration.js";
import { longformTemplateById } from "./templates.js";

function harness({ secondsPerChunk = 2, failOnCall = -1 } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-"));
  const calls = { synth: [], ffmpeg: [] };
  const deps = {
    synthesize: async (req) => {
      calls.synth.push(req);
      if (calls.synth.length === failOnCall) throw new Error("provider hiccup");
      const f = path.join(workDir, `tts-${calls.synth.length}.mp3`);
      fs.writeFileSync(f, "audio");
      return { ok: true, file: f, provider: "azure", voice: req.voiceId };
    },
    probeDurationSec: async (p) => (path.basename(p).startsWith("silence-") ? 5 : secondsPerChunk),
    runFfmpeg: async (args) => {
      calls.ffmpeg.push(args);
      const out = args[args.length - 1];
      fs.writeFileSync(out, "made");
    },
  };
  return { workDir, calls, deps };
}

const template = longformTemplateById("sleep-30");
const sections = [
  { heading: "Welcome", reference: null, verseText: "", text: "Rest now. You are held. Breathe slowly.", targetSec: 60 },
  { heading: "Psalm 23", reference: "Psalm 23:1", verseText: "The LORD is my shepherd.", text: "Psalm 23:1. The LORD is my shepherd. Let that settle.", targetSec: 120 },
];

describe("narrateSections", () => {
  test("synthesises every chunk, inserts pauses between sections and reports section timings", async () => {
    const { workDir, calls, deps } = harness();
    const out = await narrateSections({ sections, template: { ...template, voice: { ...template.voice, maxChunkChars: 25 } }, voiceId: "v1", workDir }, deps);
    assert.ok(calls.synth.length >= 4, "expected several chunks");
    for (const req of calls.synth) {
      assert.equal(req.voiceId, "v1");
      assert.deepEqual(req.prosody, { rate: "-15%" });
      assert.equal(req.preferredProvider, "chatterbox");
    }
    assert.equal(out.audioPath, path.join(workDir, "narration.mp3"));
    // section 1 starts at 0; section 2 starts after section-1 chunks + one 5s pause
    const s1Chunks = calls.synth.filter((r) => sections[0].text.includes(r.text.split(" ")[0])).length;
    assert.equal(out.sections[0].startMs, 0);
    assert.equal(out.sections[1].startMs, out.sections[0].endMs + 5000);
    assert.equal(out.durationMs, out.sections[1].endMs);
    assert.ok(s1Chunks > 0);
    const list = fs.readFileSync(path.join(workDir, "concat.txt"), "utf8");
    assert.match(list, /silence-5000\.mp3/);
    assert.equal(list.match(/silence-5000\.mp3/g).length, 1, "one pause between two sections");
  });
  test("resumes from cached chunks after a provider failure", async () => {
    const { workDir, calls, deps } = harness({ failOnCall: 2 });
    await assert.rejects(() => narrateSections({ sections, template, voiceId: "v1", workDir }, deps), /provider hiccup/);
    const firstRunSynths = calls.synth.length;
    const out = await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    assert.ok(out.audioPath);
    // second run re-synthesised only what the first run did not cache
    assert.ok(calls.synth.length < firstRunSynths * 2, "cached chunks were not re-synthesised");
  });
  test("cache key changes with text, voice and rate", () => {
    const a = chunkCacheKey({ provider: "azure", voiceId: "v", rate: "-15%", text: "hi" });
    assert.notEqual(a, chunkCacheKey({ provider: "azure", voiceId: "v", rate: "-15%", text: "ho" }));
    assert.notEqual(a, chunkCacheKey({ provider: "azure", voiceId: "w", rate: "-15%", text: "hi" }));
    assert.notEqual(a, chunkCacheKey({ provider: "azure", voiceId: "v", rate: "0%", text: "hi" }));
    assert.match(a, /^[a-f0-9]{40}$/);
  });
  test("rejects empty sections with a named error", async () => {
    const { workDir, deps } = harness();
    await assert.rejects(() => narrateSections({ sections: [], template, voiceId: "v", workDir }, deps), /no sections/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd server && node --test src/lib/longform/narration.test.js` → FAIL

- [ ] **Step 3: Implement**

```js
// server/src/lib/longform/narration.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { synthesize as realSynthesize } from "../voice/index.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { splitForProvider } from "./chunker.js";

function defaultRunFfmpeg(args) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const proc = spawn(ff, ["-hide_banner", "-loglevel", "error", ...args]);
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
  });
}

export function chunkCacheKey({ provider, voiceId, rate, text }) {
  return crypto.createHash("sha1").update(`${provider}|${voiceId}|${rate}|${text}`).digest("hex");
}

async function ensureSilence(workDir, ms, runFfmpeg) {
  const file = path.join(workDir, `silence-${ms}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  // ffmpeg 5.1-safe: lavfi anullsrc, fixed duration, mp3 so concat stays homogeneous.
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", (ms / 1000).toFixed(3), "-c:a", "libmp3lame", "-q:a", "6", file]);
  return file;
}

async function synthChunk({ text, voiceId, template, chunksDir, synthesize }) {
  const provider = template.voice.preferredProviders[0];
  const key = chunkCacheKey({ provider, voiceId, rate: template.voice.rate, text });
  const cached = path.join(chunksDir, `${key}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return { file: cached, provider: null };
  const r = await synthesize({ text, voiceId, prosody: { rate: template.voice.rate }, preferredProvider: provider, scriptureMode: true });
  if (!r?.ok || !r.file) throw new Error(`narration: synthesis returned no file for chunk "${text.slice(0, 40)}…"`);
  fs.copyFileSync(r.file, cached);
  // The orchestrator may have fallen through to another provider; report the real one.
  return { file: cached, provider: r.provider || provider };
}

function concatListLine(file) {
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

/**
 * Narrate sections one chunk at a time, pausing between sections, then
 * concatenate. Section timings come from measured chunk durations, so no
 * word alignment is needed. Every chunk is cached by content hash: a failure
 * mid-way resumes instead of restarting.
 */
export async function narrateSections({ sections, template, voiceId, workDir }, deps = {}) {
  if (!Array.isArray(sections) || sections.length === 0) throw new Error("narration: no sections to narrate");
  const synthesize = deps.synthesize || realSynthesize;
  const probe = deps.probeDurationSec || probeAudioDurationSec;
  const runFfmpeg = deps.runFfmpeg || defaultRunFfmpeg;

  const chunksDir = path.join(workDir, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });
  const pauseMs = template.voice.pauseMs;
  const silence = await ensureSilence(workDir, pauseMs, runFfmpeg);
  const silenceMs = Math.round((await probe(silence)) * 1000) || pauseMs;

  const entries = [];
  const timed = [];
  let cursorMs = 0;
  let usedProvider = null;
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) { entries.push(silence); cursorMs += silenceMs; }
    const startMs = cursorMs;
    for (const text of splitForProvider(sections[i].text, template.voice.maxChunkChars)) {
      const { file, provider } = await synthChunk({ text, voiceId, template, chunksDir, synthesize });
      if (provider && !usedProvider) usedProvider = provider;
      entries.push(file);
      cursorMs += Math.round((await probe(file)) * 1000);
    }
    timed.push({ ...sections[i], startMs, endMs: cursorMs });
  }

  const listPath = path.join(workDir, "concat.txt");
  fs.writeFileSync(listPath, entries.map(concatListLine).join("\n") + "\n", "utf8");
  const audioPath = path.join(workDir, "narration.mp3");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-q:a", "4", "-ar", "44100", audioPath]);

  return { audioPath, durationMs: cursorMs, sections: timed, provider: usedProvider || template.voice.preferredProviders[0] };
}
```

- [ ] **Step 4: Run tests** — `cd server && node --test src/lib/longform/narration.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/longform/narration.js server/src/lib/longform/narration.test.js
git commit -m "feat(longform): chunked narration with section pauses, concat and resumable cache"
```

---

### Task 10: Section timings → word timings + chapters (pure)

**Files:**
- Create: `server/src/lib/longform/sectionTimings.js`
- Test: `server/src/lib/longform/sectionTimings.test.js`

**Interfaces:**
- Produces:
  - `wordsFromSections(sections) → Array<{ text, startMs, endMs }>` — each section's words spread evenly across `[startMs, endMs)`.
  - `chaptersFromSections(sections) → Array<{ startMs, title }>` using `heading`.

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/longform/sectionTimings.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { wordsFromSections, chaptersFromSections } from "./sectionTimings.js";

const sections = [
  { heading: "Welcome", text: "rest now friend", startMs: 0, endMs: 3000 },
  { heading: "Psalm 23", text: "the lord is my shepherd", startMs: 8000, endMs: 18000 },
];

describe("wordsFromSections", () => {
  test("spreads each section's words across its own window", () => {
    const words = wordsFromSections(sections);
    assert.equal(words.length, 8);
    assert.deepEqual(words[0], { text: "rest", startMs: 0, endMs: 1000 });
    assert.deepEqual(words[2], { text: "friend", startMs: 2000, endMs: 3000 });
    assert.equal(words[3].startMs, 8000);
    assert.equal(words[7].endMs, 18000);
  });
  test("is monotonic and never overlaps", () => {
    const words = wordsFromSections(sections);
    for (let i = 1; i < words.length; i++) assert.ok(words[i].startMs >= words[i - 1].endMs);
  });
  test("skips sections without text", () => {
    assert.deepEqual(wordsFromSections([{ heading: "x", text: "  ", startMs: 0, endMs: 5 }]), []);
  });
});

describe("chaptersFromSections", () => {
  test("maps heading and start", () => {
    assert.deepEqual(chaptersFromSections(sections), [{ startMs: 0, title: "Welcome" }, { startMs: 8000, title: "Psalm 23" }]);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement**

```js
// server/src/lib/longform/sectionTimings.js
/**
 * Long-form sections carry measured start/end from narration. Story's scene
 * segmenter still works on words, so spread each section's words evenly
 * inside its own window — far closer to reality than spreading the whole
 * script across the whole file, and it lands scene cuts on section edges.
 */
export function wordsFromSections(sections) {
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    const tokens = String(s?.text || "").split(/\s+/).filter(Boolean);
    const start = Number(s?.startMs) || 0;
    const end = Math.max(start, Number(s?.endMs) || start);
    if (!tokens.length || end <= start) continue;
    const step = (end - start) / tokens.length;
    tokens.forEach((text, i) => {
      out.push({ text, startMs: Math.round(start + i * step), endMs: Math.round(start + (i + 1) * step) });
    });
  }
  return out;
}

export function chaptersFromSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => s && String(s.heading || "").trim())
    .map((s) => ({ startMs: Number(s.startMs) || 0, title: String(s.heading).trim() }));
}
```

- [ ] **Step 4: Run tests** → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/longform/sectionTimings.js server/src/lib/longform/sectionTimings.test.js
git commit -m "feat(longform): derive word timings and chapters from measured sections"
```

---

### Task 11: Story pipeline becomes aspect- and template-aware

**Files:**
- Modify: `server/src/lib/story/projectStore.js` (STORY_STATUS + `createProject` defaults)
- Modify: `server/src/lib/story/sceneSegmenter.js` (`maxScenes` param)
- Modify: `server/src/lib/story/storyRender.js` (`captions` option)
- Modify: `server/src/routes/story.js` (`segmentStage`, `imagesStage`, `/:id/render`)
- Tests: `server/src/lib/story/sceneSegmenter.test.js`, `server/src/lib/story/storyRender.test.js`, `server/src/routes/story.test.js` (extend each)

**Interfaces:**
- `STORY_STATUS` gains `DRAFT_SCRIPT: "draft_script"` and `NARRATING: "narrating"`.
- `createProject(baseDir, { title, style, cast, aspect = "portrait", captions = "kinetic", scene = null, longform = null })`.
- `segmentScenes({ words, style, targetSec, cast, maxScenes })` — `maxScenes` overrides the env cap when a finite number ≥ 1 is given.
- `buildStoryFfmpegArgs({ ..., captions })` / `runStoryRender({ ..., captions })` — `captions === "none"` emits no drawtext.
- Render size: `aspect === "landscape"` → `STORY_RENDER_LANDSCAPE_WIDTH/HEIGHT` (default 1280×720); otherwise existing portrait env defaults.
- Image gen aspect: `project.aspect === "landscape" ? "landscape" : "portrait"`.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/lib/story/sceneSegmenter.test.js`:

```js
test("maxScenes override widens scenes beyond the env cap", async () => {
  _setLlmImpl(async () => { throw new Error("no llm"); }); // force fallbackRanges
  const words = Array.from({ length: 600 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: (i + 1) * 1000 })); // 600s
  const scenes = await segmentScenes({ words, style: "cinematic-bible", targetSec: 8, maxScenes: 6 });
  assert.ok(scenes.length <= 6, `expected ≤6 scenes, got ${scenes.length}`);
});
```

Append to `server/src/lib/story/storyRender.test.js` (mirror an existing `buildStoryFfmpegArgs` test's fixture for scenes/words):

```js
test("captions:none emits no drawtext even for short word lists", () => {
  const { args } = buildStoryFfmpegArgs({ ...fixture(), captions: "none" });
  const graph = args.join(" ");
  assert.doesNotMatch(graph, /drawtext/);
  assert.match(graph, /\[vcat\]copy\[vout\]/);
});
```

(If the file has no `fixture()` helper, build one inline: two scenes with `imagePath` set to any existing file path and `startMs/endMs`, `words` with 5 entries, `audioPath: "a.mp3"`, `width: 1280`, `height: 720`, `outPath: "o.mp4"`.)

Append to `server/src/routes/story.test.js` (inside the existing `describe` that has `dataDir/outputDir` set up, using its `handlerFor`/`mockReqRes`/`waitForProject` helpers):

```js
test("landscape projects request landscape images", async () => {
  const seen = [];
  _setImageGenImpl(async (args) => { seen.push(args); return { ok: true, path: path.join(outputDir, "x.png"), publicUrl: "/x.png" }; });
  fs.writeFileSync(path.join(outputDir, "x.png"), "img");
  const project = writeProject(dataDir, {
    ...(await (async () => { const { createProject } = await import("../lib/story/projectStore.js"); return createProject(dataDir, { title: "L", aspect: "landscape" }); })()),
    scenes: [{ id: "s1", text: "t", startMs: 0, endMs: 1000, imagePrompt: "p", imagePath: null, imageStatus: "pending", promptEditedByUser: false }],
    status: "generating_images",
  });
  const { req, res } = mockReqRes({ params: { id: project.projectId }, dataDir, outputDir });
  await handlerFor("post", "/:id/images")(req, res);
  await waitForProject(dataDir, project.projectId, (p) => p.scenes[0].imageStatus === "done");
  assert.equal(seen[0].aspect, "landscape");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --test src/lib/story/sceneSegmenter.test.js src/lib/story/storyRender.test.js src/routes/story.test.js`
Expected: the three new cases FAIL

- [ ] **Step 3: Implement**

`projectStore.js`:
```js
export const STORY_STATUS = {
  DRAFT: "draft",
  DRAFT_SCRIPT: "draft_script",   // long-form: outline written, nothing synthesised
  NARRATING: "narrating",         // long-form: chunked TTS in progress
  TRANSCRIBING: "transcribing",
  // ...existing entries unchanged
};

export function createProject(baseDir, { title = "Untitled", style = "cinematic-bible", cast = [], aspect = "portrait", captions = "kinetic", scene = null, longform = null } = {}) {
  // ...existing body; add to the returned object:
  //   aspect: aspect === "landscape" ? "landscape" : "portrait",
  //   captions: ["none", "static", "kinetic"].includes(captions) ? captions : "kinetic",
  //   scene: scene && typeof scene === "object" ? { targetSceneSec: Number(scene.targetSceneSec) || undefined, maxScenes: Number(scene.maxScenes) || undefined } : null,
  //   longform: longform && typeof longform === "object" ? longform : null,
}
```

`sceneSegmenter.js`: change the signature to `segmentScenes({ words, style, targetSec = TARGET_SEC_DEFAULT, cast = [], maxScenes })` and replace uses of `MAX_SCENES` inside the function with a local:
```js
  const cap = Number.isFinite(Number(maxScenes)) && Number(maxScenes) >= 1 ? Math.round(Number(maxScenes)) : MAX_SCENES;
```
(use `cap` in `minSecForCap` and in the `llmScenes.length <= cap` check).

`storyRender.js`: add `captions` to both `buildStoryFfmpegArgs` and `runStoryRender` parameter lists and pass it through; where `drawtext` is chosen:
```js
  const drawtext = captions === "none"
    ? ""
    : (drawWords.length > kineticMaxWords ? buildSubtitleDrawtext(drawWords, width, height) : buildWordDrawtext({ words: drawWords, w: width, h: height }));
```

`routes/story.js`:
- `segmentStage`: `segmentScenes({ words, style: project.style, cast: project.cast || [], targetSec: project.scene?.targetSceneSec, maxScenes: project.scene?.maxScenes })`
- `imagesStage`: `aspect: project.aspect === "landscape" ? "landscape" : "portrait"`
- `/:id/render`: replace the fixed width/height with
```js
    const landscape = project.aspect === "landscape";
    const width = Math.max(240, Number(landscape ? process.env.STORY_RENDER_LANDSCAPE_WIDTH : process.env.STORY_RENDER_WIDTH) || (landscape ? 1280 : 720));
    const height = Math.max(240, Number(landscape ? process.env.STORY_RENDER_LANDSCAPE_HEIGHT : process.env.STORY_RENDER_HEIGHT) || (landscape ? 720 : 1280));
```
  and pass `width, height, captions: project.captions || "kinetic"` to `runStoryRender`.
- `POST /` (create) and `/import-script`: pass `aspect`, `captions`, `scene`, `longform` from `req.body` into `createProject`.

- [ ] **Step 4: Run the story suite** — `cd server && node --test src/lib/story/*.test.js src/routes/story.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/story server/src/routes/story.js
git commit -m "feat(story): per-project aspect, caption mode and scene-cap overrides"
```

---

### Task 12: `routes/longform.js` — templates, draft, narrate, edit sections

**Files:**
- Create: `server/src/routes/longform.js`
- Modify: `server/index.js` (mount after `/api/story`)
- Test: `server/src/routes/longform.test.js`

**Interfaces:**
- Consumes: Task 6 `LONGFORM_TEMPLATES`, `longformTemplateById`; Task 7 `planLongformScript`; Task 9 `narrateSections`; Task 10 `wordsFromSections`; story `createProject`, `readProject`, `writeProject`, `STORY_STATUS`; story `buildImportedTranscript`; story `runStoryPipeline` (exported from `routes/story.js`).
- Produces:
  - `GET  /api/longform/templates` → `{ ok, templates: [{ id, label, kind, targetSec }] }`
  - `POST /api/longform/draft { idea, templateId, translation?, targetSec?, title? }` → `{ ok, project }` at `draft_script`, `aspect: "landscape"`, `captions` and `scene` from the template, `longform: { templateId, idea, summary, sections }`.
  - `PATCH /api/longform/:id/sections { sections: [{ heading, reference, verseText, text, targetSec }] }` → `{ ok, project }` (only while `draft_script`).
  - `POST /api/longform/:id/narrate { voiceId? }` → `{ ok, project }` immediately at `narrating`; background: narrate → import transcript (words from sections) → `segmenting` → `runStoryPipeline` (transcribe short-circuits) → images. On failure: `error` status with message.
  - Test seams: `_setPlanImpl`, `_setNarrateImpl`, `_setPipelineImpl` + resets.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/routes/longform.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import longformRouter, { _setPlanImpl, _resetPlanImpl, _setNarrateImpl, _resetNarrateImpl, _setPipelineImpl, _resetPipelineImpl } from "./longform.js";
import { readProject } from "../lib/story/projectStore.js";

let dataDir, outputDir, app;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lf-"));
  outputDir = path.join(dataDir, "out"); fs.mkdirSync(outputDir);
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir }; next(); });
  app.use("/api/longform", longformRouter);
  _setPlanImpl(async ({ idea }) => ({
    title: "Psalms for Rest", summary: "Slow psalms.",
    sections: [
      { heading: "Welcome", reference: null, verseText: "", text: `welcome ${idea}`, targetSec: 60 },
      { heading: "Psalm 23", reference: "Psalm 23:1", verseText: "The LORD is my shepherd.", text: "Psalm 23:1. The LORD is my shepherd. Rest.", targetSec: 300 },
      { heading: "Closing", reference: null, verseText: "", text: "sleep well", targetSec: 60 },
    ],
  }));
});
afterEach(() => { _resetPlanImpl(); _resetNarrateImpl(); _resetPipelineImpl(); });

async function waitFor(id, pred, ms = 3000) {
  const start = Date.now();
  for (;;) { const p = readProject(dataDir, id); if (p && pred(p)) return p; if (Date.now() - start > ms) return p; await new Promise((r) => setTimeout(r, 10)); }
}

describe("GET /api/longform/templates", () => {
  test("lists the shipped templates", async () => {
    const res = await request(app).get("/api/longform/templates");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.templates.map((t) => t.id), ["sleep-30", "sleep-60"]);
  });
});

describe("POST /api/longform/draft", () => {
  test("creates a landscape draft_script project with sections and no audio", async () => {
    const res = await request(app).post("/api/longform/draft").send({ idea: "can't sleep", templateId: "sleep-30" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.project;
    assert.equal(p.status, "draft_script");
    assert.equal(p.aspect, "landscape");
    assert.equal(p.captions, "none");
    assert.equal(p.scene.maxScenes, 12);
    assert.equal(p.title, "Psalms for Rest");
    assert.equal(p.longform.templateId, "sleep-30");
    assert.equal(p.longform.sections.length, 3);
    assert.equal(p.source.audioPath, null);
  });
  test("rejects an unknown template and a missing idea by name", async () => {
    let res = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "nope" });
    assert.equal(res.status, 400); assert.match(res.body.error, /template/i);
    res = await request(app).post("/api/longform/draft").send({ templateId: "sleep-30" });
    assert.equal(res.status, 400); assert.match(res.body.error, /idea/i);
  });
});

describe("PATCH /api/longform/:id/sections", () => {
  test("replaces section text while still a draft", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const edited = body.project.longform.sections.map((s, i) => (i === 0 ? { ...s, text: "edited welcome" } : s));
    const res = await request(app).patch(`/api/longform/${body.project.projectId}/sections`).send({ sections: edited });
    assert.equal(res.status, 200);
    assert.equal(res.body.project.longform.sections[0].text, "edited welcome");
  });
});

describe("POST /api/longform/:id/narrate", () => {
  test("narrates, imports section-based timings and hands off to the story pipeline", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    const id = body.project.projectId;
    _setNarrateImpl(async ({ sections, workDir }) => {
      fs.mkdirSync(workDir, { recursive: true });
      const audioPath = path.join(workDir, "narration.mp3"); fs.writeFileSync(audioPath, "a");
      let t = 0;
      const timed = sections.map((s) => { const out = { ...s, startMs: t, endMs: t + s.targetSec * 1000 }; t = out.endMs + 5000; return out; });
      return { audioPath, durationMs: timed[timed.length - 1].endMs, sections: timed, provider: "azure" };
    });
    const pipelineCalls = [];
    _setPipelineImpl(async (ctx, projectId, mediaPath) => { pipelineCalls.push({ projectId, mediaPath }); });

    const res = await request(app).post(`/api/longform/${id}/narrate`).send({ voiceId: "v1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.status, "narrating");

    const p = await waitFor(id, (x) => pipelineCalls.length === 1);
    assert.equal(pipelineCalls[0].projectId, id);
    assert.ok(p.source.audioPath.endsWith("narration.mp3"));
    assert.equal(p.source.durationMs, 430000);
    assert.equal(p.longform.sections[1].startMs, 65000);
    assert.ok(p.transcript.words.length > 5);
    assert.equal(p.transcript.words[0].startMs, 0);
    assert.equal(p.status, "segmenting");
  });
  test("refuses when the project has no sections", async () => {
    const { createProject, writeProject } = await import("../lib/story/projectStore.js");
    const p = writeProject(dataDir, { ...createProject(dataDir, { title: "bare" }), status: "draft_script" });
    const res = await request(app).post(`/api/longform/${p.projectId}/narrate`).send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /sections/i);
  });
  test("a narration failure lands the project in error with the reason", async () => {
    const { body } = await request(app).post("/api/longform/draft").send({ idea: "x", templateId: "sleep-30" });
    _setNarrateImpl(async () => { throw new Error("azure quota"); });
    await request(app).post(`/api/longform/${body.project.projectId}/narrate`).send({});
    const p = await waitFor(body.project.projectId, (x) => x.status === "error");
    assert.equal(p.status, "error");
    assert.match(p.error, /azure quota/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd server && node --test src/routes/longform.test.js` → FAIL (module not found)

- [ ] **Step 3: Implement**

```js
// server/src/routes/longform.js
import { Router } from "express";
import path from "path";
import { LONGFORM_TEMPLATES, longformTemplateById } from "../lib/longform/templates.js";
import { planLongformScript } from "../lib/longform/scriptPlanner.js";
import { narrateSections } from "../lib/longform/narration.js";
import { wordsFromSections } from "../lib/longform/sectionTimings.js";
import { buildImportedTranscript } from "../lib/story/scriptImport.js";
import { createProject, readProject, writeProject, STORY_STATUS } from "../lib/story/projectStore.js";
import { runStoryPipeline } from "./story.js";

let _plan = planLongformScript;
export function _setPlanImpl(fn) { _plan = fn; }
export function _resetPlanImpl() { _plan = planLongformScript; }
let _narrate = narrateSections;
export function _setNarrateImpl(fn) { _narrate = fn; }
export function _resetNarrateImpl() { _narrate = narrateSections; }
let _pipeline = runStoryPipeline;
export function _setPipelineImpl(fn) { _pipeline = fn; }
export function _resetPipelineImpl() { _pipeline = runStoryPipeline; }

const router = Router();

router.get("/templates", (_req, res) => {
  res.json({ ok: true, templates: LONGFORM_TEMPLATES.map((t) => ({ id: t.id, label: t.label, kind: t.kind, targetSec: t.targetSec })) });
});

function normaliseSections(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map((s) => ({
    heading: String(s?.heading || "").trim() || "Section",
    reference: s?.reference ? String(s.reference).trim() : null,
    verseText: String(s?.verseText || "").trim(),
    text: String(s?.text || "").trim(),
    targetSec: Math.max(20, Math.round(Number(s?.targetSec) || 60)),
    ...(Number.isFinite(Number(s?.startMs)) ? { startMs: Number(s.startMs) } : {}),
    ...(Number.isFinite(Number(s?.endMs)) ? { endMs: Number(s.endMs) } : {}),
  }));
  return out.every((s) => s.text) ? out : null;
}

router.post("/draft", async (req, res) => {
  try {
    const template = longformTemplateById(req.body?.templateId);
    if (!template) return res.status(400).json({ ok: false, error: "template is required (unknown templateId)" });
    const idea = String(req.body?.idea || "").trim();
    if (idea.length < 3) return res.status(400).json({ ok: false, error: "idea is required" });

    const plan = await _plan({ idea, template, translation: req.body?.translation, targetSec: req.body?.targetSec });
    const created = createProject(req.ctx.dataDir, {
      title: String(req.body?.title || plan.title || "").trim() || plan.title,
      style: req.body?.style,
      aspect: "landscape",
      captions: template.scene.captions,
      scene: { targetSceneSec: template.scene.targetSceneSec, maxScenes: template.scene.maxScenes },
      longform: { templateId: template.id, idea, summary: plan.summary, sections: plan.sections },
    });
    const project = writeProject(req.ctx.dataDir, {
      ...created,
      music: { ...created.music, volume: template.music.volume, autoDuck: template.music.autoDuck },
      status: STORY_STATUS.DRAFT_SCRIPT,
    });
    return res.json({ ok: true, project });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id/sections", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (project.status !== STORY_STATUS.DRAFT_SCRIPT) return res.status(409).json({ ok: false, error: "sections can only be edited while the project is a draft" });
  const sections = normaliseSections(req.body?.sections);
  if (!sections?.length) return res.status(400).json({ ok: false, error: "sections must be a non-empty array with text in every section" });
  const updated = writeProject(req.ctx.dataDir, { ...project, longform: { ...(project.longform || {}), sections } });
  return res.json({ ok: true, project: updated });
});

async function runNarration(ctx, projectId, voiceId) {
  const project = readProject(ctx.dataDir, projectId);
  const template = longformTemplateById(project?.longform?.templateId);
  const workDir = path.join(ctx.outputDir, "longform", projectId);
  const narrated = await _narrate({ sections: project.longform.sections, template, voiceId, workDir });
  const words = wordsFromSections(narrated.sections);
  const patch = buildImportedTranscript({ script: narrated.sections.map((s) => s.text).join(" "), audioPath: narrated.audioPath, durationMs: narrated.durationMs, words });
  const fresh = readProject(ctx.dataDir, projectId);
  writeProject(ctx.dataDir, {
    ...fresh,
    ...patch,
    longform: { ...fresh.longform, sections: narrated.sections, provider: narrated.provider, voiceId: voiceId || null },
    status: STORY_STATUS.SEGMENTING,
  });
  await _pipeline({ dataDir: ctx.dataDir, outputDir: ctx.outputDir }, projectId, narrated.audioPath);
}

router.post("/:id/narrate", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (!project.longform?.sections?.length) return res.status(400).json({ ok: false, error: "project has no sections to narrate" });
  if (!longformTemplateById(project.longform.templateId)) return res.status(400).json({ ok: false, error: "project's template is unknown" });
  const voiceId = req.body?.voiceId ? String(req.body.voiceId) : undefined;
  const started = writeProject(req.ctx.dataDir, { ...project, status: STORY_STATUS.NARRATING, error: null });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  runNarration(ctx, project.projectId, voiceId).catch((e) => {
    const fresh = readProject(ctx.dataDir, project.projectId);
    if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
  });
  return res.json({ ok: true, project: started });
});

export default router;
```

Mount in `server/index.js` next to the story router (same middleware chain):
```js
import longformRouter from "./src/routes/longform.js";
// ...
app.use("/api/longform",  requireAuth, withUserScope, requireVerifiedEmail, quota("render"),     longformRouter);
```

- [ ] **Step 4: Run tests** — `cd server && node --test src/routes/longform.test.js && npm test` → PASS (whole suite)

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/longform.js server/src/routes/longform.test.js server/index.js
git commit -m "feat(longform): draft, edit-sections and narrate routes feeding the Story pipeline"
```

---

### Task 13: Client — Long-form tab, outline editor, narration progress

**Files:**
- Create: `client/src/lib/longformApi.ts`
- Create: `client/src/components/story/LongformForm.tsx`
- Create: `client/src/components/story/OutlineEditor.tsx`
- Modify: `client/src/lib/storyTypes.ts` (statuses), `client/src/pages/StoryVideoPage.tsx` (entry mode + draft/narrating states), `client/src/components/story/ProjectHistory.tsx` (Draft badge)
- Tests: `client/src/components/story/__tests__/LongformForm.test.tsx`, `client/src/components/story/__tests__/OutlineEditor.test.tsx`

**Interfaces:**
```ts
// longformApi.ts
export interface LongformTemplateOption { id: string; label: string; kind: string; targetSec: number }
export const longformApi = {
  listTemplates(): Promise<LongformTemplateOption[]>,             // GET /api/longform/templates
  draft(args: { idea: string; templateId: string; targetSec?: number }): Promise<StoryProject>,  // POST /api/longform/draft
  saveSections(id: string, sections: LongformSection[]): Promise<StoryProject>,                 // PATCH /api/longform/:id/sections
  narrate(id: string, voiceId?: string): Promise<StoryProject>,                                 // POST /api/longform/:id/narrate
};
// LongformForm props
{ onDrafted: (project: StoryProject) => void; busy: boolean }
// OutlineEditor props
{ project: StoryProject; onSaved: (p: StoryProject) => void; onNarrate: (voiceId: string) => void; busy: boolean }
```
`StoryStatus` gains `'draft_script' | 'narrating'`.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/story/__tests__/LongformForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { LongformForm } from '../LongformForm';

beforeEach(() => vi.restoreAllMocks());

describe('LongformForm', () => {
  it('loads templates and drafts from an idea', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'Sleep 30', kind: 'sleep', targetSec: 1800 }, { id: 'sleep-60', label: 'Sleep 60', kind: 'sleep', targetSec: 3600 }] } } as any);
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { projectId: 'p1', status: 'draft_script', longform: { sections: [] } } } } as any);
    const onDrafted = vi.fn();
    render(<LongformForm onDrafted={onDrafted} busy={false} />);
    await screen.findByRole('option', { name: 'Sleep 60' });
    await user.selectOptions(screen.getByLabelText(/format/i), 'sleep-60');
    await user.type(screen.getByLabelText(/what's on your heart/i), 'psalms when I cannot sleep');
    await user.click(screen.getByRole('button', { name: /write the outline/i }));
    expect(post).toHaveBeenCalledWith('/api/longform/draft', { idea: 'psalms when I cannot sleep', templateId: 'sleep-60' }, undefined, expect.anything());
    expect(onDrafted).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
  it('disables the button until there is an idea', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'S', kind: 'sleep', targetSec: 1800 }] } } as any);
    render(<LongformForm onDrafted={() => {}} busy={false} />);
    await screen.findByRole('option', { name: 'S' });
    expect(screen.getByRole('button', { name: /write the outline/i })).toBeDisabled();
  });
});
```

```tsx
// client/src/components/story/__tests__/OutlineEditor.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { OutlineEditor } from '../OutlineEditor';

beforeEach(() => vi.restoreAllMocks());

const project: any = {
  projectId: 'p1', title: 'Psalms for Rest', status: 'draft_script',
  longform: { templateId: 'sleep-30', sections: [
    { heading: 'Welcome', reference: null, verseText: '', text: 'rest now', targetSec: 60 },
    { heading: 'Psalm 23', reference: 'Psalm 23:1', verseText: 'The LORD is my shepherd.', text: 'Psalm 23:1. The LORD is my shepherd. rest.', targetSec: 300 },
  ] },
};

describe('OutlineEditor', () => {
  it('shows every section, saves edits and starts narration with the chosen voice', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, data: { project } } as any);
    const onSaved = vi.fn(); const onNarrate = vi.fn();
    render(<OutlineEditor project={project} onSaved={onSaved} onNarrate={onNarrate} busy={false} />);
    expect(screen.getByText('Psalm 23')).toBeInTheDocument();
    expect(screen.getByText(/The LORD is my shepherd/)).toBeInTheDocument();
    const welcome = screen.getAllByRole('textbox')[0];
    await user.clear(welcome);
    await user.type(welcome, 'edited welcome');
    await user.click(screen.getByRole('button', { name: /save outline/i }));
    expect(patch).toHaveBeenCalledWith('/api/longform/p1/sections', expect.objectContaining({ sections: expect.arrayContaining([expect.objectContaining({ text: 'edited welcome' })]) }));
    expect(onSaved).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /generate narration/i }));
    expect(onNarrate).toHaveBeenCalledWith(expect.any(String));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd client && npx vitest run src/components/story/__tests__/LongformForm.test.tsx src/components/story/__tests__/OutlineEditor.test.tsx` → FAIL

- [ ] **Step 3: Implement**

`client/src/lib/storyTypes.ts`: extend `StoryStatus` with `'draft_script' | 'narrating'` (and keep the Task 5 additions).

```ts
// client/src/lib/longformApi.ts
import { api, GENERATE_TIMEOUT_MS } from './api';
import type { LongformSection, StoryProject } from './storyTypes';

export interface LongformTemplateOption { id: string; label: string; kind: string; targetSec: number }

function unwrapProject(res: { ok: boolean; data?: any; error?: string }): StoryProject {
  if (!res.ok || !res.data?.project) throw new Error(res.error || res.data?.error || 'Request failed');
  return res.data.project as StoryProject;
}

export const longformApi = {
  async listTemplates(): Promise<LongformTemplateOption[]> {
    const res = await api.get('/api/longform/templates');
    if (!res.ok) throw new Error(res.error || 'Failed to load templates');
    return (res.data?.templates ?? []) as LongformTemplateOption[];
  },
  // Planning calls the LLM once per section; give it the long generate ceiling.
  async draft(args: { idea: string; templateId: string; targetSec?: number }): Promise<StoryProject> {
    return unwrapProject(await api.post('/api/longform/draft', args, undefined, { timeout: GENERATE_TIMEOUT_MS }));
  },
  async saveSections(id: string, sections: LongformSection[]): Promise<StoryProject> {
    return unwrapProject(await api.patch(`/api/longform/${id}/sections`, { sections }));
  },
  async narrate(id: string, voiceId?: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/longform/${id}/narrate`, voiceId ? { voiceId } : {}));
  },
};
```

```tsx
// client/src/components/story/LongformForm.tsx
import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi, type LongformTemplateOption } from '../../lib/longformApi';
import type { StoryProject } from '../../lib/storyTypes';

interface Props { onDrafted: (project: StoryProject) => void; busy: boolean }
const inputCls = 'mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none';

export function LongformForm({ onDrafted, busy }: Props) {
  const [templates, setTemplates] = useState<LongformTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [idea, setIdea] = useState('');
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    longformApi.listTemplates().then((list) => {
      if (cancelled) return;
      setTemplates(list);
      setTemplateId((prev) => prev || list[0]?.id || '');
    }).catch((e) => toast.error((e as Error).message));
    return () => { cancelled = true; };
  }, []);

  const canDraft = idea.trim().length >= 3 && Boolean(templateId) && !busy && !drafting;

  const draft = async () => {
    if (!canDraft) return;
    setDrafting(true);
    try {
      const project = await longformApi.draft({ idea: idea.trim(), templateId });
      toast.success('Outline written — review it before narration');
      onDrafted(project);
    } catch (e) {
      toast.error((e as Error).message || 'Could not write the outline');
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm text-gray-300">
        Format
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="block text-sm text-gray-300">
        What's on your heart? (a verse, a theme, a rough idea)
        <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={4} placeholder="psalms for when I can't switch my mind off at night" className={inputCls} />
      </label>
      <button type="button" onClick={draft} disabled={!canDraft} className="inline-flex items-center gap-2 rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-60">
        {drafting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        Write the outline
      </button>
    </div>
  );
}
```

```tsx
// client/src/components/story/OutlineEditor.tsx
import { useState } from 'react';
import { Loader2, Mic, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { longformApi } from '../../lib/longformApi';
import { STORY_VOICES } from '../../lib/storyScript';
import type { LongformSection, StoryProject } from '../../lib/storyTypes';

interface Props { project: StoryProject; onSaved: (p: StoryProject) => void; onNarrate: (voiceId: string) => void; busy: boolean }
const inputCls = 'mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none';

export function OutlineEditor({ project, onSaved, onNarrate, busy }: Props) {
  const [sections, setSections] = useState<LongformSection[]>(project.longform?.sections ?? []);
  const [voiceId, setVoiceId] = useState(STORY_VOICES[0].id);
  const [saving, setSaving] = useState(false);
  const totalMin = Math.round(sections.reduce((n, s) => n + (s.targetSec || 0), 0) / 60);

  const update = (i: number, text: string) => setSections((prev) => prev.map((s, j) => (j === i ? { ...s, text } : s)));

  const save = async () => {
    setSaving(true);
    try { onSaved(await longformApi.saveSections(project.projectId, sections)); toast.success('Outline saved'); }
    catch (e) { toast.error((e as Error).message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">{sections.length} sections · about {totalMin} min. Scripture is fetched verbatim; edit the reflections freely.</p>
      {sections.map((s, i) => (
        <div key={i} className="rounded-xl border border-white/10 p-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium text-white">{s.heading}</h4>
            <span className="text-xs text-gray-500">{Math.round(s.targetSec / 60)} min</span>
          </div>
          {s.verseText && <blockquote className="mt-1 border-l-2 border-primary-400/60 pl-2 text-sm italic text-gray-300">{s.reference}: {s.verseText}</blockquote>}
          <textarea value={s.text} onChange={(e) => update(i, e.target.value)} rows={4} className={inputCls} />
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm text-gray-300">
          Voice
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={inputCls}>
            {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={save} disabled={saving || busy} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-4 py-2 text-sm text-white disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save outline
        </button>
        <button type="button" onClick={() => onNarrate(voiceId)} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-60">
          <Mic size={16} /> Generate narration
        </button>
      </div>
    </div>
  );
}
```

`StoryVideoPage.tsx`:
- Add a third entry mode `'longform'` with a "Long-form" toggle button next to *Upload audio* / *Write a script*; render `<LongformForm onDrafted={(p) => { setActive(p.projectId); qc.invalidateQueries({ queryKey: ['story-project', p.projectId] }); }} busy={busy} />` in that mode.
- In the project view, when `project.status === 'draft_script'` render `<OutlineEditor project={project} onSaved={() => refresh()} onNarrate={async (voiceId) => { setBusy(true); try { await longformApi.narrate(project.projectId, voiceId); refresh(); toast.success('Narrating on the server — this takes a few minutes'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }} busy={busy} />`.
- When `project.status === 'narrating'` render the existing spinner row with the label "Generating narration…" (reuse whatever the page shows for `transcribing`).
- Make sure the page's polling (`refetchInterval`) treats `narrating` like the other in-flight statuses.

`ProjectHistory.tsx`: where the status badge is rendered, map `draft_script` → label "Draft" and `narrating` → "Narrating" (same badge styles as `draft`/`transcribing`).

- [ ] **Step 4: Run client tests and typecheck** — `cd client && npx vitest run src && npx tsc -b` → PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): long-form tab with outline editor and narration hand-off"
```

---

## Section 3 — Inspiration → draft

### Task 14: Template suggestion + voice-note ideas on `/draft`

**Files:**
- Create: `server/src/lib/longform/suggestTemplate.js`
- Test: `server/src/lib/longform/suggestTemplate.test.js`
- Modify: `server/src/routes/longform.js` (`/draft`), `server/src/routes/longform.test.js` (extend)

**Interfaces:**
- `suggestTemplate(idea) → { templateId: string, reason: string }` — pure heuristic; long/duration cues ("hour", "60") → `sleep-60`, else `sleep-30`.
- `POST /api/longform/draft` now accepts `{ idea?, audioPath?, templateId? }`: if `audioPath` is given and `idea` is empty, transcribe it via `transcribeAudio` (from `../lib/stt/index.js`, seam `_setTranscribeImpl`) and use the joined words as the idea; if `templateId` is missing, use `suggestTemplate`. Response gains `suggestion?: { templateId, reason }` when one was applied.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/longform/suggestTemplate.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { suggestTemplate } from "./suggestTemplate.js";

describe("suggestTemplate", () => {
  test("defaults to the 30-minute sleep session", () => {
    assert.equal(suggestTemplate("psalms about rest").templateId, "sleep-30");
  });
  test("an hour cue picks sleep-60 and says why", () => {
    const r = suggestTemplate("an hour of scripture for the night shift");
    assert.equal(r.templateId, "sleep-60");
    assert.match(r.reason, /hour/i);
  });
  test("empty input still returns a valid template", () => {
    assert.equal(suggestTemplate("").templateId, "sleep-30");
  });
});
```

Append to `server/src/routes/longform.test.js` (add `_setTranscribeImpl, _resetTranscribeImpl` to the import and reset in `afterEach`):

```js
describe("POST /api/longform/draft — inspiration", () => {
  test("suggests a template when none is given and reports it", async () => {
    const res = await request(app).post("/api/longform/draft").send({ idea: "an hour of psalms" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.project.longform.templateId, "sleep-60");
    assert.equal(res.body.suggestion.templateId, "sleep-60");
  });
  test("transcribes a voice note into the idea", async () => {
    const note = path.join(outputDir, "note.m4a"); fs.writeFileSync(note, "aud");
    let planned = "";
    _setPlanImpl(async ({ idea }) => { planned = idea; return { title: "T", summary: "", sections: [
      { heading: "A", reference: null, verseText: "", text: "a", targetSec: 60 },
      { heading: "B", reference: null, verseText: "", text: "b", targetSec: 60 },
      { heading: "C", reference: null, verseText: "", text: "c", targetSec: 60 } ] }; });
    _setTranscribeImpl(async () => ({ provider: "local-whisper", words: [{ text: "when", startMs: 0, endMs: 1 }, { text: "I", startMs: 1, endMs: 2 }, { text: "cannot", startMs: 2, endMs: 3 }, { text: "sleep", startMs: 3, endMs: 4 }] }));
    const res = await request(app).post("/api/longform/draft").send({ audioPath: note, templateId: "sleep-30" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(planned, "when I cannot sleep");
    assert.equal(res.body.project.longform.idea, "when I cannot sleep");
  });
  test("rejects a voice note outside the user's output dir", async () => {
    const res = await request(app).post("/api/longform/draft").send({ audioPath: "/etc/passwd", templateId: "sleep-30" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /audioPath/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement**

```js
// server/src/lib/longform/suggestTemplate.js
/**
 * Pick a long-form template from a rough idea. Deliberately simple and
 * explainable — the response tells the operator why, and they can override.
 */
const HOUR_CUES = /\b(an?\s+hour|1\s*hour|60\s*min(ute)?s?|hour[- ]long|all night|night shift)\b/i;

export function suggestTemplate(idea) {
  const text = String(idea || "");
  if (HOUR_CUES.test(text)) return { templateId: "sleep-60", reason: "the idea mentions an hour-long session" };
  return { templateId: "sleep-30", reason: "default 30-minute sleep session" };
}
```

In `routes/longform.js`: import `transcribeAudio` from `../lib/stt/index.js` and `suggestTemplate`; add the seam:
```js
let _transcribe = transcribeAudio;
export function _setTranscribeImpl(fn) { _transcribe = fn; }
export function _resetTranscribeImpl() { _transcribe = transcribeAudio; }

function confineToOutputDir(ctx, candidate) {
  const resolved = path.resolve(String(candidate || ""));
  const root = path.resolve(ctx.outputDir);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}
```
and rewrite the top of the `/draft` handler:
```js
    let idea = String(req.body?.idea || "").trim();
    if (!idea && req.body?.audioPath) {
      const audioPath = confineToOutputDir(req.ctx, req.body.audioPath);
      if (!audioPath) return res.status(400).json({ ok: false, error: "audioPath must point inside your outputs folder" });
      const t = await _transcribe(audioPath);
      idea = (t?.words || []).map((w) => w.text).join(" ").trim();
      if (!idea) return res.status(400).json({ ok: false, error: "voice note transcription returned no words" });
    }
    if (idea.length < 3) return res.status(400).json({ ok: false, error: "idea is required" });

    let suggestion = null;
    let templateId = String(req.body?.templateId || "").trim();
    if (!templateId) { suggestion = suggestTemplate(idea); templateId = suggestion.templateId; }
    const template = longformTemplateById(templateId);
    if (!template) return res.status(400).json({ ok: false, error: "template is required (unknown templateId)" });
```
and include `...(suggestion ? { suggestion } : {})` in the success response.

- [ ] **Step 4: Run tests** — `cd server && node --test src/lib/longform/suggestTemplate.test.js src/routes/longform.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/longform/suggestTemplate.js server/src/lib/longform/suggestTemplate.test.js server/src/routes/longform.js server/src/routes/longform.test.js
git commit -m "feat(longform): voice-note ideas and template suggestion on draft"
```

---

### Task 15: Client — voice-note inspiration + "let BibleFuel choose"

**Files:**
- Modify: `client/src/components/story/LongformForm.tsx`, `client/src/lib/longformApi.ts`
- Test: extend `client/src/components/story/__tests__/LongformForm.test.tsx`

**Interfaces:**
- `longformApi.draft` accepts `{ idea?: string; audioPath?: string; templateId?: string }` and returns `{ project, suggestion? }` — change its return type to `{ project: StoryProject; suggestion?: { templateId: string; reason: string } }`; update Task 13's caller accordingly.
- `LongformForm` gains a "Let BibleFuel choose" option in the format select (value `''`) and a "Record / upload a voice note" control that uploads via the existing `storyApi.uploadAudio` (see `StoryVideoPage.handlePickFile` for its signature) and then drafts with `audioPath`.

- [ ] **Step 1: Extend the test**

```tsx
  it('sends audioPath when a voice note is chosen and surfaces the suggested template', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { templates: [{ id: 'sleep-30', label: 'S30', kind: 'sleep', targetSec: 1800 }] } } as any);
    const upload = vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/outputs/note.m4a');
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { project: { projectId: 'p2', status: 'draft_script', longform: { templateId: 'sleep-60', sections: [] } }, suggestion: { templateId: 'sleep-60', reason: 'the idea mentions an hour-long session' } } } as any);
    const info = vi.spyOn(toast, 'success');
    render(<LongformForm onDrafted={() => {}} busy={false} />);
    await screen.findByRole('option', { name: 'S30' });
    await user.selectOptions(screen.getByLabelText(/format/i), '');
    const file = new File(['aud'], 'note.m4a', { type: 'audio/m4a' });
    await user.upload(screen.getByLabelText(/voice note/i), file);
    expect(upload).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/api/longform/draft', { audioPath: '/outputs/note.m4a' }, undefined, expect.anything());
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/hour-long session/));
  });
```

(Add `import { storyApi } from '../../../lib/storyApi';` and `import toast from 'react-hot-toast';` to the test file.)

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement**

`longformApi.draft`:
```ts
  async draft(args: { idea?: string; audioPath?: string; templateId?: string; targetSec?: number }): Promise<{ project: StoryProject; suggestion?: { templateId: string; reason: string } }> {
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== ''));
    const res = await api.post('/api/longform/draft', clean, undefined, { timeout: GENERATE_TIMEOUT_MS });
    return { project: unwrapProject(res), suggestion: res.data?.suggestion };
  },
```

`LongformForm.tsx`: prepend `<option value="">Let BibleFuel choose</option>` to the format select; add
```tsx
<label className="block text-sm text-gray-300">
  Or a voice note
  <input type="file" accept="audio/*" className="mt-1 block w-full text-sm text-gray-400" onChange={(e) => { const f = e.target.files?.[0]; if (f) draftFromVoiceNote(f); }} />
</label>
```
with
```tsx
const finish = ({ project, suggestion }: Awaited<ReturnType<typeof longformApi.draft>>) => {
  if (suggestion) toast.success(`Chose ${suggestion.templateId}: ${suggestion.reason}`);
  else toast.success('Outline written — review it before narration');
  onDrafted(project);
};
const draftFromVoiceNote = async (file: File) => {
  setDrafting(true);
  try {
    const audioPath = await storyApi.uploadAudio(file);   // match the signature used in StoryVideoPage.handlePickFile
    finish(await longformApi.draft({ audioPath, templateId }));
  } catch (e) { toast.error((e as Error).message || 'Could not use the voice note'); }
  finally { setDrafting(false); }
};
```
and make the text path call `finish(await longformApi.draft({ idea: idea.trim(), templateId }))`. `canDraft` no longer requires `templateId`.

- [ ] **Step 4: Run tests + typecheck** — `cd client && npx vitest run src/components/story && npx tsc -b` → PASS

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat(client): voice-note inspiration and auto-chosen long-form format"
```

---

### Task 16: End-to-end smoke (manual, local) and env notes

**Files:**
- Modify: `server/.env.example` — add `STORY_RENDER_LANDSCAPE_WIDTH=1280`, `STORY_RENDER_LANDSCAPE_HEIGHT=720` with a comment.
- Modify: `README.md` — one short "Long-form (YouTube)" subsection: Story → Long-form tab → outline → narration → render → Publish to YouTube; mention `publishAt` keeps the video private until then.

- [ ] **Step 1: Full test run**

Run: `cd server && npm test` then `cd client && npx vitest run && npx tsc -b`
Expected: all PASS

- [ ] **Step 2: Local smoke (operator machine, dev server)**

1. `cd server && npm run dev` and the client dev server; open Story Video → Long-form.
2. Draft `sleep-30` from "psalms for a restless night" — outline shows verse blockquotes with real KJV text.
3. Generate narration with an Edge voice (free) — project moves `narrating → segmenting → generating_images → ready_to_render`.
4. Render — output is 1280×720, no captions, ~30 min. Check `ffprobe` on `outputs/story/<id>/video.mp4`.
5. Publish to YouTube with `publishAt` tomorrow and a scene thumbnail, privacy Public → toast says it stays private until then; YouTube Studio shows the scheduled video with the thumbnail.

Record anything that deviates in `SESSION_LOG.md`.

- [ ] **Step 3: Commit docs**

```bash
git add server/.env.example README.md
git commit -m "docs: long-form YouTube workflow and landscape render env"
```

---

## Self-review

**Spec coverage (Sections 1–3):**
- §1 metadata/publishAt/thumbnail/description-chapters/validation → Tasks 1–3 ✔; streaming fix → Task 3 ✔; shared panel in Timeline + Story + (ShareSheet) → Task 5 covers Timeline and Story. **ShareSheet (Render/Jobs) direct-YouTube option is deferred to Phase 2** — ShareSheet is Postiz-based and Postiz is parked; the Timeline and Story surfaces are where long-form output lives. Noted here so it is a conscious cut, not a miss.
- §2 templates → Task 6; planner with fetched scripture → Task 7; chunked narration with pauses, measured timings, cache → Tasks 8–9; section-window word timings → Task 10; per-project scene cap / captions none / landscape → Task 11; import seam + UI → Tasks 12–13; accepted judgment calls (Chatterbox/Azure first, no captions) → Task 6 `voice.preferredProviders` and `scene.captions`.
- §3 draft endpoint, narrate = approve, refuse without sections → Task 12; voice note via existing STT, template suggestion + reason → Tasks 14–15; Draft badge → Task 13.
- Aspect finding → Task 11.

**Placeholder scan:** no TBD/TODO; every code step has code; "existing options unchanged" in Task 5 refers to lines already in the file, not to be written.

**Type consistency:** `LongformSection` fields (`heading, reference, verseText, text, targetSec, startMs?, endMs?`) are identical in Tasks 7, 10, 12, 13; `YoutubePublishResult` fields (`videoId, videoUrl, forcedPrivate, thumbnailError?`) match Task 3's response; `narrateSections` return shape matches Task 12's `_setNarrateImpl` fake; `segmentScenes({ maxScenes })` and `runStoryRender({ captions })` match between Tasks 11 and 12.

**Provider provenance:** `synthesize()` in `lib/voice/orchestrator.js` falls through to the next provider when the preferred one is unreachable; `narration.js` therefore reports the provider the first fresh chunk actually used (`usedProvider`), falling back to the template preference only when every chunk came from cache.
