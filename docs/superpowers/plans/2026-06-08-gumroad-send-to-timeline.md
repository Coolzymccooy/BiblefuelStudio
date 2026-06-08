# Gumroad → "Send to Timeline" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Send to Timeline" button to the Gumroad page that narrates the free devotional via the existing TTS pipeline, seeds the Timeline editor's localStorage state, and navigates the user one click from a finished captioned video.

**Architecture:** A thin, client-only bridge. A pure parser turns the free Gumroad markdown into narration text + caption lines. The handler calls the existing `POST /api/tts/synthesize-category` endpoint, then writes Timeline's `scl*` localStorage keys (which Timeline hydrates on mount via `usePersistedState` → `loadJson`/`saveJson`). No backend, TTS, render, or Timeline code changes.

**Tech Stack:** React 19, TypeScript, react-router-dom v7, Vitest, existing `api` client + `storage` helpers.

---

## Context the implementer needs

**Verified facts (do not re-derive):**

- `usePersistedState(key, fallback)` ([client/src/lib/usePersistedState.ts](../../../client/src/lib/usePersistedState.ts)) hydrates synchronously from `loadJson(key, fallback)` on mount, and `loadJson`/`saveJson` ([client/src/lib/storage.ts](../../../client/src/lib/storage.ts)) are plain `JSON.parse`/`JSON.stringify`. So `saveJson(STORAGE_KEYS.sclX, value)` before navigation is read byte-for-byte by Timeline on mount.
- Timeline ([client/src/pages/TimelinePage.tsx](../../../client/src/pages/TimelinePage.tsx)) "Render Captioned Video" button is enabled when `sourceMediaPath` **and** `transcript` are set; with `autoBackground` defaulting to `true` and `backgroundItems` defaulting to `[]`, the disabled clause `(sourceMediaKind==='audio' && backgroundItems.length===0 && !autoBackground)` is `false`. So seeding source + transcript makes the button live with an Auto background.
- Timeline reads `clips[0]` as an optional render **trim** (`assemblyClip?.startSec / durationSec`). A stale `timelineClips` entry from a prior session would silently trim our narration → **we must clear `STORAGE_KEYS.timelineClips` to `[]` when seeding.**
- TTS contract: `POST /api/tts/synthesize-category` body `{ text, category, withTimestamps }` → response `{ ok, data: { file, words?, alignment?, ... } }`. `words` is `{ text, startMs, endMs }[]` (Timeline's exact `sclTranscript` shape) but is **only present for native-timing providers**; otherwise absent → plan falls back to even distribution.
- `category: 'devotional'` is a verified-valid category (used in [server/src/routes/tts.js](../../../server/src/routes/tts.js) chatterbox route).
- `api.post(url, body)` returns `{ ok, data, error }`. `api.mediaUrl(pathOrName)` builds a playable URL. (`client/src/lib/api.ts`)
- Test runner: `npx vitest run <file>` (client `package.json` → `"test": "vitest run"`). Tests live in `client/src/lib/__tests__/`.
- The free markdown format (from `server/src/lib/gumroadPacks.js`) is, per day:
  ```
  ## Day 1: Philippians 4:6-7
  **Verse:** Do not be anxious about anything... will guard your hearts.

  **Reflection:** Breathe. God is present. This moment does not control your future — God does.

  **Prayer:** Lord, I give You what I cannot carry. Fill my heart with Your peace. Amen.
  ```
  plus a `# title`, an intro paragraph, and a `---` footer. The parser extracts **only** `**Verse:** / **Reflection:** / **Prayer:**` lines and ignores everything else.

**Commands run from the worktree root:** `c:\Users\segun\source\repos\biblefuel-studio\.claude\worktrees\feat-gumroad-send-to-timeline\client`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `client/src/lib/gumroadToTimeline.ts` | **new** — pure functions: parse free markdown → `{ narrationText, lines }`; build/extract transcript word timings. No DOM, no I/O. |
| `client/src/lib/__tests__/gumroadToTimeline.test.ts` | **new** — unit tests for the pure functions. |
| `client/src/pages/GumroadPage.tsx` | **modify** — add `sendToTimeline()` handler, a DOM `getAudioDurationSec` helper, and the button. |

---

### Task 1: Markdown parser (`parseFreeDevotional` + `chunkWords`)

**Files:**
- Create: `client/src/lib/gumroadToTimeline.ts`
- Test: `client/src/lib/__tests__/gumroadToTimeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/__tests__/gumroadToTimeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFreeDevotional } from '../gumroadToTimeline';

const FREE_MD = `# 7 Bible Verses for Anxiety & Fear

A simple devotional from **@Biblefuel** to help you find calm.

## Day 1: Philippians 4:6-7
**Verse:** Do not be anxious about anything but in everything by prayer present your requests to God.

**Reflection:** Breathe. God is present. This moment does not control your future.

**Prayer:** Lord, I give You what I cannot carry. Amen.

---
Want more? Check the **Biblefuel 30-Day Devotional**.`;

describe('parseFreeDevotional', () => {
  it('extracts only verse/reflection/prayer text, ignoring headings/intro/footer', () => {
    const { lines, narrationText } = parseFreeDevotional(FREE_MD);
    // No heading, intro, or footer text leaks in.
    expect(lines.join(' ')).not.toContain('7 Bible Verses');
    expect(lines.join(' ')).not.toContain('@Biblefuel');
    expect(lines.join(' ')).not.toContain('Check the');
    // Real content is present.
    expect(narrationText).toContain('Do not be anxious');
    expect(narrationText).toContain('Breathe. God is present');
    expect(narrationText).toContain('I cannot carry');
  });

  it('keeps narrationText exactly equal to lines joined by a space', () => {
    const { lines, narrationText } = parseFreeDevotional(FREE_MD);
    expect(narrationText).toBe(lines.join(' '));
  });

  it('splits long segments into chunks of at most 8 words', () => {
    const { lines } = parseFreeDevotional(FREE_MD);
    for (const line of lines) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
    expect(lines.length).toBeGreaterThan(1);
  });

  it('tolerates a day missing its prayer line', () => {
    const md = `## Day 1: Psalm 23\n**Verse:** The Lord is my shepherd.\n\n**Reflection:** I shall not want.`;
    const { narrationText } = parseFreeDevotional(md);
    expect(narrationText).toBe('The Lord is my shepherd. I shall not want.');
  });

  it('returns empty output for empty input', () => {
    expect(parseFreeDevotional('')).toEqual({ narrationText: '', lines: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/gumroadToTimeline.test.ts`
Expected: FAIL — `Failed to resolve import "../gumroadToTimeline"` / `parseFreeDevotional is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `client/src/lib/gumroadToTimeline.ts`:

```ts
/**
 * Bridge: turn a generated Gumroad **free** devotional (markdown) into the
 * narration text + caption lines the Timeline editor consumes. Pure — no DOM,
 * no I/O — so it is fully unit-testable. The Timeline page is an audio/caption
 * tool, so this is the text→(narratable) seam.
 */

/** Matches the per-day content lines the free lead magnet emits. */
const LABEL_RE = /^\*\*(?:Verse|Reflection|Prayer):\*\*\s*/;

/** Split text into chunks of at most `size` words (caption-line sized). */
function chunkWords(text: string, size: number): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < words.length; i += size) {
        out.push(words.slice(i, i + size).join(' '));
    }
    return out;
}

/**
 * Parse the free devotional markdown into:
 *  - `lines`: caption-sized lines (<=8 words) for `sclEditedLines`
 *  - `narrationText`: exactly `lines.join(' ')` so TTS words align positionally
 *    with the caption lines (Timeline's reflowWordsFromEditedLines relies on
 *    positional pairing).
 *
 * Only `**Verse:**`, `**Reflection:**`, and `**Prayer:**` lines are kept;
 * the title, intro paragraph, day headings, and footer are ignored.
 */
export function parseFreeDevotional(markdown: string): {
    narrationText: string;
    lines: string[];
} {
    const lines: string[] = [];
    for (const raw of (markdown || '').split(/\r?\n/)) {
        if (!LABEL_RE.test(raw)) continue;
        const text = raw.replace(LABEL_RE, '').trim();
        if (!text) continue;
        for (const chunk of chunkWords(text, 8)) lines.push(chunk);
    }
    return { narrationText: lines.join(' '), lines };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/gumroadToTimeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/gumroadToTimeline.ts client/src/lib/__tests__/gumroadToTimeline.test.ts
git commit -m "feat(gumroad): parseFreeDevotional markdown→narration bridge"
```

---

### Task 2: Transcript timing helpers (`evenDistributeWords` + `extractTranscript`)

**Files:**
- Modify: `client/src/lib/gumroadToTimeline.ts`
- Test: `client/src/lib/__tests__/gumroadToTimeline.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing test file)**

Append to `client/src/lib/__tests__/gumroadToTimeline.test.ts`:

```ts
import { evenDistributeWords, extractTranscript } from '../gumroadToTimeline';

describe('evenDistributeWords', () => {
  it('spreads N words evenly across the duration, monotonically', () => {
    const words = evenDistributeWords('one two three four', 4);
    expect(words).toHaveLength(4);
    expect(words[0].startMs).toBe(0);
    expect(words[3].endMs).toBe(4000);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].endMs - 1);
    }
    expect(words.map((w) => w.text)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('uses a rate-based fallback when duration is non-positive', () => {
    const words = evenDistributeWords('a b c', 0);
    expect(words).toHaveLength(3);
    expect(words[2].endMs).toBeGreaterThan(0);
  });

  it('returns [] for empty text', () => {
    expect(evenDistributeWords('', 5)).toEqual([]);
  });
});

describe('extractTranscript', () => {
  it('prefers provider words when present', () => {
    const provided = [{ text: 'hi', startMs: 0, endMs: 500 }];
    expect(extractTranscript({ words: provided }, 'hi there', 2)).toBe(provided);
  });

  it('falls back to even distribution when words are absent or empty', () => {
    const a = extractTranscript({ words: [] }, 'one two', 2);
    const b = extractTranscript(null, 'one two', 2);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/gumroadToTimeline.test.ts`
Expected: FAIL — `evenDistributeWords is not a function` / `extractTranscript is not a function`.

- [ ] **Step 3: Write the minimal implementation (append to `gumroadToTimeline.ts`)**

Append to `client/src/lib/gumroadToTimeline.ts`:

```ts
/** Word-level timing — matches Timeline's TranscriptWord (`sclTranscript`). */
export interface TranscriptWord {
    text: string;
    startMs: number;
    endMs: number;
}

/** Average seconds-per-word used when no real audio duration is available. */
const FALLBACK_SEC_PER_WORD = 0.4;

/**
 * Spread the narration's words uniformly across `durationSec`. TTS narration is
 * steady-paced, so uniform spacing yields acceptable caption sync. When the
 * duration is unknown (<=0), estimate from a fixed speaking rate.
 */
export function evenDistributeWords(
    narrationText: string,
    durationSec: number,
): TranscriptWord[] {
    const tokens = narrationText.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const safeSec = durationSec > 0 ? durationSec : tokens.length * FALLBACK_SEC_PER_WORD;
    const totalMs = Math.max(1, Math.round(safeSec * 1000));
    const per = totalMs / tokens.length;
    return tokens.map((text, i) => ({
        text,
        startMs: Math.round(i * per),
        endMs: Math.round((i + 1) * per),
    }));
}

/**
 * Resolve a transcript for Timeline. Prefer the provider's native word timings;
 * otherwise even-distribute. (The provider may instead return char-level
 * `alignment`; even distribution covers that case acceptably for steady TTS,
 * so we deliberately do not port the server's char→word converter here.)
 */
export function extractTranscript(
    data: { words?: TranscriptWord[] | null } | null | undefined,
    narrationText: string,
    durationSec: number,
): TranscriptWord[] {
    const words = data?.words;
    if (Array.isArray(words) && words.length) return words;
    return evenDistributeWords(narrationText, durationSec);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/gumroadToTimeline.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/gumroadToTimeline.ts client/src/lib/__tests__/gumroadToTimeline.test.ts
git commit -m "feat(gumroad): TTS transcript timing helpers"
```

---

### Task 3: Wire the "Send to Timeline" button into GumroadPage

**Files:**
- Modify: `client/src/pages/GumroadPage.tsx`

This task is verified by typecheck/build + a manual checklist (component-level TTS+navigation flow is covered by the manual/E2E step, per the spec's testing strategy).

- [ ] **Step 1: Add imports**

In `client/src/pages/GumroadPage.tsx`, update the imports at the top. Change the react-router import and add the bridge + storage imports:

```ts
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { parseFreeDevotional, extractTranscript } from '../lib/gumroadToTimeline';
import { saveJson, STORAGE_KEYS } from '../lib/storage';
```

- [ ] **Step 2: Add the audio-duration helper above the component**

Insert this module-level helper just above `export function GumroadPage()`:

```ts
/**
 * Read an audio file's duration (seconds) by loading its metadata in a detached
 * <Audio> element. Resolves 0 if the metadata can't be read, in which case the
 * caller falls back to a rate-based estimate.
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
```

- [ ] **Step 3: Add navigate + sending state inside the component**

Immediately after the existing `const [isGenerating, setIsGenerating] = useState(false);` line, add:

```ts
    const [isSending, setIsSending] = useState(false);
    const navigate = useNavigate();
```

- [ ] **Step 4: Add the `sendToTimeline` handler**

Add this handler next to `handleDownloadZip` inside the component:

```ts
    const sendToTimeline = async () => {
        if (!result?.freeMarkdown) return;
        const { narrationText, lines } = parseFreeDevotional(result.freeMarkdown);
        if (!narrationText) {
            toast.error('Nothing to narrate in the free devotional');
            return;
        }
        setIsSending(true);
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

            // Seed the Timeline (Sermon Clip Studio) state. Clearing the Main
            // Assembly clips is REQUIRED: Timeline reads clips[0] as a render
            // trim, so a stale clip would silently crop our narration.
            saveJson(STORAGE_KEYS.timelineClips, []);
            saveJson(STORAGE_KEYS.sclSourcePath, file);
            saveJson(STORAGE_KEYS.sclSourceKind, 'audio');
            saveJson(STORAGE_KEYS.sclTranscript, transcript);
            saveJson(STORAGE_KEYS.sclEditedLines, lines);

            toast.success('Sent to Timeline — pick a background and render', { id: toastId });
            navigate('/app/timeline');
        } catch {
            toast.error('Narration failed', { id: toastId });
        } finally {
            setIsSending(false);
        }
    };
```

- [ ] **Step 5: Add the button under the free markdown block**

In the `result.freeMarkdown` `<Card>`, add a button below the `<pre>`. Replace the free-product Card body with:

```tsx
                    {result.freeMarkdown && (
                        <Card title="Free product (Markdown)">
                            <pre className="bg-black/30 border border-white/10 text-gray-200 p-4 rounded overflow-auto text-sm whitespace-pre-wrap">
                                {result.freeMarkdown}
                            </pre>
                            <div className="mt-3">
                                <Button
                                    onClick={sendToTimeline}
                                    isLoading={isSending}
                                    className="w-full sm:w-auto"
                                >
                                    Send to Timeline
                                </Button>
                                <p className="text-xs text-gray-500 mt-2">
                                    Narrates this devotional and opens the Timeline editor — pick a
                                    background and render a captioned video.
                                </p>
                            </div>
                        </Card>
                    )}
```

(The paid card is left unchanged — its verses are placeholders and are intentionally not narratable.)

- [ ] **Step 6: Typecheck + build to verify the wiring compiles**

Run: `npm run build`
Expected: PASS — `tsc -b` reports no errors and `vite build` completes. (If `tsc` flags `response.data` as untyped, the `as string` cast on `file` already covers the one access that needs it; no other changes required.)

- [ ] **Step 7: Run the full client test suite**

Run: `npx vitest run`
Expected: PASS — the new `gumroadToTimeline` tests pass and no existing test regressed.

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/GumroadPage.tsx
git commit -m "feat(gumroad): Send-to-Timeline button — narrate + seed Timeline"
```

---

### Task 4: Manual verification

- [ ] **Step 1: Start the app and sign in as super-admin**

Run the dev servers (server + client) per the repo's normal dev flow. Navigate to `/app/gumroad`.

- [ ] **Step 2: Generate, then send**

1. Click **Generate** → the free + paid markdown render.
2. Click **Send to Timeline**.
   - Expected: a "Narrating devotional…" toast, then "Sent to Timeline…", then redirect to `/app/timeline`.

- [ ] **Step 3: Confirm Timeline landed render-ready**

On `/app/timeline`, verify:
- **Source Media** shows a loaded audio file (the TTS narration).
- **Transcribe & Caption** shows the devotional split into editable caption lines.
- The **Render Captioned Video** button is **enabled** (Auto background is on by default).

- [ ] **Step 4: Render a captioned video**

Click **Render Captioned Video** → confirm it produces a video with the devotional narration and synced captions.

- [ ] **Step 5: Update the plan checkboxes and note any issues**

If any step fails, file the discrepancy and stop — do not paper over a failed manual step.

---

## Self-Review

**Spec coverage:**
- "Narrate the free devotional via existing TTS" → Task 3 (`sendToTimeline` calls `synthesize-category`). ✓
- "Seed Timeline localStorage and navigate" → Task 3 Step 4. ✓
- Parser (`gumroadToTimeline.ts`) → Tasks 1–2. ✓
- "Free only; paid hidden" → Task 3 Step 5 (button only inside the `freeMarkdown` card). ✓
- "Timestamp fallback (even distribution)" → Task 2 (`evenDistributeWords`/`extractTranscript`). ✓
- "Risk: persistence format must match" → resolved; seeding uses the same `saveJson`/`STORAGE_KEYS` Timeline reads (documented in Context). ✓
- Stale-clip trim hazard → handled (Task 3 clears `timelineClips`). ✓
- Tests → Tasks 1–2 unit, Task 4 manual/E2E. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** `parseFreeDevotional` returns `{ narrationText, lines }` (used consistently in Task 3). `TranscriptWord { text, startMs, endMs }` matches Timeline's `sclTranscript`. `extractTranscript(data, narrationText, durationSec)` signature matches its call site. ✓

**Note vs. spec:** Spec said narration category `"narrator"`; plan uses `"devotional"` — a category verified to exist in `tts.js` and thematically correct. Intentional refinement.
