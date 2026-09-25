# Story Video — Audio Trim — Design

**Date:** 2026-06-07
**Status:** Approved design — ready for implementation planning
**Sub-project:** 2 of 4 in the Story Video enhancement program (History ✅ → **Trim** → Script entry → Talking video)

## Summary

Add an optional **trim step** between uploading a sermon and running the pipeline, so a long recording can be cut to the relevant window before transcription/segmentation/render. Reuses the existing `MediaTrimmer` component and `POST /api/media/trim` endpoint wholesale — no backend changes. The pipeline runs on whichever audio path the user chooses (trimmed or full); the trimmed file starts at 0, so no timing-offset logic is needed anywhere.

## Goals

- After picking a file, show a waveform + drag-handle trimmer with the full clip pre-selected.
- "Trim & continue" → process only the selected window. "Use full audio" → process the whole file.
- Everything downstream (transcribe → segment → images → render) is unchanged.

## Non-Goals

- Backend changes (trim + pipeline already exist).
- Multi-segment / multiple cuts (single window only — matches MediaTrimmer).
- Trimming after processing has started (trim is a pre-processing step only).

## Decision (from brainstorming)

| Decision | Choice |
|---|---|
| Trigger | Always after upload, **skippable** ("Use full audio") |
| Component | Reuse `MediaTrimmer` (`kind="audio"`) |
| Cut location | Server-side via existing `POST /api/media/trim` |

## Verified Facts (no backend work)

- `MediaTrimmer` props: `{ serverPath, kind, onApply(newServerPath, newDurationSec), onCancel }`. It renders its own modal (waveform, handles, preview, Apply/Close) and on Apply calls `POST /api/media/trim` then `onApply(file, durationSec)`.
- `POST /api/media/trim` validates `inputPath` is within `req.ctx.outputDir`, writes `trimmed-<uuid>.mp3` into `req.ctx.outputDir`, and returns `{ ok, file (absolute path), durationSec }`.
- That returned path is inside the user's output dir, so it **passes the story `/transcribe` path-guard** added in the wizard sub-project. Uploads always become audio (`/api/media/upload-audio` converts video→mp3), so `kind` is always `"audio"`.

## Architecture

All changes are in **`client/src/pages/StoryVideoPage.tsx`**, Step 1. The single `handleCreateAndUpload(file)` is split into a pick phase, a small "ready" panel, the trimmer modal, and a shared pipeline runner.

**Important:** `MediaTrimmer` renders a **full-screen modal** (`fixed inset-0 z-70`). So we do NOT place buttons as siblings beside it (they'd be hidden). Instead, after upload we show a small **inline panel** with the choices, and "Trim" *opens* the modal.

1. **`handlePickFile(file)`** — `setBusy(true)`; capture `defaultTitle = file.name.replace(/\.[^.]+$/, '')`; `storyApi.uploadAudio(dataUrl, file.name)`; on success `setPendingAudio(path)`; `setBusy(false)`. On error → toast, stay on the form.
2. **Ready panel** — when `pendingAudio` is set and the trimmer modal is closed, render an inline panel: *"Audio uploaded."* + three buttons: **Trim audio** (`setShowTrimmer(true)`), **Use full audio** (`startPipeline(pendingAudio)`), **Pick a different file** (`setPendingAudio(null)`).
3. **Trimmer modal** — when `showTrimmer`, render `<MediaTrimmer serverPath={pendingAudio} kind="audio" onApply={(trimmedPath) => { setShowTrimmer(false); startPipeline(trimmedPath); }} onCancel={() => setShowTrimmer(false)} />`. Cancel returns to the ready panel (does NOT start processing).
4. **`startPipeline(audioPath)`** — the existing chain, now parameterised by path: `setBusy(true)`; `createProject(title || defaultTitle, style)`; `setActive`; `transcribe(audioPath)`; `segment`; `generateImages`; `setPendingAudio(null)`; `setShowTrimmer(false)`; invalidate the project query; toast. Existing error handling (toast + Resume) unchanged.

State added: `pendingAudio: string | null`, `showTrimmer: boolean`, `defaultTitle: string`.

### Data flow

Pick file → `uploadAudio` → `pendingAudio = path` → **ready panel**. Then one of: **Trim audio** → modal → Apply → `onApply(trimmedPath)` → `startPipeline(trimmedPath)`; **Use full audio** → `startPipeline(pendingAudio)`; modal **Close** → back to the ready panel; **Pick a different file** → `setPendingAudio(null)` (back to the form). Pipeline thereafter is identical to today.

### Component boundaries

`MediaTrimmer` is a self-contained modal that owns the cut and returns a path — `StoryVideoPage` only decides *which* path feeds the pipeline. `startPipeline(path)` is a pure orchestration function over `storyApi`; it doesn't care whether the path is trimmed or full.

## Error Handling

- Upload fails → toast the message; `pendingAudio` stays null; the form remains.
- Trim fails → `MediaTrimmer` shows its own "Trim failed — original kept" toast and stays open; the user can retry, adjust, or click "Use full audio".
- Pipeline fails (transcribe/segment/images) → existing behaviour: toast + the project (now created) shows the Resume affordance.
- File name with no extension → title defaults to the raw name; harmless.

## Testing

**Frontend (vitest + testing-library), in `StoryVideoPage.test.tsx`:** `vi.mock('../components/MediaTrimmer', ...)` with a lightweight stub exposing two buttons — "trimmer-apply" (calls `onApply('/out/trimmed.mp3', 12)`) and "trimmer-close" (calls `onCancel`) — so tests never touch the waveform/network. Mock `storyApi`.

- Picking a file (fires the hidden input's `onChange` with a stub `File`) calls `uploadAudio` and then shows the **ready panel** ("Use full audio" / "Trim audio" buttons) — NOT an immediate transcribe.
- **"Use full audio"** calls `transcribe` with the **uploaded** path.
- **"Trim audio"** → renders the mocked trimmer → "trimmer-apply" calls `transcribe` with the **trimmed** path (`/out/trimmed.mp3`).
- Upload error → no ready panel; stays on the form; error toast path exercised.
- Existing Step-1 tests (history, upload-button, resume) still pass (they don't pick a file, so the trim phase never triggers).

> Note: file-pick is driven in tests by firing `change` on the hidden `input[type=file]` with a stub `File`; `FileReader.readAsDataURL` works in jsdom. If reading a real File is flaky in jsdom, the test may stub `uploadAudio` to resolve regardless and assert the resulting trim-step render.

## Reused Existing Systems

- `MediaTrimmer` (`client/src/components/MediaTrimmer.tsx`) + `POST /api/media/trim` + `lib/trimValidate.js`.
- `storyApi` (uploadAudio/createProject/transcribe/segment/generateImages), the Step-1 form, the Resume affordance.

## Deployment Note

Per `biblefuel-deploy-prebuilt-bundle`: client-only change → rebuild `server/public` + commit, or the deployed UI stays stale.
