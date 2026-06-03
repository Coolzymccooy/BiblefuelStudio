# Media Trimmer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WhatsApp-style trim/cut tool to every uploaded media item (voice/sermon audio, music/soundtrack, source video, background clips) on the Render and Timeline pages — drag start/end handles, confirm, and the server cuts the file down to the chosen window.

**Architecture:** A single shared `<MediaTrimmer>` modal (audio → waveform backdrop, video → live `<video>` preview, both with two drag handles) calls a new `POST /api/media/trim` endpoint that ffmpeg-re-encodes the selected `[startSec, endSec]` range into a new file. On success the calling page swaps its stored path to the trimmed file. Pure handle math lives in a separate testable module; server range/path validation is extracted into a testable helper so neither test depends on ffmpeg.

**Tech Stack:** React + TypeScript + Vite (client), Express + Node (server), ffmpeg/ffprobe, `node:test` + `supertest` (server tests), Vitest (client tests).

**Spec:** `docs/superpowers/specs/2026-06-03-media-trimmer-design.md`

---

## File Structure

- **Create** `server/src/lib/trimValidate.js` — pure `validateTrimRequest()` (range + path-safety), no ffmpeg.
- **Modify** `server/src/routes/media.js` — add `POST /trim` handler using the helper + ffmpeg.
- **Create** `server/test/lib/trimValidate.test.js` — unit tests for the helper.
- **Create** `server/test/routes/media.trim.test.js` — route test (validation 400s, no ffmpeg needed).
- **Create** `client/src/lib/trimMath.ts` — pure time/pixel/clamp helpers.
- **Create** `client/src/lib/__tests__/trimMath.test.ts` — Vitest unit tests.
- **Create** `client/src/components/MediaTrimmer.tsx` — the shared trimmer modal.
- **Modify** `client/src/pages/RenderPage.tsx` — ✂ on Voice track, Soundtrack, background tiles.
- **Modify** `client/src/pages/TimelinePage.tsx` — ✂ on Source Media + Music Bed.
- **Modify** `client/src/pages/RenderPage.tsx` + `client/src/pages/TimelinePage.tsx` + `client/src/components/MediaTrimmer.tsx` — professional-grade microcopy pass (Task 7).

---

## Task 1: Server trim-request validation helper (pure, no ffmpeg)

**Files:**
- Create: `server/src/lib/trimValidate.js`
- Test: `server/test/lib/trimValidate.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/lib/trimValidate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTrimRequest } from '../../src/lib/trimValidate.js';

function mkOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trim-val-'));
}

test('accepts a file inside the user output dir with a valid range', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: 1, endSec: 5, outputDir });
  assert.equal(r.ok, true);
  assert.equal(r.resolvedPath, fs.realpathSync(file));
});

test('rejects a path outside the user output dir (traversal)', () => {
  const outputDir = mkOutDir();
  const outside = path.join(os.tmpdir(), 'evil.mp3');
  fs.writeFileSync(outside, 'x');
  const r = validateTrimRequest({ inputPath: outside, startSec: 0, endSec: 3, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /outside|not allowed|invalid path/i);
});

test('rejects a missing file', () => {
  const outputDir = mkOutDir();
  const r = validateTrimRequest({ inputPath: path.join(outputDir, 'nope.mp3'), startSec: 0, endSec: 3, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/i);
});

test('rejects endSec <= startSec', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: 5, endSec: 5, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /range/i);
});

test('rejects a selection shorter than 0.1s', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: 1, endSec: 1.05, outputDir });
  assert.equal(r.ok, false);
  assert.match(r.error, /short|0\.1/i);
});

test('rejects negative startSec', () => {
  const outputDir = mkOutDir();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const r = validateTrimRequest({ inputPath: file, startSec: -1, endSec: 3, outputDir });
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test "test/lib/trimValidate.test.js"`
Expected: FAIL — `Cannot find module '../../src/lib/trimValidate.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/lib/trimValidate.js`:

```js
import fs from "fs";
import path from "path";

/**
 * Validate a trim request WITHOUT touching ffmpeg.
 *
 * Security boundary: the resolved input must live inside the caller's own
 * output dir. We realpath both sides so symlink tricks can't escape the jail.
 *
 * @returns {{ ok: true, resolvedPath: string, startSec: number, endSec: number }
 *          | { ok: false, error: string }}
 */
export function validateTrimRequest({ inputPath, startSec, endSec, outputDir }) {
  const raw = String(inputPath || "").trim();
  if (!raw) return { ok: false, error: "inputPath is required" };

  const start = Number(startSec);
  const end = Number(endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: "startSec and endSec must be numbers" };
  }
  if (start < 0) return { ok: false, error: "startSec must be >= 0" };
  if (end <= start) return { ok: false, error: "invalid range: endSec must be greater than startSec" };
  if (end - start < 0.1) return { ok: false, error: "selection too short (minimum 0.1s)" };

  if (!fs.existsSync(raw)) return { ok: false, error: "input file not found" };

  let resolvedPath;
  let jail;
  try {
    resolvedPath = fs.realpathSync(raw);
    jail = fs.realpathSync(outputDir);
  } catch {
    return { ok: false, error: "input file not found" };
  }

  const rel = path.relative(jail, resolvedPath);
  const inside = rel === "" ? false : !rel.startsWith("..") && !path.isAbsolute(rel);
  if (!inside) return { ok: false, error: "invalid path: outside your media folder" };

  return { ok: true, resolvedPath, startSec: start, endSec: end };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test "test/lib/trimValidate.test.js"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/trimValidate.js server/test/lib/trimValidate.test.js
git commit -m "feat(server): add pure trim-request validation helper"
```

---

## Task 2: Server `POST /api/media/trim` endpoint

**Files:**
- Modify: `server/src/routes/media.js` (add import at top + new route)
- Test: `server/test/routes/media.trim.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/routes/media.trim.test.js` (validation-only — does not require ffmpeg):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import mediaRouter from '../../src/routes/media.js';

function mkApp() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-trim-'));
  const app = express();
  app.use(express.json());
  // Stub the user scope the real app injects via withUserScope.
  app.use((req, _res, next) => { req.ctx = { outputDir, dataDir: outputDir }; next(); });
  app.use('/api/media', mediaRouter);
  return { app, outputDir };
}

async function post(app, body) {
  const { default: supertest } = await import('supertest');
  return supertest(app).post('/api/media/trim').send(body);
}

test('rejects a path outside the user output dir with 400', async () => {
  const { app } = mkApp();
  const outside = path.join(os.tmpdir(), `evil-${Date.now()}.mp3`);
  fs.writeFileSync(outside, 'x');
  const res = await post(app, { inputPath: outside, startSec: 0, endSec: 3 });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('rejects an inverted range with 400', async () => {
  const { app, outputDir } = mkApp();
  const file = path.join(outputDir, 'clip.mp3');
  fs.writeFileSync(file, 'x');
  const res = await post(app, { inputPath: file, startSec: 5, endSec: 2 });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test('rejects a missing file with 400', async () => {
  const { app, outputDir } = mkApp();
  const res = await post(app, { inputPath: path.join(outputDir, 'ghost.mp3'), startSec: 0, endSec: 3 });
  assert.equal(res.status, 400);
});
```

> Note: this test confirms `media.js` is imported as a default-exported router. It already is (`const router = Router(); ... export default router` — verify the bottom of the file; if it uses a named export, adjust the import in the test to match).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test "test/routes/media.trim.test.js"`
Expected: FAIL — all three return 404 (route not mounted yet) instead of 400.

- [ ] **Step 3: Add the import at the top of `server/src/routes/media.js`**

Just below the existing imports (after line 5, `import { spawn, spawnSync } from "child_process";`):

```js
import { validateTrimRequest } from "../lib/trimValidate.js";
```

- [ ] **Step 4: Add the route**

Insert this handler in `server/src/routes/media.js` immediately after the `/upload-background` handler (before the final `export default router;`):

```js
// Trim an uploaded clip to [startSec, endSec], producing a NEW file. The cut
// is an accurate re-encode (not a stream copy) so it lands exactly on the
// handles the user dragged. The original is left in place so re-trim is cheap.
// Security: validateTrimRequest jails inputPath to the caller's own outputDir.
router.post("/trim", async (req, res) => {
  try {
    const v = validateTrimRequest({
      inputPath: req.body?.inputPath,
      startSec: req.body?.startSec,
      endSec: req.body?.endSec,
      outputDir: req.ctx.outputDir,
    });
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    const { resolvedPath, startSec, endSec } = v;
    const outDir = req.ctx.outputDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ext = path.extname(resolvedPath).toLowerCase();
    const isVideo = videoExtensions.has(ext);
    const outExt = isVideo ? "mp4" : "mp3";
    const outFile = path.join(outDir, `trimmed-${uuid()}.${outExt}`);
    const duration = endSec - startSec;

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    // -ss/-t AFTER -i = decode-accurate seek (frame-exact for video, sample
    // -exact for audio). re-encode so the output starts cleanly at the cut.
    const args = isVideo
      ? ["-y", "-i", resolvedPath, "-ss", String(startSec), "-t", String(duration),
         "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", outFile]
      : ["-y", "-i", resolvedPath, "-ss", String(startSec), "-t", String(duration),
         "-vn", "-c:a", "libmp3lame", "-ar", "44100", "-ac", "2", outFile];

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      if (res.headersSent) return;
      res.status(400).json({ ok: false, error: `ffmpeg launch failed: ${err?.message || err}` });
    });
    proc.on("close", (code) => {
      if (res.headersSent) return;
      if (code !== 0 || !fs.existsSync(outFile)) {
        return res.status(400).json({ ok: false, error: "trim failed", details: stderr.slice(-800) });
      }
      const durationSec = probeDurationSec(outFile);
      return res.json({
        ok: true,
        file: outFile.replace(/\\/g, "/"),
        durationSec: Number.isFinite(durationSec) ? durationSec : duration,
      });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
```

> `videoExtensions`, `uuid`, `probeDurationSec`, `fs`, `path`, `spawn` are all already defined/imported at the top of `media.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && node --test "test/routes/media.trim.test.js"`
Expected: PASS (3 tests).

- [ ] **Step 6: Manual ffmpeg smoke (happy path, requires ffmpeg on PATH)**

Run (from `server/`):

```bash
node -e "const{spawnSync}=require('child_process');spawnSync('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=440:duration=6','-ar','44100','outputs/_trimsrc.mp3'],{stdio:'inherit'})"
```

Then with the server running and a valid token, POST `{ inputPath: '<abs>/outputs/_trimsrc.mp3', startSec: 1, endSec: 4 }` to `/api/media/trim` and confirm the returned file is ~3s (`ffprobe outputs/trimmed-*.mp3`).
Expected: a new `trimmed-*.mp3` of ~3.0s. Delete the scratch files after.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/media.js server/test/routes/media.trim.test.js
git commit -m "feat(server): POST /api/media/trim — ffmpeg cut to [start,end] -> new file"
```

---

## Task 3: Client pure handle-math module

**Files:**
- Create: `client/src/lib/trimMath.ts`
- Test: `client/src/lib/__tests__/trimMath.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/__tests__/trimMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clampTime, snap, pxToTime, timeToPct, enforceHandles } from '../trimMath';

describe('trimMath', () => {
  it('clampTime keeps t within [0, duration]', () => {
    expect(clampTime(-2, 10)).toBe(0);
    expect(clampTime(12, 10)).toBe(10);
    expect(clampTime(4, 10)).toBe(4);
  });

  it('snap rounds to 0.1s', () => {
    expect(snap(1.234)).toBe(1.2);
    expect(snap(1.27)).toBe(1.3);
  });

  it('pxToTime maps pixel offset to time across a width', () => {
    expect(pxToTime(0, 200, 10)).toBe(0);
    expect(pxToTime(200, 200, 10)).toBe(10);
    expect(pxToTime(100, 200, 10)).toBe(5);
    // out-of-range pixels clamp
    expect(pxToTime(-50, 200, 10)).toBe(0);
    expect(pxToTime(999, 200, 10)).toBe(10);
  });

  it('timeToPct returns 0..100', () => {
    expect(timeToPct(0, 10)).toBe(0);
    expect(timeToPct(5, 10)).toBe(50);
    expect(timeToPct(10, 10)).toBe(100);
    expect(timeToPct(5, 0)).toBe(0); // guard divide-by-zero
  });

  it('enforceHandles keeps start < end with a minimum gap when moving start', () => {
    const r = enforceHandles('start', 9.9, { start: 2, end: 10 }, 10, 0.5);
    expect(r.end).toBe(10);
    expect(r.start).toBeLessThanOrEqual(9.5); // pushed back to keep >=0.5 gap
  });

  it('enforceHandles keeps end > start with a minimum gap when moving end', () => {
    const r = enforceHandles('end', 2.1, { start: 2, end: 10 }, 10, 0.5);
    expect(r.start).toBe(2);
    expect(r.end).toBeGreaterThanOrEqual(2.5);
  });

  it('enforceHandles clamps to [0, duration]', () => {
    const r = enforceHandles('end', 99, { start: 2, end: 10 }, 10, 0.5);
    expect(r.end).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/__tests__/trimMath.test.ts`
Expected: FAIL — cannot resolve `../trimMath`.

- [ ] **Step 3: Write minimal implementation**

Create `client/src/lib/trimMath.ts`:

```ts
/** Clamp a time value to [0, duration]. */
export function clampTime(t: number, duration: number): number {
  if (t < 0) return 0;
  if (t > duration) return duration;
  return t;
}

/** Snap to the nearest 0.1s for stable, readable handle positions. */
export function snap(t: number): number {
  return Math.round(t * 10) / 10;
}

/** Map a pixel offset within a track of `widthPx` to a time in [0, duration]. */
export function pxToTime(px: number, widthPx: number, duration: number): number {
  if (widthPx <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, px / widthPx));
  return snap(ratio * duration);
}

/** Map a time to a 0..100 percentage of the track width. */
export function timeToPct(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (t / duration) * 100));
}

export interface Selection { start: number; end: number; }

/**
 * Apply a proposed new value to one handle, keeping the invariant
 * start + minGap <= end and both within [0, duration].
 */
export function enforceHandles(
  which: 'start' | 'end',
  proposed: number,
  current: Selection,
  duration: number,
  minGap: number,
): Selection {
  const p = clampTime(snap(proposed), duration);
  if (which === 'start') {
    const start = Math.min(p, clampTime(current.end - minGap, duration));
    return { start: Math.max(0, start), end: current.end };
  }
  const end = Math.max(p, clampTime(current.start + minGap, duration));
  return { start: current.start, end: Math.min(duration, end) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/__tests__/trimMath.test.ts`
Expected: PASS (7 assertions across the suite).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/trimMath.ts client/src/lib/__tests__/trimMath.test.ts
git commit -m "feat(client): pure trim handle-math helpers + tests"
```

---

## Task 4: `MediaTrimmer` shared component

**Files:**
- Create: `client/src/components/MediaTrimmer.tsx`

This is a presentational modal with no router/page dependencies, so it has no unit test of its own beyond the `trimMath` coverage from Task 3 (the math is where the bugs hide; the DOM wiring is verified manually in Task 7).

- [ ] **Step 1: Create the component**

Create `client/src/components/MediaTrimmer.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Scissors, Play, Pause, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import { clampTime, pxToTime, timeToPct, enforceHandles, type Selection } from '../lib/trimMath';
import toast from 'react-hot-toast';

const MIN_GAP = 0.5; // seconds — smallest allowed selection

interface MediaTrimmerProps {
  /** Absolute server path of the uploaded file (e.g. .../outputs/user-audio-x.mp3). */
  serverPath: string;
  kind: 'audio' | 'video';
  onApply: (newServerPath: string, newDurationSec: number) => void;
  onCancel: () => void;
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MediaTrimmer({ serverPath, kind, onApply, onCancel }: MediaTrimmerProps) {
  const basename = serverPath.split(/[\\/]/).pop() || '';
  const previewUrl = api.mediaUrl(basename);
  const token = api.getToken();
  const waveformUrl = `${api.baseUrl}/api/audio-adv/waveform.png?inputPath=${encodeURIComponent(serverPath)}&w=1200&h=240${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  const [duration, setDuration] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  const [applying, setApplying] = useState(false);
  const [playing, setPlaying] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement | null>(null);
  const draggingRef = useRef<null | 'start' | 'end'>(null);

  // Load duration. Prefer ffprobe (authoritative); fall back to the media
  // element's metadata if the info endpoint is unavailable.
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/audio-adv/info?inputPath=${encodeURIComponent(serverPath)}`).then((res) => {
      if (cancelled) return;
      const d = Number(res.data?.durationSec);
      if (res.ok && Number.isFinite(d) && d > 0) {
        setDuration(d);
        setSel({ start: 0, end: d });
      }
    });
    return () => { cancelled = true; };
  }, [serverPath]);

  const onLoadedMetadata = () => {
    const d = mediaRef.current?.duration;
    if (duration == null && Number.isFinite(d) && (d as number) > 0) {
      setDuration(d as number);
      setSel({ start: 0, end: d as number });
    }
  };

  // Pointer drag on a handle.
  const startDrag = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = which;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = useCallback((e: PointerEvent) => {
    const which = draggingRef.current;
    const track = trackRef.current;
    if (!which || !track || duration == null) return;
    const rect = track.getBoundingClientRect();
    const t = pxToTime(e.clientX - rect.left, rect.width, duration);
    setSel((cur) => {
      const next = enforceHandles(which, t, cur, duration, MIN_GAP);
      // Live-scrub the preview to the handle being dragged.
      if (mediaRef.current) mediaRef.current.currentTime = which === 'start' ? next.start : next.end;
      return next;
    });
  }, [duration]);

  const endDrag = useCallback(() => { draggingRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
    };
  }, [onPointerMove, endDrag]);

  // Play just the selected window, then pause at `end`.
  const playSelection = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    el.currentTime = sel.start;
    void el.play();
    setPlaying(true);
  };
  const onTimeUpdate = () => {
    const el = mediaRef.current;
    if (el && playing && el.currentTime >= sel.end) { el.pause(); setPlaying(false); }
  };

  const applyTrim = async () => {
    if (duration == null) return;
    setApplying(true);
    const res = await api.post('/api/media/trim', {
      inputPath: serverPath,
      startSec: sel.start,
      endSec: sel.end,
    });
    setApplying(false);
    if (res.ok && res.data?.file) {
      toast.success(`Trimmed to ${fmt(Number(res.data.durationSec) || (sel.end - sel.start))}`, { id: 'trim-ok' });
      onApply(res.data.file as string, Number(res.data.durationSec) || (sel.end - sel.start));
    } else {
      toast.error(res.error || 'Trim failed — original kept', { id: 'trim-err' });
    }
  };

  const selDur = Math.max(0, sel.end - sel.start);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-2xl max-h-[88dvh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={18} className="text-primary-300" />
            <h3 className="font-bold text-lg text-white">Trim clip</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-white p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {/* Preview */}
          {kind === 'video' ? (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={previewUrl}
              playsInline
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              className="w-full max-h-[40vh] rounded-lg bg-black"
            />
          ) : (
            <>
              <img
                src={waveformUrl}
                alt="Audio waveform"
                className="w-full h-28 object-cover rounded-lg bg-black/40"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={previewUrl}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                className="hidden"
              />
            </>
          )}

          {/* Timeline track with two handles + selection region */}
          <div
            ref={trackRef}
            className="relative h-12 rounded-lg bg-white/5 border border-white/10 select-none touch-none"
          >
            {duration != null && (
              <>
                <div
                  className="absolute inset-y-0 bg-primary-500/25 border-x-2 border-primary-400"
                  style={{ left: `${timeToPct(sel.start, duration)}%`, right: `${100 - timeToPct(sel.end, duration)}%` }}
                />
                <div
                  role="slider"
                  aria-label="Trim start"
                  aria-valuenow={sel.start}
                  onPointerDown={startDrag('start')}
                  className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex items-center justify-center"
                  style={{ left: `${timeToPct(sel.start, duration)}%` }}
                >
                  <span className="h-8 w-1.5 rounded-full bg-primary-300 shadow" />
                </div>
                <div
                  role="slider"
                  aria-label="Trim end"
                  aria-valuenow={sel.end}
                  onPointerDown={startDrag('end')}
                  className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex items-center justify-center"
                  style={{ left: `${timeToPct(sel.end, duration)}%` }}
                >
                  <span className="h-8 w-1.5 rounded-full bg-primary-300 shadow" />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-gray-300 tabular-nums">
            <span>In <span className="text-white font-semibold">{fmt(sel.start)}</span></span>
            <span>Selected <span className="text-primary-300 font-semibold">{fmt(selDur)}</span></span>
            <span>Out <span className="text-white font-semibold">{fmt(sel.end)}</span></span>
          </div>

          <Button variant="secondary" onClick={playSelection} className="h-9 text-xs" disabled={duration == null}>
            {playing ? <Pause size={14} className="mr-1.5" /> : <Play size={14} className="mr-1.5" />}
            {playing ? 'Stop' : 'Play selection'}
          </Button>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/30 shrink-0">
          <Button variant="secondary" onClick={onCancel} className="h-9 text-xs" disabled={applying}>Cancel</Button>
          <Button onClick={applyTrim} className="h-9 text-xs" disabled={applying || duration == null}>
            {applying ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Scissors size={14} className="mr-1.5" />}
            {applying ? 'Trimming…' : 'Apply trim'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0, no errors (confirms props and refs line up).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/MediaTrimmer.tsx
git commit -m "feat(client): MediaTrimmer modal (waveform/video preview + drag handles)"
```

---

## Task 5: Wire `MediaTrimmer` into RenderPage

**Files:**
- Modify: `client/src/pages/RenderPage.tsx`

- [ ] **Step 1: Add import + trimmer state**

At the top of `RenderPage.tsx`, add to the existing lucide-react import a `Scissors` icon, and add the component import:

```tsx
import { MediaTrimmer } from '../components/MediaTrimmer';
```

Inside the component, near the other `useState` calls (after line ~105), add:

```tsx
const [trimTarget, setTrimTarget] = useState<
  | { kind: 'audio' | 'video'; path: string; apply: (p: string) => void }
  | null
>(null);
```

- [ ] **Step 2: Add a ✂ button to the Voice track field**

In the Voice track `<Field>` (after the `<Input value={audioPath} .../>`, before the `audioHistory` block at line ~1037), add:

```tsx
{audioPath.trim() && (
  <button
    type="button"
    onClick={() => setTrimTarget({ kind: 'audio', path: audioPath.trim(), apply: setAudioPath })}
    className="mt-2 inline-flex items-center gap-1.5 text-[0.6875rem] px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
  >
    <Scissors size={12} /> Trim
  </button>
)}
```

- [ ] **Step 3: Add a ✂ button to the Soundtrack field**

In the Soundtrack `<Field>`, replace the existing `{musicPath && ( <p ...>{basename}</p> )}` block (line ~1085) with:

```tsx
{musicPath && (
  <div className="mt-2 flex items-center justify-between gap-2">
    <p className="text-[10px] text-gray-400 font-mono break-all">
      {musicPath.split(/[\\/]/).pop()}
    </p>
    <button
      type="button"
      onClick={() => setTrimTarget({ kind: 'audio', path: musicPath, apply: setMusicPath })}
      className="shrink-0 inline-flex items-center gap-1.5 text-[0.6875rem] px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
    >
      <Scissors size={12} /> Trim
    </button>
  </div>
)}
```

- [ ] **Step 4: Add a ✂ control to device-uploaded background tiles**

Background items carry `kind` (`'video'`/`'image'`) and `path`/`id`. Only video uploads are trimmable. In the selected-background list where each `backgroundItems` entry is rendered with its reorder/remove controls, add a Trim button for video items. Locate the per-item controls in the "selected backgrounds" strip (search for `setBackgroundItems(backgroundItems.filter` / the reorder arrows) and add alongside them:

```tsx
{item.kind === 'video' && typeof item.path === 'string' && item.path && (
  <button
    type="button"
    onClick={() => setTrimTarget({
      kind: 'video',
      path: item.path as string,
      apply: (p) => setBackgroundItems(backgroundItems.map((b) => b.id === item.id ? { ...b, path: p, url: p, previewUrl: p } : b)),
    })}
    className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-black/50 text-primary-200 hover:bg-black/70"
    title="Trim this clip"
    aria-label="Trim this clip"
  >
    <Scissors size={13} />
  </button>
)}
```

> If a background item's `id` and `path` are the same value for uploads, the map-by-`id` swap still works. Background trim only applies to device uploads (which have a local `path`); Pexels/library items have remote URLs and won't pass the `item.path` local-string guard once `getImageSrc`/`toMediaUrl` is considered — keep the guard as written (server-side validation will reject non-local paths anyway).

- [ ] **Step 5: Render the trimmer modal**

Near the other modals at the bottom of the returned JSX (e.g. just before the closing of the top-level fragment / after `showLibraryModal`), add:

```tsx
{trimTarget && (
  <MediaTrimmer
    serverPath={trimTarget.path}
    kind={trimTarget.kind}
    onCancel={() => setTrimTarget(null)}
    onApply={(newPath) => { trimTarget.apply(newPath); setTrimTarget(null); }}
  />
)}
```

- [ ] **Step 6: Type-check**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/RenderPage.tsx
git commit -m "feat(render): trim handles on voice, soundtrack, and background uploads"
```

---

## Task 6: Wire `MediaTrimmer` into TimelinePage

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

- [ ] **Step 1: Add import + trimmer state**

Add `Scissors` to the lucide-react import and:

```tsx
import { MediaTrimmer } from '../components/MediaTrimmer';
```

Near the other `useState` calls, add:

```tsx
const [trimTarget, setTrimTarget] = useState<
  | { kind: 'audio' | 'video'; path: string; apply: (p: string) => void }
  | null
>(null);
```

- [ ] **Step 2: Add a ✂ button to Source Media**

Replace the `{sourceMediaPath && ( ... )}` block (line ~769) with:

```tsx
{sourceMediaPath && (
  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-300">
    <span>
      <span className="text-gray-500">Loaded ({sourceMediaKind}):</span>{' '}
      <span className="font-mono break-all">{sourceMediaPath.split(/[\\/]/).pop()}</span>
    </span>
    <button
      type="button"
      onClick={() => setTrimTarget({
        kind: sourceMediaKind === 'video' ? 'video' : 'audio',
        path: sourceMediaPath,
        apply: (p) => {
          setSourceMediaPath(p);
          // Keep the legacy Main Assembly clip pointed at the trimmed audio.
          if (sourceMediaKind !== 'video') {
            const clip: TimelineClip = {
              id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              path: p,
              label: p.split(/[\\/]/).pop() || 'clip',
              startSec: null,
              durationSec: null,
            };
            setClips([clip]);
            saveClipsToCache([clip]);
          }
        },
      })}
      className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
    >
      <Scissors size={12} /> Trim
    </button>
  </div>
)}
```

- [ ] **Step 3: Add a ✂ button to Music Bed**

Replace the `{musicPath && ( <p ...> )}` block (line ~842) with:

```tsx
{musicPath && (
  <div className="flex items-center justify-between gap-2">
    <p className="text-xs text-gray-300 font-mono break-all">
      {musicPath.split(/[\\/]/).pop()}
    </p>
    <button
      type="button"
      onClick={() => setTrimTarget({ kind: 'audio', path: musicPath, apply: setMusicPath })}
      className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
    >
      <Scissors size={12} /> Trim
    </button>
  </div>
)}
```

- [ ] **Step 4: Render the trimmer modal**

Near the other modals at the bottom of the returned JSX (after the `shareUrl` modal block), add:

```tsx
{trimTarget && (
  <MediaTrimmer
    serverPath={trimTarget.path}
    kind={trimTarget.kind}
    onCancel={() => setTrimTarget(null)}
    onApply={(newPath) => { trimTarget.apply(newPath); setTrimTarget(null); }}
  />
)}
```

- [ ] **Step 5: Type-check**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/TimelinePage.tsx
git commit -m "feat(timeline): trim handles on source media and music bed"
```

---

## Task 7: Professional-grade microcopy pass

Bring the helper subtext, field hints, badges, and tooltips on the Render and Timeline pages — plus the new trimmer's own copy — to a clear, confident, professional voice. Concise, benefit-led, no dev jargon ("server/outputs/…", "absolute path") leaking into user-facing hints.

**Files:**
- Modify: `client/src/pages/RenderPage.tsx`
- Modify: `client/src/pages/TimelinePage.tsx`
- Modify: `client/src/components/MediaTrimmer.tsx`

- [ ] **Step 1: RenderPage Voice track copy**

Replace the Voice track `placeholder` and `tooltip` (lines ~1029, 1034):

- `tooltip="Absolute path to the narration MP3/WAV produced in the Voice & Audio tab. Required for waveform renders; optional for video renders."`
  → `tooltip="Your narration track. Generate one in Voice & Audio, or upload your own. Required for waveform videos; optional when you supply a background video."`
- `placeholder="e.g. server/outputs/tts-xyz.mp3"`
  → `placeholder="Pick a narration track or generate one in Voice & Audio"`

- [ ] **Step 2: RenderPage Soundtrack copy**

- `placeholder="e.g. server/outputs/music.mp3"` (line ~1055)
  → `placeholder="Add background music (optional)"`
- The helper line (line ~1090-1092):
  `mp3, wav, m4a, aac, ogg. Up to {MAX_UPLOAD_MB} MB. Layered under your video.`
  → `Plays softly under your narration. MP3, WAV, M4A, AAC or OGG, up to {MAX_UPLOAD_MB} MB.`

- [ ] **Step 3: RenderPage "Voice track" badge**

`badge="Required for waveform"` (line ~1028) → `badge="Required for waveform"` stays, but ensure the Soundtrack `badge="Optional"` reads `badge="Optional"` (already fine). No change unless inconsistent casing is found nearby.

- [ ] **Step 4: TimelinePage Source Media copy**

- The intro paragraph (lines ~751-754):
  `Upload an audio sermon (mp3, wav, m4a) or a recorded video (mp4, mov, webm). Up to {MAX_UPLOAD_MB} MB.`
  → `Drop in a finished sermon — audio (MP3, WAV, M4A) or video (MP4, MOV, WEBM). Up to {MAX_UPLOAD_MB} MB.`
- The `tooltip` (line ~749):
  → `Your source recording. Audio is mastered into the assembly for an audio render; video keeps its frames for a captioned-video render.`

- [ ] **Step 5: TimelinePage Transcribe & Caption + Music Bed copy**

- Transcribe helper (line ~782-784):
  `Pull a word-level transcript with timings, then edit the lines below.`
  → `Generate a word-level transcript with timings, then refine the lines below before rendering captions.`
- Music Bed helper (line ~826-828):
  `Optional. mp3, wav, m4a. Up to {MAX_UPLOAD_MB} MB.`
  → `Optional background music, mixed under the sermon. MP3, WAV or M4A, up to {MAX_UPLOAD_MB} MB.`
- Music Bed `tooltip` (line ~823): tighten to
  `Background music under the sermon. Auto-duck lowers it while someone is speaking and lifts it back between phrases, so the message stays clear.`

- [ ] **Step 6: MediaTrimmer copy**

In `MediaTrimmer.tsx`, under the timeline track add a one-line hint (above or below the In/Selected/Out row):

```tsx
<p className="text-[11px] text-gray-500 text-center">
  Drag the handles to choose the part you want to keep, then Apply trim.
</p>
```

- [ ] **Step 7: Type-check + build**

Run: `cd client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0; bundle written to `../server/public`.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/RenderPage.tsx client/src/pages/TimelinePage.tsx client/src/components/MediaTrimmer.tsx server/public
git commit -m "polish(ux): professional-grade microcopy on Render & Timeline + trimmer; rebuild bundle"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run all server tests**

Run: `cd server && npm test`
Expected: existing suite + the two new files pass.

- [ ] **Step 2: Run all client tests**

Run: `cd client && npx vitest run`
Expected: existing suite + `trimMath` pass.

- [ ] **Step 3: Manual smoke (dev server)**

Start dev (`npm run dev` at repo root), sign in, then:
1. Render → upload a short MP3 as Soundtrack → click **Trim** → drag handles → **Play selection** → **Apply trim** → confirm the basename changes to `trimmed-*.mp3` and a "Trimmed to m:ss" toast appears.
2. Render → add a device-uploaded background **video** → **Trim** → confirm the preview seeks while dragging and Apply swaps the tile's path.
3. Timeline → upload a **video** as Source Media → **Trim** → Apply → confirm `sourceMediaPath` updates.
4. Timeline → upload an audio sermon → **Trim** → Apply → confirm the Main Assembly clip now points at the trimmed file (Render Audio still works).
5. Confirm Cancel leaves the original untouched, and a deliberately tiny selection is blocked.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "test: verify media trimmer end-to-end"
```

---

## Self-Review notes

- **Spec coverage:** scope (audio/music/video/background) → Tasks 5–6; trim-now→new-file → Task 2; shared component → Task 4; waveform/info reuse → Task 4; path-safety → Tasks 1–2; sync-first video → Task 2; edge cases (range/clamp/min/ffmpeg-fail) → Tasks 1–2 + component; tests → Tasks 1, 2, 3, 8; professional subtext → Task 7.
- **Type consistency:** `Selection`, `enforceHandles`, `pxToTime`, `timeToPct`, `clampTime`, `snap` defined in Task 3 and used in Task 4. `trimTarget` shape identical in Tasks 5 and 6. `validateTrimRequest` signature identical in Tasks 1 and 2.
- **No placeholders:** all steps carry real code/commands. The one intentional encoding caveat (`useRef`) is called out with a guard step.
