# Generative Visuals (AI image + Ken Burns motion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users explicitly generate Bible-safe visuals from their script (alongside or instead of library backgrounds) and give image scenes subtle in-house Ken Burns motion — reusing the existing `generateBibleImage` engine, the background-item system, and the render image-scene support.

**Architecture:** A new `POST /api/imagegen/generate` endpoint wraps `generateBibleImage` over N script beats, metering the `imageGen` quota per image; the client adds the returned images as ordinary background items (so the still case needs no render change). A `kenBurns` render flag splices a pure `kenBurnsFilter()` zoompan into the single-bg and non-sync multi-bg image branches.

**Tech Stack:** Express + Node ESM, `node:test` + `supertest`, ffmpeg (zoompan), React + TypeScript + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-generative-visuals-design.md`

---

## File Structure

- **Create** `server/src/lib/kenBurns.js` — pure ffmpeg zoompan filter-string builder.
- **Create** `server/src/routes/imagegen.js` — `POST /generate` (with test seams), reuses `generateBibleImage` + quota lib.
- **Modify** `server/index.js` — mount `/api/imagegen`.
- **Modify** `server/src/routes/render.js` — splice `kenBurnsFilter` into 2 image branches behind `kenBurns`.
- **Create** `client/src/lib/generativeVisuals.ts` — pure `applyGeneratedVisuals(existing, generated, mode, max)`.
- **Modify** `client/src/pages/RenderPage.tsx` — Generate-visuals control + Ken Burns toggle + payload flag.
- **Tests:** `server/test/lib/kenBurns.test.js`, `server/test/routes/imagegen.test.js`, `client/src/lib/__tests__/generativeVisuals.test.ts`.

---

## Task 1: `kenBurns.js` (pure ffmpeg filter builder)

**Files:**
- Create: `server/src/lib/kenBurns.js`
- Test: `server/test/lib/kenBurns.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/lib/kenBurns.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kenBurnsFilter } from '../../src/lib/kenBurns.js';

test('builds a zoompan filter sized to the canvas with the right frame count', () => {
  const f = kenBurnsFilter(1080, 1920, 5, 30);
  assert.match(f, /zoompan=/);
  assert.match(f, /s=1080x1920/);
  assert.match(f, /:d=150/, 'd = durSec * fps = 5*30');
  assert.match(f, /fps=30/);
  // upscale before zoompan so the pan has pixels to move into (no jitter)
  assert.match(f, /^scale=/);
});

test('zoom expression increases monotonically and is capped', () => {
  const f = kenBurnsFilter(1080, 1920, 5, 30);
  assert.match(f, /zoom\+0\.0\d+/, 'zoom increments each frame');
  assert.match(f, /min\(/, 'zoom is capped');
});

test('clamps degenerate durations to at least 1 frame', () => {
  const f = kenBurnsFilter(1080, 1920, 0, 30);
  assert.match(f, /:d=1/);
});

test('rounds canvas dims to integers', () => {
  const f = kenBurnsFilter(1080.4, 1920.6, 3, 25);
  assert.match(f, /s=1080x1921/);
  assert.match(f, /:d=75/);
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/lib/kenBurns.test.js"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/lib/kenBurns.js`:

```js
/**
 * Build a Ken Burns (slow zoom) ffmpeg filter substring for an image scene.
 *
 * Returned string is a drop-in replacement for the `scale=W:H` step of an
 * image input: it upscales first (so zoompan has pixels to pan into without
 * shimmer), then zooms in gently from 1.0 to ~1.06 across the scene.
 *
 * @param {number} width   output canvas width
 * @param {number} height  output canvas height
 * @param {number} durSec  scene duration in seconds
 * @param {number} [fps=30]
 * @returns {string} e.g. "scale=2160:3840,zoompan=z='min(zoom+0.0006,1.06)':d=150:s=1080x1920:fps=30"
 */
export function kenBurnsFilter(width, height, durSec, fps = 30) {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  const rate = Math.max(1, Math.round(Number(fps) || 30));
  const frames = Math.max(1, Math.round((Number(durSec) || 0) * rate));
  // Upscale 2x so the zoom/pan samples from a larger source (avoids the
  // 1px jitter zoompan is infamous for at native resolution).
  const upW = w * 2;
  const upH = h * 2;
  // Per-frame zoom increment chosen so a ~5s scene reaches ~1.06x.
  const zoom = `'min(zoom+0.0006,1.06)'`;
  return `scale=${upW}:${upH},zoompan=z=${zoom}:d=${frames}:s=${w}x${h}:fps=${rate}`;
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/lib/kenBurns.test.js"`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/src/lib/kenBurns.js server/test/lib/kenBurns.test.js && git commit -m "feat(server): pure Ken Burns zoompan filter builder"
```

---

## Task 2: `POST /api/imagegen/generate` route + mount

**Files:**
- Create: `server/src/routes/imagegen.js`
- Modify: `server/index.js`
- Test: `server/test/routes/imagegen.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/routes/imagegen.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import imagegenRouter, { _setGenerateImpl, _setEnabledImpl, _reset } from '../../src/routes/imagegen.js';

function mkApp(plan = 'free') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgen-'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { dataDir, outputDir: dataDir, userId: 'u1', plan }; next(); });
  app.use('/api/imagegen', imagegenRouter);
  return { app, dataDir };
}
async function http(app) { const { default: supertest } = await import('supertest'); return supertest(app); }

test('happy path: generates N images, increments usage by N', async () => {
  const { app, dataDir } = mkApp();
  _setEnabledImpl(() => true);
  let n = 0;
  _setGenerateImpl(async ({ partNumber }) => ({ ok: true, path: `/abs/part-${partNumber}.png`, publicUrl: `/outputs/genImg/x/part-${partNumber}.png` }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['line a', 'line b'], count: 2, aspect: 'portrait' });
  assert.equal(res.status, 200);
  assert.equal(res.body.generated, 2);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].kind, 'image');
  // usage file should record 2 imageGen ticks
  const usage = JSON.parse(fs.readFileSync(path.join(dataDir, 'usage.json'), 'utf-8'));
  assert.ok((usage?.counts?.imageGen ?? 0) >= 2, 'usage incremented per image');
  _reset(); void n;
});

test('partial failure returns successes + failed count', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => true);
  _setGenerateImpl(async ({ partNumber }) => partNumber === 1 ? { ok: true, path: '/a.png', publicUrl: '/outputs/genImg/x/a.png' } : { ok: false, error: 'boom' });
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a', 'b'], count: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.generated, 1);
  assert.equal(res.body.failed, 1);
  _reset();
});

test('zero successes -> 502', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => true);
  _setGenerateImpl(async () => ({ ok: false, error: 'boom' }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a'], count: 1 });
  assert.equal(res.status, 502);
  _reset();
});

test('not configured -> 503', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => false);
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a'], count: 1 });
  assert.equal(res.status, 503);
  _reset();
});

test('count is clamped to 4', async () => {
  const { app } = mkApp('premium'); // unlimited quota so cap is the only limiter
  _setEnabledImpl(() => true);
  const seen = [];
  _setGenerateImpl(async ({ partNumber }) => { seen.push(partNumber); return { ok: true, path: `/p${partNumber}.png`, publicUrl: `/outputs/genImg/x/p${partNumber}.png` }; });
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a','b','c','d','e','f'], count: 10 });
  assert.equal(res.status, 200);
  assert.ok(res.body.generated <= 4, 'never more than 4');
  _reset();
});

test('empty lines -> 400', async () => {
  const { app } = mkApp();
  _setEnabledImpl(() => true);
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: [], count: 2 });
  assert.equal(res.status, 400);
  _reset();
});

test('quota exhausted -> 429', async () => {
  const { app, dataDir } = mkApp('free');
  // pre-fill imageGen usage to the free cap (5)
  fs.writeFileSync(path.join(dataDir, 'usage.json'), JSON.stringify({ day: new Date().toISOString().slice(0,10), counts: { imageGen: 5 } }), 'utf-8');
  _setEnabledImpl(() => true);
  _setGenerateImpl(async () => ({ ok: true, path: '/a.png', publicUrl: '/outputs/genImg/x/a.png' }));
  const res = await (await http(app)).post('/api/imagegen/generate').send({ lines: ['a'], count: 1 });
  assert.equal(res.status, 429);
  _reset();
});
```

> Before implementing, READ `server/src/lib/usageStore.js` to confirm the on-disk shape (the test assumes `usage.json` with `{ day, counts: { imageGen } }` and exports `readUsage(dataDir)` → `{ day, counts }` and `incrementUsage(dataDir, bucket)`). If the filename or shape differs, adjust the test's direct file reads/writes to match the real store — but keep the behavioural assertions identical.

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/routes/imagegen.test.js"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `server/src/routes/imagegen.js`. (ESM exports are non-configurable, so we use injectable seams — the same pattern as `transcribe.js`'s `_setTranscribeAudioImpl`.)

```js
import { Router } from "express";
import { randomUUID } from "crypto";
import { generateBibleImage, isImageGenEnabled } from "../lib/imageGen/index.js";
import { selectBackgroundsForScript } from "../lib/autoBackground.js";
import { readUsage, incrementUsage } from "../lib/usageStore.js";
import { QUOTAS } from "../middleware/quota.js";

const MAX_VISUALS = 4;

// Test seams (ESM exports can't be mock.method'd directly).
let _generate = generateBibleImage;
let _enabled = isImageGenEnabled;
export function _setGenerateImpl(fn) { _generate = fn; }
export function _setEnabledImpl(fn) { _enabled = fn; }
export function _reset() { _generate = generateBibleImage; _enabled = isImageGenEnabled; }

const router = Router();

router.post("/generate", async (req, res) => {
  try {
    if (!_enabled()) {
      return res.status(503).json({ ok: false, error: "NOT_CONFIGURED" });
    }
    const lines = Array.isArray(req.body?.lines)
      ? req.body.lines.map((l) => String(l || "").trim()).filter(Boolean)
      : [];
    if (lines.length === 0) {
      return res.status(400).json({ ok: false, error: "lines[] is required (nothing to generate from)" });
    }
    const aspect = ["portrait", "landscape", "square"].includes(String(req.body?.aspect))
      ? String(req.body.aspect) : "portrait";
    let count = Math.max(1, Math.min(MAX_VISUALS, Math.floor(Number(req.body?.count) || 1)));

    // Per-image quota metering (the route is NOT behind quota() middleware).
    const plan = req.ctx.plan;
    const limit = (QUOTAS[plan] || QUOTAS.free).imageGen;
    if (limit !== -1) {
      const { counts } = readUsage(req.ctx.dataDir);
      const remaining = Math.max(0, limit - Number(counts?.imageGen || 0));
      if (remaining === 0) {
        return res.status(429).json({ ok: false, error: "QUOTA_EXCEEDED", bucket: "imageGen", limit, plan });
      }
      count = Math.min(count, remaining);
    }

    const beats = selectBackgroundsForScript({ beats: lines, maxBackgrounds: count }).beats.slice(0, count);
    const seriesId = `genvis-${String(req.ctx.userId || "anon")}-${randomUUID().slice(0, 8)}`;

    const items = [];
    let failed = 0;
    for (let i = 0; i < beats.length; i++) {
      const r = await _generate({ seriesId, partNumber: i + 1, beatType: "verse", verseText: beats[i].text, aspect });
      if (r?.ok && r.path) {
        items.push({ id: r.path, publicUrl: r.publicUrl, kind: "image" });
        incrementUsage(req.ctx.dataDir, "imageGen");
      } else {
        failed += 1;
      }
    }

    if (items.length === 0) {
      return res.status(502).json({ ok: false, error: "GENERATION_FAILED", failed });
    }
    return res.json({ ok: true, items, generated: items.length, failed });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
```

> If `selectBackgroundsForScript` is not exported from `server/src/lib/autoBackground.js`, READ that file and use whatever beat-derivation export exists (e.g. call it to get `.beats`); the only requirement is "turn `lines` into up to `count` beat strings". If nothing suitable exists, fall back to `const beats = lines.slice(0, count).map((t) => ({ text: t }));`.

- [ ] **Step 4: Mount in `server/index.js`**

Add the import beside the other route imports:
```js
import imagegenRouter from "./src/routes/imagegen.js";
```
Add the mount near the other `/api/*` mounts (after the `/api/transcripts` line is fine). NO `quota()` middleware (the handler meters per image); keep `requireVerifiedEmail` (generation is a paid-ish action):
```js
app.use("/api/imagegen", requireAuth, withUserScope, requireVerifiedEmail, imagegenRouter);
```

- [ ] **Step 5: Run route tests + full suite**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/routes/imagegen.test.js"`
Expected: 7 pass.
Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && npm test`
Expected: full suite passes (report totals).

- [ ] **Step 6: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/src/routes/imagegen.js server/index.js server/test/routes/imagegen.test.js && git commit -m "feat(server): POST /api/imagegen/generate (per-image quota, partial-fail aware)"
```

---

## Task 3: Splice Ken Burns into render.js (image branches only)

**Files:**
- Modify: `server/src/routes/render.js`

Apply `kenBurnsFilter` to image scenes when the request sets `kenBurns: true`. Touch ONLY the single-bg branch and the non-sync multi-bg `segParts` branch. **Do NOT touch the `useSyncBackgrounds` crossfade chain** (Ken Burns + synced crossfades is a deliberate follow-up).

- [ ] **Step 1: Import the helper + read the flag**

At the top of `server/src/routes/render.js`, add to the imports:
```js
import { kenBurnsFilter } from "../lib/kenBurns.js";
```
In the captioned-video handler (the one containing the `backgroundPaths.forEach((bg, i) => {` block around line 781), near where other `req.body` flags are read (e.g. `syncBackgrounds`), add:
```js
const kenBurns = req.body?.kenBurns === true;
```

- [ ] **Step 2: Single-bg image branch**

Find (around line 805):
```js
      if (N === 1) {
        preDrawChain = needsScale
          ? `[0:v]scale=${renderWidth}:${renderHeight}[vbg];`
          : `[0:v]null[vbg];`;
      } else if (useSyncBackgrounds) {
```
Replace the `if (N === 1) { ... }` block with:
```js
      if (N === 1) {
        const singleIsImage = /\.(jpg|jpeg|png|webp)$/i.test(String(backgroundPaths[0]));
        if (kenBurns && singleIsImage) {
          preDrawChain = `[0:v]${kenBurnsFilter(renderWidth, renderHeight, durationSec, 30)}[vbg];`;
        } else {
          preDrawChain = needsScale
            ? `[0:v]scale=${renderWidth}:${renderHeight}[vbg];`
            : `[0:v]null[vbg];`;
        }
      } else if (useSyncBackgrounds) {
```

- [ ] **Step 3: Non-sync multi-bg image segments**

Find (around line 813-819):
```js
        const segSec = durationSec / N;
        const segParts = backgroundPaths.map((_, i) =>
          `[${i}:v]trim=duration=${segSec.toFixed(3)},scale=${renderWidth}:${renderHeight},setsar=1,setpts=PTS-STARTPTS[seg${i}]`,
        );
```
Replace the `segParts` map with one that uses Ken Burns for image inputs when enabled (zoompan replaces the `scale` step; trim still bounds the duration):
```js
        const segSec = durationSec / N;
        const segParts = backgroundPaths.map((bg, i) => {
          const segIsImage = /\.(jpg|jpeg|png|webp)$/i.test(String(bg));
          const scaleStep = (kenBurns && segIsImage)
            ? kenBurnsFilter(renderWidth, renderHeight, segSec, 30)
            : `scale=${renderWidth}:${renderHeight}`;
          return `[${i}:v]trim=duration=${segSec.toFixed(3)},${scaleStep},setsar=1,setpts=PTS-STARTPTS[seg${i}]`;
        });
```

- [ ] **Step 4: Verify existing render tests still pass + server suite**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && npm test`
Expected: full suite passes unchanged (the render route's existing tests must stay green — Ken Burns is off by default, so default behaviour is byte-identical).

- [ ] **Step 5: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/src/routes/render.js && git commit -m "feat(render): Ken Burns motion on image scenes (single-bg + non-sync multi-bg) behind kenBurns flag"
```

---

## Task 4: Client `generativeVisuals.ts` (pure helper)

**Files:**
- Create: `client/src/lib/generativeVisuals.ts`
- Test: `client/src/lib/__tests__/generativeVisuals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/__tests__/generativeVisuals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyGeneratedVisuals, type BgItem } from '../generativeVisuals';

const bg = (id: string): BgItem => ({ id, url: id, previewUrl: id, image: id, kind: 'video' });
const gen = (id: string): BgItem => ({ id, url: id, previewUrl: id, image: id, kind: 'image' });

describe('applyGeneratedVisuals', () => {
  it('replace mode swaps the list entirely', () => {
    const out = applyGeneratedVisuals([bg('a'), bg('b')], [gen('g1'), gen('g2')], 'replace', 4);
    expect(out.map((x) => x.id)).toEqual(['g1', 'g2']);
  });

  it('alongside mode appends after existing', () => {
    const out = applyGeneratedVisuals([bg('a')], [gen('g1'), gen('g2')], 'alongside', 4);
    expect(out.map((x) => x.id)).toEqual(['a', 'g1', 'g2']);
  });

  it('never exceeds max (alongside)', () => {
    const out = applyGeneratedVisuals([bg('a'), bg('b'), bg('c')], [gen('g1'), gen('g2')], 'alongside', 4);
    expect(out).toHaveLength(4);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'g1']);
  });

  it('dedups by id', () => {
    const out = applyGeneratedVisuals([bg('a')], [gen('a'), gen('g1')], 'alongside', 4);
    expect(out.map((x) => x.id)).toEqual(['a', 'g1']);
  });

  it('replace also respects max', () => {
    const out = applyGeneratedVisuals([], [gen('g1'), gen('g2'), gen('g3'), gen('g4'), gen('g5')], 'replace', 4);
    expect(out).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx vitest run src/lib/__tests__/generativeVisuals.test.ts`
Expected: FAIL — cannot resolve `../generativeVisuals`.

- [ ] **Step 3: Implement**

Create `client/src/lib/generativeVisuals.ts`:

```ts
export interface BgItem {
  id: string;
  url?: string;
  previewUrl?: string;
  image?: string;
  kind?: string;
  [k: string]: unknown;
}

export type GenerateMode = 'alongside' | 'replace';

/**
 * Combine generated visuals into the background-item list.
 * - 'replace': use only the generated items.
 * - 'alongside': append after the existing items.
 * Dedups by id (existing wins) and never exceeds `max`.
 */
export function applyGeneratedVisuals(
  existing: BgItem[],
  generated: BgItem[],
  mode: GenerateMode,
  max: number,
): BgItem[] {
  const base = mode === 'replace' ? [] : [...existing];
  const seen = new Set(base.map((b) => b.id));
  const out = [...base];
  for (const g of generated) {
    if (out.length >= max) break;
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out.slice(0, max);
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx vitest run src/lib/__tests__/generativeVisuals.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Type-check + commit**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.
```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/lib/generativeVisuals.ts client/src/lib/__tests__/generativeVisuals.test.ts && git commit -m "feat(client): pure applyGeneratedVisuals (mix/replace + cap) helper"
```

---

## Task 5: Wire RenderPage (Generate control + Ken Burns toggle + payload)

**Files:**
- Modify: `client/src/pages/RenderPage.tsx`

Context (confirm by reading): RenderPage has `backgroundItems`/`setBackgroundItems` (`LibraryItem[]`), `lines` (string, newline-separated overlay text), `aspect` (`'portrait'|'landscape'|'square'`), `MAX_BACKGROUNDS = 4`, `api` (with `api.post`, `api.mediaBaseUrl`), `toast`, and a Background `<Section>`/area with Auto / From library / Upload controls. The render request payload is assembled in the submit handler (search for `scenes:` / `'/api/jobs/enqueue'` / `'/api/render/'`).

- [ ] **Step 1: Imports + state**

Add near the other lib imports:
```tsx
import { applyGeneratedVisuals, type GenerateMode } from '../lib/generativeVisuals';
```
Add `Sparkles` to the existing `lucide-react` import (append to the named list).
Near the other `useState` calls add:
```tsx
const [genVisualsMode, setGenVisualsMode] = useState<GenerateMode>('alongside');
const [genVisualsCount, setGenVisualsCount] = useState(2);
const [isGeneratingVisuals, setIsGeneratingVisuals] = useState(false);
const [kenBurns, setKenBurns] = usePersistedState<boolean>(STORAGE_KEYS.renderKenBurns ?? 'bf_render_kenburns', false);
```
> If `STORAGE_KEYS.renderKenBurns` does not exist, either add it to `client/src/lib/storage.ts` `STORAGE_KEYS` (preferred) or just use a plain `useState(false)` for `kenBurns`. Do NOT invent a STORAGE_KEYS member without adding it.

- [ ] **Step 2: Generate handler**

Add inside the component:
```tsx
const handleGenerateVisuals = async () => {
    const scriptLines = lines.split('\n').map((l) => l.trim()).filter(Boolean);
    if (scriptLines.length === 0) { toast.error('Add some script lines first'); return; }
    setIsGeneratingVisuals(true);
    const toastId = toast.loading('Generating visuals from your script…');
    try {
        const res = await api.post('/api/imagegen/generate', {
            lines: scriptLines,
            count: genVisualsCount,
            aspect,
        });
        if (!res.ok || !Array.isArray(res.data?.items) || res.data.items.length === 0) {
            if (res.status === 503) { toast.error('AI visuals aren’t configured on this server yet.', { id: toastId }); return; }
            if (res.status === 429) { toast.error('Daily AI-image limit reached. Try again tomorrow or upgrade.', { id: toastId }); return; }
            toast.error(res.error || 'Could not generate visuals', { id: toastId });
            return;
        }
        const generatedItems = (res.data.items as Array<{ id: string; publicUrl: string }>).map((it) => {
            const mediaUrl = `${api.mediaBaseUrl}${it.publicUrl}`;
            return { id: it.id, url: mediaUrl, previewUrl: mediaUrl, image: mediaUrl, kind: 'image' as const, savedAt: new Date().toISOString() };
        });
        const next = applyGeneratedVisuals(backgroundItems as never[], generatedItems as never[], genVisualsMode, MAX_BACKGROUNDS) as typeof backgroundItems;
        setBackgroundItems(next);
        if (next.length > 0 && !backgroundPath) setBackgroundPath(String(next[0].id));
        const failedNote = res.data.failed ? ` (${res.data.failed} failed)` : '';
        toast.success(`Added ${res.data.generated} AI visual${res.data.generated === 1 ? '' : 's'}${failedNote}`, { id: toastId });
    } catch {
        toast.error('Could not generate visuals', { id: toastId });
    } finally {
        setIsGeneratingVisuals(false);
    }
};
```

- [ ] **Step 3: The control UI**

In the Background section (near the Auto / From library / Upload controls), insert this panel:
```tsx
<div className="mt-3 rounded-xl border border-primary-500/20 bg-primary-500/[0.04] p-3 space-y-2">
    <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-primary-300" />
        <span className="text-content-secondary text-xs font-medium">Generate visuals from my script</span>
    </div>
    <p className="text-meta">Bible-safe AI imagery (landscapes &amp; symbols) created from your lines. Uses your daily AI-image allowance.</p>
    <div className="flex flex-wrap items-center gap-2">
        <select
            value={genVisualsMode}
            onChange={(e) => setGenVisualsMode(e.target.value as GenerateMode)}
            className="h-9 text-xs rounded-md bg-dark-900/70 border border-white/10 px-2 text-gray-200"
        >
            <option value="alongside">Alongside my backgrounds</option>
            <option value="replace">Only AI visuals</option>
        </select>
        <select
            value={genVisualsCount}
            onChange={(e) => setGenVisualsCount(Number(e.target.value))}
            className="h-9 text-xs rounded-md bg-dark-900/70 border border-white/10 px-2 text-gray-200"
        >
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} image{n === 1 ? '' : 's'}</option>)}
        </select>
        <Button onClick={handleGenerateVisuals} disabled={isGeneratingVisuals} className="h-9 text-xs">
            <Sparkles size={14} className="mr-1.5" />
            {isGeneratingVisuals ? 'Generating…' : 'Generate'}
        </Button>
    </div>
    <label className="flex items-center gap-2 text-xs text-content-secondary cursor-pointer pt-1">
        <input type="checkbox" checked={kenBurns} onChange={(e) => setKenBurns(e.target.checked)} className="rounded border-white/10 bg-black/50 checked:bg-primary-500" />
        Add subtle motion (Ken Burns) to image backgrounds
    </label>
</div>
```

- [ ] **Step 4: Send the `kenBurns` flag in the render payload**

In the submit handler where the render/enqueue payload object is built (search for the object literal containing `audioPath`, `musicPath`, `scenes`, `syncBackgrounds`, etc.), add `kenBurns,` to that payload object so the server receives it. (It rides along on both the instant and queued render paths — add it to the shared payload object.)

- [ ] **Step 5: Type-check + build**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0. If `usePersistedState`/`STORAGE_KEYS`/`Sparkles`/`Button` is missing an import, add it. Resolve the `applyGeneratedVisuals` generics cleanly (the `as never[]`/`as typeof backgroundItems` casts bridge the `LibraryItem` ↔ `BgItem` structural gap; if `LibraryItem` is exported, prefer importing it and typing precisely over `never`).

- [ ] **Step 6: Commit (source only)**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/pages/RenderPage.tsx client/src/lib/storage.ts 2>/dev/null; cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src && git commit -m "feat(render): generate-visuals control + Ken Burns toggle"
```

---

## Task 6: Full verification + bundle

- [ ] **Step 1: Server suite** — `cd c:/Users/segun/source/repos/biblefuel-studio/server && npm test` → all pass (report totals).
- [ ] **Step 2: Client tests + type-check** — `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx vitest run && npx tsc -p tsconfig.app.json --noEmit` → all pass; exit 0.
- [ ] **Step 3: Build** — `cd c:/Users/segun/source/repos/biblefuel-studio/client && npm run build` → exit 0.
- [ ] **Step 4: Manual smoke** — Render page: type/pick a script → "Generate visuals" (alongside) → confirm 1–4 image tiles appear in the background slots; toggle "Add subtle motion" → render → confirm the still **pans/zooms**; render with motion off → static. Try "Only AI visuals" → confirm it replaces the slots. With `imageGen` not configured, the Generate call should 503 gracefully.
- [ ] **Step 5: Commit bundle** — `cd c:/Users/segun/source/repos/biblefuel-studio && git add server/public && git commit -m "build(client): rebuild bundle with generative visuals + Ken Burns" || echo "nothing to commit"`

---

## Self-Review notes

- **Spec coverage:** endpoint (per-image quota, partial-fail, clamps, 503/429/502/400) → Task 2; reuse `generateBibleImage`/beats → Task 2; Ken Burns render flag + helper → Tasks 1 & 3; client control (checkbox/mode/count/✨)/motion toggle/payload → Task 5; mix-vs-replace + cap logic → Task 4; tests (route, kenBurns string, client helper) → Tasks 1,2,4; verification → Task 6.
- **Render safety:** Ken Burns is off by default and only alters image branches; the existing render tests in Task 3 Step 4 guard byte-identical default behaviour. The `useSyncBackgrounds` crossfade path is intentionally untouched (documented follow-up).
- **Type/name consistency:** `kenBurnsFilter(w,h,dur,fps)` (Task 1) used in Task 3; `applyGeneratedVisuals(existing,generated,mode,max)` + `GenerateMode` (Task 4) used in Task 5; endpoint item shape `{ id (abs path), publicUrl, kind:'image' }` (Task 2) consumed in Task 5.
- **Quota:** route meters `imageGen` per image (Task 2), NOT via `quota()` middleware (which would tick once). Mount has no `quota()`.
