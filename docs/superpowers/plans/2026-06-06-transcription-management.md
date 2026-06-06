# Transcription Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users clear the working transcript, reuse a previously-produced one instantly (0 render quota), and browse/delete a server-side per-user transcription history — auto-reusing a saved transcript when re-transcribing the same file.

**Architecture:** A per-user `transcripts.json` store (atomic writes, one entry per source file, modelled on `seriesStore.js`) exposed by a NEW `/api/transcripts` router (auth + user-scope, deliberately OFF the quota'd `/api/transcribe` path so CRUD never burns render quota). The client decides reuse-vs-run via a tested pure helper, auto-saves edits (debounced), and adds Clear + History controls to the Timeline "Transcribe & Caption" card.

**Tech Stack:** Express + Node ESM, `node:test` + `supertest` (server), React + TypeScript + Vitest (client).

**Spec:** `docs/superpowers/specs/2026-06-06-transcription-management-design.md`

> **Deviation from spec (intentional):** the CRUD routes are mounted at `/api/transcripts` (NOT `/api/transcribe/history`). Reason: `/api/transcribe` carries `quota("render")`, which increments on EVERY request to any sub-path — so history/save/delete would each burn render quota and 429 free users. A separate mount avoids that.

---

## File Structure

- **Create** `server/src/lib/transcriptStore.js` — pure per-user store: read/list/upsert/delete. One responsibility: persistence.
- **Create** `server/src/routes/transcripts.js` — thin HTTP router over the store.
- **Modify** `server/index.js` — import + mount the router at `/api/transcripts`.
- **Create** `client/src/lib/transcribeAction.ts` — pure reuse-vs-run decision + `TranscriptRecord` type.
- **Modify** `client/src/pages/TimelinePage.tsx` — history fetch, auto-reuse, Clear, History dropdown, debounced auto-save.
- **Tests:** `server/test/lib/transcriptStore.test.js`, `server/test/routes/transcripts.test.js`, `client/src/lib/__tests__/transcribeAction.test.ts`.

---

## Task 1: `transcriptStore.js` (pure store)

**Files:**
- Create: `server/src/lib/transcriptStore.js`
- Test: `server/test/lib/transcriptStore.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/lib/transcriptStore.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTranscripts, listTranscripts, upsertTranscript, deleteTranscript } from '../../src/lib/transcriptStore.js';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tx-store-')); }
const W = [{ text: 'hello', start: 0, end: 0.5 }];

test('upsert creates a record with id/timestamps/label/lineCount', () => {
  const dir = mkDir();
  const rec = upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: ['Hello world'], now: '2026-06-06T00:00:00.000Z' });
  assert.ok(rec.id);
  assert.equal(rec.userId, 'u1');
  assert.equal(rec.sourceFile, 'a.mp3');
  assert.equal(rec.label, 'Hello world');
  assert.equal(rec.lineCount, 1);
  assert.equal(rec.createdAt, '2026-06-06T00:00:00.000Z');
  assert.equal(rec.updatedAt, '2026-06-06T00:00:00.000Z');
  assert.equal(readTranscripts(dir).length, 1);
});

test('upsert by sourceFile updates in place, preserves createdAt, moves to front', () => {
  const dir = mkDir();
  upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: ['v1'], now: '2026-06-06T00:00:00.000Z' });
  upsertTranscript(dir, 'u1', { sourceFile: 'b.mp3', words: W, editedLines: ['other'], now: '2026-06-06T00:01:00.000Z' });
  const rec = upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: ['v2'], now: '2026-06-06T00:02:00.000Z' });
  const all = readTranscripts(dir);
  assert.equal(all.length, 2, 'no duplicate entry for a.mp3');
  assert.equal(all[0].sourceFile, 'a.mp3', 'updated entry moved to front');
  assert.equal(rec.editedLines[0], 'v2');
  assert.equal(rec.createdAt, '2026-06-06T00:00:00.000Z', 'createdAt preserved');
  assert.equal(rec.updatedAt, '2026-06-06T00:02:00.000Z', 'updatedAt bumped');
});

test('sourceFile is reduced to a basename (no path traversal in key)', () => {
  const dir = mkDir();
  const rec = upsertTranscript(dir, 'u1', { sourceFile: '/abs/../../x/a.mp3', words: W, editedLines: [], now: '2026-06-06T00:00:00.000Z' });
  assert.equal(rec.sourceFile, 'a.mp3');
});

test('list filters by userId and caps at 50', () => {
  const dir = mkDir();
  for (let i = 0; i < 55; i++) upsertTranscript(dir, 'u1', { sourceFile: `f${i}.mp3`, words: W, editedLines: [], now: `2026-06-06T00:${String(i).padStart(2, '0')}:00.000Z` });
  upsertTranscript(dir, 'u2', { sourceFile: 'other.mp3', words: W, editedLines: [], now: '2026-06-06T01:00:00.000Z' });
  const u1 = listTranscripts(dir, 'u1', 100);
  assert.equal(u1.length, 50, 'capped at 50');
  assert.ok(u1.every((t) => t.userId === 'u1'), 'only u1 records');
});

test('delete removes by id+userId, returns boolean', () => {
  const dir = mkDir();
  const rec = upsertTranscript(dir, 'u1', { sourceFile: 'a.mp3', words: W, editedLines: [], now: '2026-06-06T00:00:00.000Z' });
  assert.equal(deleteTranscript(dir, 'u2', rec.id), false, 'wrong user cannot delete');
  assert.equal(deleteTranscript(dir, 'u1', rec.id), true);
  assert.equal(readTranscripts(dir).length, 0);
});

test('corrupt file reads as empty list (never throws)', () => {
  const dir = mkDir();
  fs.writeFileSync(path.join(dir, 'transcripts.json'), '{ not json', 'utf-8');
  assert.deepEqual(readTranscripts(dir), []);
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/lib/transcriptStore.test.js"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/lib/transcriptStore.js`:

```js
/**
 * Transcription history store — multi-tenant, one entry per source file.
 *
 * Mirrors series/seriesStore.js: per-user dataDir, atomic temp-file + rename
 * writes, corruption-tolerant reads (return []), 50-record cap. Records carry
 * userId so the legacy single-dir (admin) mode stays correctly partitioned.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const MAX_RECENT = 50;

function filePath(dataDir) {
  if (!dataDir) throw new Error("transcripts: dataDir required");
  return path.join(dataDir, "transcripts.json");
}
function tmpPath(dataDir) { return path.join(dataDir, "transcripts.json.tmp"); }
function ensureDir(dataDir) { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); }

export function readTranscripts(dataDir) {
  ensureDir(dataDir);
  const f = filePath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(parsed?.transcripts) ? parsed.transcripts : [];
  } catch {
    return [];
  }
}

function writeAll(dataDir, list) {
  ensureDir(dataDir);
  fs.writeFileSync(tmpPath(dataDir), JSON.stringify({ transcripts: list }, null, 2), "utf-8");
  fs.renameSync(tmpPath(dataDir), filePath(dataDir));
}

export function listTranscripts(dataDir, userId, limit = MAX_RECENT) {
  const uid = String(userId || "").trim();
  const cap = Math.max(1, Math.min(MAX_RECENT, Number(limit) || MAX_RECENT));
  return readTranscripts(dataDir)
    .filter((t) => String(t?.userId || "") === uid)
    .slice(0, cap);
}

/**
 * Upsert by (userId, basename(sourceFile)). Updates in place + moves to front
 * on a repeat; preserves createdAt. `now` is injectable for deterministic tests.
 */
export function upsertTranscript(dataDir, userId, input) {
  const uid = String(userId || "").trim();
  const sourceFile = path.basename(String(input?.sourceFile || "").trim());
  if (!sourceFile) throw new Error("sourceFile required");
  const words = Array.isArray(input?.words) ? input.words : [];
  const editedLines = Array.isArray(input?.editedLines) ? input.editedLines.map(String) : [];
  const now = input?.now || new Date().toISOString();

  const list = readTranscripts(dataDir);
  const idx = list.findIndex(
    (t) => String(t?.userId || "") === uid && path.basename(String(t?.sourceFile || "")) === sourceFile,
  );
  const prev = idx >= 0 ? list[idx] : null;
  const record = {
    id: prev?.id || randomUUID(),
    userId: uid,
    sourceFile,
    label: editedLines.find((l) => l && l.trim())?.trim().slice(0, 60) || sourceFile,
    words,
    editedLines,
    typographyPreset: input?.typographyPreset ?? prev?.typographyPreset ?? null,
    durationSec: input?.durationSec ?? prev?.durationSec ?? null,
    lineCount: editedLines.length,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  const rest = idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list;
  const next = [record, ...rest].slice(0, MAX_RECENT);
  writeAll(dataDir, next);
  return record;
}

export function deleteTranscript(dataDir, userId, id) {
  const uid = String(userId || "").trim();
  const list = readTranscripts(dataDir);
  const next = list.filter((t) => !(String(t?.id) === String(id) && String(t?.userId || "") === uid));
  const removed = next.length !== list.length;
  if (removed) writeAll(dataDir, next);
  return removed;
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/lib/transcriptStore.test.js"`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/src/lib/transcriptStore.js server/test/lib/transcriptStore.test.js && git commit -m "feat(server): transcript history store (per-user, upsert-by-file)"
```

---

## Task 2: `/api/transcripts` router + mount

**Files:**
- Create: `server/src/routes/transcripts.js`
- Modify: `server/index.js`
- Test: `server/test/routes/transcripts.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/test/routes/transcripts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import transcriptsRouter from '../../src/routes/transcripts.js';

function mkApp(userId = 'u1') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-route-'));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { dataDir, outputDir: dataDir, userId }; next(); });
  app.use('/api/transcripts', transcriptsRouter);
  return { app, dataDir };
}
async function http(app) { const { default: supertest } = await import('supertest'); return supertest(app); }
const W = [{ text: 'hi', start: 0, end: 0.4 }];

test('POST saves and GET lists it', async () => {
  const { app } = mkApp();
  const s = await http(app);
  const save = await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: W, editedLines: ['Line one'] });
  assert.equal(save.status, 200);
  assert.equal(save.body.item.sourceFile, 'a.mp3');
  const list = await s.get('/api/transcripts');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].label, 'Line one');
});

test('POST 400 on missing sourceFile / bad words', async () => {
  const { app } = mkApp();
  const s = await http(app);
  assert.equal((await s.post('/api/transcripts').send({ words: W, editedLines: [] })).status, 400);
  assert.equal((await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: 'no', editedLines: [] })).status, 400);
  assert.equal((await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: W, editedLines: 'no' })).status, 400);
});

test('DELETE removes by id', async () => {
  const { app } = mkApp();
  const s = await http(app);
  const save = await s.post('/api/transcripts').send({ sourceFile: 'a.mp3', words: W, editedLines: [] });
  const id = save.body.item.id;
  const del = await s.delete(`/api/transcripts/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.removed, true);
  assert.equal((await s.get('/api/transcripts')).body.items.length, 0);
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/routes/transcripts.test.js"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `server/src/routes/transcripts.js`:

```js
import { Router } from "express";
import { listTranscripts, upsertTranscript, deleteTranscript } from "../lib/transcriptStore.js";

const router = Router();

// GET /api/transcripts?limit=50 — list the caller's saved transcripts.
router.get("/", (req, res) => {
  try {
    const items = listTranscripts(req.ctx.dataDir, req.ctx.userId, Number(req.query?.limit) || 50);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/transcripts — upsert a transcript by source file.
router.post("/", (req, res) => {
  try {
    const sourceFile = String(req.body?.sourceFile || "").trim();
    if (!sourceFile) return res.status(400).json({ ok: false, error: "sourceFile is required" });
    if (!Array.isArray(req.body?.words)) return res.status(400).json({ ok: false, error: "words[] is required" });
    if (!Array.isArray(req.body?.editedLines)) return res.status(400).json({ ok: false, error: "editedLines[] is required" });
    const item = upsertTranscript(req.ctx.dataDir, req.ctx.userId, {
      sourceFile,
      words: req.body.words,
      editedLines: req.body.editedLines,
      typographyPreset: req.body?.typographyPreset,
      durationSec: req.body?.durationSec,
    });
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// DELETE /api/transcripts/:id — remove one of the caller's transcripts.
router.delete("/:id", (req, res) => {
  try {
    const removed = deleteTranscript(req.ctx.dataDir, req.ctx.userId, req.params.id);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
```

- [ ] **Step 4: Mount in `server/index.js`**

Add the import next to the other route imports (near `import transcribeRouter from "./src/routes/transcribe.js";`):

```js
import transcriptsRouter from "./src/routes/transcripts.js";
```

Add the mount immediately AFTER the existing transcribe mount line (`app.use("/api/transcribe", requireAuth, withUserScope, requireVerifiedEmail, quota("render"), transcribeRouter);`). Note: NO `quota` and NO `requireVerifiedEmail` — CRUD on saved transcripts must not burn render quota:

```js
app.use("/api/transcripts", requireAuth, withUserScope, transcriptsRouter);
```

- [ ] **Step 5: Run route tests + full suite**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && node --test "test/routes/transcripts.test.js"`
Expected: 3 tests pass.
Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && npm test`
Expected: full suite passes (report totals).

- [ ] **Step 6: Commit**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/src/routes/transcripts.js server/index.js server/test/routes/transcripts.test.js && git commit -m "feat(server): /api/transcripts CRUD (off the quota'd transcribe path)"
```

---

## Task 3: Client `transcribeAction.ts` (pure helper)

**Files:**
- Create: `client/src/lib/transcribeAction.ts`
- Test: `client/src/lib/__tests__/transcribeAction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/__tests__/transcribeAction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickTranscribeAction, type TranscriptRecord } from '../transcribeAction';

const rec = (sourceFile: string): TranscriptRecord => ({
  id: sourceFile, userId: 'u1', sourceFile, label: sourceFile,
  words: [], editedLines: [], typographyPreset: null, durationSec: null,
  lineCount: 0, createdAt: '', updatedAt: '',
});

describe('pickTranscribeAction', () => {
  it('reuses when a history entry matches the source basename', () => {
    const r = pickTranscribeAction([rec('a.mp3')], '/x/y/a.mp3');
    expect(r.mode).toBe('reuse');
    if (r.mode === 'reuse') expect(r.record.sourceFile).toBe('a.mp3');
  });

  it('matches on basename even when history stored a bare name and path has dirs', () => {
    const r = pickTranscribeAction([rec('a.mp3')], 'C:\\\\out\\\\a.mp3');
    expect(r.mode).toBe('reuse');
  });

  it('runs when no history matches', () => {
    expect(pickTranscribeAction([rec('a.mp3')], '/x/b.mp3').mode).toBe('run');
  });

  it('runs when sourceMediaPath is null/empty', () => {
    expect(pickTranscribeAction([rec('a.mp3')], null).mode).toBe('run');
    expect(pickTranscribeAction([], '').mode).toBe('run');
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx vitest run src/lib/__tests__/transcribeAction.test.ts`
Expected: FAIL — cannot resolve `../transcribeAction`.

- [ ] **Step 3: Implement**

Create `client/src/lib/transcribeAction.ts`:

```ts
export interface TranscriptWordLike { text: string; start?: number; end?: number; }

export interface TranscriptRecord {
  id: string;
  userId: string;
  sourceFile: string;
  label: string;
  words: TranscriptWordLike[];
  editedLines: string[];
  typographyPreset?: string | null;
  durationSec?: number | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TranscribeAction =
  | { mode: 'reuse'; record: TranscriptRecord }
  | { mode: 'run' };

/** basename across both posix and windows separators. */
export function baseName(p: string | null | undefined): string {
  return String(p || '').split(/[\\/]/).pop() || '';
}

/**
 * Decide whether clicking Transcribe should REUSE a saved transcript (matched
 * by source-file basename) or RUN a fresh Whisper pass.
 */
export function pickTranscribeAction(
  history: TranscriptRecord[],
  sourceMediaPath: string | null | undefined,
): TranscribeAction {
  const base = baseName(sourceMediaPath);
  if (!base) return { mode: 'run' };
  const record = history.find((h) => baseName(h.sourceFile) === base);
  return record ? { mode: 'reuse', record } : { mode: 'run' };
}
```

- [ ] **Step 4: Run to confirm PASS**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx vitest run src/lib/__tests__/transcribeAction.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Type-check + commit**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx tsc -p tsconfig.app.json --noEmit`
Expected: exit 0.
```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/lib/transcribeAction.ts client/src/lib/__tests__/transcribeAction.test.ts && git commit -m "feat(client): pure transcribe reuse-vs-run helper + tests"
```

---

## Task 4: Wire TimelinePage (history, auto-reuse, Clear, History, auto-save)

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

Context: existing state includes `transcript` (`TranscriptWord[] | null`), `editedLines` (`string[]`), `sourceMediaPath` (`string | null`), `typographyPreset` (`string`), `isTranscribing`, and helper `groupWordsIntoLines(words, 8)`. `handleTranscribe` currently POSTs `/api/transcribe` and sets transcript/editedLines. The "Transcribe & Caption" card has a `<Button onClick={handleTranscribe} disabled={!sourceMediaPath || isTranscribing}>` and renders `editedLines` as editable inputs.

- [ ] **Step 1: Imports + state**

Add to the imports at the top of `TimelinePage.tsx`:

```tsx
import { pickTranscribeAction, baseName, type TranscriptRecord } from '../lib/transcribeAction';
```
Add `Scissors`? No — add `History as HistoryIcon, Trash2, RotateCcw` to the existing `lucide-react` import (append to the named list; do not duplicate the import line).

Near the other `useState` calls, add:

```tsx
const [transcriptHistory, setTranscriptHistory] = useState<TranscriptRecord[]>([]);
const [showHistory, setShowHistory] = useState(false);
```

- [ ] **Step 2: History fetch + save/delete helpers**

Add these functions inside the component (near `handleTranscribe`):

```tsx
const loadTranscriptHistory = useCallback(async () => {
    const res = await api.get('/api/transcripts?limit=50');
    if (res.ok && Array.isArray(res.data?.items)) setTranscriptHistory(res.data.items as TranscriptRecord[]);
}, []);

const saveTranscript = useCallback(async (words: TranscriptWord[], lines: string[]) => {
    if (!sourceMediaPath || !words.length) return;
    const res = await api.post('/api/transcripts', {
        sourceFile: baseName(sourceMediaPath),
        words,
        editedLines: lines,
        typographyPreset,
    });
    if (res.ok) void loadTranscriptHistory();
}, [sourceMediaPath, typographyPreset, loadTranscriptHistory]);

const applyTranscriptRecord = useCallback((rec: TranscriptRecord) => {
    setTranscript(rec.words as TranscriptWord[]);
    setEditedLines(rec.editedLines);
    if (rec.typographyPreset) setTypographyPreset(rec.typographyPreset);
    setShowHistory(false);
}, [setTranscript, setEditedLines, setTypographyPreset]);

const deleteTranscriptRecord = useCallback(async (id: string) => {
    const res = await api.delete(`/api/transcripts/${encodeURIComponent(id)}`);
    if (res.ok) void loadTranscriptHistory();
}, [loadTranscriptHistory]);
```

`useCallback` must be imported from React — add it to the existing `import { ... } from 'react'` line if not already present.

- [ ] **Step 3: Load history on mount**

Add an effect near the other effects:

```tsx
useEffect(() => { void loadTranscriptHistory(); }, [loadTranscriptHistory]);
```

- [ ] **Step 4: Replace `handleTranscribe` with reuse-aware version**

Replace the existing `handleTranscribe` (the `async () => { ... }` that POSTs `/api/transcribe`) with:

```tsx
const runFreshTranscribe = async () => {
    if (!sourceMediaPath) { toast.error('Upload a sermon first'); return; }
    setIsTranscribing(true);
    const toastId = toast.loading('Transcribing — this can take a minute...');
    try {
        const response = await api.post('/api/transcribe', { mediaPath: sourceMediaPath });
        if (!response.ok || !Array.isArray(response.data?.words)) {
            toast.error(response.error || 'Transcription failed', { id: toastId });
            return;
        }
        const words: TranscriptWord[] = response.data.words;
        const lines = groupWordsIntoLines(words, 8);
        setTranscript(words);
        setEditedLines(lines);
        toast.success(`Transcribed ${words.length} words`, { id: toastId });
        void saveTranscript(words, lines);
    } catch {
        toast.error('Transcription failed', { id: toastId });
    } finally {
        setIsTranscribing(false);
    }
};

const handleTranscribe = async () => {
    if (!sourceMediaPath) { toast.error('Upload a sermon first'); return; }
    const action = pickTranscribeAction(transcriptHistory, sourceMediaPath);
    if (action.mode === 'reuse') {
        applyTranscriptRecord(action.record);
        toast.success('Reused saved transcript — 0 quota used', { id: 'tx-reuse' });
        return;
    }
    await runFreshTranscribe();
};
```

- [ ] **Step 5: Debounced auto-save of edits**

Add an effect that saves edits back into the entry (only when a transcript is loaded for the current source). Place near the other effects:

```tsx
useEffect(() => {
    if (!transcript || !transcript.length || !sourceMediaPath || !editedLines.length) return;
    const t = setTimeout(() => { void saveTranscript(transcript, editedLines); }, 1200);
    return () => clearTimeout(t);
}, [editedLines, transcript, sourceMediaPath, saveTranscript]);
```

- [ ] **Step 6: Clear + History + Re-transcribe controls in the card header**

In the "Transcribe & Caption" `<Card>`, find the header row that holds the Transcribe `<Button>` (the `flex items-center justify-between` block with the description on the left and the Transcribe button on the right). Replace the right-hand control cluster (the single Transcribe `<Button>`) with this group:

```tsx
<div className="flex items-center gap-2 relative">
    {transcript && transcript.length > 0 && (
        <>
            <Button
                variant="secondary"
                onClick={() => { setTranscript(null); setEditedLines([]); }}
                className="h-9 text-xs"
                title="Clear the working transcript (saved history is kept)"
            >
                Clear
            </Button>
            <Button
                variant="secondary"
                onClick={runFreshTranscribe}
                disabled={isTranscribing || !sourceMediaPath}
                className="h-9 text-xs"
                title="Run a fresh Whisper pass (uses render quota)"
            >
                <RotateCcw size={14} className="mr-1.5" />
                Re-transcribe
            </Button>
        </>
    )}
    {transcriptHistory.length > 0 && (
        <Button
            variant="secondary"
            onClick={() => setShowHistory((v) => !v)}
            className="h-9 text-xs"
            title="Saved transcripts"
        >
            <HistoryIcon size={14} className="mr-1.5" />
            History
        </Button>
    )}
    <Button
        onClick={handleTranscribe}
        disabled={!sourceMediaPath || isTranscribing}
        className="h-9 text-xs"
    >
        <Waves size={14} className="mr-2" />
        {isTranscribing ? 'Transcribing...' : 'Transcribe'}
    </Button>

    {showHistory && (
        <div className="absolute right-0 top-11 z-30 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-dark-900/98 backdrop-blur-xl shadow-2xl p-2">
            <p className="text-caption px-2 py-1">Saved transcripts</p>
            {transcriptHistory.map((h) => (
                <div key={h.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5">
                    <button
                        type="button"
                        onClick={() => applyTranscriptRecord(h)}
                        className="flex-1 min-w-0 text-left"
                    >
                        <p className="text-content-secondary text-xs truncate">{h.label}</p>
                        <p className="text-meta">{h.sourceFile} · {h.lineCount} lines</p>
                    </button>
                    <button
                        type="button"
                        onClick={() => void deleteTranscriptRecord(h.id)}
                        className="shrink-0 p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-white/5"
                        aria-label="Delete saved transcript"
                        title="Delete"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            ))}
        </div>
    )}
</div>
```

> NOTE: `Waves` is already imported (the original Transcribe button uses it). If the original button used a different icon or label, preserve the icon import; only the surrounding cluster changes. If the card layout differs, keep the existing wrapper and insert the Clear / Re-transcribe / History buttons + dropdown immediately before the existing Transcribe `<Button>`.

- [ ] **Step 7: Type-check + build**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: exit 0. If `useCallback`/`useEffect` or an icon is reported missing, add it to the relevant import. Do NOT introduce `any` to silence errors — `transcript`/`editedLines` are already typed.

- [ ] **Step 8: Commit (source only — bundle rebuilt in Task 5)**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add client/src/pages/TimelinePage.tsx && git commit -m "feat(timeline): clear/reuse/history + debounced auto-save for transcripts"
```

---

## Task 5: Full verification + bundle

- [ ] **Step 1: Server suite**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/server && npm test`
Expected: all pass (existing + new store/route tests). Report totals.

- [ ] **Step 2: Client tests + type-check**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: all pass; tsc exit 0.

- [ ] **Step 3: Build bundle**

Run: `cd c:/Users/segun/source/repos/biblefuel-studio/client && npm run build`
Expected: exit 0; bundle written to `../server/public`.

- [ ] **Step 4: Manual smoke (dev or live)**

Sign in, Timeline → upload a sermon → Transcribe (runs Whisper, saves). Reload the page → Transcribe again on the same file → confirm it **reuses instantly** with the "0 quota used" toast (no Whisper wait). Edit a caption line, wait ~2s, reload, Transcribe → confirm the edit persisted. Open **History** → load another entry, delete one. **Clear** → confirm the working transcript empties but the History entry remains.

- [ ] **Step 5: Commit the rebuilt bundle**

```bash
cd c:/Users/segun/source/repos/biblefuel-studio && git add server/public && git commit -m "build(client): rebuild bundle with transcription management" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** data model + per-file dedup + cap + atomic writes → Task 1; server endpoints (list/save/delete) → Task 2 (mounted at `/api/transcripts`, off the quota path — the intentional deviation, flagged at top); reuse-vs-run decision → Task 3; auto-reuse + Clear + History + debounced auto-save → Task 4; tests (store/route/helper) → Tasks 1–3; verification → Task 5.
- **Quota safety:** the whole point — CRUD lives on `/api/transcripts` (no `quota("render")`); only the fresh-run path hits `/api/transcribe`.
- **Type/name consistency:** `TranscriptRecord`, `pickTranscribeAction`, `baseName` defined in Task 3 and used verbatim in Task 4; store fns `listTranscripts`/`upsertTranscript`/`deleteTranscript` defined in Task 1 and used in Task 2.
- **No placeholders:** every step carries real code/commands.
