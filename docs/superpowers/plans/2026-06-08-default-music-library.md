# Default Music Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a library of 10 gospel music beds selectable across Story Video, Render, Timeline, Series, and Auto-Publish (with "Use default audio" + auto-select for Series/Auto-Publish), reusing the existing autoduck renderers.

**Architecture:** A `musicLibrary` module (manifest + `resolveLibraryTrack("library:<id>")` → bundled file) hooked into the existing `resolveAssetPath` of every renderer, so a `library:<id>` musicPath works everywhere with no render-logic change. A `GET /api/music/library` + static `/music` serve feed a shared `MusicPicker`. Series/Auto-Publish default their music to the designated default track.

**Tech Stack:** Node/Express + `node:test` (server); React 19 + TanStack Query + Vitest (client). Reuses the autoduck filtergraphs already in render.js / jobs.js / storyRender.

**Spec:** `docs/superpowers/specs/2026-06-08-default-music-library-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/assets/music/01..10-*.mp3` | 10 placeholder beds (swap later) | Create |
| `server/assets/music/README.md` | "replace these 10, keep names" | Create |
| `server/src/lib/musicLibrary.js` | manifest + `listTracks`/`resolveLibraryTrack`/`defaultTrackRef` | Create |
| `server/src/lib/musicLibrary.test.js` | unit tests | Create |
| `server/src/routes/music.js` | `GET /api/music/library` | Create |
| `server/src/routes/render.js`, `jobs.js`, `audio_advanced.js` | hook `resolveLibraryTrack` into each `resolveAssetPath` | Modify |
| `server/src/routes/story.js` | resolve `library:` for the story render music | Modify |
| `server/index.js` | mount `/api/music` + static `/music` | Modify |
| `client/src/lib/musicLibraryApi.ts` + `useMusicLibrary` | fetch the track list | Create |
| `client/src/components/MusicPicker.tsx` | shared picker (default / library / upload / remove) | Create |
| Story Video / Render / Timeline pages | adopt `MusicPicker` | Modify |
| `server/public/**` | rebuilt bundle | Modify |

---

## Task 1: musicLibrary module + placeholder tracks

**Files:**
- Create: `server/assets/music/*` (10 mp3s + README), `server/src/lib/musicLibrary.js`
- Test: `server/src/lib/musicLibrary.test.js`

- [ ] **Step 1: Generate the 10 placeholder MP3s + README**

Run (from repo root) — creates 10 valid silent 30s mp3s:
```bash
mkdir -p server/assets/music
slugs="01-peaceful-worship 02-hopeful-strings 03-gentle-piano 04-uplifting-pads 05-reflective-acoustic 06-joyful-praise 07-cinematic-hope 08-soft-prayer 09-warm-devotion 10-triumphant-rise"
for s in $slugs; do ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 30 -q:a 9 -acodec libmp3lame "server/assets/music/$s.mp3" 2>/dev/null; done
ls server/assets/music
printf '%s\n' "# Default music library" "" "These 10 files are PLACEHOLDER silent tracks. Replace each with a real royalty-free/licensed gospel instrumental bed, KEEPING the same filename. No code change is needed — the manifest in src/lib/musicLibrary.js maps these filenames to ids/labels." > server/assets/music/README.md
```
Expected: 10 `.mp3` files listed.

- [ ] **Step 2: Write the failing test** `server/src/lib/musicLibrary.test.js`

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { MUSIC_LIBRARY, listTracks, resolveLibraryTrack, defaultTrackRef } from "./musicLibrary.js";

describe("musicLibrary", () => {
  test("has 10 tracks with exactly one default", () => {
    assert.equal(MUSIC_LIBRARY.length, 10);
    assert.equal(MUSIC_LIBRARY.filter((t) => t.default).length, 1);
    for (const t of MUSIC_LIBRARY) { assert.ok(t.id && t.label && t.file); }
  });
  test("listTracks exposes id/label/mood/previewUrl/default", () => {
    const list = listTracks();
    assert.equal(list.length, 10);
    assert.match(list[0].previewUrl, /^\/music\//);
    assert.equal(list.filter((t) => t.default).length, 1);
  });
  test("resolveLibraryTrack maps a library: ref to an existing absolute file", () => {
    const id = MUSIC_LIBRARY[0].id;
    const p = resolveLibraryTrack(`library:${id}`);
    assert.ok(p && fs.existsSync(p));
  });
  test("resolveLibraryTrack returns null for unknown id and non-library input", () => {
    assert.equal(resolveLibraryTrack("library:nope"), null);
    assert.equal(resolveLibraryTrack("/some/upload.mp3"), null);
    assert.equal(resolveLibraryTrack(null), null);
  });
  test("defaultTrackRef points at the default track", () => {
    const def = MUSIC_LIBRARY.find((t) => t.default);
    assert.equal(defaultTrackRef(), `library:${def.id}`);
  });
});
```

- [ ] **Step 3: Run, confirm FAIL**

Run: `node --test server/src/lib/musicLibrary.test.js` → module not found.

- [ ] **Step 4: Implement** `server/src/lib/musicLibrary.js`

```javascript
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.resolve(__dirname, "../../assets/music");

/** The 10 default gospel beds. Files live in server/assets/music/. */
export const MUSIC_LIBRARY = [
  { id: "peaceful-worship", label: "Peaceful Worship", mood: "calm", file: "01-peaceful-worship.mp3", default: true },
  { id: "hopeful-strings", label: "Hopeful Strings", mood: "uplifting", file: "02-hopeful-strings.mp3" },
  { id: "gentle-piano", label: "Gentle Piano", mood: "reflective", file: "03-gentle-piano.mp3" },
  { id: "uplifting-pads", label: "Uplifting Pads", mood: "uplifting", file: "04-uplifting-pads.mp3" },
  { id: "reflective-acoustic", label: "Reflective Acoustic", mood: "reflective", file: "05-reflective-acoustic.mp3" },
  { id: "joyful-praise", label: "Joyful Praise", mood: "joyful", file: "06-joyful-praise.mp3" },
  { id: "cinematic-hope", label: "Cinematic Hope", mood: "cinematic", file: "07-cinematic-hope.mp3" },
  { id: "soft-prayer", label: "Soft Prayer", mood: "calm", file: "08-soft-prayer.mp3" },
  { id: "warm-devotion", label: "Warm Devotion", mood: "calm", file: "09-warm-devotion.mp3" },
  { id: "triumphant-rise", label: "Triumphant Rise", mood: "triumphant", file: "10-triumphant-rise.mp3" },
];

/** Public list for the API/picker (no server paths leaked). */
export function listTracks() {
  return MUSIC_LIBRARY.map((t) => ({
    id: t.id, label: t.label, mood: t.mood,
    previewUrl: `/music/${t.file}`, default: Boolean(t.default),
  }));
}

/**
 * Resolve a `library:<id>` ref to an existing absolute file path.
 * Returns null for non-library input or an unknown/missing track, so callers
 * fall through to their own resolution.
 */
export function resolveLibraryTrack(ref) {
  const s = String(ref || "").trim();
  if (!s.startsWith("library:")) return null;
  const id = s.slice("library:".length);
  const track = MUSIC_LIBRARY.find((t) => t.id === id);
  if (!track) return null;
  const full = path.join(MUSIC_DIR, track.file);
  return fs.existsSync(full) ? full : null;
}

/** The designated default track as a library ref. */
export function defaultTrackRef() {
  const def = MUSIC_LIBRARY.find((t) => t.default) || MUSIC_LIBRARY[0];
  return `library:${def.id}`;
}
```

- [ ] **Step 5: Run, confirm PASS**

Run: `node --test server/src/lib/musicLibrary.test.js`

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/assets/music server/src/lib/musicLibrary.js server/src/lib/musicLibrary.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(music): default music library module + 10 placeholder beds"
```

---

## Task 2: wire the library into renderers + API + static + auto-select

**Files:**
- Create: `server/src/routes/music.js`
- Modify: `server/src/routes/render.js`, `jobs.js`, `audio_advanced.js`, `story.js`, `server/index.js`
- Test: `server/src/routes/music.test.js`, plus reuse existing route tests

- [ ] **Step 1: Write the failing test** `server/src/routes/music.test.js`

```javascript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import musicRouter from "./music.js";

function handlerFor(method, routePath) {
  const layer = musicRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function res() {
  return { payload: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
}

describe("music route", () => {
  test("GET /library returns the 10 tracks", () => {
    const r = res();
    handlerFor("get", "/library")({}, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.tracks.length, 10);
    assert.match(r.payload.tracks[0].previewUrl, /^\/music\//);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/routes/music.test.js` → module not found.

- [ ] **Step 3: Implement the route + wiring**

(a) Create `server/src/routes/music.js`:
```javascript
import { Router } from "express";
import { listTracks } from "../lib/musicLibrary.js";

const router = Router();
router.get("/library", (_req, res) => res.json({ ok: true, tracks: listTracks() }));
export default router;
```

(b) In `server/src/routes/render.js`, `jobs.js`, and `audio_advanced.js`: add `import { resolveLibraryTrack } from "../lib/musicLibrary.js";` at the top, and in EACH file's `resolveAssetPath`, immediately AFTER the `if (!normalized) return null;` line, insert:
```javascript
  const libTrack = resolveLibraryTrack(normalized);
  if (libTrack) return libTrack;
```
(So a `library:<id>` musicPath resolves to the bundled file before any other logic; everything else is unchanged.)

(c) In `server/src/routes/story.js`, the `POST /:id/render` handler passes `musicPath: project.music?.path || null` to `runStoryRender`. Add the import `import { resolveLibraryTrack } from "../lib/musicLibrary.js";` and change that line to resolve a library ref:
```javascript
      musicPath: resolveLibraryTrack(project.music?.path) || project.music?.path || null,
```

(d) In `server/src/routes/jobs.js`, add `defaultTrackRef` to the musicLibrary import added in (b): `import { resolveLibraryTrack, defaultTrackRef } from "../lib/musicLibrary.js";`. Find `runCampaignAutoPost` (the `campaign_auto_post` entry point — `jobs.js:609` calls `runCampaignAutoPost(job.payload || {}, job.id)`). At the VERY TOP of `runCampaignAutoPost`, BEFORE it reads/destructures or delegates the payload, enrich the payload object so the default bed flows through whichever render path it takes (its own inline ffmpeg AND/OR a delegated `renderVideoCore`):
```javascript
  // Series + Auto-Publish auto-apply the default gospel bed when none chosen.
  payload = {
    ...payload,
    musicPath: payload.musicPath || defaultTrackRef(),
    musicVolume: payload.musicVolume ?? 0.3,
    autoDuck: payload.autoDuck ?? true,
  };
```
(If `payload` is a `const` parameter, rename the param destructure or reassign via a new `const enriched = {...}` and use `enriched` thereafter — but the simplest is to make the param reassignable. Do NOT touch the shared `renderVideoCore`, so manual `render_video` jobs are unaffected.)

(e) In `server/index.js`:
- Add `import musicRouter from "./src/routes/music.js";` with the other route imports.
- Mount the static serve near the `/outputs` static block (BEFORE the auth-gated routes):
```javascript
import path from "path"; // (already imported — reuse)
app.use("/music", express.static(path.resolve(__dirname, "src/assets/music"), { acceptRanges: true }));
```
IMPORTANT: confirm the real path to `server/assets/music` from `index.js`. `index.js` is at `server/index.js`, so the dir is `path.resolve(__dirname, "assets/music")` (NOT `src/assets`). Verify `__dirname` is defined in index.js (ESM: `const __dirname = path.dirname(fileURLToPath(import.meta.url))`); if not present, compute the absolute path the same way the file already locates `server/public`/`outputs`.
- Mount the API route with the others:
```javascript
app.use("/api/music", requireAuth, withUserScope, musicRouter);
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/routes/music.test.js` → pass. Then `cd server && npm test` → all green (existing render/jobs/audio_advanced tests still pass — the hook only adds a `library:` fast-path).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/routes/music.js server/src/routes/music.test.js server/src/routes/render.js server/src/routes/jobs.js server/src/routes/audio_advanced.js server/src/routes/story.js server/index.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(music): /api/music/library + static serve + library resolution in all renderers + Series/Auto-Publish default"
```

---

## Task 3: client — useMusicLibrary + MusicPicker

**Files:**
- Create: `client/src/lib/musicLibraryApi.ts`, `client/src/hooks/useMusicLibrary.ts`, `client/src/components/MusicPicker.tsx`
- Test: `client/src/components/__tests__/MusicPicker.test.tsx`

- [ ] **Step 1: Write the failing test** `client/src/components/__tests__/MusicPicker.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as api from '../../lib/musicLibraryApi';
import { MusicPicker } from '../MusicPicker';

const TRACKS = [
  { id: 'peaceful-worship', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/01.mp3', default: true },
  { id: 'joyful-praise', label: 'Joyful Praise', mood: 'joyful', previewUrl: '/music/06.mp3', default: false },
];

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchMusicLibrary').mockResolvedValue(TRACKS as any);
});

describe('MusicPicker', () => {
  it('"Use default audio" sets the default library ref', async () => {
    const onChange = vi.fn();
    renderWith(<MusicPicker value={{ path: null, volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /use default audio/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'library:peaceful-worship' }));
  });

  it('selecting a library track sets its ref', async () => {
    const onChange = vi.fn();
    renderWith(<MusicPicker value={{ path: null, volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    const select = await screen.findByLabelText(/music library/i);
    await userEvent.selectOptions(select, 'joyful-praise');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'library:joyful-praise' }));
  });

  it('remove clears the music', async () => {
    const onChange = vi.fn();
    renderWith(<MusicPicker value={{ path: 'library:joyful-praise', volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    await userEvent.click(await screen.findByRole('button', { name: /remove music/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: null }));
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/components/__tests__/MusicPicker.test.tsx`

- [ ] **Step 3: Implement**

(a) `client/src/lib/musicLibraryApi.ts`:
```typescript
import { api } from './api';

export interface MusicTrack { id: string; label: string; mood: string; previewUrl: string; default: boolean }

export async function fetchMusicLibrary(): Promise<MusicTrack[]> {
  const res = await api.get('/api/music/library');
  if (!res.ok) throw new Error(res.error || 'Failed to load music library');
  return (res.data?.tracks ?? []) as MusicTrack[];
}
```

(b) `client/src/hooks/useMusicLibrary.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import { fetchMusicLibrary } from '../lib/musicLibraryApi';

export function useMusicLibrary() {
  return useQuery({ queryKey: ['music-library'], queryFn: fetchMusicLibrary, staleTime: Infinity });
}
```

(c) `client/src/components/MusicPicker.tsx`:
```tsx
import { useRef } from 'react';
import { Music, X, Loader2, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useMusicLibrary } from '../hooks/useMusicLibrary';

export interface MusicValue { path: string | null; volume: number; autoDuck?: boolean }

interface MusicPickerProps {
  value: MusicValue;
  onChange: (next: MusicValue) => void;
  busy: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function MusicPicker({ value, onChange, busy }: MusicPickerProps) {
  const { data: tracks } = useMusicLibrary();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoDuck = value.autoDuck ?? true;
  const defaultTrack = (tracks || []).find((t) => t.default);
  const isLibrary = (value.path || '').startsWith('library:');
  const currentId = isLibrary ? value.path!.slice('library:'.length) : '';

  const upload = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const path = await storyApi.uploadAudio(dataUrl, file.name);
      onChange({ path, volume: value.volume ?? 0.3, autoDuck });
      toast.success('Music added');
    } catch (e) { toast.error((e as Error).message || 'Music upload failed'); }
  };

  const preview = (id: string) => {
    const t = (tracks || []).find((x) => x.id === id);
    if (!t) return;
    if (audioRef.current) audioRef.current.pause();
    const el = new Audio(`${api.baseUrl}${t.previewUrl}`);
    audioRef.current = el;
    el.play().catch(() => {});
  };

  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-gray-300">
      <div className="flex items-center gap-2"><Music size={14} /> <span className="font-medium">Background music</span></div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isLibrary && currentId === defaultTrack?.id}
          aria-label="use default audio"
          onChange={(e) => onChange(e.target.checked && defaultTrack
            ? { path: `library:${defaultTrack.id}`, volume: value.volume ?? 0.3, autoDuck }
            : { path: null, volume: value.volume ?? 0.3, autoDuck })}
        />
        Use default audio{defaultTrack ? ` (${defaultTrack.label})` : ''}
      </label>

      <label className="flex items-center gap-2">
        <span>Music library</span>
        <select
          aria-label="music library"
          value={currentId}
          onChange={(e) => {
            const id = e.target.value;
            onChange(id ? { path: `library:${id}`, volume: value.volume ?? 0.3, autoDuck } : { path: null, volume: value.volume ?? 0.3, autoDuck });
          }}
          className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
        >
          <option value="">— none —</option>
          {(tracks || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {currentId && (
          <button type="button" onClick={() => preview(currentId)} className="inline-flex items-center gap-1 text-gray-400 hover:text-primary-300"><Play size={12} /> preview</button>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="rounded-md border border-white/15 px-2 py-1 hover:border-primary-400 disabled:opacity-50">Upload your own</button>
        <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        {value.path && (
          <>
            <label className="inline-flex items-center gap-1">Vol
              <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => onChange({ ...value, autoDuck, volume: Number(e.target.value) })} className="accent-primary-500" />
            </label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoDuck} aria-label="autoduck" onChange={(e) => onChange({ ...value, autoDuck: e.target.checked })} /> Autoduck</label>
            <button type="button" onClick={() => onChange({ path: null, volume: value.volume, autoDuck })} className="inline-flex items-center gap-1 text-gray-400 hover:text-red-300"><X size={12} /> Remove music</button>
          </>
        )}
        {busy && <Loader2 size={12} className="animate-spin" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm PASS + type-check**

Run: `cd client && npx vitest run src/components/__tests__/MusicPicker.test.tsx`
Then `cd client && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -iE "MusicPicker|musicLibrary" | head` → no errors.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/musicLibraryApi.ts client/src/hooks/useMusicLibrary.ts client/src/components/MusicPicker.tsx client/src/components/__tests__/MusicPicker.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(music-ui): useMusicLibrary + shared MusicPicker"
```

---

## Task 4: adopt MusicPicker in Story Video, Render, Timeline

**Files:**
- Modify: `client/src/pages/StoryVideoPage.tsx`, `client/src/pages/RenderPage.tsx`, `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Story Video — swap MusicControl for MusicPicker**

In `client/src/pages/StoryVideoPage.tsx`, replace the `import { MusicControl } from '../components/story/MusicControl';` with `import { MusicPicker } from '../components/MusicPicker';`, and the `<MusicControl music={...} onChange={onMusicChange} busy={busy} />` usage with:
```tsx
          <MusicPicker
            value={project.music ?? { path: null, volume: 0.3, autoDuck: true }}
            onChange={(m) => onMusicChange(m)}
            busy={busy}
          />
```
`onMusicChange` already PATCHes `/api/story/:id/music` with `{ path, volume, autoDuck }`; a `library:<id>` path flows through unchanged (the story render route now resolves it). Leave `MusicControl.tsx` in place (unused) or delete it — delete it and its test to avoid dead code:
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" rm client/src/components/story/MusicControl.tsx client/src/components/story/__tests__/MusicControl.test.tsx
```
Run `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx` — if a test referenced MusicControl directly, update it to MusicPicker (the page test only checks the page renders; the MusicControl unit test is removed). Ensure `npx tsc -b` is clean.

- [ ] **Step 2: Render + Timeline — add the picker to their music sections**

READ `client/src/pages/RenderPage.tsx` and `client/src/pages/TimelinePage.tsx` and locate where music is currently handled (search for `musicPath`, `musicVolume`, `autoDuck`, or the existing "music"/upload UI). Each page holds music state that is sent to the render request as `musicPath`/`musicVolume`/`autoDuck`. Mount `<MusicPicker value={{ path: musicPath, volume: musicVolume, autoDuck }} onChange={(m) => { setMusicPath(m.path); setMusicVolume(m.volume); setAutoDuck(m.autoDuck ?? true); }} busy={isRendering} />` in place of (or alongside) the current music upload control, wiring it to that page's existing music state setters and render payload. Keep the existing upload behaviour available (the picker includes "Upload your own"). Import: `import { MusicPicker } from '../components/MusicPicker';`.

A `library:<id>` value flows to the render request as `musicPath` and the server resolves it (Task 2). No render-call changes needed beyond passing the chosen `musicPath`.

- [ ] **Step 3: Type-check + tests**

Run: `cd client && npx tsc -b 2>&1 | tail -20` → no errors. Run `cd client && npm test` → green. Fix any page test that referenced the old music control.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/pages/StoryVideoPage.tsx client/src/pages/RenderPage.tsx client/src/pages/TimelinePage.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(music-ui): adopt MusicPicker in Story Video, Render, Timeline"
```

---

## Task 5: full sweep + rebuild bundle

- [ ] **Step 1:** `cd server && npm test` → green; `cd client && npm test` → green.
- [ ] **Step 2:** `cd client && npm run build`, then:
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(music): rebuild bundle with default music library"
```

---

## Notes for the Implementer

- **One hook, all surfaces:** every renderer's `resolveAssetPath` now short-circuits a `library:<id>` ref to the bundled file, so Render/Timeline/Story/Series/Auto-Publish all play library beds with no audio-pipeline change.
- **Series/Auto-Publish default lives only in `runCampaignAutoPost`** — NOT in the shared `renderVideoCore` — so manual render_video jobs are unaffected.
- **Static `/music` must be public** (no auth) so `<audio>`/preview works; it serves read-only bundled beds, not user data.
- **`server/assets/music` is committed** (placeholders) and is OUTSIDE `server/public`, so `vite build` won't wipe it.
- **Live verify:** select a library track on Story Video with autoduck on → render → the bed plays under the voice; trigger an Auto-Publish/Series render with no music chosen → the default bed is applied.
