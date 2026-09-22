# Music Library Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator keep an uploaded music track — labelled, duration-known and licence-tagged — in a per-tenant library that every build can draw on, instead of re-uploading a loose file per project.

**Architecture:** A per-tenant JSON index at `<dataDir>/musicLibrary.json` holds uploaded tracks; the 23 bundled tracks in `server/assets/music/` stay exactly as they are and are merged in at read time. Bundled tracks keep the `library:<id>` ref that resolves with no tenant context; tenant tracks get a new `mylib:<id>` ref, because resolving one requires `dataDir`. The three existing `resolveAssetPath` helpers already take `dataDir`, so wiring the new prefix in is one line each.

**Tech Stack:** Node ESM, Express, `node:test` + `assert/strict` on the server; React + TypeScript + Vitest + React Testing Library on the client; ffprobe via the existing `probeAudioDurationSec`.

**Spec:** `docs/superpowers/specs/2026-09-22-ambient-scripture-video-design.md` (Phase 1 of the Build order section)

## Global Constraints

- Production ffmpeg is **5.1**. Any ffmpeg invocation uses `-filter_complex_script` via `toFilterScriptArgs`, never inline `-filter_complex`. (This plan only probes durations, but the constraint binds anything added.)
- All route I/O goes through `req.ctx.dataDir` / `req.ctx.outputDir`. Never a module-level `DATA_DIR` or `OUTPUT_DIR` inside a request handler.
- A tenant must never read or delete another tenant's track. Every store function takes `dataDir` as its first argument.
- Bundled tracks are read-only: they are never written to a tenant index and `DELETE` on one is refused.
- Server tests run with a glob, never a bare directory: `node --test "src/lib/*.test.js"` from `server/`.
- No `console.log` in shipped code.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `server/src/lib/musicLibraryStore.js` *(new)* | The per-tenant index: read, register, update, remove, resolve a `mylib:` ref. Knows nothing about HTTP. |
| `server/src/lib/musicLibraryStore.test.js` *(new)* | Store behaviour, including tenant isolation. |
| `server/src/lib/musicLibrary.js` *(modify)* | Gains `listBundledTracks()` as a named alias of today's `listTracks()` so the merged listing reads clearly. Bundled data untouched. |
| `server/src/routes/music.js` *(modify)* | Merged `GET /library`, plus `POST /upload`, `PATCH /:id`, `DELETE /:id`. |
| `server/src/routes/music.test.js` *(modify)* | Route contracts against the existing handler-extraction idiom. |
| `server/src/routes/audio_advanced.js`, `jobs.js`, `render.js`, `story.js` *(modify)* | One line each so a `mylib:` ref resolves to a real file. |
| `client/src/lib/musicLibraryApi.ts` *(modify)* | `MusicTrack` gains `source`/`licence`/`durationSec`; adds `saveTrackToLibrary`, `updateTrack`, `deleteTrack`. |
| `client/src/components/MusicPicker.tsx` *(modify)* | After an upload, offer "Save to library"; show a licence badge; delete a tenant track. |
| `client/src/components/__tests__/MusicPicker.test.tsx` *(new)* | The save flow, the badge, and that bundled tracks offer no delete. |

---

### Task 1: The per-tenant music index

**Files:**
- Create: `server/src/lib/musicLibraryStore.js`
- Test: `server/src/lib/musicLibraryStore.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `readMusicLibrary(dataDir) -> { items: Track[] }`
  - `registerTrack(dataDir, { file, label, mood, licence, durationSec }) -> Track`
  - `updateTrack(dataDir, id, { label?, mood?, licence? }) -> Track | null`
  - `removeTrack(dataDir, id) -> boolean`
  - `resolveTenantTrack(dataDir, ref) -> string | null`
  - `musicIndexPath(dataDir) -> string`
  - where `Track = { id, label, mood, file, durationSec, source: 'upload', licence, addedAt }`

- [ ] **Step 1: Write the failing test**

Create `server/src/lib/musicLibraryStore.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  readMusicLibrary, registerTrack, updateTrack, removeTrack,
  resolveTenantTrack, musicIndexPath,
} from "./musicLibraryStore.js";

function tmpTenant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-music-"));
  const file = path.join(dir, "track.mp3");
  fs.writeFileSync(file, "not really audio, but a real file on disk");
  return { dir, file };
}

test("an empty tenant has an empty library rather than an error", () => {
  const { dir } = tmpTenant();
  assert.deepEqual(readMusicLibrary(dir), { items: [] });
});

test("a registered track comes back with an id, a ref and the metadata given", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Secret Place", mood: "calm", licence: "cleared", durationSec: 182.5 });
  assert.ok(t.id, "got an id");
  assert.equal(t.label, "Secret Place");
  assert.equal(t.mood, "calm");
  assert.equal(t.licence, "cleared");
  assert.equal(t.durationSec, 182.5);
  assert.equal(t.source, "upload");
  assert.equal(readMusicLibrary(dir).items.length, 1);
});

test("licence defaults to unknown, because assuming cleared is the dangerous default", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Untagged" });
  assert.equal(t.licence, "unknown");
});

test("registering the same file twice returns the same entry instead of duplicating it", () => {
  const { dir, file } = tmpTenant();
  const a = registerTrack(dir, { file, label: "One" });
  const b = registerTrack(dir, { file, label: "One again" });
  assert.equal(a.id, b.id);
  assert.equal(readMusicLibrary(dir).items.length, 1);
});

test("a mylib ref resolves to the file on disk, and to null once the file is gone", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Bed" });
  assert.equal(resolveTenantTrack(dir, `mylib:${t.id}`), file);
  fs.unlinkSync(file);
  assert.equal(resolveTenantTrack(dir, `mylib:${t.id}`), null);
});

test("resolveTenantTrack ignores refs that are not ours", () => {
  const { dir } = tmpTenant();
  assert.equal(resolveTenantTrack(dir, "library:peaceful-worship"), null);
  assert.equal(resolveTenantTrack(dir, "/some/upload.mp3"), null);
  assert.equal(resolveTenantTrack(dir, null), null);
});

test("one tenant cannot see, resolve or delete another tenant's track", () => {
  const a = tmpTenant();
  const b = tmpTenant();
  const t = registerTrack(a.dir, { file: a.file, label: "Mine" });
  assert.deepEqual(readMusicLibrary(b.dir), { items: [] });
  assert.equal(resolveTenantTrack(b.dir, `mylib:${t.id}`), null);
  assert.equal(removeTrack(b.dir, t.id), false);
  assert.equal(readMusicLibrary(a.dir).items.length, 1, "the owner still has it");
});

test("updateTrack changes only what it is given, and reports an unknown id", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Before", mood: "calm", licence: "unknown" });
  const after = updateTrack(dir, t.id, { licence: "cleared" });
  assert.equal(after.licence, "cleared");
  assert.equal(after.label, "Before", "label was left alone");
  assert.equal(after.mood, "calm", "mood was left alone");
  assert.equal(updateTrack(dir, "nope", { label: "x" }), null);
});

test("removeTrack drops the entry but never the operator's file", () => {
  const { dir, file } = tmpTenant();
  const t = registerTrack(dir, { file, label: "Bed" });
  assert.equal(removeTrack(dir, t.id), true);
  assert.deepEqual(readMusicLibrary(dir), { items: [] });
  assert.equal(fs.existsSync(file), true, "the audio file is the operator's, not ours to delete");
  assert.equal(removeTrack(dir, t.id), false, "removing twice is not an error, just false");
});

test("a corrupt index reads as empty rather than throwing mid-request", () => {
  const { dir } = tmpTenant();
  fs.writeFileSync(musicIndexPath(dir), "{ this is not json");
  assert.deepEqual(readMusicLibrary(dir), { items: [] });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run from `server/`: `node --test "src/lib/musicLibraryStore.test.js"`
Expected: FAIL — `Cannot find module './musicLibraryStore.js'`

- [ ] **Step 3: Write the implementation**

Create `server/src/lib/musicLibraryStore.js`:

```js
import fs from "fs";
import path from "path";
import crypto from "crypto";

const INDEX_FILE = "musicLibrary.json";
const REF_PREFIX = "mylib:";

/** Where this tenant's uploaded-track index lives. */
export function musicIndexPath(dataDir) {
  return path.join(dataDir, INDEX_FILE);
}

/**
 * The tenant's uploaded tracks.
 *
 * A missing or corrupt index reads as empty: a music picker that renders
 * nothing is recoverable, a request that throws mid-listing is not.
 */
export function readMusicLibrary(dataDir) {
  try {
    const raw = fs.readFileSync(musicIndexPath(dataDir), "utf8");
    const parsed = JSON.parse(raw);
    return { items: Array.isArray(parsed?.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

function writeMusicLibrary(dataDir, lib) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(musicIndexPath(dataDir), JSON.stringify(lib, null, 2), "utf8");
}

/**
 * Remember an already-uploaded file as a reusable track.
 *
 * Identity is the absolute path, so saving the same file twice returns the
 * first entry rather than filling the picker with duplicates.
 *
 * `licence` defaults to "unknown" on purpose. On a long music-led video a
 * Content ID claim takes the revenue for the whole video, so the dangerous
 * assumption is "cleared" — the operator has to say so.
 */
export function registerTrack(dataDir, { file, label, mood, licence, durationSec }) {
  const abs = String(file || "").trim();
  if (!abs) throw new Error("file is required");
  const lib = readMusicLibrary(dataDir);
  const existing = lib.items.find((t) => t.file === abs);
  if (existing) return existing;

  const track = {
    id: crypto.randomUUID(),
    label: String(label || path.basename(abs)).trim(),
    mood: String(mood || "calm").trim(),
    file: abs,
    durationSec: Number.isFinite(Number(durationSec)) ? Number(durationSec) : null,
    source: "upload",
    licence: String(licence || "unknown").trim() || "unknown",
    addedAt: Date.now(),
  };
  lib.items.push(track);
  writeMusicLibrary(dataDir, lib);
  return track;
}

/** Patch a track's metadata. Returns the updated track, or null if unknown. */
export function updateTrack(dataDir, id, patch = {}) {
  const lib = readMusicLibrary(dataDir);
  const track = lib.items.find((t) => t.id === id);
  if (!track) return null;
  for (const key of ["label", "mood", "licence"]) {
    if (patch[key] !== undefined) track[key] = String(patch[key]).trim();
  }
  writeMusicLibrary(dataDir, lib);
  return track;
}

/**
 * Forget a track. The audio file itself is left alone — it is the operator's
 * upload and may be referenced by a project we cannot see from here.
 */
export function removeTrack(dataDir, id) {
  const lib = readMusicLibrary(dataDir);
  const next = lib.items.filter((t) => t.id !== id);
  if (next.length === lib.items.length) return false;
  writeMusicLibrary(dataDir, { items: next });
  return true;
}

/**
 * Resolve a `mylib:<id>` ref to a file on disk.
 *
 * Bundled tracks keep their own `library:` prefix and resolve without tenant
 * context; these cannot, which is exactly why they are spelled differently.
 */
export function resolveTenantTrack(dataDir, ref) {
  const s = String(ref || "").trim();
  if (!s.startsWith(REF_PREFIX)) return null;
  const id = s.slice(REF_PREFIX.length);
  const track = readMusicLibrary(dataDir).items.find((t) => t.id === id);
  if (!track) return null;
  return fs.existsSync(track.file) ? track.file : null;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test "src/lib/musicLibraryStore.test.js"`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/musicLibraryStore.js server/src/lib/musicLibraryStore.test.js
git commit -m "feat(music): a per-tenant index for uploaded tracks"
```

---

### Task 2: The routes

**Files:**
- Modify: `server/src/routes/music.js` (whole file — it is 5 lines today)
- Modify: `server/src/lib/musicLibrary.js` (add one exported alias)
- Test: `server/src/routes/music.test.js`

**Interfaces:**
- Consumes: `readMusicLibrary`, `registerTrack`, `updateTrack`, `removeTrack` from Task 1; `listTracks` from `musicLibrary.js`; `probeAudioDurationSec` from `../lib/story/storyRender.js`.
- Produces: `GET /api/music/library` returning `{ ok, tracks }` where each track is `{ id, label, mood, previewUrl, default, source, licence, durationSec }` and `source` is `'bundled' | 'upload'`; `POST /api/music/upload`; `PATCH /api/music/:id`; `DELETE /api/music/:id`.

- [ ] **Step 1: Write the failing test**

Replace the body of `server/src/routes/music.test.js` with this, keeping the existing `handlerFor`/`res` helpers at the top:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import musicRouter from "./music.js";
import { registerTrack } from "../lib/musicLibraryStore.js";

function handlerFor(method, routePath) {
  const layer = musicRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function res() {
  return { payload: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
}
function tenant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-music-route-"));
  const outputDir = path.join(dir, "out");
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, "user-audio-1.mp3");
  fs.writeFileSync(file, "a real file on disk");
  return { ctx: { dataDir: dir, outputDir }, file };
}

describe("music route", () => {
  test("GET /library still lists the 23 bundled tracks, now tagged", async () => {
    const r = res();
    await handlerFor("get", "/library")({ ctx: tenant().ctx }, r);
    assert.equal(r.payload.ok, true);
    const bundled = r.payload.tracks.filter((t) => t.source === "bundled");
    assert.equal(bundled.length, 23);
    assert.match(bundled[0].previewUrl, /^\/music\//);
    assert.equal(bundled[0].licence, "pixabay-cleared");
  });

  test("GET /library merges the tenant's own uploads after the bundled ones", async () => {
    const { ctx, file } = tenant();
    registerTrack(ctx.dataDir, { file, label: "My Bed", licence: "unknown" });
    const r = res();
    await handlerFor("get", "/library")({ ctx }, r);
    const mine = r.payload.tracks.filter((t) => t.source === "upload");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].label, "My Bed");
    assert.equal(mine[0].licence, "unknown");
    assert.equal(r.payload.tracks.length, 24);
  });

  test("POST /upload registers a file that is already in the caller's output dir", async () => {
    const { ctx, file } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file, label: "Saved", mood: "calm", licence: "cleared" } }, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.track.label, "Saved");
    assert.equal(r.payload.track.source, "upload");
  });

  test("POST /upload refuses a path outside the caller's own media folder", async () => {
    const { ctx } = tenant();
    const outsider = path.join(os.tmpdir(), "somebody-elses.mp3");
    fs.writeFileSync(outsider, "x");
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: outsider, label: "Nope" } }, r);
    assert.equal(r.statusCode, 403);
    assert.equal(r.payload.ok, false);
  });

  test("POST /upload refuses a file that is not there", async () => {
    const { ctx } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: path.join(ctx.outputDir, "ghost.mp3") } }, r);
    assert.equal(r.statusCode, 400);
  });

  test("PATCH /:id changes the licence; an unknown id is a 404", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Bed" });
    const ok = res();
    await handlerFor("patch", "/:id")({ ctx, params: { id: t.id }, body: { licence: "cleared" } }, ok);
    assert.equal(ok.payload.track.licence, "cleared");
    const missing = res();
    await handlerFor("patch", "/:id")({ ctx, params: { id: "nope" }, body: { licence: "cleared" } }, missing);
    assert.equal(missing.statusCode, 404);
  });

  test("DELETE /:id forgets an upload but refuses a bundled track", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Bed" });
    const gone = res();
    await handlerFor("delete", "/:id")({ ctx, params: { id: t.id } }, gone);
    assert.equal(gone.payload.ok, true);
    const bundled = res();
    await handlerFor("delete", "/:id")({ ctx, params: { id: "peaceful-worship" } }, bundled);
    assert.equal(bundled.statusCode, 400, "bundled tracks ship with the app and are not the tenant's to delete");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test "src/routes/music.test.js"`
Expected: FAIL — `no handler for post /upload`, and the bundled-listing test fails on `licence` being undefined.

- [ ] **Step 3: Write the implementation**

Replace `server/src/routes/music.js` entirely:

```js
import { Router } from "express";
import fs from "fs";
import path from "path";
import { listTracks } from "../lib/musicLibrary.js";
import {
  readMusicLibrary, registerTrack, updateTrack, removeTrack,
} from "../lib/musicLibraryStore.js";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";

const router = Router();

/** A tenant upload, in the shape the picker already understands. */
function toListed(track) {
  return {
    id: track.id,
    label: track.label,
    mood: track.mood,
    previewUrl: null, // uploads are served through the authed /outputs path, not /music
    default: false,
    source: "upload",
    licence: track.licence,
    durationSec: track.durationSec,
    ref: `mylib:${track.id}`,
  };
}

// Bundled first (they are the curated set), then the operator's own.
router.get("/library", (req, res) => {
  const bundled = listTracks().map((t) => ({
    ...t,
    source: "bundled",
    licence: "pixabay-cleared",
    durationSec: null,
    ref: `library:${t.id}`,
  }));
  const mine = readMusicLibrary(req.ctx.dataDir).items.map(toListed);
  res.json({ ok: true, tracks: [...bundled, ...mine] });
});

// Remember a file the operator has ALREADY uploaded through
// POST /api/media/upload-audio (or the resumable pair). This route does not
// receive bytes; it only records what is already on disk.
router.post("/upload", async (req, res) => {
  try {
    const file = path.resolve(String(req.body?.file || "").trim());
    const root = path.resolve(req.ctx.outputDir);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return res.status(403).json({ ok: false, error: "That file is outside your media folder" });
    }
    if (!fs.existsSync(file)) {
      return res.status(400).json({ ok: false, error: "That file is no longer there" });
    }
    // A duration makes the picker useful ("3:02") and lets a later bed
    // assembly know how many tracks it needs. A probe failure is not fatal.
    // probeAudioDurationSec is declared `function` (storyRender.js:435) and
    // returns a promise; awaiting it is correct, and a rejection must not
    // cost the operator their saved track.
    let durationSec = null;
    try { durationSec = await probeAudioDurationSec(file); } catch { durationSec = null; }

    const track = registerTrack(req.ctx.dataDir, {
      file,
      label: req.body?.label,
      mood: req.body?.mood,
      licence: req.body?.licence,
      durationSec,
    });
    return res.json({ ok: true, track: toListed(track) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id", (req, res) => {
  const track = updateTrack(req.ctx.dataDir, req.params.id, {
    label: req.body?.label,
    mood: req.body?.mood,
    licence: req.body?.licence,
  });
  if (!track) return res.status(404).json({ ok: false, error: "track not found" });
  return res.json({ ok: true, track: toListed(track) });
});

router.delete("/:id", (req, res) => {
  const bundled = listTracks().some((t) => t.id === req.params.id);
  if (bundled) return res.status(400).json({ ok: false, error: "Bundled tracks ship with the app" });
  if (!removeTrack(req.ctx.dataDir, req.params.id)) {
    return res.status(404).json({ ok: false, error: "track not found" });
  }
  return res.json({ ok: true });
});

export default router;
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test "src/routes/music.test.js"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole server suite so nothing else read the old listing shape**

Run: `npm test` from `server/`
Expected: PASS. If a Timeline or Story test asserted a bare 23-track listing, update that assertion to filter on `source === 'bundled'` — the count is only stable for the bundled set now.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/music.js server/src/routes/music.test.js
git commit -m "feat(music): save, tag and forget uploaded tracks"
```

---

### Task 3: Make a saved track playable in every build

**Files:**
- Modify: `server/src/routes/audio_advanced.js` (inside `resolveAssetPath`, right after the `resolveLibraryTrack` line)
- Modify: `server/src/routes/jobs.js:337` (inside the exported `resolveAssetPath`)
- Modify: `server/src/routes/render.js:65` (inside `resolveAssetPath`)
- Modify: `server/src/routes/story.js:770` (the `musicPath:` line)
- Test: `server/src/routes/musicRefs.test.js` *(new)*

**Interfaces:**
- Consumes: `resolveTenantTrack(dataDir, ref)` from Task 1; `registerTrack` for the fixtures.
- Produces: nothing new — this makes `mylib:` refs work wherever `library:` refs already do.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/musicRefs.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { registerTrack } from "../lib/musicLibraryStore.js";
import { resolveAssetPath } from "./jobs.js";

// A track saved to the library is only useful if every build can play it.
// jobs.js is the shared resolver for the render queue; render.js and
// audio_advanced.js carry their own copies of the same helper.

test("a mylib ref resolves to the saved file for the tenant that owns it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-"));
  const file = path.join(dir, "bed.mp3");
  fs.writeFileSync(file, "audio");
  const t = registerTrack(dir, { file, label: "Bed" });
  assert.equal(resolveAssetPath(`mylib:${t.id}`, dir), file);
});

test("a mylib ref from another tenant does not resolve", () => {
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-a-"));
  const theirs = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-b-"));
  const file = path.join(mine, "bed.mp3");
  fs.writeFileSync(file, "audio");
  const t = registerTrack(mine, { file, label: "Bed" });
  assert.notEqual(resolveAssetPath(`mylib:${t.id}`, theirs), file);
});

test("bundled library refs still resolve exactly as they did", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-refs-c-"));
  const resolved = resolveAssetPath("library:peaceful-worship", dir);
  assert.ok(resolved && resolved.endsWith("01-peaceful-worship.mp3"));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test "src/routes/musicRefs.test.js"`
Expected: FAIL — the first test resolves to `null` because nothing understands `mylib:` yet.

- [ ] **Step 3: Write the implementation**

In **each** of `audio_advanced.js`, `jobs.js` and `render.js`, add the import:

```js
import { resolveTenantTrack } from "../lib/musicLibraryStore.js";
```

and insert these two lines inside that file's `resolveAssetPath`, immediately after the existing `if (libTrack) return libTrack;`:

```js
  // A track the operator saved to their own library. Needs dataDir, which is
  // why it is spelled mylib: rather than library:.
  const saved = resolveTenantTrack(dataDir, normalized);
  if (saved) return saved;
```

In `server/src/routes/story.js:770`, change:

```js
      musicPath: resolveLibraryTrack(project.music?.path) || project.music?.path || null,
```

to:

```js
      musicPath: resolveLibraryTrack(project.music?.path)
        || resolveTenantTrack(req.ctx.dataDir, project.music?.path)
        || project.music?.path
        || null,
```

adding `import { resolveTenantTrack } from "../lib/musicLibraryStore.js";` to that file's imports.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test "src/routes/musicRefs.test.js"` — expected PASS, 3 tests.
Then `npm test` from `server/` — expected PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/audio_advanced.js server/src/routes/jobs.js server/src/routes/render.js server/src/routes/story.js server/src/routes/musicRefs.test.js
git commit -m "feat(music): saved tracks play in every build, not just the one that uploaded them"
```

---

### Task 4: The picker remembers an upload

**Files:**
- Modify: `client/src/lib/musicLibraryApi.ts`
- Modify: `client/src/components/MusicPicker.tsx` (the `upload` function around line 55, and the track list rendering)
- Test: `client/src/components/__tests__/MusicPicker.test.tsx` *(new)*

**Interfaces:**
- Consumes: the routes from Task 2.
- Produces: `MusicTrack` gains `source: 'bundled' | 'upload'`, `licence: string`, `durationSec: number | null`, `ref: string`; plus `saveTrackToLibrary(file, meta)`, `updateTrack(id, patch)`, `deleteTrack(id)`.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/__tests__/MusicPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../lib/api';
import { MusicPicker } from '../MusicPicker';

const tracks = [
  { id: 'peaceful-worship', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/01.mp3', default: true, source: 'bundled', licence: 'pixabay-cleared', durationSec: null, ref: 'library:peaceful-worship' },
  { id: 'u1', label: 'My Bed', mood: 'calm', previewUrl: null, default: false, source: 'upload', licence: 'unknown', durationSec: 182, ref: 'mylib:u1' },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, tracks } } as any);
});

describe('MusicPicker', () => {
  it('warns on a track whose licence is unknown, and says nothing about a cleared one', async () => {
    render(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
    await waitFor(() => expect(screen.getByText('My Bed')).toBeInTheDocument());
    expect(screen.getByTitle(/licence is not recorded/i)).toBeInTheDocument();
    expect(screen.queryByTitle(/Peaceful Worship.*licence/i)).not.toBeInTheDocument();
  });

  it('offers to delete a saved upload but never a bundled track', async () => {
    render(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
    await waitFor(() => expect(screen.getByText('My Bed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /forget My Bed/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forget Peaceful Worship/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run from `client/`: `npx vitest run src/components/__tests__/MusicPicker.test.tsx`
Expected: FAIL — no licence badge and no forget button exist.

- [ ] **Step 3: Extend the client API**

In `client/src/lib/musicLibraryApi.ts`, replace the interface and add the three calls:

```ts
import { api } from './api';

export interface MusicTrack {
  id: string;
  label: string;
  mood: string;
  previewUrl: string | null;
  default: boolean;
  /** Bundled tracks ship with the app; uploads belong to this account. */
  source: 'bundled' | 'upload';
  /** 'pixabay-cleared' for bundled; 'unknown' until the operator says otherwise. */
  licence: string;
  durationSec: number | null;
  /** The ref a build stores: `library:<id>` or `mylib:<id>`. */
  ref: string;
}

export async function fetchMusicLibrary(): Promise<MusicTrack[]> {
  const res = await api.get('/api/music/library');
  if (!res.ok) throw new Error(res.error || 'Failed to load music library');
  return (res.data?.tracks ?? []) as MusicTrack[];
}

/** Remember an already-uploaded file as a reusable track. */
export async function saveTrackToLibrary(
  file: string,
  meta: { label?: string; mood?: string; licence?: string } = {},
): Promise<MusicTrack> {
  const res = await api.post('/api/music/upload', { file, ...meta });
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to save track');
  return res.data.track as MusicTrack;
}

export async function updateTrack(id: string, patch: { label?: string; mood?: string; licence?: string }): Promise<MusicTrack> {
  const res = await api.patch(`/api/music/${id}`, patch);
  if (!res.ok || !res.data?.track) throw new Error(res.error || 'Failed to update track');
  return res.data.track as MusicTrack;
}

export async function deleteTrack(id: string): Promise<void> {
  const res = await api.delete(`/api/music/${id}`);
  if (!res.ok) throw new Error(res.error || 'Failed to remove track');
}
```

- [ ] **Step 4: Wire the picker**

In `client/src/components/MusicPicker.tsx`:

1. Import the new calls and the query client:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { saveTrackToLibrary, deleteTrack } from '../lib/musicLibraryApi';
```

2. In the component body, add `const qc = useQueryClient();`.

3. In `upload`, after the existing `storyApi.uploadAudio` call succeeds, keep the track:

```tsx
      const path = await storyApi.uploadAudio(file, file.name);
      // Keep it: an upload used to be a loose file attached to one project.
      // Saving it costs nothing here and makes it available to every build.
      try {
        await saveTrackToLibrary(path, { label: file.name.replace(/\.[^.]+$/, '') });
        qc.invalidateQueries({ queryKey: ['music-library'] });
      } catch {
        // The upload itself succeeded — the project can still use the file.
        // Failing to remember it is not worth losing the upload over.
      }
```

4. Where each track row renders, add the badge and the forget button:

```tsx
{t.licence === 'unknown' && (
  <span
    className="ml-2 rounded px-1.5 py-0.5 text-[10px] text-amber-300 bg-amber-500/10"
    title="This track's licence is not recorded. On a long music-led video a Content ID claim takes the revenue for the whole video."
  >
    licence?
  </span>
)}
{t.source === 'upload' && (
  <button
    aria-label={`Forget ${t.label}`}
    title="Remove from your library. The uploaded file itself is kept."
    onClick={async () => {
      await deleteTrack(t.id);
      qc.invalidateQueries({ queryKey: ['music-library'] });
    }}
    className="ml-2 text-content-tertiary hover:text-bf-danger"
  >
    <X size={12} />
  </button>
)}
```

The query key is `['music-library']`, set in `client/src/hooks/useMusicLibrary.ts` with `staleTime: Infinity` — which is exactly why both calls above must invalidate it, or a saved track will not appear until a full reload.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run src/components/__tests__/MusicPicker.test.tsx` — expected PASS, 2 tests.
Then `npx vitest run` and `npx tsc --noEmit -p .` from `client/` — expected PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/musicLibraryApi.ts client/src/components/MusicPicker.tsx client/src/components/__tests__/MusicPicker.test.tsx
git commit -m "feat(music): uploads are kept, tagged and reusable across builds"
```

---

### Task 5: Verify it end to end, and record what changed

**Files:**
- Modify: `docs/speech-to-text.md`'s sibling — create `docs/music-library.md`
- Test: manual, against the running dev stack

**Interfaces:**
- Consumes: everything above.
- Produces: `docs/music-library.md`.

- [ ] **Step 1: Run both suites**

From `server/`: `npm test` — expected PASS.
From `client/`: `npx vitest run` and `npx tsc --noEmit -p .` — expected PASS and clean.

- [ ] **Step 2: Drive the real app**

The dev stack runs under pm2. Do **not** run a bare `pm2 start ecosystem.config.cjs` — it starts the Chatterbox sidecar, which affects an unrelated machine. Use the already-running `biblefuel-api` / `biblefuel-client`, and never edit server source while a render is in flight (pm2 watch restarts kill it).

In the browser: open a Story Video project, upload an audio file through the music picker, confirm it appears in the library list with a `licence?` badge, reload the page and confirm it is still there, then open a *different* project and confirm the same track is selectable. Render a short video with it and confirm the music plays.

- [ ] **Step 3: Write the doc**

Create `docs/music-library.md` covering: the two ref prefixes and why they differ (`library:` resolves without tenant context, `mylib:` cannot); where the index lives (`<dataDir>/musicLibrary.json`); that bundled tracks are read-only; that `licence` defaults to `unknown` and what that costs on a music-led video; and that removing a track forgets the entry but keeps the operator's file.

- [ ] **Step 4: Commit**

```bash
git add docs/music-library.md
git commit -m "docs(music): how the per-tenant music library works"
```

---

## Self-review notes

**Spec coverage.** The spec's Phase 1 asks for the per-tenant index (Task 1), the upload/edit/delete routes and merged listing (Task 2), and the picker changes (Task 4). Task 3 is not named in the spec but is required by it: a saved track that no build can resolve is not a library. Task 5 covers the spec's "ends with the operator able to upload a track and pick it in any existing build."

**Deliberately not built.** The licence *gate* (409 on an uncleared assembly) belongs to Phase 2, where bed assembly exists to gate. Phase 1 stores the licence and badges it. Building a gate now would leave a code path with no caller.

**Correction carried from the spec.** The spec says "there is no way to add a track", which is true of the library but not of a project: `MusicPicker` already uploads via `storyApi.uploadAudio`. Task 4 therefore *keeps* an existing upload rather than building uploading, which is why it is a small task.

**Known unknown, unchanged.** `probeAudioDurationSec` is used on an uploaded file in Task 2; if it proves slow on a two-hour mix, the probe is already wrapped in a try/catch that degrades to `durationSec: null`, so a slow or failed probe cannot fail the save.
