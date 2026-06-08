# Gumroad & Timeline Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-day "Send to Timeline" buttons, server-backed Gumroad generation history, and Timeline trim-output reuse (Source ↔ Music Bed).

**Architecture:** A client parser splits the free devotional into per-day units; a new per-user JSON store (mirroring `transcriptStore`) persists generated packs; the Gumroad page gains per-day send buttons + a history panel; the Timeline page records uploaded/trimmed audio and adds cross-slot "Use as Source / Music Bed" actions. No changes to TTS, render, or MediaTrimmer.

**Tech Stack:** React 19 + TypeScript + Vitest (client), Node ESM + `node --test` (server), existing `api` client, `saveJson`/`STORAGE_KEYS`.

---

## Context the implementer needs

**Working directory:** `c:\Users\segun\source\repos\biblefuel-studio\.claude\worktrees\feat-gumroad-timeline-refinements`. Use absolute paths or `cd` into it each Bash command (cwd resets). Commit on branch `worktree-feat-gumroad-timeline-refinements`. `node_modules` may need installing in `client/` and `server/` before tests run (`npm install` in each if missing).

**Test commands:**
- Client: `cd client && npx vitest run <file>` (and `npx vitest run` for all).
- Server: `cd server && node --test src/lib/gumroadStore.test.js` (server runner is Node's built-in `node --test`).

**Verified facts:**
- `transcriptStore.js` is the exact pattern to mirror (per-user `${dataDir}/transcripts.json`, atomic temp+rename, corruption-tolerant read, upsert + per-user cap of 50). The new store mirrors it with `gumroad-history.json` and `{ packs: [] }`.
- The gumroad router already runs behind `requireAuth → withUserScope → featureGate("gumroad")`, so `req.ctx.dataDir` and `req.ctx.userId` are available (same as `transcripts.js`).
- `gumroadToTimeline.ts` already exports `parseFreeDevotional`, `evenDistributeWords`, `extractTranscript`, `TranscriptWord`, and has module-internal `LABEL_RE` (`/^\*\*(?:Verse|Reflection|Prayer):\*\*\s*/`) + `chunkWords(text, size)`.
- The free markdown day heading format is `## Day N: <reference>`.
- `Card` accepts a `className` prop; `Button` accepts `isLoading` + `disabled`; `api` has `.get/.post/.delete/.download/.mediaUrl`.
- Timeline `audioHistory` (`STORAGE_KEYS.audioHistory`, `AudioItem = { id, path, kind, createdAt }`) is loaded on mount but never written; the "Recent Audio" panel renders it.

---

### Task 1: `parseFreeDevotionalDays` (per-day parser)

**Files:**
- Modify: `client/src/lib/gumroadToTimeline.ts`
- Test: `client/src/lib/__tests__/gumroadToTimeline.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

Append to `client/src/lib/__tests__/gumroadToTimeline.test.ts`:

```ts
import { parseFreeDevotionalDays } from '../gumroadToTimeline';

const MULTI_DAY_MD = `# 7 Bible Verses for Anxiety & Fear

A simple devotional from **@Biblefuel** to help you find calm.

## Day 1: Philippians 4:6-7
**Verse:** Do not be anxious about anything but in everything by prayer present your requests.

**Reflection:** Breathe. God is present.

**Prayer:** Lord, I give You what I cannot carry. Amen.

## Day 2: 1 Peter 5:7
**Verse:** Cast all your anxiety on Him because He cares for you.

**Reflection:** Breathe. God is present.

---
Want more? Check the **Biblefuel 30-Day Devotional**.`;

describe('parseFreeDevotionalDays', () => {
  it('splits into one unit per day with number + reference', () => {
    const days = parseFreeDevotionalDays(MULTI_DAY_MD);
    expect(days).toHaveLength(2);
    expect(days[0].dayNumber).toBe(1);
    expect(days[0].reference).toBe('Philippians 4:6-7');
    expect(days[1].dayNumber).toBe(2);
    expect(days[1].reference).toBe('1 Peter 5:7');
  });

  it('keeps each day narrationText equal to its lines joined by a space', () => {
    for (const d of parseFreeDevotionalDays(MULTI_DAY_MD)) {
      expect(d.narrationText).toBe(d.lines.join(' '));
      for (const line of d.lines) expect(line.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
  });

  it('scopes content to its own day (no bleed across days)', () => {
    const days = parseFreeDevotionalDays(MULTI_DAY_MD);
    expect(days[0].narrationText).toContain('Do not be anxious');
    expect(days[0].narrationText).not.toContain('Cast all your anxiety');
    // Day 2 has no prayer line — tolerated.
    expect(days[1].narrationText).toContain('Cast all your anxiety');
  });

  it('ignores headings/intro/footer and returns [] for empty input', () => {
    expect(parseFreeDevotionalDays('')).toEqual([]);
    const joined = parseFreeDevotionalDays(MULTI_DAY_MD).map((d) => d.narrationText).join(' ');
    expect(joined).not.toContain('Biblefuel 30-Day Devotional');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run src/lib/__tests__/gumroadToTimeline.test.ts`
Expected: FAIL — `parseFreeDevotionalDays is not a function`.

- [ ] **Step 3: Write the implementation (append to `gumroadToTimeline.ts`)**

Append to `client/src/lib/gumroadToTimeline.ts`:

```ts
/** One day of the free devotional, ready to narrate + send to the Timeline. */
export interface DevotionalDay {
    dayNumber: number;
    reference: string;
    narrationText: string;
    lines: string[];
}

/** Matches the free lead magnet's per-day heading: `## Day 1: Philippians 4:6-7`. */
const DAY_HEADING_RE = /^##\s*Day\s+(\d+):\s*(.+?)\s*$/;

/**
 * Split the free devotional markdown into per-day units. Within each day, the
 * same Verse/Reflection/Prayer extraction + <=8-word chunking as
 * parseFreeDevotional is applied, and `narrationText === lines.join(' ')` holds
 * per day. Days with a heading but no content lines are dropped.
 */
export function parseFreeDevotionalDays(markdown: string): DevotionalDay[] {
    const days: DevotionalDay[] = [];
    let current: { dayNumber: number; reference: string; lines: string[] } | null = null;
    const flush = () => {
        if (current && current.lines.length) {
            days.push({
                dayNumber: current.dayNumber,
                reference: current.reference,
                narrationText: current.lines.join(' '),
                lines: current.lines,
            });
        }
    };
    for (const raw of (markdown || '').split(/\r?\n/)) {
        const heading = raw.match(DAY_HEADING_RE);
        if (heading) {
            flush();
            current = { dayNumber: Number(heading[1]), reference: heading[2].trim(), lines: [] };
            continue;
        }
        if (!current || !LABEL_RE.test(raw)) continue;
        const text = raw.replace(LABEL_RE, '').trim();
        if (!text) continue;
        for (const chunk of chunkWords(text, 8)) current.lines.push(chunk);
    }
    flush();
    return days;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run src/lib/__tests__/gumroadToTimeline.test.ts`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/gumroadToTimeline.ts client/src/lib/__tests__/gumroadToTimeline.test.ts
git commit -m "feat(gumroad): parseFreeDevotionalDays per-day parser"
```

---

### Task 2: `gumroadStore` (server-backed history store)

**Files:**
- Create: `server/src/lib/gumroadStore.js`
- Test: `server/src/lib/gumroadStore.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/src/lib/gumroadStore.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listGumroadPacks, upsertGumroadPack, deleteGumroadPack } from "./gumroadStore.js";

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "gum-")); }

test("upsert creates, lists scoped to user, and caps", () => {
  const d = tmpDir();
  upsertGumroadPack(d, "u1", { freeTitle: "F1", paidTitle: "P1", freeMarkdown: "a", paidMarkdown: "b" });
  upsertGumroadPack(d, "u2", { freeTitle: "F2", paidTitle: "P2", freeMarkdown: "c", paidMarkdown: "d" });
  assert.equal(listGumroadPacks(d, "u1").length, 1);
  assert.equal(listGumroadPacks(d, "u1")[0].freeTitle, "F1");
  assert.equal(listGumroadPacks(d, "u2").length, 1);
});

test("upsert by (freeTitle+paidTitle) updates instead of duplicating, preserves createdAt", () => {
  const d = tmpDir();
  const a = upsertGumroadPack(d, "u1", { freeTitle: "F", paidTitle: "P", freeMarkdown: "v1", paidMarkdown: "x", now: "2020-01-01T00:00:00.000Z" });
  const b = upsertGumroadPack(d, "u1", { freeTitle: "F", paidTitle: "P", freeMarkdown: "v2", paidMarkdown: "x", now: "2020-02-02T00:00:00.000Z" });
  const list = listGumroadPacks(d, "u1");
  assert.equal(list.length, 1);
  assert.equal(list[0].freeMarkdown, "v2");
  assert.equal(b.id, a.id);
  assert.equal(list[0].createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(list[0].updatedAt, "2020-02-02T00:00:00.000Z");
});

test("delete removes only the caller's own record", () => {
  const d = tmpDir();
  const rec = upsertGumroadPack(d, "u1", { freeTitle: "F", paidTitle: "P", freeMarkdown: "a", paidMarkdown: "b" });
  assert.equal(deleteGumroadPack(d, "u2", rec.id), false);
  assert.equal(deleteGumroadPack(d, "u1", rec.id), true);
  assert.equal(listGumroadPacks(d, "u1").length, 0);
});

test("corrupt file reads as empty", () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "gumroad-history.json"), "{not json");
  assert.deepEqual(listGumroadPacks(d, "u1"), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test src/lib/gumroadStore.test.js`
Expected: FAIL — cannot find module `./gumroadStore.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/lib/gumroadStore.js`:

```js
/**
 * Gumroad generation history — multi-tenant, one entry per (freeTitle+paidTitle).
 * Mirrors transcriptStore.js: per-user dataDir JSON, atomic temp-file + rename
 * writes, corruption-tolerant reads (return []), 50-record cap per user.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const MAX_RECENT = 50;

function filePath(dataDir) {
  if (!dataDir) throw new Error("gumroad: dataDir required");
  return path.join(dataDir, "gumroad-history.json");
}
function tmpPath(dataDir) { return path.join(dataDir, "gumroad-history.json.tmp"); }
function ensureDir(dataDir) { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); }

export function readGumroadPacks(dataDir) {
  ensureDir(dataDir);
  const f = filePath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(parsed?.packs) ? parsed.packs : [];
  } catch {
    return [];
  }
}

function writeAll(dataDir, list) {
  ensureDir(dataDir);
  fs.writeFileSync(tmpPath(dataDir), JSON.stringify({ packs: list }, null, 2), "utf-8");
  fs.renameSync(tmpPath(dataDir), filePath(dataDir));
}

export function listGumroadPacks(dataDir, userId, limit = MAX_RECENT) {
  const uid = String(userId || "").trim();
  const cap = Math.max(1, Math.min(MAX_RECENT, Number(limit) || MAX_RECENT));
  return readGumroadPacks(dataDir)
    .filter((p) => String(p?.userId || "") === uid)
    .slice(0, cap);
}

function keyOf(freeTitle, paidTitle) {
  return `${String(freeTitle || "").trim()} ${String(paidTitle || "").trim()}`;
}

/**
 * Upsert by (userId, freeTitle+paidTitle). Updates in place + moves to front on
 * a repeat; preserves createdAt. `now` is injectable for deterministic tests.
 */
export function upsertGumroadPack(dataDir, userId, input) {
  const uid = String(userId || "").trim();
  const freeTitle = String(input?.freeTitle || "").trim();
  const paidTitle = String(input?.paidTitle || "").trim();
  if (!freeTitle) throw new Error("freeTitle required");
  const freeMarkdown = String(input?.freeMarkdown || "");
  const paidMarkdown = String(input?.paidMarkdown || "");
  const now = input?.now || new Date().toISOString();

  const list = readGumroadPacks(dataDir);
  const idx = list.findIndex(
    (p) => String(p?.userId || "") === uid && keyOf(p?.freeTitle, p?.paidTitle) === keyOf(freeTitle, paidTitle),
  );
  const prev = idx >= 0 ? list[idx] : null;
  const record = {
    id: prev?.id || randomUUID(),
    userId: uid,
    freeTitle,
    paidTitle,
    freeMarkdown,
    paidMarkdown,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  const rest = idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list;
  const updated = [record, ...rest];

  const byUser = {};
  for (const p of updated) {
    const u = String(p?.userId || "");
    if (!byUser[u]) byUser[u] = [];
    byUser[u].push(p);
  }
  for (const u in byUser) byUser[u] = byUser[u].slice(0, MAX_RECENT);
  const next = Object.values(byUser).flat();

  writeAll(dataDir, next);
  return record;
}

export function deleteGumroadPack(dataDir, userId, id) {
  const uid = String(userId || "").trim();
  const list = readGumroadPacks(dataDir);
  const next = list.filter((p) => !(String(p?.id) === String(id) && String(p?.userId || "") === uid));
  const removed = next.length !== list.length;
  if (removed) writeAll(dataDir, next);
  return removed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test src/lib/gumroadStore.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/gumroadStore.js server/src/lib/gumroadStore.test.js
git commit -m "feat(gumroad): per-user history store"
```

---

### Task 3: Gumroad history routes (persist on generate + GET/DELETE)

**Files:**
- Modify: `server/src/routes/gumroad.js`

- [ ] **Step 1: Add the store import**

In `server/src/routes/gumroad.js`, add after the existing `gumroadPacks.js` import line:

```js
import { upsertGumroadPack, listGumroadPacks, deleteGumroadPack } from "../lib/gumroadStore.js";
```

- [ ] **Step 2: Persist in the `/generate` handler**

Replace the body of the `router.post("/generate", ...)` handler's `try` block (the lines from `const freeTitle = ...` through `res.json({ ok:true, ...last });`) with:

```js
    const freeTitle = String(req.body?.freeTitle || "7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)").trim();
    const paidTitle = String(req.body?.paidTitle || "Biblefuel: 30 Days of Strength, Peace & Faith").trim();
    const freeMarkdown = buildFreeLeadMagnet(freeTitle);
    const paidMarkdown = buildPaidDevotional(paidTitle);
    last = { freeTitle, paidTitle, freeMarkdown, paidMarkdown, createdAt: new Date().toISOString() };
    // Best-effort persist to per-user history; never block generation on a save error.
    let savedId = null;
    try {
      const rec = upsertGumroadPack(req.ctx.dataDir, req.ctx.userId, { freeTitle, paidTitle, freeMarkdown, paidMarkdown });
      savedId = rec.id;
    } catch (e) {
      console.warn("[gumroad] history save failed:", e?.message || e);
    }
    res.json({ ok: true, id: savedId, ...last });
```

- [ ] **Step 3: Add history GET/DELETE routes**

In `server/src/routes/gumroad.js`, add immediately before the final `export default router;` line:

```js
// GET /api/gumroad/history?limit=50 — list the caller's saved packs.
router.get("/history", (req, res) => {
  try {
    const items = listGumroadPacks(req.ctx.dataDir, req.ctx.userId, Number(req.query?.limit) || 50);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// DELETE /api/gumroad/history/:id — remove one of the caller's saved packs.
router.delete("/history/:id", (req, res) => {
  try {
    const removed = deleteGumroadPack(req.ctx.dataDir, req.ctx.userId, req.params.id);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});
```

- [ ] **Step 4: Verify the file parses**

Run: `cd server && node --check src/routes/gumroad.js`
Expected: no output, exit 0 (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/gumroad.js
git commit -m "feat(gumroad): persist on generate + history GET/DELETE routes"
```

---

### Task 4: GumroadPage — per-day send buttons + history panel

**Files:**
- Modify (full rewrite): `client/src/pages/GumroadPage.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite `client/src/pages/GumroadPage.tsx` with exactly:

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { parseFreeDevotionalDays, extractTranscript, type DevotionalDay } from '../lib/gumroadToTimeline';
import { saveJson, STORAGE_KEYS } from '../lib/storage';

interface GumroadRecord {
    id: string;
    freeTitle: string;
    paidTitle: string;
    freeMarkdown: string;
    paidMarkdown: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Read an audio file's duration (seconds) via a detached <Audio> element.
 * Resolves 0 if metadata can't be read (caller falls back to a rate estimate).
 */
function getAudioDurationSec(url: string): Promise<number> {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        const finish = (v: number) => resolve(Number.isFinite(v) && v > 0 ? v : 0);
        audio.onloadedmetadata = () => finish(audio.duration);
        audio.onerror = () => finish(0);
        audio.src = url;
    });
}

export function GumroadPage() {
    const { isSuperAdmin, isLoading } = useAuth();
    const [freeTitle, setFreeTitle] = useState('7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)');
    const [paidTitle, setPaidTitle] = useState('Biblefuel: 30 Days of Strength, Peace & Faith');
    const [result, setResult] = useState<{ freeMarkdown?: string; paidMarkdown?: string } | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [sendingDay, setSendingDay] = useState<number | null>(null);
    const [history, setHistory] = useState<GumroadRecord[]>([]);
    const navigate = useNavigate();

    const fetchHistory = useCallback(async () => {
        const res = await api.get('/api/gumroad/history?limit=50');
        if (res.ok && Array.isArray(res.data?.items)) setHistory(res.data.items as GumroadRecord[]);
    }, []);

    useEffect(() => { void fetchHistory(); }, [fetchHistory]);

    // Server-side gate (featureGate('gumroad')) already 403s non-super-admin
    // calls. Mirror that here so a direct URL hit doesn't show a broken page.
    if (isLoading) return <div className="text-gray-400 text-sm">Checking access…</div>;
    if (!isSuperAdmin) return <Navigate to="/app" replace />;

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            const response = await api.post('/api/gumroad/generate', { freeTitle, paidTitle });
            if (response.ok && response.data) {
                setResult(response.data);
                toast.success('Generated Gumroad packs!');
                void fetchHistory();
            } else {
                toast.error(response.error || 'Generation failed');
            }
        } catch {
            toast.error('An error occurred');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadZip = () => { api.download('/api/gumroad/download.zip'); };

    /** Narrate the given text and drop the user into the Timeline, render-ready. */
    const narrateAndSendToTimeline = async (narrationText: string, lines: string[]) => {
        if (!narrationText) { toast.error('Nothing to narrate in this day'); return; }
        const toastId = toast.loading('Narrating devotional…');
        try {
            const response = await api.post('/api/tts/synthesize-category', {
                text: narrationText,
                category: 'devotional',
                withTimestamps: true,
            });
            if (!response.ok || !response.data?.file) {
                toast.error(response.error || 'Narration failed', { id: toastId });
                return;
            }
            const file = response.data.file as string;
            const durationSec = await getAudioDurationSec(api.mediaUrl(file));
            const transcript = extractTranscript(response.data, narrationText, durationSec);

            // Clearing the Main Assembly clips is REQUIRED: Timeline reads clips[0]
            // as a render trim, so a stale clip would silently crop our narration.
            saveJson(STORAGE_KEYS.timelineClips, []);
            saveJson(STORAGE_KEYS.sclSourcePath, file);
            saveJson(STORAGE_KEYS.sclSourceKind, 'audio');
            saveJson(STORAGE_KEYS.sclTranscript, transcript);
            saveJson(STORAGE_KEYS.sclEditedLines, lines);

            toast.success('Sent to Timeline — pick a background and render', { id: toastId });
            navigate('/app/timeline');
        } catch {
            toast.error('Narration failed', { id: toastId });
        }
    };

    const sendDay = async (day: DevotionalDay) => {
        setSendingDay(day.dayNumber);
        try {
            await narrateAndSendToTimeline(day.narrationText, day.lines);
        } finally {
            setSendingDay(null);
        }
    };

    const loadPack = (rec: GumroadRecord) => {
        setFreeTitle(rec.freeTitle);
        setPaidTitle(rec.paidTitle);
        setResult({ freeMarkdown: rec.freeMarkdown, paidMarkdown: rec.paidMarkdown });
        toast.success('Loaded saved pack');
    };

    const deletePack = async (id: string) => {
        const res = await api.delete(`/api/gumroad/history/${encodeURIComponent(id)}`);
        if (res.ok) { toast.success('Deleted'); void fetchHistory(); }
        else toast.error(res.error || 'Delete failed');
    };

    const days: DevotionalDay[] = result?.freeMarkdown ? parseFreeDevotionalDays(result.freeMarkdown) : [];

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Gumroad Pack Builder</h2>

            <Card title="Configuration">
                <p className="text-sm text-gray-600 mb-4">
                    Generates Markdown you can paste into Gumroad, and a ZIP you can upload.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Lead magnet title</label>
                        <Input value={freeTitle} onChange={(e) => setFreeTitle(e.target.value)} />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Paid product title</label>
                        <Input value={paidTitle} onChange={(e) => setPaidTitle(e.target.value)} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button onClick={handleGenerate} isLoading={isGenerating} className="w-full sm:w-auto">
                            Generate
                        </Button>
                        <Button onClick={handleDownloadZip} variant="secondary" className="w-full sm:w-auto">
                            Download ZIP
                        </Button>
                    </div>
                </div>
            </Card>

            {history.length > 0 && (
                <Card title="History" className="mt-6">
                    <p className="text-xs text-gray-500 mb-3">Previously generated packs — open to revisit, or delete.</p>
                    <div className="space-y-2">
                        {history.map((h) => (
                            <div key={h.id} className="flex items-center justify-between gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                                <div className="min-w-0">
                                    <p className="text-sm text-gray-200 truncate">{h.freeTitle}</p>
                                    <p className="text-xs text-gray-500">{new Date(h.updatedAt || h.createdAt).toLocaleString()}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button onClick={() => loadPack(h)} className="text-xs h-8">Open</Button>
                                    <Button onClick={() => deletePack(h.id)} variant="secondary" className="text-xs h-8">Delete</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {result && (
                <div className="mt-6 space-y-4">
                    {result.freeMarkdown && (
                        <Card title="Free product (Markdown)">
                            <pre className="bg-black/30 border border-white/10 text-gray-200 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.freeMarkdown}
                            </pre>
                            <div className="mt-4 space-y-2">
                                <p className="text-xs text-gray-400">
                                    Send a day to the Timeline — narrates that day and opens the editor to render a captioned video.
                                </p>
                                {days.map((d) => (
                                    <div key={d.dayNumber} className="flex items-center justify-between gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                                        <span className="text-sm text-gray-200">Day {d.dayNumber} · {d.reference}</span>
                                        <Button
                                            onClick={() => sendDay(d)}
                                            isLoading={sendingDay === d.dayNumber}
                                            disabled={sendingDay !== null}
                                            className="text-xs h-8 shrink-0"
                                        >
                                            Send to Timeline
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    {result.paidMarkdown && (
                        <Card title="Paid product (Markdown)">
                            <pre className="bg-black/30 border border-white/10 text-gray-200 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.paidMarkdown}
                            </pre>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd client && npm run build`
Expected: PASS — `tsc -b` no errors, `vite build` completes.

- [ ] **Step 3: Run the full client test suite**

Run: `cd client && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/GumroadPage.tsx
git commit -m "feat(gumroad): per-day Send-to-Timeline + history panel"
```

---

### Task 5: TimelinePage — trim-output reuse (Source ↔ Music Bed)

**Files:**
- Modify: `client/src/pages/TimelinePage.tsx`

All edits are anchored to existing code. The `pushAudioHistory` const is referenced only inside event handlers (closures), so its position relative to those handlers does not matter at runtime.

- [ ] **Step 1: Add the `pushAudioHistory` helper**

In `client/src/pages/TimelinePage.tsx`, find:

```tsx
    const saveClipsToCache = (newClips: TimelineClip[]) => {
        saveJson(STORAGE_KEYS.timelineClips, newClips);
    };
```

Insert immediately AFTER it:

```tsx
    // Record an uploaded/trimmed audio file into the Recent Audio history so it
    // can be reused across slots (Source Media ↔ Music Bed). Deduped by path,
    // newest first, capped.
    const pushAudioHistory = (p: string, kind: string) => {
        if (!p) return;
        setAudioHistory((prev) => {
            const next = [
                { id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, path: p, kind, createdAt: new Date().toISOString() },
                ...prev.filter((a) => a.path !== p),
            ].slice(0, 25);
            saveJson(STORAGE_KEYS.audioHistory, next);
            return next;
        });
    };

    // Adopt an existing audio file as the Source Media (and the assembly clip),
    // e.g. reuse the music bed as the narration source.
    const useAsSource = (p: string) => {
        if (!p) return;
        setSourceMediaPath(p);
        setSourceMediaKind('audio');
        const clip: TimelineClip = {
            id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            path: p,
            label: p.split(/[\\/]/).pop() || 'clip',
            startSec: null,
            durationSec: null,
        };
        setClips([clip]);
        saveClipsToCache([clip]);
        toast.success('Using as source media');
    };

    // Adopt an existing audio file as the Music Bed.
    const useAsMusicBed = (p: string) => {
        if (!p) return;
        setMusicPath(p);
        toast.success('Using as music bed');
    };
```

- [ ] **Step 2: Record audio on source upload**

Find (inside `handleSourceUpload`, the audio-only block):

```tsx
                const next = [clip];
                setClips(next);
                saveClipsToCache(next);
            }
            toast.success(`${isVideo ? 'Video' : 'Audio'} uploaded`);
```

Replace with:

```tsx
                const next = [clip];
                setClips(next);
                saveClipsToCache(next);
                pushAudioHistory(response.data.file, 'source');
            }
            toast.success(`${isVideo ? 'Video' : 'Audio'} uploaded`);
```

- [ ] **Step 3: Record audio on music upload**

Find (inside `handleMusicUpload`):

```tsx
            setMusicPath(response.data.file);
            toast.success('Music uploaded');
```

Replace with:

```tsx
            setMusicPath(response.data.file);
            pushAudioHistory(response.data.file, 'music');
            toast.success('Music uploaded');
```

- [ ] **Step 4: Record audio on source trim + add "Use as Music Bed" on the Source card**

Find the Source Media trim button block:

```tsx
                        <button
                            type="button"
                            onClick={() => setTrimTarget({
                                kind: sourceMediaKind === 'video' ? 'video' : 'audio',
                                path: sourceMediaPath,
                                apply: (p) => {
                                    setSourceMediaPath(p);
                                    if (sourceMediaKind !== 'video') {
                                        const clip: TimelineClip = {
                                            id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                            path: p,
                                            label: p.split(/[\\/]/).pop() || 'clip',
                                            startSec: null,
                                            durationSec: null,
                                        };
                                        setClips([clip]);
                                        saveClipsToCache([clip]);
                                    }
                                },
                            })}
                            className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                        >
                            <Scissors size={12} /> Trim
                        </button>
```

Replace with:

```tsx
                        <div className="shrink-0 flex items-center gap-2">
                            {sourceMediaKind !== 'video' && (
                                <button
                                    type="button"
                                    onClick={() => useAsMusicBed(sourceMediaPath)}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                                >
                                    <Music size={12} /> Use as Music Bed
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setTrimTarget({
                                    kind: sourceMediaKind === 'video' ? 'video' : 'audio',
                                    path: sourceMediaPath,
                                    apply: (p) => {
                                        setSourceMediaPath(p);
                                        if (sourceMediaKind !== 'video') {
                                            const clip: TimelineClip = {
                                                id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                                path: p,
                                                label: p.split(/[\\/]/).pop() || 'clip',
                                                startSec: null,
                                                durationSec: null,
                                            };
                                            setClips([clip]);
                                            saveClipsToCache([clip]);
                                            pushAudioHistory(p, 'source');
                                        }
                                    },
                                })}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                            >
                                <Scissors size={12} /> Trim
                            </button>
                        </div>
```

- [ ] **Step 5: Record audio on music trim + add "Use as Source" on the Music card**

Find the Music Bed trim button block:

```tsx
                            <button
                                type="button"
                                onClick={() => setTrimTarget({ kind: 'audio', path: musicPath, apply: setMusicPath })}
                                className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                            >
                                <Scissors size={12} /> Trim
                            </button>
```

Replace with:

```tsx
                            <div className="shrink-0 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => useAsSource(musicPath)}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                                >
                                    <Waves size={12} /> Use as Source
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTrimTarget({ kind: 'audio', path: musicPath, apply: (p) => { setMusicPath(p); pushAudioHistory(p, 'music'); } })}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] text-primary-200 hover:bg-white/[0.12] transition-colors"
                                >
                                    <Scissors size={12} /> Trim
                                </button>
                            </div>
```

- [ ] **Step 6: Add cross-slot actions to the Recent Audio panel**

Find:

```tsx
                                {audioHistory.slice(0, 5).map((item) => (
                                    <div key={item.id} className="text-xs text-content-tertiary break-all">
                                        <button
                                            onClick={() => handleAddClip(item.path, item.kind)}
                                            className="text-primary-400 hover:text-primary-300"
                                        >
                                            + Add
                                        </button>
                                        <span className="ml-2">{item.path}</span>
                                    </div>
                                ))}
```

Replace with:

```tsx
                                {audioHistory.slice(0, 5).map((item) => (
                                    <div key={item.id} className="text-xs text-content-tertiary break-all">
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => handleAddClip(item.path, item.kind)} className="text-primary-400 hover:text-primary-300">
                                                + Add
                                            </button>
                                            <button onClick={() => useAsSource(item.path)} className="text-primary-400 hover:text-primary-300">
                                                Use as Source
                                            </button>
                                            <button onClick={() => useAsMusicBed(item.path)} className="text-primary-400 hover:text-primary-300">
                                                Use as Music Bed
                                            </button>
                                        </div>
                                        <span className="block mt-1">{item.path}</span>
                                    </div>
                                ))}
```

- [ ] **Step 7: Typecheck + build**

Run: `cd client && npm run build`
Expected: PASS — `tsc -b` no errors (`Music`, `Waves`, `Scissors` are already imported in this file), `vite build` completes.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/TimelinePage.tsx
git commit -m "feat(timeline): trim-output reuse across Source and Music Bed"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Per-day send.** Generate a pack → the free card shows a "Send a day to Timeline" list (Day 1…7 · reference). Click one day → narrates only that day, lands on Timeline with that day's caption lines, Render Captioned Video enabled.
- [ ] **Step 2: History.** Generate → a History panel lists the pack. Reload the page → it persists (server-backed). Click **Open** → it reloads into the view. Click **Delete** → it's removed. Regenerate the same titles → no duplicate (upsert).
- [ ] **Step 3: Trim reuse.** On Timeline, upload an audio source → **Use as Music Bed** appears and sets the music. Upload music → **Use as Source** appears and sets the source. Trim a source/music file → it appears in **Recent Audio** with **Use as Source** / **Use as Music Bed** actions.
- [ ] **Step 4:** If any step fails, file the discrepancy; do not paper over it.

---

## Self-Review

**Spec coverage:**
- Per-day parser → Task 1. ✓
- Per-day UI (buttons per day, single button removed) → Task 4. ✓
- Server history store (mirror transcriptStore, upsert by titles, cap 50) → Task 2. ✓
- Persist-on-generate + history GET/DELETE → Task 3. ✓
- History panel UI (open/delete, persists) → Task 4. ✓
- Trim-output reuse (record audio history; Source↔Music actions; Recent Audio actions) → Task 5. ✓
- Tests: parser (Task 1), store (Task 2), manual (Task 6). ✓
- Best-effort history save never blocks generation → Task 3 Step 2. ✓
- Graceful per-day TTS failure (reuses existing path) → Task 4 `narrateAndSendToTimeline`. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**Type consistency:** `DevotionalDay { dayNumber, reference, narrationText, lines }` defined in Task 1, consumed in Task 4. `GumroadRecord` fields match the store record in Task 2. Store fn names (`listGumroadPacks`/`upsertGumroadPack`/`deleteGumroadPack`) consistent across Tasks 2–3. `pushAudioHistory`/`useAsSource`/`useAsMusicBed` defined and used within Task 5. ✓
