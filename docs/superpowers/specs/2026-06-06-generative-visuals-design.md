# Generative Visuals (AI image + Ken Burns motion) — Design

**Date:** 2026-06-06
**Status:** Approved (design); pending implementation plan
**Surface:** Render page — Background section

## Problem

The generative-image engine (`server/src/lib/imageGen/` — Cloudflare Flux + Google Imagen, Bible-safe prompts) only runs as a hidden *auto-background fallback* when the user's library is empty. Users want to **explicitly** generate visuals from their script — alongside their chosen backgrounds or solely — and have them **move** (motion), not sit static.

## Goals

- An explicit "Generate visuals from my script" control on the Render page.
- Two compose modes: **alongside** existing backgrounds (append) or **only AI visuals** (replace).
- **Ken Burns motion**: a toggle that gives generated stills (and any image background) a slow zoom/drift via ffmpeg — no paid video vendor.
- Reuse the existing background-item system + render image-scene support so the render pipeline needs only the motion change.
- Meter generation against the existing `imageGen` quota (free: 5/day), per image.

## Non-goals

- No real text-to-video / paid video vendor (explicitly deferred; Ken Burns only).
- No new image provider; reuse `generateBibleImage`.
- Timeline captioned-video flow gets this as a **follow-up**, not v1 (v1 = Render page).
- No change to the Bible-safe prompt rules.

## Existing pieces reused

- `generateBibleImage({ seriesId, partNumber, beatType, verseText, aspect })` → `{ ok, path (absolute), publicUrl: "/outputs/genImg/<seriesId>/part-N.png" }` or `{ ok:false, ... }`. Writes PNG under the GLOBAL `OUTPUT_DIR/genImg/...`, served by `express.static(outputDir)` (nested paths work).
- `isImageGenEnabled()` — master flag (true iff a provider is configured or `IMAGE_GEN_ENABLED`).
- `selectBackgroundsForScript({ beats: string[], maxBackgrounds })` / `deriveBeats(script)` — turn script lines into 1..N "beats".
- Quota lib `server/src/middleware/quota.js` (`QUOTAS`) + `usageStore.js` (`readUsage`, `incrementUsage`); `imageGen` bucket already exists (free 5/day, premium/admin unlimited −1).
- RenderPage `backgroundItems` (`{ id, url, previewUrl, image, kind }`); render uses each item's **`id` as the background file path** (`backgroundPath: String(b.id)`), and already renders image scenes (`-loop 1 -framerate 30 -t <dur>`, scaled/cropped). Uploads set `id = absolute file path`.

## Architecture

Generated images flow through the **existing background-item system**, so the still-image case needs **zero render changes**.

### 1. Server endpoint — `POST /api/imagegen/generate`

Mounted at `/api/imagegen` with `requireAuth, withUserScope, requireVerifiedEmail` — **NOT** the `quota()` middleware (which would meter one tick per request); the handler meters **per image** instead, so a batch of N correctly consumes N `imageGen` units and stops at the cap.

Request: `{ lines: string[], count: number (1..4), aspect: 'portrait'|'landscape'|'square' }`.

Behaviour:
1. If `!isImageGenEnabled()` → `503 { ok:false, error:"NOT_CONFIGURED" }`.
2. Compute `imageGen` quota remaining from `readUsage(ctx.dataDir)` + `QUOTAS[plan].imageGen` (`-1` = unlimited). If remaining `=== 0` → `429 { ok:false, error:"QUOTA_EXCEEDED", bucket:"imageGen", ... }`.
3. `effectiveCount = min(count, 4, remaining-if-limited)`.
4. Derive up to `effectiveCount` beats from `lines` (via `selectBackgroundsForScript({ beats: lines, maxBackgrounds: effectiveCount }).beats`, falling back to the joined text when empty).
5. For each beat: `generateBibleImage({ seriesId: <per-request id>, partNumber: i+1, beatType:'verse', verseText: beat.text, aspect })`. Collect successes (`{ path, publicUrl }`) and failures.
6. `incrementUsage(ctx.dataDir, 'imageGen')` once per **success**.
7. Respond `{ ok:true, items: [{ id: path, publicUrl, kind:'image' }], generated: successes.length, failed: failures.length }`. If `generated === 0` → `502 { ok:false, error:"GENERATION_FAILED", failed }`.

`seriesId` is a per-request unique id (so the deterministic genImg cache never collides across requests). `lines`/`count`/`aspect` validated; `count` clamped 1..4.

### 2. Client — RenderPage Background control

A panel beside the existing Auto / From library / Upload controls:
- **Checkbox "Generate visuals from my script"**; when `imageGen` remaining is 0 it's disabled with the standard quota hint; when `!features.imageGen` (config) it's hidden.
- **Mode select:** *Alongside my backgrounds* | *Only AI visuals*.
- **Count** 1..`MAX_BACKGROUNDS` (4).
- **"✨ Generate" button** → POST `/api/imagegen/generate` with `{ lines: <the script/overlay lines>, count, aspect }`, shows a spinner, then maps each returned item to a background item:
  `{ id: item.id (absolute path), url: mediaUrl, previewUrl: mediaUrl, image: mediaUrl, kind: 'image' }` where `mediaUrl = api.mediaBaseUrl + item.publicUrl`.
  - **Alongside:** append (respect `MAX_BACKGROUNDS` cap; drop overflow with a note).
  - **Only AI visuals:** replace `backgroundItems` with the generated set.
- A pure client helper `applyGeneratedVisuals(existing, generated, mode, max)` → `LibraryItem[]` encapsulates the mix/replace + cap logic (unit-tested).

### 3. Ken Burns motion (render)

A render-payload flag `kenBurns: boolean` (sent from a "Add subtle motion (Ken Burns)" toggle). When true, **image** scenes get a slow `zoompan` instead of a static hold; video backgrounds are untouched.

A pure helper `kenBurnsFilter(width, height, durSec, fps=30)` returns the ffmpeg filter substring (e.g. upscale → `zoompan=z='min(zoom+0.0006,1.06)':d=<durSec*fps>:s=WxH:fps=<fps>`), unit-tested as a string builder. It's spliced into the per-image branch of BOTH render background paths (single-bg image and the multi-bg `scenes[]` image branch) where the current `scale=W:H` for an image scene is built — guarded by the `kenBurns` flag and the per-input `isImage` check.

## Edge cases

- Partial failure (some of N images fail) → return the successes + `failed` count; client adds what came back and toasts "Generated X of N".
- "Only AI visuals" with 0 successes → keep existing backgrounds, surface the error (never leave the user with nothing).
- Quota: per-image metering; a request is capped to remaining; 0 remaining → 429 with the standard hint.
- `imageGen` disabled → control hidden (client reads `/api/config` features) and endpoint 503s defensively.
- Ken Burns off (default) → render byte-identical to today for image scenes.
- `lines` empty → 400 (nothing to generate from).

## Testing

- **Server route** (`node:test` + supertest, stubbed `generateBibleImage` + a temp dataDir): happy path (N successes → items + usage incremented N); partial failure aggregation; 0-success → 502; quota exhausted → 429; `count` clamp to 4 and to remaining; empty `lines` → 400; not-configured → 503.
- **Server unit:** `kenBurnsFilter(w,h,dur,fps)` — contains `zoompan`, correct `d=` frame count, `s=WxH`, monotonic zoom expression; deterministic string.
- **Client unit (Vitest):** `applyGeneratedVisuals` — append respects cap, replace swaps, dedup by id, never exceeds max.
- **Manual smoke:** generate from a script, render with motion on → confirm the still pans/zooms; render with motion off → static.

## Files (anticipated)

- New: `server/src/lib/kenBurns.js` + `server/test/lib/kenBurns.test.js`.
- New: `server/src/routes/imagegen.js` + `server/test/routes/imagegen.test.js`.
- Modify: `server/index.js` (mount `/api/imagegen`).
- Modify: `server/src/routes/render.js` (splice `kenBurnsFilter` into the two image-scene branches behind the `kenBurns` flag).
- New: `client/src/lib/generativeVisuals.ts` (`applyGeneratedVisuals`) + `client/src/lib/__tests__/generativeVisuals.test.ts`.
- Modify: `client/src/pages/RenderPage.tsx` (the Generate-visuals control + Ken Burns toggle + payload flag).
