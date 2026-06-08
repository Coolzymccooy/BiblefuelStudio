# Gumroad → "Send to Timeline" — Design

**Date:** 2026-06-08
**Branch:** `worktree-feat-gumroad-send-to-timeline`
**Status:** Approved design, pending spec review

## Goal

Add a single **"Send to Timeline"** button to a generated Gumroad devotional that:

1. Narrates the **free** devotional using the existing TTS pipeline.
2. Seeds the Timeline editor's state.
3. Drops the user into `/app/timeline` **one click away from a finished captioned video** — reusing existing captions, kinetic typography, auto-backgrounds, and image generation.

No changes to the Timeline page, the TTS pipeline, the render pipeline, or the Gumroad generation engine. The feature is a thin, client-side **bridge**.

## Context — current state

- **Gumroad** ([client/src/pages/GumroadPage.tsx](../../../client/src/pages/GumroadPage.tsx) → [server/src/routes/gumroad.js](../../../server/src/routes/gumroad.js) → [server/src/lib/gumroadPacks.js](../../../server/src/lib/gumroadPacks.js)) emits **pure static template markdown** — no LLM, no audio, no images. `POST /api/gumroad/generate` returns `{ ok, freeTitle, paidTitle, freeMarkdown, paidMarkdown, createdAt }`.
  - **Free** lead magnet: 7 hardcoded verses, each with **real verse text** + a canned reflection + prayer.
  - **Paid** product: 30 themed days with `**Verse:** (Add your chosen verse here)` **placeholders** — not narratable.
- **Timeline** ([client/src/pages/TimelinePage.tsx](../../../client/src/pages/TimelinePage.tsx)) is an **audio/caption tool**, not a text tool. It has two render paths, and neither runs on text alone:
  - **Main Assembly → "Render Audio"** (`POST /api/audio-adv/timeline`) needs audio **clips** (`STORAGE_KEYS.timelineClips`, each `{ path, startSec, durationSec }`).
  - **Sermon Clip Studio → "Render Captioned Video"** (`POST /api/render/captioned-video`) is **gated on both** `sourceMediaPath` **and** `transcript`. Caption lines alone keep the button disabled.
- The Timeline page hydrates its entire state from **`localStorage`** via `STORAGE_KEYS` + `usePersistedState` / `loadJson`:
  - `sclSourcePath` (source media path), `sclSourceKind` (`'audio' | 'video'`), `sclTranscript` (`TranscriptWord[]` = `{ text, startMs, endMs }`), `sclEditedLines` (`string[]`).

## Decision — the bridge

**"Send to Timeline" = narrate the free devotional via existing TTS, seed the Timeline localStorage keys, then navigate.** The button is the only new UI; Timeline reads the seeded state exactly as if the user had uploaded and transcribed a sermon themselves.

### Why narration (not a text-only handoff)

Timeline cannot render from text. The "Render Captioned Video" path requires `sourceMediaPath` + `transcript`. TTS with `withTimestamps: true` produces **both** the audio source and the word-level timings, so the user lands render-ready. A text-only handoff (seed `sclEditedLines` only) leaves the render buttons disabled and is fragile (a fresh transcribe overwrites the injected lines) — explicitly rejected.

## Architecture

```
GumroadPage (free markdown result)
      │  click "Send to Timeline"
      ▼
gumroadToTimeline.parse(freeMarkdown)  ──►  { narrationText, lines }
      │
      ▼
POST /api/tts/synthesize-category  { text: narrationText, category: "narrator", withTimestamps: true }
      │                                   (existing endpoint — unchanged)
      ▼  { file, wordTimings }
seed localStorage (same helper usePersistedState uses):
   sclSourcePath  = file
   sclSourceKind  = "audio"
   sclTranscript  = wordTimings           (or even-distribution fallback)
   sclEditedLines = lines
      │
      ▼
navigate("/app/timeline")  ──►  user picks background / Auto  ──►  Render Captioned Video
```

Gumroad becomes a **source node**; Timeline stays an untouched **consumer**.

## New code (all client-side)

### 1. `client/src/lib/gumroadToTimeline.ts` — pure parser

```
parseFreeDevotional(markdown: string): { narrationText: string; lines: string[] }
```

- Strips markdown decoration (`# title`, `**Verse:**`, `**Reflection:**`, `**Prayer:**`, `---`, intro/footer lines).
- Per day, keeps the **spoken** text: verse text + reflection + prayer.
- Splits into caption-sized `lines: string[]`.
- `narrationText` is **exactly `lines.join(' ')`** (or `'\n'`) so the TTS words align **positionally** with `sclEditedLines` — this is what `reflowWordsFromEditedLines` on the Timeline relies on.
- Pure function, no I/O — fully unit-testable.

### 2. `sendToTimeline()` handler + button in `GumroadPage.tsx`

- Button rendered **only under the free markdown block** (paid product is placeholders — button hidden/disabled there with an explanatory tooltip).
- On click:
  1. `parseFreeDevotional(result.freeMarkdown)`.
  2. `api.post('/api/tts/synthesize-category', { text: narrationText, category: 'narrator', withTimestamps: true })`.
  3. Seed the four localStorage keys via the **same persistence helper `usePersistedState` uses** (see Risk).
  4. `navigate('/app/timeline')` (react-router).
- UX: button shows `Narrating…` + disabled while TTS is in flight; toast on failure (no navigation).

### 3. Tests — `client/src/lib/__tests__/gumroadToTimeline.test.ts`

- Well-formed free markdown → expected `lines` + `narrationText`.
- `narrationText === lines.join(' ')` invariant.
- Missing prayer / missing reflection line tolerated.
- Multi-day parsing.
- Line-splitting boundary cases (long verse text wraps to multiple lines).

## Error handling

- **Free only:** the button never operates on `paidMarkdown` (placeholder verses).
- **TTS failure:** toast, button re-enabled, no navigation, no partial seed.
- **Timestamp fallback:** if the resolved TTS provider returns no `wordTimings`, synthesize a transcript by **even-distributing** the words across the audio duration (mirrors Timeline's `groupWordsIntoLines` philosophy) so captions still render rather than leaving "Render Captioned Video" disabled.

## The one real risk

`usePersistedState` and `loadJson` / `saveJson` **must serialize identically**, or the seeded keys won't hydrate when Timeline mounts. **The implementation plan's first step is to confirm the exact persistence format** (read `client/src/lib/usePersistedState.ts` and `client/src/lib/storage.ts`) and seed through the matching helper. This is the single point that can silently break the feature.

## Testing strategy

- **Unit:** the parser (above).
- **Manual / E2E:** Generate (super-admin) → Send to Timeline → confirm `/app/timeline` mounts with Source Media, Transcribe & Caption lines, and an enabled **Render Captioned Video** button; pick Auto background → render succeeds.

## Out of scope (explicitly deferred)

- Dispatch to **Series**, **Voice & Audio**, **Story & Video** — each becomes its own later spec.
- The **5 moat features** (real AI generation, omni-format bundle, auto cover/mockups, persistent product catalog, lead-magnet→paid email funnel).
- Any change to the static Gumroad generation engine.

## Files touched

| File | Change |
|------|--------|
| `client/src/lib/gumroadToTimeline.ts` | **new** — pure parser |
| `client/src/lib/__tests__/gumroadToTimeline.test.ts` | **new** — unit tests |
| `client/src/pages/GumroadPage.tsx` | add `sendToTimeline()` handler + button |

Backend: **none.** Timeline / TTS / render pipelines: **unchanged.**
