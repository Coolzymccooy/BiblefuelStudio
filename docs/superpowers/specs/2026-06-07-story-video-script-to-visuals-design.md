# Story Video (Script-to-Visuals) — Design

**Date:** 2026-06-07
**Status:** Approved design — ready for implementation planning
**Author:** Brainstormed with Claude

## Summary

A new **Story Video** feature that turns an uploaded sermon/audio file into a
captioned, AI-illustrated vertical video. The user uploads audio; the system
transcribes it, segments the transcript into semantic scenes, writes a
style-anchored image prompt per scene, generates the images, lets the user
review/edit the scenes at a single checkpoint, then renders an MP4 using the
existing captioned-video pipeline.

This is **~80% reuse** of systems BibleFuel Studio already ships (Whisper
transcription, multi-provider image generation, FFmpeg render pipeline, kinetic
captions, TTS/music mixing, SSE progress). The genuinely new pieces are: an LLM
**scene segmenter**, a persisted **project document** model, and a
**durability** layer so long renders survive redeploys.

## Goals

- Upload sermon/audio → reviewable scene list → MP4, with one human checkpoint.
- Reuse existing transcription, image-gen, render, caption, and audio systems.
- No new paid vendor — reuse existing `OPENAI_API_KEY` / `GEMINI_API_KEY`.
- Make the expensive work (transcription, image generation) durable so a
  redeploy mid-job never wastes it. This also fixes the class of render failure
  hit previously when transcribing a ~4-min MP3 and rendering with images.

## Non-Goals (v1)

- Real generative AI **video** (Runway/Kling/Sora). Images + motion only.
- Parallax depth layers, custom-easing transitions, particle effects.
- A Redis/BullMQ persistent queue (durability achieved via cached artifacts +
  restart-aware render instead).
- Typed-script / queue-script entry points (audio upload is the v1 entry).
- More than 4 visual style presets (others are trivial to add later).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Primary input | Audio/sermon upload |
| Control level | Auto everything; **one** review checkpoint at the scene list |
| UI home | New dedicated wizard page (`/app/story`) |
| Scene pacing | Semantic, ~6–10s per scene (≈25–40 images for a 4-min clip) |
| LLM | gpt-4o-mini primary → gemini-2.0-flash fallback (existing keys) |
| Job durability | Harden: cached artifacts + restart-aware resumable render |
| Style presets (v1) | Cinematic Bible, Modern Devotional, Heavenly Atmosphere, Ancient Scripture |

## Architecture

A **Story Video Project** is a persisted JSON document that every pipeline stage
reads and writes. Stages are idempotent and cache their output into the project,
so the only fragile step (FFmpeg) operates entirely on already-cached inputs.
Re-running the encode after an interruption is cheap because nothing upstream
re-runs.

### Storage

- Project doc: `DATA_DIR/users/<userId>/story-projects/<projectId>.json`
  (super-admin uses the legacy global path, consistent with existing
  multi-tenancy).
- Generated assets: `OUTPUT_DIR/story/<projectId>/` — uploaded audio,
  `scene-001.png`…, final `video.mp4`.

### Project document

```jsonc
{
  "projectId": "uuid",
  "userId": "...",
  "title": "Trusting God in the Waiting",
  "status": "draft | transcribing | segmenting | generating_images | ready_to_render | rendering | done | error",
  "style": "cinematic-bible",
  "source": { "audioPath": "...", "durationMs": 240000 },
  "transcript": { "words": [ { "text": "...", "startMs": 0, "endMs": 380 } ], "hash": "sha256" },
  "scenes": [
    {
      "id": "scene-001",
      "text": "When life feels dark...",
      "startMs": 0, "endMs": 8200,
      "imagePrompt": "A lone figure in rain at dusk, cinematic lighting, 9:16",
      "imagePath": "scene-001.png",
      "imageStatus": "pending | generating | done | error",
      "promptEditedByUser": false
    }
  ],
  "music": { "path": null, "volume": 0.3 },
  "captionPreset": "cinematic-default",
  "render": { "jobId": null, "outputPath": null },
  "createdAt": 0, "updatedAt": 0
}
```

Rationale:
- `transcript.hash` lets re-segmentation skip re-transcribing identical audio.
- Each scene owns `imagePath` + `imageStatus`, so per-scene regenerate is a
  one-cell update and a killed render never loses generated images.
- `promptEditedByUser` protects hand-tuned prompts from "regenerate all".
- `captionPreset` / `style` reuse existing systems (layoutOptions, image-gen
  style anchors) rather than inventing new ones.

### New server modules

| Module | Responsibility | Reuses |
|---|---|---|
| `lib/story/projectStore.js` | CRUD + atomic write of project doc | paths.js, multi-tenant dir |
| `lib/story/sceneSegmenter.js` | transcript → scenes + prompts via LLM | generateScripts.js LLM pattern |
| `lib/story/storyRenderAdapter.js` | scenes → existing `/captioned-video` args | backgroundSequence.js, render.js |
| `routes/story.js` | wizard endpoints | transcribe.js, imagegen.js, renderJobs |

Segmenter and adapter are pure transforms (unit-testable without I/O); store and
route are the I/O boundary.

## Pipeline Stages

Each stage advances `status`, writes its result into the project, and is safe to
re-run. A reloaded project continues from wherever `status` left off.

```
POST  /api/story/projects                              create draft → projectId
POST  /api/story/projects/:id/transcribe               audio → Whisper → transcript (reuses transcribe.js)
POST  /api/story/projects/:id/segment                  transcript → scenes + prompts (sceneSegmenter)
POST  /api/story/projects/:id/images                   generate images for all pending scenes (reuses imagegen)
POST  /api/story/projects/:id/scenes/:sid/regenerate   one scene's image (or edited prompt)
PATCH /api/story/projects/:id/scenes/:sid              edit scene text/prompt (sets promptEditedByUser)
POST  /api/story/projects/:id/render                   storyRenderAdapter → /captioned-video job
GET   /api/story/projects/:id                          poll full project (status + scenes + image statuses)
```

### Scene segmenter contract (`sceneSegmenter.js`)

- **Input:** transcript word array (text + timings) + chosen `style`.
- **LLM job:** group consecutive words into semantic scenes (~6–10s each,
  snapped to phrase boundaries so we never cut mid-thought), and emit a vivid,
  style-anchored image prompt per scene.
- **Output (validated JSON):**
  ```jsonc
  { "scenes": [ { "text": "...", "startWordIndex": 0, "endWordIndex": 14, "imagePrompt": "..." } ] }
  ```
- **Timing derivation:** `startMs`/`endMs` are computed from the referenced word
  indices — the LLM picks boundaries, never invents timings. Keeps captions
  perfectly synced to existing word-level timing.
- **Style anchor:** a per-style suffix (e.g. *"cinematic biblical oil-painting,
  warm light, 9:16, no text"*) appended to every prompt so all images look like
  one coherent video. Reuses the deterministic-anchor idea in
  `imageGen/prompt.js`.
- **Provider:** gpt-4o-mini primary → gemini-2.0-flash fallback (same dual
  pattern as `generateScripts.js`), forced JSON output, schema-validated.
- **Deterministic fallback:** on total LLM failure or invalid JSON, split the
  transcript into fixed ~8s windows with a generic style prompt, so the feature
  degrades instead of dead-ends.

### Image generation over N scenes

Loops scenes, calls the existing image generator with cache key
`{projectId, sceneId}`. Already-`done` scenes are skipped (idempotent).
`promptEditedByUser` scenes regenerate only on explicit request. The existing
4-image cap lives in render assembly, not the generator — it is lifted in
`storyRenderAdapter` so all scenes render.

## Wizard UI

New page `client/src/pages/StoryVideoPage.tsx` at route `/app/story` (added to
App.tsx nav). Three steps, driven by the project `status` field, so a reload or
"come back later" lands the user exactly where they left off. State comes from
polling `GET /api/story/projects/:id` via TanStack Query (single source of
truth; no local mirror to drift).

### Step 1 — Upload & Setup

Drop an MP3/sermon + title + style picker (4 presets w/ thumbnails). "Create"
uploads audio and kicks off transcribe + segment + images automatically. A
single progress panel (reusing the SSE `RenderProgressOverlay` pattern) shows
*Transcribing… → Breaking into scenes… → Generating images…*. The user can
leave; the project persists.

### Step 2 — Review Scenes (the one checkpoint)

A vertical list of scene cards, each showing:
- Generated image thumbnail (spinner while `generating`, retry on `error`).
- Editable scene caption text.
- Collapsible "edit prompt" (editing sets `promptEditedByUser`).
- Per-card actions: **Regenerate image**, **Edit prompt then regenerate**,
  **Merge into neighbor** (delete a scene, extending the adjacent one's timing
  so audio stays fully covered).
- Read-only timing (`0:00–0:08`) derived from the audio.

Global controls: caption style preset dropdown (existing 11), optional
background-music upload + volume, **"Looks good → Render"** button.

### Step 3 — Render & Download

"Render" hands off to the durable job; progress via existing SSE. On done:
inline MP4 preview + download + (later) existing social-publish handoff. If the
user leaves mid-render, the project shows `status: rendering`; returning
re-attaches to the job or shows the finished file.

### UX guardrails

- Regenerating one image never touches others (per-scene cache key).
- "Regenerate all images" warns it skips hand-edited prompts unless opted in.
- Render button disabled until every scene has a `done` image (or the user
  explicitly chooses to render with a solid-color fallback for failures) — fail
  early, not after a 40s encode.

## Durability

The fix flows from `renderJobs.js`'s own note: *"a restart kills the ffmpeg
child anyway."* We don't make FFmpeg resumable — we make everything before it
durable and cached, so re-running the encode is cheap.

### Tier 1 — Expensive artifacts persist in the project doc

Transcript, scenes, and all generated images are written to disk + the project
JSON as they complete. A redeploy during transcription/segmentation/image-gen
loses at most the one in-flight step, because each stage is idempotent and
re-entrant: re-calling `/transcribe` sees an existing transcript hash and skips;
`/images` skips `done` scenes. The slow, costly work (Whisper, ~30 image
generations, LLM) is never repeated.

### Tier 2 — Restart-aware render job

Extend the existing job registry minimally (no Redis):
- Persist a thin job record to
  `DATA_DIR/users/<userId>/render-jobs/<jobId>.json` (status, percent,
  projectId, outputPath), written on each state transition — not every progress
  tick (progress % stays in-memory only, to avoid disk thrash).
- On server boot, a **reconciliation sweep** marks any job left in
  `running`/`queued` as `interrupted` (its FFmpeg child died with the process).
- The project, seeing `render.jobId` is `interrupted`, shows a clear
  **"Render was interrupted — Resume"** button. Resume re-calls `/render`, which
  rebuilds the FFmpeg command from the already-cached scenes/images and
  re-encodes. Fast, because nothing upstream re-runs.

Segment-level FFmpeg resume is intentionally out of scope — the encode is the
fast part once images exist; re-encoding from cached assets is the pragmatic
robust choice. Chunked encode is a clean future enhancement if renders grow
long.

## Error Handling

Validation at every boundary; every stage degrades to something usable rather
than dead-ending.

| Stage | Failure | Behavior |
|---|---|---|
| Upload | Non-audio / corrupt / >cap MB | Reject at boundary; no project state mutated. |
| Transcribe | Whisper error / empty | `status: error` + retry; saved audio reused on retry. |
| Segment | LLM both providers fail / invalid JSON | Deterministic ~8s-window fallback; banner notes auto-split. |
| Segment | Out-of-range word indices | Clamp to valid range + log; never crash timing derivation. |
| Images | One scene fails | That scene `imageStatus: error` + retry; others unaffected. |
| Images | Cloudflare daily quota exhausted | Surfaced explicitly; falls to Imagen if configured, else render with succeeded images + solid-color fallback. |
| Render | FFmpeg non-zero exit | Capture stderr tail into `render.error`; inputs stay cached so retry is cheap. |
| Render | Interrupted by redeploy | Reconciliation → `interrupted` → Resume. |

Cross-cutting:
- No silent swallows — every catch logs server context and sets a user-facing
  message on the project.
- Atomic project writes (temp file + rename) so a crash mid-write never corrupts
  the project JSON.
- Reuse existing quota/feature-gate middleware so Story Video respects plan
  limits.

## Testing

TDD, 80%+ target. Hard logic lives in pure functions that test without I/O.

### Unit (the bulk — pure transforms, LLM/network mocked)

- `sceneSegmenter`: timing derived from word indices; phrase-boundary snapping;
  out-of-range indices clamped; malformed LLM JSON → deterministic fallback;
  style anchor on every prompt; empty/1-word transcript edge cases.
- `storyRenderAdapter`: scenes → correct `/captioned-video` args; >4 scenes
  lifts the cap; timings map to background-sequence cut points; missing image →
  placeholder substitution.
- `projectStore`: atomic write (temp+rename); multi-tenant path resolution;
  idempotent re-write; corrupt-file read handling.
- Job reconciliation: `running`/`queued` on boot → `interrupted`; `done`/`error`
  untouched.

### Integration (endpoints, providers mocked)

- Happy path: create → transcribe → segment → images → render advances `status`
  and persists at each step.
- Re-entrancy (durability proof): `/transcribe` twice → second skips via hash;
  `/images` after partial completion → only `pending` scenes generate.
- Per-scene `/regenerate` touches only the target scene.
- Auth: a user cannot read/poll another user's project.

### E2E (Playwright, one critical flow)

Upload short fixture audio → scene review → edit one prompt + regenerate →
render → assert MP4 downloads. Providers stubbed for deterministic CI.

### Fixtures

A tiny committed fixture (few-second audio clip + canned Whisper word-array
JSON) so segmenter/adapter tests run offline and fast.

## Deployment Note

Per repo convention (`biblefuel-deploy-prebuilt-bundle`), client changes here
require `npm run build` + committing the built `server/public` bundle + push, or
the deployed UI stays stale.

## Reused Existing Systems (reference)

- Transcription: `server/src/routes/transcribe.js`, `lib/voice/alignment.js`
- Image gen: `server/src/routes/imagegen.js`, `lib/imageGen/*`
- Render: `server/src/routes/render.js` (`/captioned-video`),
  `lib/backgroundSequence.js`, `lib/kenBurns.js`
- Captions: `lib/captions.js`, `lib/videoFilters.js`, `client` layoutOptions
- Jobs/progress: `lib/renderJobs.js`, `components/RenderProgressOverlay.tsx`
- LLM pattern: `lib/generateScripts.js` (gpt-4o-mini + gemini-2.0-flash)
