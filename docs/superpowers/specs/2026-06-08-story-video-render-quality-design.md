# Story Video — Render Quality: Caption Sync + Music Bed — Design

**Date:** 2026-06-08
**Status:** Approved (triage root-caused + fix approved) — ready for implementation planning
**Batch A** of the Story Video render-quality fixes (sibling: Batch B = server-orchestrated pipeline).

## Summary

Two render fixes, both in the Story Video render path:

- **#2 (bug) — captions stop while the voice continues.** Root cause: each scene clip is built from its *word-span* (`endMs − startMs` of that scene's words), which **drops the silent gaps between scenes** and any lead-in, AND the output is capped at the last word's timestamp. So the concatenated video is **shorter than the voiceover** and ends early; the absolute-timed captions drift out of sync. Fix: make scenes **contiguous and audio-length-matched** so the video timeline equals the audio timeline and captions stay locked.
- **#3 (feature) — music bed + autoduck.** `storyRender` already accepts a music input but only does a flat low-volume mix and has no UI. Add a music upload + autoduck toggle to the Story Video UI, and port `render.js`'s proven `sidechaincompress` autoduck into `storyRender`.

## #2 — Caption sync fix

### Root cause (confirmed in code)

`storyRender.sceneSegmentsSec` computes each scene's clip duration as `(scene.endMs − scene.startMs)/1000` — the span of that scene's own words. Consecutive scenes have a gap (inter-word silence at the boundary: `nextScene.startMs − thisScene.endMs`), and the first scene may start at `> 0`. So:
- Concatenated video length = `Σ(scene.endMs − scene.startMs)` — **less than** the audio length.
- `totalDurationSec` (the `-t` cap) = `lastScene.endMs/1000` — also less than the true audio length if there's trailing audio.
- Captions are drawn over the (short) concatenated video using **absolute** word times, so they end early and desync.

### Fix

Display each scene from its start until the **next** scene starts, and stretch the last scene to the true audio end:
- `displayStart_0 = 0`, `displayStart_i = scene[i].startMs` (ms).
- Scene `i` clip duration = `displayStart_{i+1} − displayStart_i` (last scene → `audioDurationMs − displayStart_last`).
- Total video = `audioDurationSec`; output `-t = audioDurationSec`.

Now output-time = absolute-audio-time, scenes are gap-free and cover `[0, audioEnd]`, and the absolute-timed captions stay in sync for the whole clip. Ken Burns simply pans across the full (slightly longer, gap-inclusive) window.

**Signature change:** `buildStoryFfmpegArgs` and `runStoryRender` gain an `audioDurationSec` parameter. The `/render` route probes the audio duration (ffprobe — same util pattern as `render.js`) and passes it in. `sceneSegmentsSec(scenes, audioDurationSec)` returns the contiguous display durations.

**Guard:** if `audioDurationSec` is missing/invalid (probe failed), fall back to the old behaviour (`lastScene.endMs`) so a render never crashes — captions may end slightly early but the video still renders.

## #3 — Music bed + autoduck

### Backend

`buildStoryFfmpegArgs` gains `musicVolume` (0–1, default 0.3) and `autoDuck` (bool). When `musicPath` is present, build the audio chain like `render.js`:
- **autoDuck on:** `[voice]asplit=2[v1][v2]; [music]volume=<vol>[m1]; [m1][v1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked]; [v2][ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`.
- **autoDuck off:** `[voice]volume=1[a1]; [music]volume=<vol>[m1]; [a1][m1]amix=inputs=2:duration=first:dropout_transition=2[aout]`.
- No music → voice only (unchanged).

`duration=first` keeps the mix as long as the **voice** track (so a short music loop doesn't extend the video, and a long music bed is cut to the voice). The existing `-t audioDurationSec` caps the output.

The `/render` route reads `project.music = { path, volume }` plus a new `project.music.autoDuck` (or a render-body flag) and passes them through.

### Frontend

In the **review step** (Step 2, before "Render"), add a small **Music** control: an "Add background music" upload (reuses `storyApi.uploadAudio` / the existing `/api/media/upload-audio`), a volume slider (default 0.3), and an **Autoduck** checkbox (default on). Selecting music PATCHes the project's `music` ({ path, volume, autoDuck }) via a new `storyApi.setMusic(projectId, { path, volume, autoDuck })` → `PATCH /api/story/projects/:id/music`. A "remove music" clears it. The render then includes the bed.

## Architecture / data flow

Render: `/render` route → probe `audioDurationSec` → `runStoryRender({ scenes, words, audioPath, musicPath, musicVolume, autoDuck, audioDurationSec, width, height, outPath })` → `buildStoryFfmpegArgs` (contiguous scenes + ducked audio) → FFmpeg. Music is set earlier via the review-step control → `PATCH .../music` → stored on the project → used at render time.

## Error handling

- Probe fails → fall back to `lastScene.endMs` for the duration (render still works).
- Music upload fails → toast; project unchanged; render proceeds voice-only.
- `musicVolume` clamped to `[0,1]`; `autoDuck` coerced to boolean.
- Music shorter than voice → `amix duration=first` keeps the voice length (music simply stops); not an error.

## Testing

**Backend (node:test, `storyRender.test.js`):**
- `sceneSegmentsSec(scenes, audioDurationSec)`: scene `i` duration = `next.startMs − this.startMs`; first scene starts at 0; last scene extends to `audioDurationSec`; durations sum to `audioDurationSec`.
- `buildStoryFfmpegArgs`: output `-t` equals `audioDurationSec` (not `lastScene.endMs`); when `audioDurationSec` omitted → falls back to `lastScene.endMs`.
- Audio chain: with `musicPath` + `autoDuck:true` the filtergraph contains `sidechaincompress`; with `autoDuck:false` it contains `amix` and NO `sidechaincompress`; with `musicVolume` it sets `volume=<vol>`; no music → no `amix`.
- Existing trim/runaway guards still pass.

**Backend route (`story.test.js`):**
- `PATCH /:id/music` stores `{ path, volume, autoDuck }` on the project; clamps volume; clears on null path.

**Frontend (vitest):**
- Music control: upload sets music; volume slider + autoduck toggle PATCH the project; remove clears it. (Network mocked.)
- `storyApi.setMusic` issues the right PATCH.

**Live verify:** render a clip with a music bed + autoduck and **watch that captions track the voice to the very end** and the music ducks under speech.

## Reused Existing Systems

- `render.js` autoduck chain (`sidechaincompress` params), `/api/media/upload-audio`, `storyApi.uploadAudio`.
- The whole existing render builder, caption (`buildWordDrawtext`), and trim/runaway fixes.

## Deployment Note

Client changes → rebuild `server/public` + commit, or the deployed UI stays stale.
