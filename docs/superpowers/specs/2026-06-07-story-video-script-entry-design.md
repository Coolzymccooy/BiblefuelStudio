# Story Video — Script / Template Entry — Design

**Date:** 2026-06-07
**Status:** Approved design — ready for implementation planning
**Sub-project:** 3 of 4 in the Story Video enhancement program (History ✅ → Trim ✅ → **Script entry** → Talking video)

## Summary

Add a **"Write a script"** entry mode beside "Upload audio" on Step 1. The user types a rough idea (optionally picking a template), and the app **refines** it into a clean narration, synthesizes a **TTS voiceover** (free Microsoft Edge voices), and feeds that audio into the *existing* Story Video pipeline (optional trim → transcribe → segment → images → render). ~80% reuse — the only new pieces are a script→audio backend step and the script-entry UI.

## Goals

- Start a Story Video from text, with no audio file.
- Refine a vague idea into a coherent ~N-second narration, shaped by a template (tone/length/structure).
- Produce a spoken voiceover with a free, always-available TTS (Edge), with a small voice picker.
- Reuse the entire downstream pipeline unchanged — the generated audio behaves exactly like an upload.

## Non-Goals

- Paid TTS (ElevenLabs/etc.) — Edge only for v1 (decision below).
- A silent/caption-only path — every script video has a voiceover.
- Per-scene voice direction or SSML editing.
- Talking/animated avatar — that is sub-project 4.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Narration | AI voiceover via **free Edge TTS** |
| Templates | **Fixed presets + Custom** (5 total) |
| Pipeline join | Produce audio, then reuse the existing trim→transcribe→segment→images→render flow |
| Word timings | From transcribing the (clean) TTS audio — same as the upload path |

## Verified Facts (grounding)

- `synthesizeEdgeTts({ text, voiceId, rate?, pitch?, volume? })` (`server/src/lib/edgeTts.js`) returns `{ ok, file, provider:'edge', voice }`, writing an mp3 to the **global `OUTPUT_DIR`** (NOT per-user). Edge TTS is **enabled by default** (`EDGE_TTS_ENABLED ?? "true"`), needs no API key.
- Because it writes to global `OUTPUT_DIR`, the new endpoint must **move/copy the file into `req.ctx.outputDir`** so it passes the story `/transcribe` path-guard for non-super-admin users.
- The dual-provider LLM pattern (gpt-4o-mini → gemini) already exists in `lib/generateScripts.js` and was mirrored in `lib/story/sceneSegmenter.js` (`_setLlmImpl` seam) — `refineScript` reuses the same shape.
- The frontend already has `pendingAudio` + the "ready panel" (Trim / Use full / Pick different) + `startPipeline(path)` from the Trim sub-project. Script entry sets `pendingAudio` and reuses all of it.

## Architecture

### Backend

**`server/src/lib/story/scriptTemplates.js`** (pure data + lookup):
```
TEMPLATES = [
  { id:'devotional-30', label:'30s Devotional', targetSeconds:30, prompt:'<tone/structure>' },
  { id:'teaching-60',   label:'60s Teaching',    targetSeconds:60, prompt:'...' },
  { id:'meditation',    label:'Scripture Meditation', targetSeconds:45, prompt:'...' },
  { id:'testimony',     label:'Testimony / Encouragement', targetSeconds:45, prompt:'...' },
  { id:'custom',        label:'Custom', targetSeconds:40, prompt:'' },
]
```
`templateById(id)` → template or the `custom` default. **No API endpoint** — the client keeps its own `{ id, label }` mirror for the picker; the backend owns the prompts and resolves `templateId` server-side, so the two are decoupled (client sends an id, server maps it to a prompt).

**`server/src/lib/story/scriptRefine.js`** — `refineScript({ idea, template, llm? })`:
- Builds a prompt from the idea + template (tone, structure, ~`targetSeconds` of speech ≈ `targetSeconds * 2.5` words). Calls the injected `llm(prompt)` (default = the gpt-4o-mini→gemini completion, same as sceneSegmenter). Returns plain narration text (strips markdown/quotes).
- **Fallback:** on LLM failure/empty output, return the trimmed `idea` verbatim. `_setLlmImpl`/`_resetLlmImpl` seam for tests.

**`POST /api/story/script-to-audio`** (in `routes/story.js`), body `{ idea, templateId, voiceId? }`:
1. Validate `idea` non-empty (≥3 chars) → else 400.
2. `script = await refineScript({ idea, template: templateById(templateId) })`.
3. `tts = await synthesizeEdgeTts({ text: script, voiceId })` (injectable seam `_setTtsImpl` for tests).
4. **Move** `tts.file` into `req.ctx.outputDir` as `story-tts-<uuid>.mp3` (rename if same volume, else copy+unlink); use the resolved in-scope path.
5. Return `{ ok:true, file: <inScopePath>, script }`. TTS disabled/empty → 400/502 with the error.

No change to transcribe/segment/images/render — the returned `file` is consumed exactly like an uploaded audio path.

### Frontend

**Step-1 entry mode** in `StoryVideoPage.tsx`:
- A 2-way toggle at the top of the Step-1 form (only when not busy / no `pendingAudio`): **Upload audio** | **Write a script**. State `entryMode: 'upload' | 'script'` (default `'upload'`).
- **Upload mode:** the existing upload button (unchanged).
- **Script mode:** a `ScriptForm` component — template picker (from the client `STORY_SCRIPT_TEMPLATES` `{id,label}` mirror), a textarea (`idea`), a voice `<select>` (curated Edge voices, default first), and a **"Generate voiceover"** button (disabled while idea is empty/whitespace).
- **Generate** → `setBusy(true)` → `storyApi.scriptToAudio(idea, templateId, voiceId)` → on success `setPendingAudio(file)` + `setDefaultTitle(<derived from idea>)` → the existing **ready panel** renders (Trim / Use full / Pick different) → `startPipeline`. On error → toast, stay on the script form.

**Curated voices** (`client/src/lib/storyVoices.ts`, small constant): e.g.
`en-US-GuyNeural` (US, M, default), `en-US-AriaNeural` (US, F), `en-GB-RyanNeural` (UK, M), `en-NG-AbeoNeural` (Nigeria, M), `en-NG-EzinneNeural` (Nigeria, F). Each `{ id, label }`. (Standard Azure/Edge neural voice ids; verify they synthesize during the live check.)

**`storyApi.scriptToAudio(idea, templateId, voiceId)`** → `POST /api/story/script-to-audio` with a long timeout (refine + TTS can take ~10–20s); returns the `file` string; throws on `!ok`.

### Component boundaries

`scriptTemplates` + `scriptRefine` are pure/injected and unit-testable without network. The route is the I/O boundary (LLM + TTS + file move). On the client, `ScriptForm` is a self-contained form that hands a `(idea, templateId, voiceId)` to the page; the page owns turning the returned audio path into `pendingAudio` and reuses the trim/pipeline flow.

## Data Flow

idea + templateId + voiceId → `script-to-audio` (refine → Edge TTS → move into outputDir) → audio path → `pendingAudio` → **ready panel** (trim optional) → `startPipeline` → transcribe → segment → images → render. Everything after `pendingAudio` is the existing, tested flow.

## Error Handling

- Empty/whitespace idea → "Generate voiceover" disabled (client) and 400 (server).
- Refine LLM fails → fallback to the raw idea text (never dead-ends); video still generates.
- TTS disabled (`EDGE_TTS_ENABLED=false`) or network error → 400/502 surfaced as a toast; user stays on the script form.
- File move fails → 500 with a clear message; no partial project created (the project isn't created until `startPipeline`, which only runs after a successful audio path).
- Downstream (transcribe/segment/images/render) failures → existing handling (toast + Resume affordance).

## Testing

**Backend (node:test):**
- `scriptTemplates`: 5 templates incl. `custom`; `templateById('nope')` → custom; each has `targetSeconds > 0`.
- `refineScript`: LLM mocked → returns its text trimmed; LLM throws/empty → returns the raw idea; template prompt + word-count target are included in the prompt passed to the LLM.
- `POST /script-to-audio`: empty idea → 400; happy path with refine+TTS+move seams mocked → returns `{ ok, file, script }` where `file` is inside the test `outputDir`; TTS error → surfaced.

**Frontend (vitest + testing-library):**
- Entry-mode toggle switches between the upload button and the script form.
- `ScriptForm`: "Generate voiceover" is disabled for empty idea; enabled with text; clicking calls `storyApi.scriptToAudio(idea, templateId, voiceId)`.
- Page: a successful `scriptToAudio` (mocked) shows the ready panel (reusing the trim-flow assertions). `storyApi.scriptToAudio` issues the right POST and throws on `!ok`.

## Reused Existing Systems

- `synthesizeEdgeTts` (`lib/edgeTts.js`), the LLM dual-provider pattern, `lib/story/sceneSegmenter` seam style.
- The whole `pendingAudio` → ready panel → `startPipeline` → transcribe→segment→images→render flow (sub-projects 1–2).
- `storyApi`, `StoryVideoPage` Step 1.

## Deployment Note

Per `biblefuel-deploy-prebuilt-bundle`: client changes → rebuild `server/public` + commit, or the deployed UI stays stale.
