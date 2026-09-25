# Ambient Scripture Video — Phase 2 Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A music-first render: an assembled music bed, scripture spoken over it at
intervals, one still per movement, one ffmpeg pass.

**Spec:** `docs/superpowers/specs/2026-09-22-ambient-scripture-video-design.md`

## Global Constraints

- Production ffmpeg is **5.1**. Build the graph as a string and convert with
  `toFilterScriptArgs(args, outPath)` before spawning. Never emit inline
  `-filter_complex`. Allowed filters: `acrossfade`, `adelay`, `apad`, `amix`
  (with `normalize=0`, available since 4.4), `sidechaincompress`, `atrim`,
  `volume`, `scale`, `crop`, `setsar`, `fps`, `zoompan`, `xfade`, `drawtext`.
- Scripture is **never** LLM-generated. Text comes verbatim from
  `lookupVerses(reference, translation)`. Default translation `'kjv'`.
- All route I/O goes through `req.ctx.dataDir` / `req.ctx.outputDir`.
- No unattended public uploads. Rendering produces a file; publishing stays manual.
- Server tests run with a **glob**, never a bare directory.

## Route contract (server and client both build to this)

| Route | Body | Returns |
|---|---|---|
| `POST /api/ambient` | `{ title, theme, targetSec, aspect }` | `{ ok, project }` |
| `GET /api/ambient` | — | `{ ok, projects: [{projectId,title,status,updatedAt}] }` |
| `GET /api/ambient/:id` | — | `{ ok, project }` |
| `DELETE /api/ambient/:id` | — | `{ ok }` |
| `POST /api/ambient/:id/plan` | `{ count? }` | `{ ok, project }` — fills `drops[]` with references + times |
| `PATCH /api/ambient/:id/drops` | `{ drops: [{id?,atMs,reference,translation?}] }` | `{ ok, project }` |
| `POST /api/ambient/:id/voice` | — | `{ ok, project }` — lookup + synth pending drops |
| `PATCH /api/ambient/:id/bed` | `{ mode, trackRefs?, filePath?, volume?, crossfadeSec?, allowUncleared? }` | `{ ok, project }` or `409 { ok:false, error, uncleared:[…] }` |
| `POST /api/ambient/:id/images` | `{ force? }` | `{ ok, project }` |
| `PATCH /api/ambient/:id/captions` | caption settings | `{ ok, project }` |
| `POST /api/ambient/:id/render` | — | `{ ok, jobId }` |
| `POST /api/ambient/:id/cancel` | — | `{ ok }` |

`project` shape is the spec's data model.

---

### Task 1: `lib/ambient/projectStore.js`

**Files:** Create `server/src/lib/ambient/projectStore.js`, test
`server/src/lib/ambient/projectStore.test.js`

Mirror `lib/story/projectStore.js`: `createProject`, `readProject`,
`writeProject`, `listProjects`, `deleteProject`, atomic temp+rename writes,
projects at `<dataDir>/ambient/<projectId>.json`. Re-export
`normaliseCaptionSettings` from the Story store rather than reimplementing.

Defaults: `targetSec: 7200`, `aspect: 'landscape'`, `translation: 'kjv'`,
`bed: { mode:'assemble', trackRefs:[], crossfadeSec:6, volume:0.85,
allowUncleared:false }`, `motion:'still'`, `captions:'none'`,
`duck: { threshold:0.02, ratio:8, attackMs:20, releaseMs:800 }`.

### Task 2: `lib/ambient/bedAssembly.js`

**Files:** Create `server/src/lib/ambient/bedAssembly.js` + test.

- `orderTracks(tracks, targetSec, rng)` — cycle a shuffled list, reshuffle each
  pass, **never place a track adjacent to itself across the seam**, stop once
  cumulative duration (minus crossfade overlap) ≥ targetSec.
- `bedHash({ trackRefs, crossfadeSec, targetSec })` — sha256.
- `buildBedArgs(files, { crossfadeSec, targetSec, outPath })` — chained
  `acrossfade=d=N` pairs, then `atrim=0:targetSec`, via `toFilterScriptArgs`.
- Cache: if `bed.builtHash` matches and `bed.builtPath` exists, skip.

Total duration of an N-track chain with crossfade d is
`sum(durations) - (N-1)*d` — the ordering must account for that or the bed
comes up short.

### Task 3: `lib/ambient/drops.js`

**Files:** Create `server/src/lib/ambient/drops.js` + test.

- `defaultDropTimes(targetSec, intervalSec = 900)` — first drop at
  `intervalSec`, then every `intervalSec`, none within the final 60s.
- `normaliseDrops(input)` — sort by `atMs`, assign ids, clamp to `[0,targetSec)`.
- `voiceDrops(project, { dataDir, lookupVerses, synthesize, probe })` — per drop:
  verbatim lookup → synthesize → probe duration. A failure marks that drop
  `status:'error'` and the rest continue.

### Task 4: `lib/ambient/movements.js`

**Files:** Create `server/src/lib/ambient/movements.js` + test.

`deriveMovements(project)` — one movement per drop by default, spanning from the
midpoint before to the midpoint after, first starting at 0 and last ending at
`targetSec`. Zero drops → one movement covering the whole runtime.
`imagePrompt` from theme + verse reference.

### Task 5: `lib/ambient/ambientRender.js`

**Files:** Create `server/src/lib/ambient/ambientRender.js` + test.

`buildAmbientFfmpegArgs(project, { bedPath, images, drops, outPath })` returning
`{ args, filter }`. Input order is fixed and load-bearing:

```
inputs 0..K-1  images   (-loop 1 -t <movementSec> -i <file>)
input  K       bed      (-i <bedPath>)
inputs K+1..   drops    (-i <dropAudio>)
```

Video: scale/crop to frame, `setsar=1`, `fps=24`; `motion:'drift'` adds
`kenBurnsVariedFilter(w,h,dur,24,...)` — **pass 24 explicitly**, the default 30
runs the drift at the wrong speed; movements joined with `xfade`.

Audio, per the spec:

```
[K:a]atrim=0:T,volume=<bed.volume>[bed];
[K+1+i:a]adelay=<atMs>|<atMs>,apad=whole_dur=<T>[d<i>];
...amix=inputs=M:normalize=0:duration=shortest[voice];
[voice]asplit=2[vc][vm];
[bed][vc]sidechaincompress=threshold=..:ratio=..:attack=..:release=..[ducked];
[ducked][vm]amix=inputs=2:normalize=0:duration=first[aout]
```

Zero drops → no voice chain, bed straight to `[aout]`. One drop → no first
`amix`. Encode `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 24
-c:a aac -b:a 192k -movflags +faststart`.

### Task 6: `routes/ambient.js`

**Files:** Create `server/src/routes/ambient.js` + test; mount in `server/index.js`.

Every handler reads `req.ctx`. Licence gate on `PATCH /bed`: any track with
`licence: 'unknown'` → `409 { ok:false, error, uncleared:[…] }` unless
`allowUncleared: true`. Render goes through `renderJobs`
(`createJob`/`markRunning`/`markProgress`/`attachProc`/`markDone`/`markError`).

### Task 7: Client

**Files:** Create `client/src/lib/ambientApi.ts`, `client/src/lib/ambientTypes.ts`,
`client/src/pages/AmbientPage.tsx` + tests; route `/app/ambient` in `App.tsx`.

Four steps: **Sound** → **Word** → **Look** → **Render**. Reuse `MusicPicker`,
`StoryCaptionsPanel`, `RenderProgressOverlay`.

### Task 8: End-to-end evidence

Render a short ambient video (~6 min, drops every ~2 min) through the real
pipeline and confirm: bed audible throughout, verse audible at each drop time,
bed ducks under the voice, picture changes per movement.
