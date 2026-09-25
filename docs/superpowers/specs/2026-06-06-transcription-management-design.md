# Transcription Management (Clear / Reuse / History) — Design

**Date:** 2026-06-06
**Status:** Approved (design); pending implementation plan
**Surface:** Timeline page — "Transcribe & Caption" card

## Problem

Transcripts live only in browser `localStorage` (a single current value). Re-running `/api/transcribe` re-pays the **render quota bucket** and the Whisper wait every time, even for a file already transcribed. There's no way to clear the working transcript, reuse a previous one, or browse past transcriptions.

## Goals

- **Clear** the working transcript without losing saved history.
- **Reuse** a previously-produced transcript instantly (0 quota, no wait), including the user's edited caption lines.
- **History** of past transcriptions, server-side per user, survivable across refresh / cache-clear / devices.
- Auto-reuse: clicking Transcribe on an already-transcribed file reuses the saved transcript and offers a fresh re-run.

## Non-goals

- No transcript editing UI changes beyond what already exists (the editable lines stay).
- No diarization / speaker labels / translation.
- No cross-user sharing.
- No change to the Whisper engine or `/api/transcribe` core behaviour (it stays the fresh-run path).

## Existing patterns reused

- Per-user JSON stores with atomic temp-file+rename writes, capped recents, corruption-tolerant reads: `server/src/lib/series/seriesStore.js`, `server/src/lib/renderHistory.js`.
- `/api/transcribe` is mounted `requireAuth, withUserScope, requireVerifiedEmail, quota("render")` (see `server/index.js`). New sub-routes inherit the same guards.
- Client transcript state in `client/src/pages/TimelinePage.tsx`: `transcript` (`TranscriptWord[]`), `editedLines` (`string[]`), `sourceMediaPath`, `typographyPreset` — all via `usePersistedState`. `groupWordsIntoLines(words, 8)` produces the initial lines.

## Data model

Per-user `transcripts.json` in the user's `dataDir`, a list of entries. **One entry per source file** (dedup key = source filename basename).

```
TranscriptRecord {
  id: string;            // stable unique id
  sourceFile: string;    // basename of the source media (dedup key)
  label: string;         // display label (basename, or first edited line if present)
  words: TranscriptWord[];   // raw Whisper output ({ text, start, end })
  editedLines: string[];     // user's edited caption lines
  typographyPreset?: string; // last preset used (restored on reuse)
  durationSec?: number;
  lineCount: number;
  createdAt: string;     // ISO
  updatedAt: string;     // ISO
}
```

Cap: 50 most-recent (drop oldest). Re-transcribing or editing the same file updates its entry in place (`updatedAt` bumped, moved to front).

## Server

New `server/src/lib/transcriptStore.js` (mirrors `seriesStore.js`):
- `listTranscripts(dataDir, limit)` → `TranscriptRecord[]` (most-recent first; tolerant of corruption → `[]`).
- `upsertTranscript(dataDir, { sourceFile, words, editedLines, typographyPreset, durationSec })` → upsert by `sourceFile`, returns the record. Generates `id` on create; bumps `updatedAt` and re-sorts to front on update; recomputes `label`/`lineCount`; enforces the 50-cap.
- `deleteTranscript(dataDir, id)` → boolean removed.
- Atomic writes (temp + rename); `ensureDir`.

New routes appended to `server/src/routes/transcribe.js` (already exported router, mounted with the guards above):
- `GET /api/transcribe/history?limit=50` → `{ ok: true, items: TranscriptRecord[] }`.
- `POST /api/transcribe/save` `{ sourceFile, words, editedLines, typographyPreset?, durationSec? }` → validate (`sourceFile` non-empty string; `words` array; `editedLines` array of strings), `upsertTranscript`, return `{ ok: true, item }`. `400` on invalid.
- `DELETE /api/transcribe/history/:id` → `{ ok: true, removed: boolean }`.

`sourceFile` is always reduced to a basename server-side (`path.basename`) before use as the key (defence-in-depth; no path content trusted).

The existing `POST /api/transcribe` is unchanged — it remains the quota'd fresh-run path.

## Client UX (Timeline "Transcribe & Caption" card)

State additions (TimelinePage): `transcriptHistory: TranscriptRecord[]`, `showHistory: boolean`.

- **Load history:** on mount and after each save/delete, `GET /api/transcribe/history`. Derive `cachedForCurrent = history.find(h => h.sourceFile === basename(sourceMediaPath))`.

- **Transcribe button** (`handleTranscribe`):
  - If `cachedForCurrent` exists → **reuse**: `setTranscript(record.words)`, `setEditedLines(record.editedLines)`, `setTypographyPreset(record.typographyPreset ?? current)`, toast `"Reused saved transcript — 0 quota used"`, and render an inline **"Re-transcribe (fresh)"** action. No `/api/transcribe` call → no quota.
  - Else → call `/api/transcribe` as today; on success, `groupWordsIntoLines`, then `POST /api/transcribe/save` with `{ sourceFile: basename, words, editedLines, typographyPreset, durationSec }`; refresh history.
  - **"Re-transcribe (fresh)"** always calls `/api/transcribe` (quota applies), then re-saves (updates the entry).

- **Clear** button (shown when `transcript` is non-empty): `setTranscript(null); setEditedLines([])`. Does NOT delete the saved history entry.

- **History** dropdown (toggle `showHistory`): list `transcriptHistory` (label · relative date · `lineCount` lines). Clicking an entry **loads/reuses** it (same as reuse path) and, if its `sourceFile` differs from the current source, shows a hint that the loaded transcript is from a different file. A trash icon calls `DELETE /api/transcribe/history/:id` and refreshes.

- **Debounced auto-save:** when `editedLines` change AND a transcript is loaded for the current `sourceMediaPath`, debounce (~1.2s) a `POST /api/transcribe/save` so edits persist into the entry and reuse restores them. (Guard: only auto-save when `transcript` is non-empty and `sourceMediaPath` is set.)

A small pure helper `pickTranscribeAction(history, sourceMediaPath)` → `{ mode: 'reuse', record } | { mode: 'run' }` encapsulates the decision (unit-testable, no React).

## Edge cases

- Reuse is independent of the audio file existing on disk; rendering still requires the audio present (unchanged behaviour). Loading a transcript whose source file isn't the current upload is allowed but hinted.
- Re-run updates the single per-file entry (no duplicate entries per file).
- History cap 50 → oldest dropped on insert.
- Corrupt `transcripts.json` → reads return `[]` (never throws).
- Concurrency: atomic temp+rename writes.
- Debounced save coalesces rapid edits; a save in flight during unmount is allowed to complete (fire-and-forget).

## Testing

- **Server unit** (`transcriptStore`): upsert-creates; upsert-by-sourceFile updates in place + moves to front; 50-cap drops oldest; delete by id; corrupt-file read → `[]`; `sourceFile` reduced to basename.
- **Server routes** (`node:test` + supertest, stubbed `req.ctx`): `GET /history` returns items; `POST /save` happy + `400` on missing `sourceFile`/bad `words`; `DELETE /history/:id` removes.
- **Client unit** (Vitest): `pickTranscribeAction` — reuse when a matching `sourceFile` exists, run otherwise, run when `sourceMediaPath` is null.

## Files (anticipated)

- New: `server/src/lib/transcriptStore.js` + `server/test/lib/transcriptStore.test.js`.
- Modify: `server/src/routes/transcribe.js` (3 routes) + `server/test/routes/transcribe.history.test.js`.
- New: `client/src/lib/transcribeAction.ts` (pure helper) + `client/src/lib/__tests__/transcribeAction.test.ts`.
- Modify: `client/src/pages/TimelinePage.tsx` (Clear / History / auto-reuse / debounced save).
