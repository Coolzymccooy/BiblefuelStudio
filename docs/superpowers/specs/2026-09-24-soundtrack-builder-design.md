# Soundtrack Builder — music-only Ambient sessions, own track order, tracklist credits, vocal removal

**Date:** 2026-09-24
**Branch:** feat/soundtrack-builder
**Status:** Design approved in chat (2 parts), pending spec review

## Goal

Let the operator publish **up to two hours of gospel instrumental music** to YouTube from
BibleFuel Studio: pick tracks they are allowed to use, optionally strip the vocals off one,
arrange them, put a picture behind them, render one MP4, and paste a description that
carries a timestamped tracklist and music credits.

This is **four additions to the existing Ambient project type**, not a new app. Ambient
already assembles a crossfaded, loudness-levelled music bed to a target length, gates
uncleared licences, renders pictures with a slow drift, and publishes to YouTube.

## What already exists (verified in code, not assumed)

- `lib/ambient/bedAssembly.js` — `orderTracks()` fills `targetSec` from a **shuffled** pool,
  never placing a track next to itself; `chainDurationSec()` accounts for crossfade overlap;
  `bedHash()` keys the cached assembly (`BED_BUILD_VERSION = 2`).
- `lib/ambient/loudness.js` — one fixed gain per track to `BED_TARGET_LUFS = -18`.
- `lib/ambient/stages.js` — bed build (`~L338–400`) saves the shuffled order back to
  `bed.trackRefs`; `unclearedTracks()` backs the licence gate; `imagesStage` throws
  `"no movements to illustrate — add drops first"` when `movements` is empty (`L205`).
- `lib/ambient/movements.js` — with zero drops, returns one movement spanning `targetSec`,
  but only when movements are recomputed (plan / drops edits). A project that skips the
  Word step has `movements: []` and fails at the image stage.
- `routes/ambient.js` — `PATCH /:id/bed` (licence gate → 409 with `uncleared`),
  `POST /:id/render` via `lib/renderJobs.js`.
- `lib/ambient/ambientRender.js` — 1920×1080 (landscape), `FPS = 24`,
  `libx264 -preset veryfast -crf 23`.
- `lib/musicLibraryStore.js` — tenant index `<dataDir>/musicLibrary.json`; `registerTrack`
  stores `label, mood, licence (default "unknown"), durationSec`; `PATCH /api/music/:id`
  edits `label | mood | licence`. Bundled tracks are `licence: "pixabay-cleared"`.
- `client/src/lib/ambientShare.ts` — `ambientChapters()` / `ambientDescription()` build
  chapters **only from spoken scripture drops**.
- `server/src/lib/social/youtubeMetadata.js` — `buildYoutubeDescription()` and chapter
  rules (≥3 chapters, first forced to 00:00).
- Host: Python 3.12.10 (`py -3.12`) and 3.14 (default), FFmpeg 8.0.1; no Python code in
  the server today apart from TTS provider clients.

## Global constraints

- **Legal:** the tool never helps disguise music the operator has no right to use. Derived
  instrumentals inherit the source's licence and credit; the existing licence gate applies
  unchanged. Separating a song does not clear it.
- **Existing projects are unchanged**: every new field has a default that reproduces today's
  behaviour (`words: "verses"`, `order: "shuffle"`, render `encoder: "cpu"`).
- **Vocal removal is laptop-only**: hidden unless the separator is detected; nothing is
  added to the Docker image.
- **One heavy job at a time** on the host: a render and a separation never run together.

---

## Part 1 — Ambient changes

### A. Music-only mode

- Project field `words: "verses" | "none"` (default `"verses"`), set via a new
  `PATCH /api/ambient/:id/words { words }` (same shape as the existing `/motion` and
  `/captions` routes).
- When `"none"`:
  - drops are ignored (kept on disk, so switching back restores them);
  - `writeWithMovements` guarantees **exactly one movement** spanning `0 → targetSec`, so
    the image stage and render have a picture — this fixes the `L205` failure;
  - the voicing stage is skipped; the render gets no voice input and no caption filters;
  - chapters come from the tracklist (C), never from drops.
- UI: a **"Music only (no verses)"** switch at the top of `AmbientWordStep`; when on, the
  step collapses to that switch and the wizard lets the operator continue.

### B. Keep my order

- Bed field `order: "shuffle" | "fixed"` (default `"shuffle"`), accepted by `PATCH /:id/bed`.
- New pure `fixedOrder(tracks, targetSec, { crossfadeSec, maxTracks })` in `bedAssembly.js`:
  plays tracks in the given order; if one pass is short of `targetSec`, repeats the list
  from the top; if the seam would put a track next to itself (a one-track list aside),
  it skips to the next one. Same `maxTracks = 400` ceiling as `orderTracks`.
- Build stage picks `fixedOrder` or `orderTracks` by `bed.order`. In fixed mode the saved
  `bed.trackRefs` stays the **operator's list** (not the expanded play order), so their
  arrangement is never overwritten.
- `bedHash` gains `order`; `BED_BUILD_VERSION` → 3 so old cached beds rebuild once.
- UI: `AmbientSoundStep` gets a **Shuffle / Keep my order** toggle; in fixed mode the chosen
  tracks list is drag-to-reorder (up/down buttons as the keyboard-accessible fallback).

### C. Tracklist and credits

- At bed build, store `bed.builtOrder: [{ ref, label, startSec, durationSec }]`, where
  `startSec[i] = Σ durationSec[0..i-1] − i × crossfadeSec`, truncated to the portion that
  plays within `targetSec` (the last entry may be cut short). Pure helper
  `trackStarts(order, crossfadeSec, targetSec)` in `bedAssembly.js`.
- Library tracks get an optional **`credit`** string (≤ 200 chars), editable through the
  existing `PATCH /api/music/:id` (allow-list extended) and set by `registerTrack`.
  Bundled tracks read as `credit: "Music from Pixabay"` at merge time.
- `ambientShare.ts`:
  - `ambientChapters(project)`: if `words === "none"` **or** there are no spoken drops, map
    `bed.builtOrder` to `{ startMs, title: label }`, dropping entries under 10 s (YouTube
    minimum); otherwise today's verse chapters.
  - `ambientDescription(project)`: append a `Music credits:` block — each distinct credit
    once, falling back to the track label when a track has no credit.
- `/api/ambient/:id` already returns the project, so `builtOrder` reaches the client
  without a new route. Chapters appear only after a render has built the bed; before that
  the publish step shows its existing no-chapters state.

### D. Encode with graphics chip (optional)

- Render option `encoder: "cpu" | "amf"` (default `"cpu"`). `"amf"` swaps the video codec
  args for `-c:v h264_amf -quality quality -rc cqp -qp_i 22 -qp_p 24` (exact values tuned
  during implementation against a 5-minute sample) and keeps `-pix_fmt yuv420p -r 24`.
- Detection: `ffmpeg -hide_banner -encoders` probed once, cached; if `h264_amf` is absent
  or the AMF render exits non-zero within its first seconds, the stage **retries once with
  the CPU args** and records `render.encoderUsed`.
- Set per render: `POST /:id/render { encoder }` (validated; anything else → `"cpu"`),
  stored on `project.render.encoderRequested`.
- UI: a checkbox on `AmbientRenderStep`, shown only when the server reports AMF available.

### Part 1 tests

- `bedAssembly`: `fixedOrder` (exact order, repeat-from-top, no self-adjacency at the seam,
  single-track list, `maxTracks`); `trackStarts` (crossfade maths, repeats, truncation);
  `bedHash` changes with `order`.
- `stages`: music-only project runs plan → images → render with one movement and no
  voice; fixed order leaves `bed.trackRefs` untouched; `builtOrder` saved.
- `ambientRender`: music-only args have no voice input and no `drawtext`; `amf` args swap
  the codec; CPU fallback on AMF failure.
- `routes/ambient`: `PATCH /:id/words`, `order` and render `encoder` validation; bed PATCH still 409s on uncleared.
- `routes/music`: `credit` accepted, trimmed, capped.
- Client (`ambientShare`): tracklist chapters, <10 s entries dropped, ≥3 rule, credits
  block de-duplicated; verse chapters still win when verses exist.

---

## Part 2 — Vocal removal (laptop-only)

### Separator choice

Use the **`audio-separator`** Python package rather than calling Demucs directly, so one
integration offers two models:

| Quality option | Model family | Expected time per 4-min song (Ryzen 7 8840HS, CPU) |
|---|---|---|
| **Fast** | Demucs (`htdemucs`) | ~1–3 min |
| **Best** (default) | BS-Roformer vocal/instrumental | ~3–6 min |

Times are estimates; **task 1 of the plan is a spike** that installs the package on the
laptop, separates one song with each model, and records real timings and memory. If the
spike shows `audio-separator` cannot be installed on Python 3.12 or Roformer is too slow,
the plan falls back to plain `demucs` with the same server interface.

### Server — `server/src/lib/stems/`

- `separatorAvailable()` — spawns `<STEMS_PYTHON> -m audio_separator --version` once per
  process (timeout 20 s), caches `{ ok, version }`. `STEMS_PYTHON` env var, default
  `py -3.12` on Windows / `python3` elsewhere, split into executable + args (never a shell
  string).
- `buildSeparatorArgs({ input, outDir, quality })` — pure; returns the argv array
  (`--model_filename`, `--output_dir`, `--output_format WAV`, `--single_stem Instrumental`).
  Paths are passed as arguments, never interpolated into a command line.
- `removeVocals({ input, outDir, quality, onProgress, signal })` — spawns with
  `shell: false`, parses percentage from the tool's progress output (pure
  `parseProgress(line)`), honours `signal` by killing the process tree, then transcodes
  the instrumental WAV to AAC `.m4a` (192 kb/s) with FFmpeg and deletes the WAV.
- `heavyJobGate` — a process-wide single-slot queue shared by separation and the Ambient
  render stage. Waiting jobs report `phase: "queued"`.

### Routes (`routes/music.js`)

- `GET /api/music/capabilities` → `{ vocalRemoval: boolean, amfEncoder: boolean }`.
- `POST /api/music/:id/instrumental { quality: "fast" | "best" }` → `{ jobId }`.
  - 404 if the track isn't in this tenant's library or bundled set; 409 if the separator
    is unavailable; resolves the file through the existing confined `resolveTrackFile`
    path, so no path from the request body is ever used.
  - Output lands in `<outputDir>/stems/<jobId>/instrumental.m4a` (unregistered).
- `GET /api/music/instrumental/:jobId` → status, percent, phase, preview URL when done.
- `POST /api/music/instrumental/:jobId/keep` → registers the file via `registerTrack` with
  `label: "<source label> (instrumental)"`, **the source's `licence` and `credit`**,
  `mood` copied, `derivedFrom: <source ref>`; returns the new track.
- `POST /api/music/instrumental/:jobId/discard` → deletes the job folder.
- Unkept results older than 7 days are removed by a sweep at server start and daily via
  `node-cron` (already a dependency).
- Rate-limited through the existing `quota` middleware like other heavy routes.

### Client

- In the music library list (MusicPicker / `AmbientLibraryPicker`): a **Make
  instrumental** action per track, shown only when `capabilities.vocalRemoval`.
- A small dialog: quality choice → progress bar (with Cancel) → **before/after preview**
  (30 s from the loudest section of each, two `<audio>` elements) → **Keep** / **Discard**.
- Kept tracks appear immediately in the picker with their inherited licence badge.

### Setup doc — `docs/vocal-removal.md`

One-time install on the laptop (`py -3.12 -m pip install "audio-separator[cpu]"`, model
download on first use, ~2 GB total), how to set `STEMS_PYTHON`, expected timings from the
spike, quality expectations (studio lead vocal: very good; backing vocals: good with faint
bleed; choir-heavy: fair; live: poor), and the licence rule.

### Part 2 tests

- `buildSeparatorArgs` (both qualities, paths with spaces/quotes stay single argv items).
- `parseProgress` against captured sample output.
- `separatorAvailable` true/false/timeout with an injected spawn.
- `heavyJobGate`: second job waits; cancellation of a queued job; gate released on error.
- Routes: capability hidden → 409; other tenant's / unknown track → 404; keep copies
  licence + credit and sets `derivedFrom`; original track untouched; discard removes files.

---

## Error handling

- Separator crash / non-zero exit → job `error` with the last 400 chars of stderr; no
  library entry created.
- Out of disk during separation or render → surfaced as the job error; partial files
  removed.
- A kept instrumental whose file later disappears behaves like any forgotten `mylib:`
  track today (thins the bed, never kills the render).

## Non-goals

- Vocal removal on the deployed server.
- Separating into drums/bass/other stems.
- Downloading music from URLs (YouTube, streaming services).
- AI-composed music.
- Any automatic "licence clearing" — licence status stays an operator decision.

## Dunni

Tracked as a BibleFuel feature issue in this repo; PR body carries `Closes #N`.
