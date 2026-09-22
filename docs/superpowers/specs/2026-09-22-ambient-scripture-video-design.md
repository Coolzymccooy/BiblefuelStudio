# Ambient Scripture Video — design

**Date:** 2026-09-22
**Status:** proposed, awaiting operator review
**Branch context:** written on `feat/youtube-longform`, but independent of it

## What this is

A build that produces a ~2-hour soaking/prayer video: calm gospel instrumental
throughout, with roughly eight scripture drops spaced about fifteen minutes
apart. At each drop a verse is spoken over the bed, the bed ducks and lifts
around it, the verse appears on screen, and the picture changes.

The reference the operator brought is *"The Secret Place: Prophetic Worship
Music | Intercession Prayer Instrumental"* (Jacob Agendia, 2M views). The
neighbouring shelf is bigger still — a 4:10:26 instrumental at 17M views, a
2:00:44 worship set at 1M. These videos are almost always a single still image
over an unbroken music bed.

Our difference is the Word, placed deliberately and shown on screen, using the
caption machinery this repo already has. Less script, not more: the music is
the product and the scripture is the punctuation.

## Why a new project type

Approach A of three considered. The alternatives were a `kind: 'ambient'` mode
inside `StoryProject`, and a Timeline preset rendered by the proof renderer.

Both were rejected for the same underlying reason: **this inverts the audio
graph**. Every render today ends the mix when narration stops —
`storyRender.js:313` mixes `[v2][ducked]amix=inputs=2:duration=first` with the
*voice* as the first input, because narration drives the timeline. Here the bed
drives it and eight brief voice drops are guests inside it, so the same line
becomes `[ducked][voice]amix=inputs=2:duration=first` with the *bed* first.

That is a small diff and a large semantic change. Bending `StoryProject` to
carry it would push music-first special cases into every Story render path —
which is exactly how caption handling fragmented into three divergent copies
that had to be reunified. The runtime is also ~40× anything the Story renderer
has been asked to encode.

So: a sibling project type that reuses the shared libraries and owns its own
store, routes and renderer.

**Reused unchanged:** `musicLibrary`, `lookupVerses` (`bible/scriptureApi.js`),
`voice/index.js` `synthesize`, `imageGen/imageLibrary`, `videoFilters` (captions
and typography), `story/projectStore.js` `normaliseCaptionSettings`,
`renderJobs`, `probeAudioDurationSec` and `toFilterScriptArgs` from
`story/storyRender.js`, `kenBurnsVariedFilter`.

## Scope

**In:** the build described above; a per-tenant music library with uploads and
licence tags; theme-suggested verse references the operator edits; one image per
movement, library-first; on-screen verse captions; render with progress and
cancel; the existing YouTube publish panel.

**Out:** AI-composed music (no provider exists in this codebase — verified, no
MusicGen/Suno/Stable Audio integration anywhere); video backgrounds for
movements; multi-language; scheduling or auto-publishing.

## Global constraints

- Scripture is **never** LLM-generated. The model may suggest *which*
  references; the words come verbatim from `lookupVerses(reference, translation)`.
- Production ffmpeg is **5.1**. Use `-filter_complex_script` via
  `toFilterScriptArgs`, never inline `-filter_complex`. Every filter used here
  (`acrossfade`, `adelay`, `amix`, `sidechaincompress`, `zoompan`, `xfade`,
  `drawtext`) exists in 5.1.
- All route I/O goes through `req.ctx.dataDir` / `req.ctx.outputDir`. No shared
  global paths.
- No unattended public uploads. Rendering produces a file; publishing stays a
  deliberate operator action.

## Data model

Projects live at `<dataDir>/ambient/<projectId>.json`, mirroring the Story store.
New module `server/src/lib/ambient/projectStore.js` with the same shape of API
(`createProject`, `readProject`, `writeProject`, `listProjects`, `deleteProject`).

```js
{
  projectId, title, theme, translation,        // theme drives verse suggestion
  targetSec: 7200,
  aspect: 'landscape',
  status: 'draft' | 'voicing' | 'assembling' | 'generating_images'
        | 'ready_to_render' | 'rendering' | 'done' | 'error',

  bed: {
    mode: 'assemble' | 'file',   // assemble from tracks, or one uploaded mix
    trackRefs: [],               // resolved order when mode === 'assemble'
    filePath: null,              // the uploaded mix when mode === 'file'
    crossfadeSec: 6,
    volume: 0.85,                // bed sits loud; it is the product
    builtPath: null,             // cached assembly output
    builtHash: null,             // sha256(trackRefs + crossfadeSec + targetSec)
    allowUncleared: false,       // operator acknowledged an unknown licence
  },

  drops: [{
    id, atMs, reference, translation,
    text: null,                  // verbatim, filled by lookupVerses
    voiceId, audioPath: null, durationMs: null,
    status: 'pending' | 'done' | 'error', error: null,
  }],

  movements: [{
    id, startMs, endMs,
    imagePrompt, imagePath, imageUrl,
    imageStatus, imageError,
    imageSource, imageLibraryId, imageReuseScore,   // same fields Story scenes carry
  }],

  motion: 'drift' | 'still',     // slow zoompan, or no motion at all
  captions: 'kinetic' | 'static' | 'none',
  captionPreset, captionMotion, captionLayout,
  captionDepth, captionStagger, captionHighlight,   // via normaliseCaptionSettings

  duck: { threshold, ratio, attackMs, releaseMs },   // sidechaincompress units: threshold is linear, not dB
  render: { jobId, outputPath, status, percent, phase },
  error, createdAt, updatedAt,
}
```

## Music library with uploads

Today `musicLibrary.js:17` is a hardcoded array of 23 bundled tracks under
`server/assets/music/`, exposed read-only by `GET /api/music/library`. The whole
library is roughly seventy minutes, so a two-hour bed cannot be built from it
without repetition, and there is no way to add a track.

A per-tenant index at `<dataDir>/musicLibrary.json` holds uploaded tracks:

```js
{ id, label, mood, file, durationSec, source: 'upload',
  licence: 'cleared' | 'unknown' | string, addedAt }
```

The bundled 23 are merged in at read time with `source: 'bundled'` and
`licence: 'pixabay-cleared'`; they are never written to the tenant index and
cannot be deleted.

**Licence gate.** Assembling a bed that includes any `licence: 'unknown'` track
returns `409` with the offending track list unless the request carries
`allowUncleared: true`. The operator can always proceed — this warns, it does
not forbid. The reason is specific: on a two-hour video that is almost entirely
music, a Content ID claim takes the revenue for the *whole* video, not a
segment, and repeat claims put the channel itself at risk.

**Routes** (`server/src/routes/music.js`):

- `GET /api/music/library` — merged bundled + tenant, each with `source` and `licence`
- `POST /api/music/upload` — registers a file already uploaded through
  `POST /api/media/upload-audio`, or through the resumable
  `upload-session`/`upload-finalize` pair for anything past Cloudflare's 100 MB
  body cap (a two-hour mix will be)
- `PATCH /api/music/:id` — label, mood, licence
- `DELETE /api/music/:id` — tenant uploads only

## Audio pipeline

Three ways in, all on the same build:

1. **Assembled bed** — two hours needs more track-minutes than most libraries
   hold, so repetition is a question of *how*, not *whether*. Cycle through a
   shuffled list, reshuffle on each pass, and never place a track adjacent to
   itself across the seam. Chain them with `acrossfade=d=<crossfadeSec>` until the total
   passes `targetSec`, then trim to length. Durations come from
   `probeAudioDurationSec`. The result is cached at `bed.builtPath` keyed by
   `bed.builtHash`, so re-rendering does not re-assemble.
2. **Uploaded mix** — `mode: 'file'`. Assembly is skipped entirely; the file is
   the bed. If it is shorter than `targetSec` it loops with `-stream_loop -1`,
   the same way Story loops music today.
3. **Explicit order** — `mode: 'assemble'` with `trackRefs` set by hand rather
   than shuffled, for a build where the operator wants a specific run.

**Drops.** For each entry: `lookupVerses(reference, translation)` for the
verbatim text, then `synthesize({ text, voiceId })` for the audio, then
`probeAudioDurationSec`. Default placement is every fifteen minutes; the
operator may retime any drop. A drop whose lookup or synthesis fails is marked
`status: 'error'` and the build continues — eight drops should not be held
hostage by one bad reference.

**Ducking.** The drops are offset with `adelay` and mixed into a single
full-length sparse voice track, which then both drives the sidechain and joins
the final mix — the same idiom Story already uses, with the inputs reversed so
the bed sets the length:

```
[voice]asplit=2[vc][vm];
[bed]volume=<volume>[b1];
[b1][vc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=800[ducked];
[ducked][vm]amix=inputs=2:duration=first:dropout_transition=2[aout]
```

## Visual pipeline

One still per movement — by default one movement per drop, so the picture
changes as the Word arrives. Prompts are built from the theme and the verse;
images come from `findReusableImages` first and are generated only on a miss,
so a build usually costs no image quota. `registerImage` harvests anything new,
`markUsed` prevents the same picture appearing twice in one video.

`motion: 'drift'` gives each movement a very slow `kenBurnsVariedFilter` pass,
which takes fps as an argument and defaults to 30 — it must be passed the same
24 the encoder uses, or the drift runs at the wrong speed;
`motion: 'still'` skips motion entirely, which is both the cheapest encode and
exactly what the reference video does. Movements cross-dissolve with `xfade`.

Captions are burned only where there is something to say — the verse text, timed
to its drop, through the shared builder with the project's caption settings.

## Render

One ffmpeg pass, assembled the same way Story's is and converted with
`toFilterScriptArgs` before spawning. Encoding settings:
`-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 24`,
`-c:a aac -b:a 192k`, `-movflags +faststart`. Static content compresses hard; a
two-hour 1080p file should land near 1–1.5 GB.

Progress, cancellation and persistence go through `renderJobs`
(`createJob`/`markRunning`/`markProgress`/`markDone`/`markError`/`attachProc`),
so the existing overlay and cancel button work unchanged.

**Encode time is the main cost and is not yet measured.** Two hours of drifting
stills is expected to take roughly 10–40 minutes on the production box; `still`
motion should be far faster. If `drift` proves painful there is a fallback —
re-encode only the segments carrying captions and stream-copy the rest via the
concat demuxer — but it is deliberately **not** in this design. Measure first.

## Routes

`server/src/routes/ambient.js`, every handler through `req.ctx`:

| Route | Does |
|---|---|
| `POST /api/ambient` | create `{ title, theme, targetSec, aspect }` |
| `GET /api/ambient` / `GET /api/ambient/:id` / `DELETE /api/ambient/:id` | list, read, delete |
| `POST /api/ambient/:id/plan` | suggest verse *references* for the theme, spaced across the runtime |
| `PATCH /api/ambient/:id/drops` | add, remove, reorder, retime, re-reference |
| `POST /api/ambient/:id/voice` | verbatim lookup + synthesis for every pending drop |
| `PATCH /api/ambient/:id/bed` | mode, tracks, uploaded file, volume, crossfade, `allowUncleared` |
| `POST /api/ambient/:id/images` | movement images, library-first; `force` regenerates |
| `PATCH /api/ambient/:id/captions` | reuses `normaliseCaptionSettings` |
| `POST /api/ambient/:id/render` / `POST /api/ambient/:id/cancel` | render, cancel |

## Client

A new page, `client/src/pages/AmbientPage.tsx`, in four steps: **Sound** (bed
mode, tracks, upload, licence warnings) → **Word** (theme, suggested verses,
edit and retime) → **Look** (movement images, caption panel) → **Render**.

Reused: `MusicPicker` (extended for uploads and licence badges),
`StoryCaptionsPanel`, `RenderProgressOverlay`, the done panel and
`YoutubePublishPanel`.

## Failure handling

- A failed drop marks itself and the build continues; the page offers a retry
  for failed drops only, the way failed images already work.
- A failed image leaves the movement showing the previous picture rather than
  black, and is retryable.
- Bed assembly failure is fatal to the build and reported as such — there is no
  video without it.
- A render interrupted by a server restart is recovered by
  `reconcilePersistedJobs`, as Story's are.

## Testing

Server, `node:test` with a glob (never a bare directory):

- bed assembly: order, no adjacent repeats, total ≥ target, crossfade maths,
  cache hit on an unchanged hash
- drop placement: default cadence, custom times, out-of-order input
- ducking graph: bed leads the mix (`duration=first` with the bed first), voice
  offsets correct, one drop and zero drops both build
- licence gate: unknown licence → 409, `allowUncleared` → proceeds
- filter script: no inline `-filter_complex` survives to the spawn
- routes with supertest, including tenant isolation of the music index

Client, Vitest: the four-step page, the licence warning, drop editing, and that
the captions panel patches through.

## Build order

Two phases, because the first is independently useful and independently
shippable — Story Video and Timeline builds can draw on an uploaded music
library the day it exists, whether or not the ambient build ever ships.

**Phase 1 — music library with uploads and licence tags.** The per-tenant
index, the upload and edit routes, the merged listing, the licence gate, and
the `MusicPicker` changes. Ends with the operator able to upload a track and
pick it in any existing build.

**Phase 2 — the ambient build.** Project type, bed assembly, drops, ducking,
movements, renderer, routes, page.

Each phase gets its own implementation plan.

## Risks and open questions

1. **Encode time** — unmeasured; the first task in the plan is a timing probe on
   a short build extrapolated to two hours.
2. **YouTube upload size** — whether the existing publish path handles ~1.3 GB
   is not verified. Task one of the plan reads `routes/social.js` and the
   YouTube client for a resumable upload, and if there is none, adding it is a
   task in this plan rather than a discovery made after a two-hour render.
3. **Content ID** — a product risk, not an engineering one. The licence gate
   surfaces it; it cannot remove it.
4. **Long filter chains** — ~40 chained `acrossfade` nodes plus eight `xfade`
   transitions is well within ffmpeg's limits but should be sanity-checked on
   the real prod binary rather than assumed from the dev 8.x build.
