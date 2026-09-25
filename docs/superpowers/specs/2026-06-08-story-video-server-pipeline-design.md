# Story Video — Server-Orchestrated Pipeline — Design

**Date:** 2026-06-08
**Status:** Approved (triage) — ready for implementation planning
**Batch B** of the Story Video render-quality fixes (sibling: Batch A = caption sync + music, done).

## Summary

**#1 (bug) — switching tabs loses an in-progress job.** Today the pipeline (transcribe → segment → generate-images) runs as sequential `await`s **in the browser**; only the final FFmpeg render is server-side. Navigating to another page abandons the in-flight chain. Fix: run the whole chain **server-side in the background** via a new `POST /:id/process`. The client kicks it off once and just polls; switching tabs, navigating away, even closing the laptop no longer stops it.

## Goals

- The transcribe→segment→images pipeline runs on the **server**, independent of the client staying mounted/foregrounded.
- The client kicks it off with one call, then polls status (it already polls).
- The pipeline is **re-entrant**: re-calling `/process` continues from wherever it stopped (so a server restart mid-pipeline is recoverable).
- Replace the "Resume during normal processing" false-positive with a **staleness-based** stall detector (Resume only when a job is genuinely stuck).

## Non-Goals

- A persistent job queue (Redis/BullMQ) — fire-and-forget background async + status persistence, matching the existing render job.
- Changing transcribe/segment/image internals (only where they run).

## Architecture

### Backend

**Extract the three stages into reusable helpers** in `routes/story.js` (or a new `lib/story/pipeline.js` — see below), each reading + writing the project and returning the updated project (throwing on hard failure), **re-entrant**:

- `transcribeStage(ctx, projectId, mediaPath)` — the current `/transcribe` body. **Skip** (just advance status to `segmenting`) if `project.transcript.words.length > 0`.
- `segmentStage(ctx, projectId)` — the current `/segment` body. **Skip** (advance to `generating_images`) if `project.scenes.length > 0`.
- `imagesStage(ctx, projectId)` — the current `/images` body (already idempotent: skips `done` scenes).

The existing `POST /:id/transcribe`, `/segment`, `/images` routes become thin wrappers calling these helpers (no behaviour change — keeps them for manual re-trigger + the existing tests).

**New `POST /:id/process`** body `{ mediaPath }`:
1. Validate project + `mediaPath` (same path-guard as `/transcribe`).
2. Respond **immediately** `{ ok: true }` (the work runs detached).
3. In a background async: `transcribeStage → segmentStage → imagesStage`, each persisting status as it goes (already the pattern). On any throw → `writeProject(status: error, error: msg)`. This is fire-and-forget exactly like the render.

Because every stage persists `updatedAt` and status, the polling client sees live progress, and a re-call of `/process` (Resume) safely continues (stages skip what's done).

> `ctx` = `{ dataDir, outputDir }` (from `req.ctx`) plus the module seams (`_transcribeFn`, `_imageGenFn`) the stages already use. Keeping the helpers in `story.js` lets them use those module-level seams directly; tests drive them via the existing `_setTranscribeImpl`/`_setImageGenImpl`.

### Frontend

- **`storyApi.process(projectId, mediaPath)`** → `POST /api/story/:id/process` (long timeout; returns on the immediate ack, not on completion).
- **`startPipeline(audioPath)`** changes from "create → transcribe → segment → images (awaited)" to:
  `createProject → setActive → storyApi.process(projectId, audioPath)` then **stop** — the server runs the rest; `useStoryProject` polling drives the UI. `busy` is set only for the brief create+kickoff, then cleared.
- **Stall detection** (`storyWizard.isStalled`) changes from `!busy && transient` to **staleness-based**: `transient && (nowMs − project.updatedAt) > STALL_MS` (e.g. 90s). During normal server processing `updatedAt` keeps advancing → no Resume banner; if the server died mid-pipeline, `updatedAt` goes stale → Resume shows. `isStalled` gains a `nowMs` param (deterministic for tests).
- **Resume** → re-call `storyApi.process(projectId, project.source.audioPath)` (re-entrant) instead of the old client chain.

### Data flow

Upload/script → audio path → `startPipeline`: `createProject` → `setActive` → `process(id, audioPath)` (returns immediately) → server runs transcribe→segment→images in the background, persisting status → client polls and renders progress → `ready_to_render` → review → render (already server-side).

## Error handling

- Background stage throws → project `status: error` + message; the polling UI shows the error banner; Resume re-runs `/process` (continues from the last good stage).
- `/process` path-guard rejects an out-of-scope `mediaPath` (same 403 as `/transcribe`).
- Server restart mid-pipeline → project stuck at a transient status; `updatedAt` goes stale → the staleness `isStalled` surfaces Resume.
- The detached async never rejects out of the request (wrapped in try/catch), so no unhandled rejection.

## Testing

**Backend (`story.test.js`):**
- `POST /:id/process` happy path (transcribe/segment/image seams mocked): responds `{ok:true}` immediately, and after the background work settles the project reaches `ready_to_render` with scenes + images. (Await a short tick / poll the project in the test.)
- Re-entrancy: calling `/process` on a project that already has a transcript skips transcription (mock asserts transcribe seam NOT called again) and still completes.
- Path-guard: out-of-scope `mediaPath` → 403.
- The extracted `transcribe`/`segment`/`images` wrappers still pass their existing tests unchanged.

**Frontend (vitest):**
- `storyApi.process` issues the right POST.
- `startPipeline` (via the upload/script flow) calls `storyApi.process` (NOT transcribe/segment/images directly) and then relies on polling.
- `isStalled`: fresh `updatedAt` + transient → false; stale `updatedAt` + transient → true; non-transient → false.

**Live verify:** start a job, **switch to another page mid-processing, come back** → the job kept going and is further along / done (the bug is gone).

## Reused Existing Systems

- The existing transcribe/segment/images stage logic (now extracted), the `useStoryProject` polling, the Resume affordance (repurposed), and the boot reconciliation pattern.

## Deployment Note

Client changes → rebuild `server/public` + commit.
