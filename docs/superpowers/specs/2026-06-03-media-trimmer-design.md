# Media Trimmer — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Surfaces:** Render page, Timeline page

## Problem

When a user uploads a music track, sermon audio, or video clip, they get the
whole file — there is no way to keep only the portion they want. They want a
WhatsApp-style trimmer: after upload, drag start/end handles over a
waveform (audio) or timeline (video) and cut the clip down to a chosen window
before it feeds the render.

## Goals

- Optional, non-destructive-by-default trimming on **all** uploaded media:
  voice/sermon audio, music/soundtrack, source video, and device-uploaded
  background clips.
- "Trim now → new clip" model: on confirm, the server cuts immediately and
  returns a shorter file that replaces the original reference. The rest of the
  render pipeline is untouched — it just receives a shorter file.
- One shared trimmer UI used identically on both pages.

## Non-goals

- No multi-segment / multi-region cutting (single contiguous window only).
- No fades, no per-region volume — trim only.
- No filmstrip thumbnail strip for video (live preview + handles instead).
- No editing of Pexels/library clips that were never uploaded by the user
  (only files in the user's own output dir are trimmable).

## Existing infrastructure reused

- `GET /api/audio-adv/info?inputPath=…` → `{ durationSec }` (ffprobe).
- `GET /api/audio-adv/waveform.png?inputPath=…` → waveform PNG. Mounted under
  `requireAuth`, which also accepts `?token=` (per `api.ts` note), so an
  `<img>` can load it with a token query param.
- Upload endpoints return `{ ok, file: "<abs server path>" }`:
  `/api/media/upload-audio`, `/api/media/upload-source-video`,
  `/api/media/upload-background`.
- `api.mediaUrl(basename)` → playable `/outputs/<name>` URL on the media origin
  (already used for previews in TimelinePage).
- Path-safety helper `resolveAssetPath(dataDir, path)` (used by
  `audio_advanced.js`) scopes a path to the user's own data dir.

## UX & flow

After any successful upload, a **✂ Trim** button appears next to the file.
Trimming is optional — skipping it uses the full file exactly as today.
Clicking ✂ opens the **Media Trimmer modal**:

- **Audio** (voice/sermon/music): waveform image backdrop + a draggable
  selection region with two handles.
- **Video** (source/background): a live `<video>` preview + a timeline bar with
  the same two handles; grabbing a handle seeks the preview to that frame.
- Both show **in / out / selected-duration** read-outs and a **▶ Play
  selection** button to audition just the chosen window before committing.
- **Apply trim** → server cuts → modal closes → the file reference is swapped to
  the new trimmed file (toast: e.g. "Trimmed to 3:25"). **Cancel** leaves the
  original untouched.

Re-trim is allowed: each Apply trims **from the current (already-trimmed)
file**, so dragging in narrows further. To widen again, re-upload.

## Shared component: `<MediaTrimmer>`

One reusable component, used by both pages:

```
<MediaTrimmer
  serverPath   // uploaded file path, e.g. .../outputs/user-audio-<uuid>.mp3
  kind         // 'audio' | 'video'
  onApply(newServerPath, newDurationSec)
  onCancel()
/>
```

Behaviour:

- Loads duration from `/api/audio-adv/info?inputPath=…`.
- Audio backdrop from `/api/audio-adv/waveform.png?inputPath=…&token=…`.
- Preview/audition via an `<audio>`/`<video>` whose `src` is
  `api.mediaUrl(basename)`; seeks with `currentTime`, stops playback at `out`.
- Handles are pointer-drag (touch + mouse via pointer events), snapping to 0.1s,
  with a minimum 0.5s selection enforced (in < out always).
- "Apply trim" calls `POST /api/media/trim` and invokes `onApply` with the
  returned file + duration.

## Server: new endpoint `POST /api/media/trim`

Request:

```json
{ "inputPath": "<server path>", "startSec": 45.0, "endSec": 250.0 }
```

Response:

```json
{ "ok": true, "file": "<new server path>", "durationSec": 205.0 }
```

Behaviour:

- Resolve `inputPath` with the existing path-safety helper scoped to the user's
  output dir; reject anything outside it (`400`). Users can only trim their own
  files.
- Validate range: `startSec >= 0`, `endSec > startSec`, clamp `endSec` to the
  probed source duration; reject a degenerate (< 0.1s) selection.
- ffmpeg **accurate re-encode** (not stream-copy, so the cut lands exactly on
  the handles):
  - audio → `-ss start -to end -c:a libmp3lame -ar 44100 -ac 2` → new `.mp3`
  - video → `-ss start -to end -c:v libx264 -c:a aac -movflags +faststart` →
    new `.mp4`
- Write a new UUID-named file in the user's output dir; probe and return its
  duration. The original file is left in place (cheap; makes re-trim trivial).
- Failure handling mirrors the upload route: ffmpeg missing / non-zero exit →
  `400` with details; the client keeps the original file and toasts the error.

### Trade-off: synchronous vs background

Audio trims are always fast. A very long **video** re-encode could hold the
request open. **Decision: ship synchronous-first** (clips here are short) with
a generous timeout. If long-video trims prove painful, a follow-up can route
video trims above a length threshold through the existing background-job + SSE
progress pattern. This is explicitly out of scope for v1.

## Integration points

- **Render page** (`client/src/pages/RenderPage.tsx`): ✂ on Voice track,
  Soundtrack, and the device-upload background tiles.
- **Timeline page** (`client/src/pages/TimelinePage.tsx`): ✂ on Source Media
  (audio *and* video) and Music Bed.
- On Apply, the page swaps its stored path to the trimmed file and refreshes any
  duration-dependent UI:
  - Render: `voiceTrack`, `musicPath`, background item's `path` + `id`.
  - Timeline: `sourceMediaPath`, `musicPath`; for a trimmed source audio, the
    legacy Main Assembly clip entry is updated to the new path too.

## Edge cases

- Trim past EOF clamps to duration.
- Zero / inverted / sub-minimum selection blocked client-side and re-validated
  server-side.
- ffmpeg failure → toast + original kept (no silent data loss).
- Missing ffmpeg → same graceful fallback the upload route already uses.
- Background clip re-trim updates the item by `id`; selection order preserved.

## Testing

- Server (`/api/media/trim`): happy path (audio + video), path-safety rejection
  (path outside user dir → 400), bad range (endSec <= startSec → 400), clamp to
  duration.
- Component: handle math — in < out invariant, clamping to [0, duration],
  minimum-duration enforcement, time → pixel mapping.

## Files (anticipated)

- New: `client/src/components/MediaTrimmer.tsx`.
- New: server trim handler in `server/src/routes/media.js` (+ helper if needed).
- Edit: `client/src/pages/RenderPage.tsx`, `client/src/pages/TimelinePage.tsx`.
- New tests: server trim route test; `MediaTrimmer` handle-math test.
