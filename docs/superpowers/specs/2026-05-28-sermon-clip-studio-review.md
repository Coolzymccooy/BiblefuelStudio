# Sermon Clip Studio — Implementation Review

**Date:** 2026-05-28
**Branch:** `feat/sermon-clip-studio-review`
**Status:** Review (no code changes yet)
**Audience:** Biblefuel Studio maintainer, before scoping the feature

---

## Purpose

Compare the proposed **Sermon Clip Studio / Speech-to-Video Studio** flow against the current Biblefuel Studio codebase, so the eventual implementation plan is scoped to *what's actually missing* — not a rewrite of capabilities that already ship.

Proposed flow (verbatim from request):

```
Upload audio/video → Extract speech to text → Clean transcript →
Split into caption lines → Render kinetic typography →
Optional background/video/music → Export short-form video
```

## Headline finding

The proposal is ~70% already built. The two real gaps are:

1. **Speech-to-Text on user-uploaded media.** Today Whisper is only invoked as a forced-alignment fallback on *TTS-rendered* audio. The user-upload → transcribe path doesn't exist.
2. **Video input handling.** Today the render pipeline composites *generated audio over a looped background*; it does not accept a user-uploaded video as the primary layer and burn captions onto the original frames.

Everything else — uploads, kinetic typography, music bed, auto-ducking, FFmpeg pipeline, a timeline editor — already exists in some form.

## Capability gap table

| # | Proposed capability | Status | Where it lives today |
|---|---|---|---|
| 1 | Upload audio (mp3/wav/m4a/aac/ogg/flac/webm) | **Exists** | [server/src/routes/media.js:76](server/src/routes/media.js#L76) `POST /upload-audio` — base64 dataUrl, ffprobe-validated, normalised to MP3 |
| 2 | Upload video (mp4/mov/webm) | **Partial** | media.js declares `videoExtensions` ([line 9](server/src/routes/media.js#L9)) and exposes `/video-list`, but there is no `POST /upload-video` route that accepts a user's source video for caption burn-in. Need to verify. |
| 3 | Speech-to-Text with word timestamps | **Partial — needs new entry point** | Whisper integration exists at [server/src/lib/voice/alignment.js](server/src/lib/voice/alignment.js) but is wired only as a *forced-alignment fallback* for TTS output (gated by `forcedAlignmentFallback: true`). It already returns word-level timings in our normalised alignment contract. **Reuse it** behind a new `POST /api/transcribe` route. Azure Speech-to-Text is *not* needed unless we want a second provider — Whisper already does the job and we already pay for it. |
| 4 | Transcript cleanup + caption-line splitting | **Exists** | [server/src/lib/captions.js](server/src/lib/captions.js) — `charAlignmentToWords`, `pickKeyword` (stopword-aware emphasis), `charsToWords` with 50ms floor. Line-wrapping for FFmpeg drawtext is in [server/src/routes/render.js:88-107](server/src/routes/render.js#L88-L107). |
| 5 | Kinetic typography render | **Exists** | [server/src/lib/videoFilters.js](server/src/lib/videoFilters.js) — 10+ `TYPOGRAPHY_PRESETS` with `lineEnter` (fade / rise-fade) and `wordReveal` (fade / rise-fade / scale-fade). Picker UI already merged at [client/src/components/voicelab/AnimationPicker.tsx](client/src/components/voicelab/AnimationPicker.tsx) and surfaced on Render (commit `d581698`). |
| 6 | Background image/video selection | **Exists** | Library + Pexels/Pixabay routes; `backgroundPath` accepted across render endpoints; `-stream_loop -1` for short backgrounds. |
| 7 | Music bed: volume, fade, loop, **auto-ducking** | **Exists** | [server/src/routes/jobs.js:422-470, 581-640, 781+](server/src/routes/jobs.js#L422-L470) — `musicPath`, `musicVolume`, `autoDuck` params resolve a music asset, then build a `sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2` filter chain, then `amix=inputs=2:duration=shortest`. Used by `/video`, `/waveform`, and `/timeline` job handlers. |
| 8 | Render mode: audio + background + captions | **Exists** | `POST /api/render/video` and `POST /api/render/waveform` ([server/src/routes/render.js](server/src/routes/render.js)). |
| 9 | Render mode: original video + captions overlaid | **Missing** | No route today takes a user-uploaded video as the visual layer; render.js treats `backgroundPath` as a *looped* background, not as a primary source whose own timeline is preserved. New code, but small — same FFmpeg drawtext chain, just drop the loop and drive duration from the input. |
| 10 | Timeline UI with layers (Speech / Captions / Background / Music) | **Partial** | [client/src/pages/TimelinePage.tsx](client/src/pages/TimelinePage.tsx) exists and is real: it has clips, background picker, fade in/out, LUFS normalize, de-ess, render + preview against `/api/audio-adv/timeline-preview`. What's missing: a **captions layer**, a **music layer** (the audio-adv timeline today is for assembling spoken clips), and a **video source layer**. The page is the right shell — needs more layers, not a rewrite. |
| 11 | FFmpeg pipeline for extract / mix / burn-in | **Exists** | Used throughout `jobs.js`, `render.js`, `audio_advanced.js`, `media.js`. `FFMPEG_PATH` and `FFPROBE_PATH` env vars supported. |
| 12 | Async job model for long renders | **Exists** | [server/src/routes/jobs.js](server/src/routes/jobs.js) — same place auto-ducking lives. New work plugs into existing job types. |

## What to actually build

Given the table above, the *minimum* delta to ship "Sermon Clip Studio":

1. **`POST /api/transcribe`** — accept an uploaded audio/video path, call Whisper via existing `alignment.js` machinery (extract audio with FFmpeg first if video), return our normalised `{ audioPath, words: [{ text, startMs, endMs }] }` contract. ~80% of this is already written; the missing piece is the *public* entry point and the video→audio extraction step.
2. **`POST /api/render/captioned-video`** — sibling of `/api/render/video` that takes a user video as the *primary visual* (no loop, duration from input), and burns the kinetic-typography drawtext chain on top using the same `TYPOGRAPHY_PRESETS`.
3. **Upload route for video sources** — confirm whether `media.js` already accepts MP4 uploads via `/upload-audio` (it normalises to MP3, which is *wrong* for video sources). Likely needs a separate `POST /upload-source-video` that preserves the file.
4. **TimelinePage extension** — add (a) a "Source media" card that accepts audio *or* video, (b) a "Transcribe & Caption" action that calls the new transcribe route, surfaces editable lines, then hands them to the render route, (c) a music-bed slot that maps to the existing `musicPath / musicVolume / autoDuck` params, (d) a typography preset picker (reuse `AnimationPicker`).
5. **Auto-ducking exposure** — already on the server; just expose the toggle + slider in the TimelinePage UI.

What we explicitly **don't** need:

- Azure Speech-to-Text. Whisper is already integrated, already returns timestamps, already normalised. Adding a second STT provider is yield-negative until Whisper limits hurt us.
- A new FFmpeg layer. The filter graphs already exist.
- A new typography engine. `TYPOGRAPHY_PRESETS` covers the kinetic styles the proposal asks for.
- A new timeline page. `TimelinePage.tsx` is the shell; extend it.

## Risks & open questions

- **Whisper cost on uploads.** Forced alignment today runs on short TTS clips. A 45-minute sermon transcription is a different cost shape — needs per-user quota (the `usageStore` + `quota` middleware already exists, so this is a config decision, not new infrastructure).
- **Whisper context length.** Whisper has a 25 MB upload limit per request. Long sermons need to be chunked, transcribed in parallel, and stitched. New work, but small.
- **Video upload size.** `MAX_INPUT_MB` is enforced in jobs.js for music/audio — confirm the same gate applies (and is appropriate) for source video uploads. Mobile-shot sermon videos can easily exceed 100 MB.
- **Storage.** User-uploaded sermons (audio + video) need a per-user directory; verify `userScope` middleware already covers media routes.
- **"Auto-ducking" UX.** The server uses a fixed `sidechaincompress` curve. If users complain the duck is too aggressive/soft we'll want to expose threshold/ratio — not now.

## Naming

The proposal offers "Sermon Clip Studio" or "Speech-to-Video Studio". The first is on-brand for the sermon-repurposing audience the [public multitenancy roadmap](2026-05-26-public-multitenancy-design.md) is targeting; the second describes the mechanic. Recommend **Sermon Clip Studio** as the user-facing name and `sermon-clip` as the internal route prefix.

## Next step

If this scoping is accepted, the implementation plan goes in `docs/superpowers/plans/2026-05-28-sermon-clip-studio.md` and is structured around the five deltas in the "What to actually build" section.
