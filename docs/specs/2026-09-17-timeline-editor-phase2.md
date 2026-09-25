# Timeline Editor — Phase 2 spec

**Date:** 2026-09-17
**Branch:** `fix/timeline-light-legibility`
**Status:** BUILT 2026-09-17 — all five shipped in order F1 → F5 → F3 → F2 → F4
**Reference:** the CapCut-style mockup the operator supplied (7 scenes, 6 tracks, 4:30)

The visual layer is already shipped on this branch: lane colour families, icon
chips, scene tints, lane beds, three themes, contrast audited. This spec covers
what the mockup shows that the app does **not** yet do.

---

## What already exists (do not rebuild)

Verified in the codebase before writing this, because it changes the estimates
substantially:

| Capability | Where | Reuse |
|---|---|---|
| `ffprobe` invocation + env path | `server/src/routes/audio_advanced.js:248` | duration probing |
| Waveform **PNG** endpoint | `audio_advanced.js:57` `GET /waveform.png` | ffmpeg `showwavespic` already proven |
| `generateVideoThumbnail()` | `server/src/lib/mediaThumb.js:67` | **first-frame JPEG, already cached to `/outputs/<stem>.jpg`, already run on upload** |
| Thumb wired into upload | `media.js:599` `respondWithBackground()` | videos already get a poster |
| Asset model with `durationSec`, `proxyPath`, `proxyStatus` | `client/src/lib/timelineProject.ts:38` | extend, don't replace |

**Consequence:** clip thumbnails are *mostly done server-side*. The gap is that
`TimelineAsset` has no `thumbPath` field to carry the existing JPEG to the clip
block. That is a small change, not a feature build.

---

## Scope, in dependency order

### F1 — Time ruler
**What:** a timecode axis above the scene strip (`0:00 0:30 1:00 … 4:30`),
aligned to the same horizontal grid as the lanes.

**Why first:** F2 (zoom) and F4 (waveforms) are both meaningless without a time
axis, and both must share its scale. Building it first forces the shared
`pxPerSecond` model into existence once.

**Design:**
- New `useTimelineScale({ durationSec, containerWidth, zoom })` →
  `{ pxPerSecond, tickEverySec, ticks[] }`.
- Tick interval auto-selects from a ladder (1, 2, 5, 10, 15, 30, 60, 300s) so
  labels never collide: pick the smallest interval where
  `tickEverySec * pxPerSecond >= 56px`.
- Ruler renders inside the same scrolling container as the lanes and shares its
  `marginLeft: headW`, so the axis cannot drift from the clips.

**Risk (known, already burned once):** there is a comment at
`VisualTimelineCanvas.tsx:257` recording that the ruler and lanes previously sat
on different grids on a 390px phone. The offset must come from one constant, not
be duplicated per element.

**Acceptance:**
- Tick labels never overlap at any width 320–2560px.
- Ruler `0:00` aligns to clip `x=0` within 1px at every zoom level.
- Phone: ruler hidden (as today) rather than misaligned.

---

### F2 — Zoom
**What:** the `− ●———— +` control from the mockup; scales the time axis.

**Depends on:** F1.

**Design:**
- Zoom is a multiplier on `pxPerSecond`, clamped `[0.25, 8]`.
- Clip widths become `durationSec * pxPerSecond` (today they are `%` of total),
  so the lane content becomes wider than the viewport and scrolls.
- **Fit** resets zoom so the whole project fits the container.
- Persist per project in `localStorage` (`bf.timeline.zoom.<projectId>`), like
  the existing `bf.editor.stripPct`.

**Acceptance:**
- A 4:30 project at zoom 1 fits the container.
- Zooming keeps the **playhead** centred, not the scroll origin.
- Clip/lane/ruler stay aligned at every zoom step.

---

### F3 — Lane controls (eye / lock / overflow)
**What:** per-lane visibility, lock, and a `⋯` menu, as in the mockup.

**Design:**
- Extend `TimelineTrack` with `hidden?: boolean; locked?: boolean`.
- **Hidden** = excluded from the render payload. **Locked** = clips not
  selectable/draggable, still rendered.
- Both persist with the project (they are editorial state, not view state).
- `⋯` reuses the existing `onClearLane` plus new "select all in lane".

**DECIDED 2026-09-17 (operator):** `hidden` **affects the render** — NLE
behaviour. Because a forgotten hidden lane would otherwise silently ship a wrong
video, the Render action MUST warn when any lane is hidden, naming which ones,
and require confirmation. That warning is part of F3, not a follow-up.

**Acceptance:**
- Hidden lane: greyed, clips non-interactive, excluded from render payload.
- Locked lane: clips visible and selectable for inspection, not editable.
- State survives reload.

---

### F4 — Audio waveforms
**What:** the peak trace inside music/VO clips.

**This is the expensive one.** Two viable approaches:

**(a) Server PNG — cheap, reuses `GET /waveform.png`**
- ffmpeg `showwavespic` → PNG → `background-image` on the clip.
- Pros: endpoint already exists and is proven; no client audio decoding.
- Cons: a raster does not rescale with zoom without re-fetching; needs a
  cache-key per `(assetId, width bucket)`.

**(b) Server peaks JSON — correct, more work**
- ffmpeg → raw PCM → downsample to N peak pairs → JSON, cached beside the asset
  as `<stem>.peaks.json`.
- Client draws to `<canvas>`, so **zoom is free** and it re-tints per theme.
- Cons: new endpoint, new cache, decode cost on first view.

**Recommendation: (b).** (a) looks cheaper but fights F2 immediately — every
zoom step would re-request a raster, and a stretched PNG looks wrong. Peaks JSON
is ~120 lines server-side and makes zoom a non-issue. Cache invalidation is by
file mtime + size.

**Acceptance:**
- Peaks generated once per asset, cached, survive restart.
- Waveform redraws correctly at every zoom level.
- Waveform inherits `--lane-ink`, so it follows the theme.
- A failed/absent waveform degrades to the current flat clip — never blocks.

---

### F5 — Clip thumbnails
**What:** the filmstrip frame at the head of video clips.

**Much cheaper than it looks** — see the table above.

**Design:**
- Add `thumbPath?: string` to `TimelineAsset`.
- Populate from the existing `respondWithBackground()` `thumb` value at upload,
  and backfill via `thumbPathFor()` (already in `mediaThumb.js`) for assets that
  predate the field.
- Render as a 28×28 (compact) / 40×40 rounded image in the clip's leading slot,
  replacing the icon chip when present.

**Acceptance:**
- Video clips show a frame; audio/caption clips keep the icon chip.
- A missing thumb falls back to the chip, never a broken image.
- No new ffmpeg work at timeline-render time.

---

## Sequencing

```
F1 ruler ──┬── F2 zoom ──┬── F4 waveforms
           │             │
           └── F3 lane controls (independent)
                         └── F5 thumbnails (independent)
```

Suggested order: **F1 → F5 → F3 → F2 → F4.**
F5 and F3 are cheap wins that make the editor feel finished; F4 is last because
it is the only piece with real infrastructure cost.

---

## Non-goals for this phase

- Drag-to-move / trim handles on clips (the mockup implies them; they are a
  separate interaction spec with undo implications).
- Snapping / magnetic timeline.
- Multi-select.
- Transport controls (play/pause/fullscreen in the preview) — the preview owns
  its own time model today, and wiring it to the timeline playhead is its own
  piece of work.

---

## Testing

Each feature ships with unit tests for its pure logic, in the existing style:

- F1: `useTimelineScale` — tick ladder selection at many widths/durations.
- F2: zoom clamping, fit calculation, playhead-preserving zoom.
- F3: hidden/locked reducers, render-payload exclusion.
- F4: peak downsampling (N samples in → exactly N pairs out), cache key
  derivation.
- F5: thumb resolution + fallback.

Contrast for any new surface is verified against **all three themes** before
commit, as on the rest of this branch.


---

## Built — what differed from this spec

Recorded 2026-09-17, after implementation. The spec was accurate about
sequencing and cost; these are the places reality differed.

| Spec said | Reality |
|---|---|
| `thumbPathFor()` exists in mediaThumb.js | It does not. The real helper is `deriveOutputJpgPathFromVideo()`. |
| F5 = add `thumbPath` to TimelineAsset | Not needed. The client DERIVES the path, so assets uploaded before today get frames with no backfill. A stored `thumbPath` still wins if one ever appears. |
| F3 = add `hidden` and `locked` | `locked` and `muted` already existed on TimelineTrack but were **dead fields** — nothing read either. Only `hidden` was new; `locked` is now wired for the first time. |
| F4 tick ladder to 300s | Already extended to 3600s during F1's property testing (a 90-minute sermon on a phone). |

### Two bugs the unit tests could not have caught

Both were found by driving the feature in a browser, and both are recorded in
code comments so they are not reintroduced:

1. **Measurement feedback loop (F2).** `scaleRef` was attached to the ruler —
   an element whose width the scale then sets. Measure → widen → measure the
   wider thing: `contentWidth` reached **67 million pixels** after one click of
   `+`. The ref must sit on the scrolling *viewport*, which is the only stable
   reference and does not grow with its content.

2. **Sticky gutter (F2).** The ruler and scene strip used a plain `marginLeft`,
   which is correct at zoom 1 but slides them under the sticky lane headers as
   soon as content scrolls. Both now use the lane rows' own structure — sticky
   gutter cell plus content cell — rather than a second mechanism that would
   drift from the first.

A third issue was caught visually: F3's eye and lock left only 44px of text in
the 9rem header and five of six lane names truncated. `headW` went to 11.5rem,
and because it is the one constant the ruler, scene strip and lane grid all
read, all three moved together.

### Still open

- **Thumbnails and waveforms are unverified in a rendered clip block.** Both
  were proven at the layer below — thumb derivation by unit test, peaks by
  running real TTS audio through the actual ffmpeg pipeline (2s → 1024
  buckets, peaks +0.45/-0.51, silence between words reading near zero) — but
  the test project has no clips, so neither has been *seen* in a lane. First
  real project with media will confirm or contradict.
- The non-goals below are unchanged: no drag/trim, no snapping, no
  multi-select, no transport wiring.
