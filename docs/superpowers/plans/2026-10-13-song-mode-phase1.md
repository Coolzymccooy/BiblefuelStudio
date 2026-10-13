# Song mode — Phase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can create a lyric project, upload a song, paste its lyric sheet, have every line timed automatically, check and nudge flagged lines against a live preview, pick a Studio look, and render a Shorts-safe kinetic lyric video over one background.

**Architecture:** Pure, separately tested server modules under `server/src/lib/lyricVideo/` (sheet parser → windowed Whisper with lyric prompts → sequence alignment → beat grid → section effect policy → ASS via the existing kinetic engine → ffmpeg render), a project store and an Express router mounted at `/api/lyric-video`, and a stepped React page at `/app/lyric-video` whose timing step previews the exact render ASS in the browser with JASSUB.

**Tech Stack:** Node 22 ESM + Express 4 + `node:test` (server); React 19 + TypeScript + Vite + TanStack Query + Tailwind + Vitest/Testing Library (client); ffmpeg/ffprobe (prod 5.1.9, dev 8.x); OpenAI `whisper-1`; `jassub@1.8.8` (libass in WebAssembly).

**Spec:** `docs/superpowers/specs/2026-10-13-song-mode-lyric-video-design.md` (Phase 1 = §14 item 1). Tracker: Coolzymccooy/BiblefuelStudio#51.

**Worktree / branch:** `C:\Users\segun\source\repos\bf-song-mode`, branch `feat/song-mode` (from origin/master 9dcdafe2). Never work in `C:\Users\segun\source\repos\biblefuel-studio` (another agent uses it). Install deps once: `cd server && npm ci` and `cd client && npm ci`.

## Global Constraints

- Prod FFmpeg is **5.1.9**: use only filters that exist in 5.1; pass filter graphs with `-filter_complex_script` (`toFilterScriptArgs` in `server/src/lib/story/storyRender.js`); no `y_align`.
- Whisper: model `whisper-1`, `response_format=verbose_json`, `timestamp_granularities[]=word`, `language=en`, `temperature=0`; prompt capped at **900 characters**, cut at a line boundary.
- Shorts-safe tall layout: nothing drawn above **0.11 h** or below **0.75 h**; right **12%** kept clear (spec §6.4).
- Input limits: sheet ≤ **20 000** characters and ≤ **400** lines; title and artist ≤ **100** characters; line times within `[0, song.durationSec]`.
- Every file path from a request is confined with `confineToDir(req.ctx.outputDir, p)` (`server/src/lib/confinePath.js`).
- Line confidence bar: flag `"check"` when confidence **< 0.6**, an interpolation gap **> 3 s**, or an overlap. Unheard responses: start **0.2 s** after the call's last word, **0.25 s** per word, min **0.7 s**, confidence **0**.
- Reliable prefix rule: stop at the first run of **3** lines with confidence **< 0.5**. Windows **30 s**, start **2 s** before the frontier; one retry at **15 s**.
- Loop rule: a word or 2-/3-gram repeated **≥ 6** times consecutively ends a pass there.
- Render defaults: 720p (portrait 720×1280, landscape 1280×720, square 720×720); 1080p doubles to 1080×1920 / 1920×1080 / 1080×1080. H.264 `-preset veryfast -crf 20`, AAC 192k, `-movflags +faststart`, 30 fps.
- Copy in the UI is plain English (no jargon such as "ASS", "seed", "alignment").
- Commit messages: conventional (`feat:`, `fix:`, `test:`, `chore:`), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`. Never push or open a PR without the operator's go-ahead.
- Every client change ends with `cd client && npm run build` succeeding (`tsc -b && vite build`, the prod command); the rebuilt `server/public` is committed separately as `chore: rebuild client bundle` at the end of the phase.

## Review Focus

1. **A sheet with no `[SECTION]` headings** (plain lyrics pasted from a notes app) must still produce lines in one section and time them — test in Task 2 (`parseSheet` "no headings").
2. **A song whose vocals start late or whose first pass hears nothing** (long instrumental intro, Whisper returns `♪♪`) must still be timed by the windows — test in Task 4 (`transcribeSong` "empty first pass").
3. **Lyrics edited after timing** (a line added or removed) must keep the user's locked lines where their text is unchanged — test in Task 8 (`carryOverTiming`).
4. **A nudge that crosses the neighbouring line or the song's end** must be clamped, not saved out of order — tests in Task 11 (PATCH clamps) and Task 13 (`nudgeLine`).
5. **An upload with no audio stream** (a silent video or an image) must give "That file has no sound in it" instead of a broken project — test in Task 11 (`POST /:id/song`).

---

## File structure

**Server — new** (`server/src/lib/lyricVideo/`)

| File | Responsibility |
|---|---|
| `sheetParser.js` | lyric sheet text → sections, lines (lead/response/soft), skipped notes |
| `align.js` | normalise words, sequence-align sheet tokens to heard words, place lines with confidence/flags |
| `passQuality.js` | loop trimming, hallucination filtering, pass rejection, prompt building |
| `transcribeWindows.js` | pass 0 + windowed transcription loop (dependencies injected) |
| `whisperPrompted.js` | the real Whisper HTTP call with a prompt |
| `beats.js` | decode audio, onset envelope, tempo, beat grid |
| `policy.js` | section effect policy → per-line effect |
| `lyricAss.js` | project → ASS text through the kinetic engine |
| `projectStore.js` | lyric project JSON persistence, artist prefs, timing carry-over |
| `alignJob.js` | the timing job: prepare audio, transcribe, place, beats, persist |
| `lyricRender.js` | ffmpeg args + runner for the final video |
| `__fixtures__/my-time-no-late/` | reference song fixtures (already committed with this plan) |

**Server — modified**

| File | Change |
|---|---|
| `server/src/lib/kinetic/layout.js` | `isTall`, `shorts` slots/anchors/arc, bounds |
| `server/src/lib/kinetic/effects/{curve,frame,pop,quote,slam,stack,title}.js` | `aspect === "tall"` → `isTall(aspect)` |
| `server/src/lib/kinetic/ass.js` | export `EFFECTS`, `assHeader`; `buildAss({ layout })` |
| `server/src/routes/lyricVideo.js` (new) | the API |
| `server/src/middleware/featureGate.js` | `lyric.video` capability for free + premium |
| `server/index.js` | mount router; serve caption fonts at `/caption-fonts` |

**Client — new**

| File | Responsibility |
|---|---|
| `client/src/lib/lyricVideoTypes.ts` | types mirroring the project JSON |
| `client/src/lib/lyricVideoApi.ts` | API calls |
| `client/src/lib/lyricTiming.ts` | pure timing helpers (nudge/clamp, line at time, format) |
| `client/src/hooks/useLyricProject.ts` | project query with polling while a job runs |
| `client/src/components/lyricVideo/LivePreview.tsx` | video + song + JASSUB captions |
| `client/src/components/lyricVideo/{LyricStepper,SongStep,LyricsStep,TimingStep,LookStep,RenderStep}.tsx` | the steps |
| `client/src/pages/LyricVideoPage.tsx` | project list + stepped flow |

**Client — modified:** `client/src/App.tsx` (route), `client/src/pages/StudioHubPage.tsx` (card), `client/package.json` (`jassub`).

---

### Task 1: JASSUB feasibility spike

Decides spec §9. Output is a short findings note plus the pinned dependency; the throwaway page is deleted before commit.

**Files:**
- Modify: `client/package.json` (add `"jassub": "1.8.8"`)
- Create: `docs/superpowers/notes/2026-10-13-jassub-spike.md`
- Temporary (not committed): `client/src/pages/JassubSpikePage.tsx`, a route in `App.tsx`

**Interfaces:**
- Produces: the decision `JASSUB_OK` (yes/no) and the exact import lines that work in this Vite app, recorded in the note. Task 14 uses them.

- [ ] **Step 1: Install**

Run: `cd client && npm install jassub@1.8.8 --save-exact`
Expected: `package.json` has `"jassub": "1.8.8"`.

- [ ] **Step 2: Write the spike page**

```tsx
// client/src/pages/JassubSpikePage.tsx  (TEMPORARY — delete before commit)
import { useEffect, useRef } from 'react';
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Kinetic,Permanent Marker,90,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,0,0,0,0,100,100,1,0,1,4,3,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:00:04.00,Kinetic,,0,0,0,,{\\an5\\pos(338,500)\\fscx150\\fscy150\\t(0,160,\\fscx100\\fscy100)}MY TIME
Dialogue: 0,0:00:02.00,0:00:06.00,Kinetic,,0,0,0,,{\\an5\\pos(338,700)\\fnCaveat}Ọmọ mi, mo dúpẹ́
`;

export function JassubSpikePage() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!video.current) return;
    const t0 = performance.now();
    const r = new JASSUB({
      video: video.current,
      subContent: ASS,
      workerUrl,
      wasmUrl,
      availableFonts: {
        'permanent marker': '/caption-fonts/PermanentMarker.ttf',
        caveat: '/caption-fonts/Caveat-Bold.ttf',
      },
      fallbackFont: 'permanent marker',
    });
    console.info('[spike] JASSUB ready in', Math.round(performance.now() - t0), 'ms');
    return () => r.destroy();
  }, []);
  return (
    <video ref={video} controls className="w-[360px]"
      src="data:video/mp4;base64," /* replace with any local mp4 under /outputs while testing */ />
  );
}
```

Add a temporary route in `client/src/App.tsx` next to the `story` route: `<Route path="jassub-spike" element={<JassubSpikePage />} />` (lazy import like the others). Add a temporary static route in `server/index.js` right after the `/music` static line:

```js
app.use("/caption-fonts", express.static(FONT_DIR, { maxAge: "7d" }));
```

(import `FONT_DIR` from `./src/lib/videoFilters.js`; this line is kept — Task 11 relies on it).

- [ ] **Step 3: Run it**

Start the local stack (`npm run dev` in `server` and `client`), sign in, open `/app/jassub-spike` with a real mp4 from your outputs folder as `src`. Check, and write each answer in the note:
1. Captions draw over the video; "MY TIME" pops; the Yoruba line renders with its marks in Caveat.
2. Browser console: no CSP errors (`script-src` has `'unsafe-eval'`, `worker-src 'self' blob:` — both needed by JASSUB).
3. `setTrack(newContent)` swaps captions without reloading (call it from the console via a temporary `window.__r = r`).
4. Load a generated 3-minute ASS with ~200 events (`node -e` with `server/src/lib/lyricVideo/__fixtures__/my-time-no-late/expected-lines.json` through `buildAss` at 720×1280) — playback stays smooth at 1× on a laptop and on a phone (Chrome DevTools "Mid-tier mobile" CPU throttle 4× is acceptable as the phone check).
5. `npm run build` succeeds with the worker and wasm emitted as assets.

- [ ] **Step 4: Record the decision**

```markdown
# JASSUB spike — 2026-10-13
- Version: jassub 1.8.8
- Imports that work: `import JASSUB from 'jassub'`, `jassub/dist/jassub-worker.js?url`, `jassub/dist/jassub-worker.wasm?url`
- Fonts: served from `/caption-fonts/<file>`; names lower-cased in `availableFonts`
- Checks 1–5: <pass/fail with one line each>
- Decision: JASSUB_OK = yes|no
- Licence: libass is LGPL-2.1; shipped unmodified as a separate wasm asset (dynamic use), which LGPL permits.
```

If any of checks 1–3 or 5 fail, set `JASSUB_OK = no`: Task 14 then uses its **fallback** section.

- [ ] **Step 5: Remove the spike page and route, commit**

Delete `JassubSpikePage.tsx` and its route. Keep `jassub` in `package.json` only if `JASSUB_OK = yes`.

```bash
git add client/package.json client/package-lock.json docs/superpowers/notes/2026-10-13-jassub-spike.md server/index.js
git commit -m "chore: pin jassub for live caption preview (spike findings)"
```

---

### Task 2: Lyric sheet parser

**Files:**
- Create: `server/src/lib/lyricVideo/sheetParser.js`
- Test: `server/src/lib/lyricVideo/sheetParser.test.js`

**Interfaces:**
- Produces:
  - `parseSheet(raw: string) → { sections: Section[], lines: Line[], skipped: string[] }`
  - `Section = { id: "s1"…, kind: "intro"|"verse"|"pre"|"chorus"|"final"|"bridge"|"outro"|"other", label: string }`
  - `Line = { id: "l1"…, sectionId: string, kind: "lead"|"response"|"soft", text: string }`
  - `sectionKind(label: string) → Section["kind"]`
  - `splitLongLine(text: string, { maxWords = 5, maxChars = 28 } = {}) → string[]`
  - `needsSoftFont(text: string) → boolean`
  - `SHEET_MAX_CHARS = 20000`, `SHEET_MAX_LINES = 400`

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/sheetParser.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheet, sectionKind, splitLongLine, needsSoftFont } from "./sheetParser.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const sheet = fs.readFileSync(path.join(FIX, "sheet.txt"), "utf8");

describe("sectionKind", () => {
  test("maps headings to kinds", () => {
    assert.equal(sectionKind("INTRO"), "intro");
    assert.equal(sectionKind("VERSE 2"), "verse");
    assert.equal(sectionKind("PRE-CHORUS"), "pre");
    assert.equal(sectionKind("CHORUS"), "chorus");
    assert.equal(sectionKind("Hook"), "chorus");
    assert.equal(sectionKind("FINAL CHORUS"), "final");
    assert.equal(sectionKind("BRIDGE"), "bridge");
    assert.equal(sectionKind("OUTRO"), "outro");
    assert.equal(sectionKind("Spoken word"), "other");
  });
});

describe("parseSheet on the reference sheet", () => {
  const out = parseSheet(sheet);
  test("finds the eight sections in order", () => {
    assert.deepEqual(out.sections.map((s) => s.kind), ["intro", "verse", "pre", "chorus", "verse", "bridge", "final", "outro"]);
    assert.equal(out.sections[3].label, "CHORUS");
  });
  test("skips the preamble and the stage notes", () => {
    assert.ok(out.skipped.some((s) => s.startsWith("Here is the kinetic")));
    assert.ok(out.skipped.includes("(Talking drum, soft guitar, male vocal)"));
    assert.ok(out.skipped.includes("(Female harmonies enter)"));
    assert.ok(out.skipped.includes("(Instrumental groove with crowd chants)"));
    assert.ok(!out.lines.some((l) => /Talking drum/.test(l.text)));
  });
  test("strips emoji and keeps Yoruba marks exactly", () => {
    assert.ok(out.lines.every((l) => !/[🎵💬🔥✨💃🎉]/u.test(l.text)));
    assert.ok(out.lines.some((l) => l.text.includes("Ọmọ mi")));
    assert.ok(out.lines.some((l) => l.text.normalize("NFC").includes("Oluwa, mo dúpẹ́")));
  });
  test("chorus responses become response lines after their call", () => {
    const chorus = out.sections.find((s) => s.kind === "chorus");
    const inChorus = out.lines.filter((l) => l.sectionId === chorus.id);
    assert.equal(inChorus[0].text, "Who talk say I no go shine?");
    assert.deepEqual([inChorus[1].kind, inChorus[1].text], ["response", "(WHO TALK SAY?!)"]);
  });
  test("an inline response is split off its call", () => {
    const final = out.sections.find((s) => s.kind === "final");
    const fl = out.lines.filter((l) => l.sectionId === final.id);
    assert.deepEqual(fl.slice(0, 4).map((l) => [l.kind, l.text]), [
      ["lead", "WHO TALK SAY?!"], ["response", "(WHO TALK SAY?!)"],
      ["lead", "MY TIME NO LATE!"], ["response", "(NO DEY LATE!)"],
    ]);
  });
  test("bridge lines and lines with ẹ/ọ are soft", () => {
    const bridge = out.sections.find((s) => s.kind === "bridge");
    assert.ok(out.lines.filter((l) => l.sectionId === bridge.id).every((l) => l.kind === "soft"));
    assert.equal(out.lines.find((l) => l.text.includes("Ọmọ")).kind, "soft");
  });
  test("long lines split at the comma nearest the middle", () => {
    assert.ok(out.lines.some((l) => l.text === "Abeg, no tell me make I keep quiet!"));
    assert.ok(out.lines.some((l) => l.text === "Some dey buy house," ) && out.lines.some((l) => l.text === "some dey buy car,"));
  });
});

describe("parseSheet edge cases", () => {
  test("no headings: one 'other' section with every line", () => {
    const out = parseSheet("Line one here\nLine two here\n\nLine three");
    assert.equal(out.sections.length, 1);
    assert.equal(out.sections[0].kind, "other");
    assert.deepEqual(out.lines.map((l) => l.text), ["Line one here", "Line two here", "Line three"]);
  });
  test("verse heading with a colon", () => {
    const out = parseSheet("VERSE 1:\nHello there\nCHORUS:\nSing it");
    assert.deepEqual(out.sections.map((s) => s.kind), ["verse", "chorus"]);
  });
  test("empty input gives no lines", () => {
    assert.deepEqual(parseSheet("   \n  ").lines, []);
  });
});

describe("splitLongLine", () => {
  test("keeps short lines", () => {
    assert.deepEqual(splitLongLine("My time no late"), ["My time no late"]);
  });
  test("splits at the comma nearest the middle", () => {
    assert.deepEqual(splitLongLine("Me I still dey hustle, but I know who I are."), ["Me I still dey hustle,", "but I know who I are."]);
  });
  test("a long line without punctuation stays whole", () => {
    assert.deepEqual(splitLongLine("Pocket nearly empty but my dreams dey there."), ["Pocket nearly empty but my dreams dey there."]);
  });
});

describe("needsSoftFont", () => {
  test("detects Yoruba under-dots and combining marks", () => {
    assert.equal(needsSoftFont("Ọmọ mi"), true);
    assert.equal(needsSoftFont("mo dúpẹ́"), true);
    assert.equal(needsSoftFont("believe again"), false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/sheetParser.test.js`
Expected: FAIL — `Cannot find module './sheetParser.js'`.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/sheetParser.js
/**
 * Reads a pasted lyric sheet: section headings ([CHORUS], VERSE 1:), sung
 * lines, crowd responses in brackets, and stage notes to skip. Words and
 * Yoruba marks are kept exactly as typed; only emoji and bullets go.
 */
export const SHEET_MAX_CHARS = 20000;
export const SHEET_MAX_LINES = 400;

const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const BULLETS = /^[\s•*\->#]+/u;
const SOFT_CHARS = /[ẸẹỌọṢṣ]|\p{M}/u;
const BRACKET_HEADING = /^\s*\[(.+)\]\s*$/;
const BOLD_HEADING = /^\s*\*\*(.+)\*\*\s*$/;
const WORD_HEADING = /^\s*((?:final\s+)?(?:intro|verse|pre-?\s?chorus|chorus|hook|refrain|bridge|outro|ending|coda)\b[^a-z]{0,6}):?\s*$/i;
const WHOLE_PAREN = /^\(.*\)$/;
const INLINE_RESPONSE = /^(.*?\S)\s*(\([^()]+\))\s*$/;

export function sectionKind(label) {
  const s = String(label || "").toLowerCase();
  if (/final/.test(s)) return "final";
  if (/pre/.test(s)) return "pre";
  if (/chorus|hook|refrain/.test(s)) return "chorus";
  if (/verse/.test(s)) return "verse";
  if (/intro/.test(s)) return "intro";
  if (/bridge/.test(s)) return "bridge";
  if (/outro|ending|coda/.test(s)) return "outro";
  return "other";
}

export function needsSoftFont(text) {
  return SOFT_CHARS.test(String(text).normalize("NFD"));
}

/** Splits a long line in two at the punctuation nearest its middle, recursively. */
export function splitLongLine(text, { maxWords = 5, maxChars = 28 } = {}) {
  const t = String(text).trim();
  const words = t.split(/\s+/);
  if (words.length <= maxWords && t.length <= maxChars) return [t];
  const cuts = [];
  for (let i = 0; i < words.length - 1; i += 1) if (/[,!?;:]$/.test(words[i])) cuts.push(i + 1);
  if (!cuts.length) return [t];
  const mid = words.length / 2;
  const at = cuts.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best), cuts[0]);
  const left = words.slice(0, at).join(" ");
  const right = words.slice(at).join(" ");
  return [...splitLongLine(left, { maxWords, maxChars }), ...splitLongLine(right, { maxWords, maxChars })];
}

function clean(raw) {
  return raw.replace(EMOJI, " ").replace(BULLETS, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

function headingOf(line) {
  const m = line.match(BRACKET_HEADING) || line.match(BOLD_HEADING) || line.match(WORD_HEADING);
  if (!m) return null;
  return m[1].split(/\s+[—–-]\s+/)[0].replace(/:$/, "").trim();
}

export function parseSheet(raw) {
  const rows = String(raw || "").slice(0, SHEET_MAX_CHARS).split(/\r?\n/).slice(0, SHEET_MAX_LINES);
  const hasHeadings = rows.some((r) => headingOf(r.trim()));
  const sections = [];
  const lines = [];
  const skipped = [];
  let current = null;
  let prevWasHeading = false;
  const ensureSection = () => {
    if (!current) {
      current = { id: `s${sections.length + 1}`, kind: "other", label: "" };
      sections.push(current);
    }
    return current;
  };
  const push = (kind, text) => {
    const section = ensureSection();
    const soft = kind === "lead" && (section.kind === "bridge" || needsSoftFont(text));
    lines.push({ id: `l${lines.length + 1}`, sectionId: section.id, kind: soft ? "soft" : kind, text });
  };
  for (const row of rows) {
    const label = headingOf(row.trim());
    if (label) {
      current = { id: `s${sections.length + 1}`, kind: sectionKind(label), label };
      sections.push(current);
      prevWasHeading = true;
      continue;
    }
    const text = clean(row);
    if (!text) continue;
    if (hasHeadings && !current) { skipped.push(text); continue; } // preamble before the first heading
    if (WHOLE_PAREN.test(text)) {
      const leadsSoFar = lines.some((l) => l.sectionId === current?.id && l.kind !== "response");
      if (prevWasHeading || !leadsSoFar) skipped.push(text);
      else push("response", text);
      prevWasHeading = false;
      continue;
    }
    prevWasHeading = false;
    const inline = text.match(INLINE_RESPONSE);
    if (inline && !WHOLE_PAREN.test(inline[1])) {
      for (const part of splitLongLine(inline[1])) push("lead", part);
      push("response", inline[2]);
      continue;
    }
    for (const part of splitLongLine(text)) push("lead", part);
  }
  return { sections: sections.filter((s) => lines.some((l) => l.sectionId === s.id)), lines, skipped };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/sheetParser.test.js`
Expected: PASS (all). If "long lines split" fails because a sheet line splits differently, fix the implementation, not the expected sheet text — the expectations come from the reference sheet.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/sheetParser.js server/src/lib/lyricVideo/sheetParser.test.js server/src/lib/lyricVideo/__fixtures__
git commit -m "feat: read pasted lyric sheets into sections, lines and responses"
```

---

### Task 3: Sequence alignment and line placement

**Files:**
- Create: `server/src/lib/lyricVideo/align.js`
- Test: `server/src/lib/lyricVideo/align.test.js`

**Interfaces:**
- Consumes: `Line` from Task 2.
- Produces:
  - `normWord(w: string) → string`
  - `tokenize(lines: Line[]) → Array<{ line: number, word: number, norm: string }>`
  - `alignTokens(a: string[], b: string[]) → number[]` (index into `b`, or −1)
  - `placeLines(lines: Line[], heard: Heard[], { locked?: Map<string, {words}> , durationSec?: number } = {}) → PlacedLine[]`
  - `Heard = { word: string, start: number, end: number }`
  - `PlacedLine = Line & { words: {text,start,end}[], start: number, end: number, confidence: number, flag: "check"|null }`
  - constants `FLAG_CONFIDENCE = 0.6`, `MAX_INTERP_GAP = 3`

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/align.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normWord, tokenize, alignTokens, placeLines } from "./align.js";

const L = (id, text, kind = "lead") => ({ id, sectionId: "s1", kind, text });
const H = (word, start, end = start + 0.3) => ({ word, start, end });

describe("normWord", () => {
  test("strips accents, case and punctuation", () => {
    assert.equal(normWord("Ọmọ,"), "omo");
    assert.equal(normWord("dúpẹ́"), "dupe");
    assert.equal(normWord("man's"), "man's");
    assert.equal(normWord("?!"), "");
  });
});

describe("tokenize", () => {
  test("hyphenated words become parts of one word", () => {
    const t = tokenize([L("l1", "Eh-yeah, eh-yeah!")]);
    assert.deepEqual(t.map((x) => [x.word, x.norm]), [[0, "eh"], [0, "yeah"], [1, "eh"], [1, "yeah"]]);
  });
});

describe("alignTokens", () => {
  test("matches equal words and skips insertions", () => {
    assert.deepEqual(alignTokens(["who", "talk", "say"], ["um", "who", "talk", "say"]), [1, 2, 3]);
  });
  test("a mishearing between matches keeps its slot", () => {
    assert.deepEqual(alignTokens(["i", "dey", "wonder"], ["i", "de", "wonder"]), [0, 1, 2]);
  });
  test("a mismatch at the edge is not trusted", () => {
    assert.deepEqual(alignTokens(["pocket", "nearly"], ["rocket", "nearly"]), [-1, 1]);
  });
});

describe("placeLines", () => {
  test("heard words give their times; line spans first to last word", () => {
    const [l] = placeLines([L("l1", "My time no late")], [H("My", 1), H("time", 1.4), H("no", 1.8), H("late", 2.1, 2.6)]);
    assert.deepEqual(l.words.map((w) => w.start), [1, 1.4, 1.8, 2.1]);
    assert.equal(l.start, 1);
    assert.equal(l.end, 2.6);
    assert.equal(l.confidence, 1);
    assert.equal(l.flag, null);
  });
  test("unheard words are spread between heard neighbours and the line is flagged", () => {
    const [l] = placeLines([L("l1", "one two three four five")], [H("one", 10), H("five", 14)]);
    assert.deepEqual(l.words.map((w) => w.start), [10, 11, 12, 13, 14]);
    assert.equal(l.confidence, 0.4);
    assert.equal(l.flag, "check");
  });
  test("an interpolation gap over 3 s flags even a well-heard line", () => {
    const lines = [L("l1", "alpha beta"), L("l2", "gamma delta"), L("l3", "epsilon zeta")];
    const out = placeLines(lines, [H("alpha", 0), H("beta", 0.5), H("epsilon", 9), H("zeta", 9.5)]);
    assert.equal(out[1].flag, "check");
    assert.equal(out[0].flag, null);
  });
  test("an unheard response sits just after its call, flagged", () => {
    const lines = [L("l1", "Who talk say I no go shine?"), L("l2", "(WHO TALK SAY?!)", "response"), L("l3", "Who talk say the joy no mine?")];
    const heard = [H("Who", 71.18), H("talk", 71.66), H("say", 72.14), H("I", 72.28), H("no", 72.7), H("go", 73.02), H("shine", 73.24, 73.6),
      H("Who", 76.0), H("talk", 76.3), H("say", 76.5), H("the", 76.8), H("joy", 77.1), H("no", 77.3), H("mine", 77.6)];
    const out = placeLines(lines, heard);
    assert.equal(out[1].start, 73.8);
    assert.ok(out[1].end <= out[2].start);
    assert.ok(out[1].end - out[1].start >= 0.7);
    assert.equal(out[1].confidence, 0);
    assert.equal(out[1].flag, "check");
  });
  test("a locked line keeps its times and anchors its neighbours", () => {
    const lines = [L("l1", "aa bb"), L("l2", "cc dd"), L("l3", "ee ff")];
    const locked = new Map([["l2", { words: [{ text: "cc", start: 5, end: 5.5 }, { text: "dd", start: 5.5, end: 6 }] }]]);
    const out = placeLines(lines, [H("aa", 1), H("bb", 1.5), H("ee", 9), H("ff", 9.5)], { locked });
    assert.deepEqual(out[1].words.map((w) => w.start), [5, 5.5]);
    assert.equal(out[1].flag, null);
  });
  test("starts are strictly increasing even when heard times collide", () => {
    const out = placeLines([L("l1", "a b c")], [H("a", 2), H("b", 2), H("c", 2)]);
    const s = out[0].words.map((w) => w.start);
    assert.ok(s[1] > s[0] && s[2] > s[1]);
  });
  test("Yoruba typed in NFD matches NFC heard words", () => {
    const [l] = placeLines([L("l1", "Ọmọ mi".normalize("NFD"))], [H("Omo", 33.08), H("mi", 33.1)]);
    assert.equal(l.confidence, 1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/align.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/align.js
/**
 * Puts the sheet's words on the song's clock: the sheet is matched word by
 * word against what Whisper heard (global alignment), heard words give their
 * times, the rest are spread between heard neighbours. Words always come from
 * the sheet, so spelling and Yoruba marks are never replaced by Whisper's.
 */
export const FLAG_CONFIDENCE = 0.6;
export const MAX_INTERP_GAP = 3;
const MIN_WORD = 0.08;
const RESPONSE_AFTER = 0.2;
const RESPONSE_PER_WORD = 0.25;
const RESPONSE_MIN = 0.7;
const TAIL_WORD = 0.3;

export function normWord(w) {
  return String(w).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9']/g, "");
}

export function tokenize(lines) {
  const out = [];
  lines.forEach((line, li) => {
    String(line.text).trim().split(/\s+/).forEach((word, wi) => {
      for (const part of word.split("-")) {
        const norm = normWord(part);
        if (norm) out.push({ line: li, word: wi, norm });
      }
    });
  });
  return out;
}

/** Needleman–Wunsch: match +2, mismatch −1, gap −1. Mismatch runs count only between matches. */
export function alignTokens(a, b) {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const score = new Int32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 1 diag, 2 up (gap in b), 3 left (gap in a)
  for (let i = 1; i <= n; i += 1) { score[i * W] = -i; move[i * W] = 2; }
  for (let j = 1; j <= m; j += 1) { score[j] = -j; move[j] = 3; }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const d = score[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1);
      const u = score[(i - 1) * W + j] - 1;
      const l = score[i * W + j - 1] - 1;
      const best = Math.max(d, u, l);
      score[i * W + j] = best;
      move[i * W + j] = best === d ? 1 : best === u ? 2 : 3;
    }
  }
  const steps = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i * W + j];
    if (i > 0 && j > 0 && mv === 1) { steps.push({ t: a[i - 1] === b[j - 1] ? "M" : "S", i: i - 1, j: j - 1 }); i -= 1; j -= 1; }
    else if (i > 0 && (j === 0 || mv === 2)) { steps.push({ t: "D", i: i - 1 }); i -= 1; }
    else { steps.push({ t: "I", j: j - 1 }); j -= 1; }
  }
  steps.reverse();
  const map = new Array(n).fill(-1);
  for (let k = 0; k < steps.length; k += 1) {
    const s = steps[k];
    if (s.t === "M") { map[s.i] = s.j; continue; }
    if (s.t !== "S") continue;
    let a0 = k; while (a0 > 0 && steps[a0 - 1].t === "S") a0 -= 1;
    let b0 = k; while (b0 < steps.length - 1 && steps[b0 + 1].t === "S") b0 += 1;
    const before = a0 > 0 && steps[a0 - 1].t === "M";
    const after = b0 < steps.length - 1 && steps[b0 + 1].t === "M";
    if (before && after) map[s.i] = s.j;
  }
  return map;
}

function wordsOf(line) {
  return String(line.text).trim().split(/\s+/);
}

export function placeLines(lines, heard, { locked = new Map(), durationSec = Infinity } = {}) {
  const sortedHeard = [...heard].sort((x, y) => x.start - y.start);
  const tokens = tokenize(lines);
  const map = alignTokens(tokens.map((t) => t.norm), sortedHeard.map((h) => normWord(h.word)));
  // Per sheet word: heard start/end, how many parts, how many heard.
  const slots = lines.map((line) => wordsOf(line).map(() => ({ start: null, end: null, parts: 0, heard: 0 })));
  tokens.forEach((t, k) => {
    const slot = slots[t.line][t.word];
    slot.parts += 1;
    const j = map[k];
    if (j < 0) return;
    slot.heard += 1;
    if (slot.start === null) slot.start = sortedHeard[j].start;
    slot.end = sortedHeard[j].end;
  });
  lines.forEach((line, li) => {
    const lock = locked.get(line.id);
    if (!lock) return;
    lock.words.forEach((w, wi) => { if (slots[li][wi]) Object.assign(slots[li][wi], { start: w.start, end: w.end, heard: slots[li][wi].parts || 1, parts: slots[li][wi].parts || 1, locked: true }); });
  });
  const isUnheardResponse = (li) => lines[li].kind === "response" && !locked.has(lines[li].id) && slots[li].every((s) => s.start === null);
  // Flat order of the words that take part in interpolation.
  const flat = [];
  lines.forEach((line, li) => { if (!isUnheardResponse(li)) slots[li].forEach((s, wi) => flat.push({ li, wi, s })); });
  const gapFlag = new Set();
  let k = 0;
  while (k < flat.length) {
    if (flat[k].s.start !== null) { k += 1; continue; }
    let e = k; while (e < flat.length && flat[e].s.start === null) e += 1;
    const left = k > 0 ? flat[k - 1].s.start : null;
    const right = e < flat.length ? flat[e].s.start : null;
    const count = e - k;
    for (let q = 0; q < count; q += 1) {
      let t;
      if (left !== null && right !== null) t = left + ((right - left) * (q + 1)) / (count + 1);
      else if (right !== null) t = Math.max(0, right - TAIL_WORD * (count - q));
      else if (left !== null) t = Math.min(durationSec, left + TAIL_WORD * (q + 1));
      else t = TAIL_WORD * q;
      flat[k + q].s.start = t;
      flat[k + q].s.interp = true;
    }
    if (left === null || right === null || right - left > MAX_INTERP_GAP) for (let q = k; q < e; q += 1) gapFlag.add(flat[q].li);
    k = e;
  }
  for (let q = 1; q < flat.length; q += 1) {
    if (flat[q].s.start < flat[q - 1].s.start + MIN_WORD) flat[q].s.start = flat[q - 1].s.start + MIN_WORD;
  }
  const out = lines.map((line, li) => {
    const texts = wordsOf(line);
    const parts = slots[li].reduce((n, s) => n + s.parts, 0);
    const heardParts = slots[li].reduce((n, s) => n + s.heard, 0);
    return { ...line, texts, slots: slots[li], confidence: parts ? heardParts / parts : 0, gap: gapFlag.has(li) };
  });
  // Unheard responses: just after their call.
  out.forEach((l, li) => {
    if (!isUnheardResponse(li)) return;
    const call = [...out.slice(0, li)].reverse().find((x) => x.slots.length && x.slots[x.slots.length - 1].start !== null);
    const callLast = call ? call.slots[call.slots.length - 1] : null;
    const callEnd = callLast ? (callLast.end ?? callLast.start + TAIL_WORD) : 0;
    const len = Math.max(RESPONSE_MIN, RESPONSE_PER_WORD * l.texts.length);
    l.slots.forEach((s, wi) => { s.start = callEnd + RESPONSE_AFTER + (len * wi) / l.texts.length; s.respEnd = callEnd + RESPONSE_AFTER + len; });
  });
  const firstStartAfter = (li) => {
    for (let q = li + 1; q < out.length; q += 1) if (out[q].slots.length) return out[q].slots[0].start;
    return durationSec;
  };
  return out.map((l, li) => {
    const next = firstStartAfter(li);
    const words = l.slots.map((s, wi) => {
      const after = wi + 1 < l.slots.length ? l.slots[wi + 1].start : null;
      let end = after ?? (s.respEnd ?? (s.end && !s.interp ? s.end : s.start + TAIL_WORD));
      end = Math.min(end, Number.isFinite(next) ? next - 0.02 : end);
      end = Math.max(end, s.start + MIN_WORD);
      return { text: l.texts[wi], start: round(s.start), end: round(end) };
    });
    const overlap = words.length && Number.isFinite(next) && words[words.length - 1].end > next;
    const isLocked = locked.has(l.id);
    const flag = isLocked ? null : (l.confidence < FLAG_CONFIDENCE || l.gap || overlap ? "check" : null);
    const { texts, slots: _s, gap: _g, ...rest } = l;
    return {
      ...rest,
      words,
      start: words.length ? words[0].start : 0,
      end: words.length ? words[words.length - 1].end : 0,
      confidence: isLocked ? 1 : round(l.confidence),
      flag,
    };
  });
}

function round(n) { return Math.round(n * 100) / 100; }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/align.test.js`
Expected: PASS. The response test expects `start === 73.8` (call's last heard word ends 73.6 + 0.2).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/align.js server/src/lib/lyricVideo/align.test.js
git commit -m "feat: place lyric lines on the song's clock from heard words"
```

---

### Task 4: Pass quality and windowed transcription

**Files:**
- Create: `server/src/lib/lyricVideo/passQuality.js`, `server/src/lib/lyricVideo/transcribeWindows.js`, `server/src/lib/lyricVideo/whisperPrompted.js`
- Test: `server/src/lib/lyricVideo/passQuality.test.js`, `server/src/lib/lyricVideo/transcribeWindows.test.js`, `server/src/lib/lyricVideo/whisperPrompted.test.js`

**Interfaces:**
- Consumes: `normWord`, `placeLines` (Task 3); `Line` (Task 2).
- Produces:
  - `trimLoops(words: Heard[]) → Heard[]` (cut at the first loop; hallucinations removed)
  - `rejectPass(words: Heard[], expected: Set<string>) → string|null`
  - `promptFor(lines: Line[], maxChars = 900) → string`
  - `transcribeSong({ audioPath, durationSec, lines, transcribe, cutAudio, onProgress? }) → Promise<{ heard: Heard[], passes: Array<{ from, to, status: "used"|"rejected", reason? }> }>`
    - `transcribe(filePath: string, prompt: string) → Promise<{ words: Heard[] }>` (times relative to the file)
    - `cutAudio(from: number, to: number) → Promise<string>` (a file path)
  - `transcribePrompted(audioPath, prompt, { fetchImpl?, apiKey? }) → Promise<{ words: Heard[] }>` (throws `Error` with the HTTP status on failure)

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/passQuality.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { trimLoops, rejectPass, promptFor } from "./passQuality.js";

const W = (text, t0 = 0) => text.split(" ").map((w, i) => ({ word: w, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25 }));

describe("trimLoops", () => {
  test("cuts at a 3-word phrase repeated six times", () => {
    const words = [...W("see as the table"), ...W(Array(8).fill("who talk say").join(" "), 2)];
    const out = trimLoops(words);
    assert.deepEqual(out.map((w) => w.word), ["see", "as", "the", "table"]);
  });
  test("cuts at a single word repeated six times", () => {
    assert.equal(trimLoops(W("my love smoke smoke smoke smoke smoke smoke smoke")).length, 2);
  });
  test("keeps 'dance, dance, dance' and two repeats of a hook", () => {
    assert.equal(trimLoops(W("oya dance dance dance who talk say who talk say")).length, 10);
  });
  test("drops hallucinated sign-offs and music notes", () => {
    assert.deepEqual(trimLoops(W("eh yeah ♪ thanks for watching")).map((w) => w.word), ["eh", "yeah"]);
  });
});

describe("rejectPass", () => {
  const expected = new Set(["from", "lagos", "traffic", "to", "the", "london", "rain"]);
  test("accepts a pass that hears the expected words", () => {
    assert.equal(rejectPass(W("from lagos traffic to the london rain"), expected), null);
  });
  test("rejects empty, music-only and off-lyric passes", () => {
    assert.match(rejectPass([], expected), /nothing/);
    assert.match(rejectPass(W("♪ ♪"), expected), /nothing/);
    assert.match(rejectPass(W("subscribe now please like share"), expected), /lyrics/);
  });
  test("rejects times that go backwards", () => {
    const words = W("from lagos traffic");
    words[2].start = 0;
    assert.match(rejectPass(words, expected), /order/);
  });
});

describe("promptFor", () => {
  test("joins lines and stops at a line boundary under the cap", () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ text: `line number ${i} goes here` }));
    const p = promptFor(lines, 100);
    assert.ok(p.length <= 100);
    assert.ok(p.endsWith("goes here"));
  });
});
```

```js
// server/src/lib/lyricVideo/transcribeWindows.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheet } from "./sheetParser.js";
import { placeLines, normWord } from "./align.js";
import { transcribeSong } from "./transcribeWindows.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const sheet = fs.readFileSync(path.join(FIX, "sheet.txt"), "utf8");
const pass0 = read("passes/pass0-mix.json").words;
// Every window the hand-made video used, merged: the "song" a fake Whisper hears in any window.
const pool = (() => {
  const all = fs.readdirSync(path.join(FIX, "passes")).filter((f) => f.startsWith("window-"))
    .flatMap((f) => read(`passes/${f}`).words).sort((a, b) => a.start - b.start);
  const out = [];
  for (const w of all) {
    const dup = out.find((o) => normWord(o.word) === normWord(w.word) && Math.abs(o.start - w.start) < 0.25);
    if (!dup) out.push(w);
  }
  return out;
})();

function fakes({ first = pass0 } = {}) {
  const calls = [];
  const cutAudio = async (from, to) => `cut:${from}:${to}`;
  const transcribe = async (file, prompt) => {
    calls.push({ file, prompt });
    if (file === "song.m4a") return { words: first };
    const [, from, to] = file.split(":").map(Number);
    return { words: pool.filter((w) => w.start >= from && w.start < to).map((w) => ({ ...w, start: w.start - from, end: w.end - from })) };
  };
  return { calls, cutAudio, transcribe };
}

describe("transcribeSong on the reference song", () => {
  test("windows recover what the first pass lost, within the acceptance bar", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes();
    const { heard, passes } = await transcribeSong({ audioPath: "song.m4a", durationSec: 181.27, lines, ...f });
    assert.ok(passes.length >= 3, "used several windows");
    assert.ok(f.calls.every((c) => c.prompt.length <= 900));
    const placed = placeLines(lines, heard, { durationSec: 181.27 });
    // Compare line starts by the first sheet word, against the hand-checked timings.
    const expected = read("expected-lines.json");
    const expectedWords = expected.flatMap((l) => l.words.map((w, i) => ({ ...w, lineStart: i === 0, kind: l.kind })));
    const placedWords = placed.flatMap((l) => l.words);
    assert.equal(placedWords.length, expectedWords.length, "same sheet words in the same order");
    const leadStarts = expectedWords.map((w, i) => ({ w, p: placedWords[i] })).filter(({ w }) => w.lineStart && w.kind !== "response");
    const close = leadStarts.filter(({ w, p }) => Math.abs(w.start - p.start) <= 0.3).length;
    assert.ok(close / leadStarts.length >= 0.85, `only ${close}/${leadStarts.length} lead lines within 0.3 s`);
  });

  test("an empty first pass still gets every section timed", async () => {
    const { lines } = parseSheet(sheet);
    const f = fakes({ first: [] });
    const { heard } = await transcribeSong({ audioPath: "song.m4a", durationSec: 181.27, lines, ...f });
    const placed = placeLines(lines, heard, { durationSec: 181.27 });
    const heardLines = placed.filter((l) => l.confidence >= 0.6).length;
    assert.ok(heardLines / placed.length >= 0.7, `only ${heardLines}/${placed.length} lines heard`);
  });

  test("reports progress for each window", async () => {
    const { lines } = parseSheet(sheet);
    const seen = [];
    await transcribeSong({ audioPath: "song.m4a", durationSec: 181.27, lines, ...fakes(), onProgress: (p) => seen.push(p) });
    assert.ok(seen.length >= 2 && seen.every((p) => typeof p.window === "number"));
  });
});
```

Note on the first test's word-count assertion: `expected-lines.json` splits a few lines differently from `parseSheet` (for example "Because the darkness / no fit swallow my light!"), but both are the same sheet words in the same order, so word-by-word comparison is valid. If `placedWords.length` differs, print both word streams and fix `parseSheet` dropping or adding a word — do not edit the fixture.

```js
// server/src/lib/lyricVideo/whisperPrompted.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transcribePrompted } from "./whisperPrompted.js";

test("sends the prompt and word timestamps, returns words", async () => {
  const f = path.join(os.tmpdir(), "wp-test.m4a");
  fs.writeFileSync(f, "x");
  let sent;
  const fetchImpl = async (url, opts) => {
    sent = opts.body;
    return { ok: true, json: async () => ({ words: [{ word: "Eh", start: 0, end: 0.4 }] }) };
  };
  const out = await transcribePrompted(f, "Eh-yeah", { fetchImpl, apiKey: "k" });
  assert.deepEqual(out.words, [{ word: "Eh", start: 0, end: 0.4 }]);
  assert.equal(sent.get("prompt"), "Eh-yeah");
  assert.equal(sent.get("language"), "en");
  assert.equal(sent.get("temperature"), "0");
  assert.equal(sent.getAll("timestamp_granularities[]")[0], "word");
});

test("an HTTP error throws with the status", async () => {
  const f = path.join(os.tmpdir(), "wp-test.m4a");
  fs.writeFileSync(f, "x");
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(transcribePrompted(f, "x", { fetchImpl, apiKey: "k" }), /429/);
});

test("no API key throws a clear error", async () => {
  await assert.rejects(transcribePrompted("x.m4a", "x", { apiKey: "" }), /OPENAI_API_KEY/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/passQuality.test.js src/lib/lyricVideo/transcribeWindows.test.js src/lib/lyricVideo/whisperPrompted.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/passQuality.js
import { normWord } from "./align.js";

const LOOP_REPEATS = 6;
const HALLUCINATIONS = [["thanks", "for", "watching"], ["subscribe"], ["like", "and", "subscribe"]];

/** Whisper's failure modes on sung music: a phrase on loop, music notes, sign-offs. */
export function trimLoops(words) {
  let kept = words.filter((w) => normWord(w.word) && !/♪/.test(w.word));
  for (const h of HALLUCINATIONS) {
    const out = [];
    for (let i = 0; i < kept.length; i += 1) {
      if (h.every((t, k) => normWord(kept[i + k]?.word ?? "") === t)) { i += h.length - 1; continue; }
      out.push(kept[i]);
    }
    kept = out;
  }
  const n = kept.map((w) => normWord(w.word));
  for (let i = 0; i < n.length; i += 1) {
    for (let size = 1; size <= 3; size += 1) {
      let reps = 1;
      while (n.slice(i, i + size).every((t, k) => t === n[i + reps * size + k]) && i + (reps + 1) * size <= n.length) reps += 1;
      if (reps >= LOOP_REPEATS) return kept.slice(0, i);
    }
  }
  return kept;
}

export function rejectPass(words, expected) {
  const real = words.filter((w) => normWord(w.word) && !/♪/.test(w.word));
  if (!real.length) return "heard nothing";
  for (let i = 1; i < real.length; i += 1) if (real[i].start < real[i - 1].start) return "times out of order";
  const hits = real.filter((w) => expected.has(normWord(w.word))).length;
  if (hits / real.length < 0.2) return "did not hear the expected lyrics";
  return null;
}

export function promptFor(lines, maxChars = 900) {
  let out = "";
  for (const l of lines) {
    const next = out ? `${out} ${l.text}` : l.text;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}
```

```js
// server/src/lib/lyricVideo/transcribeWindows.js
import { placeLines, normWord } from "./align.js";
import { trimLoops, rejectPass, promptFor } from "./passQuality.js";

const WINDOW_SEC = 30;
const RETRY_SEC = 15;
const BACKUP_SEC = 2;
const NEXT_LINES = 8;
const LOW = 0.5;

/** Index of the first of three lines in a row heard below LOW, from `from` on; lines.length when none. */
function frontierOf(placed, from = 0) {
  for (let i = from; i < placed.length; i += 1) {
    if ([0, 1, 2].every((k) => !placed[i + k] || placed[i + k].confidence < LOW)) return i;
  }
  return placed.length;
}

function shift(words, by) {
  return words.map((w) => ({ word: w.word, start: w.start + by, end: w.end + by }));
}

/**
 * Pass 0 hears the whole song with the whole sheet as a prompt and is kept up
 * to where it stops matching. From there 30 s windows, each prompted with the
 * next lines of the sheet, carry on to the end. See spec §5.3.
 */
export async function transcribeSong({ audioPath, durationSec, lines, transcribe, cutAudio, onProgress }) {
  const passes = [];
  const first = await transcribe(audioPath, promptFor(lines));
  let heard = trimLoops(first.words || []);
  let placed = placeLines(lines, heard, { durationSec });
  let frontier = frontierOf(placed);
  let frontierTime = frontier > 0 ? placed[frontier - 1].end : 0;
  heard = heard.filter((w) => w.start < frontierTime + 0.5);
  passes.push({ from: 0, to: durationSec, status: "used" });
  let windowNo = 0;
  const maxWindows = Math.ceil(durationSec / 10) + 5;
  while (frontier < lines.length && frontierTime < durationSec - 1 && windowNo < maxWindows) {
    windowNo += 1;
    const from = Math.max(0, frontierTime - BACKUP_SEC);
    const upcoming = lines.slice(frontier, frontier + NEXT_LINES);
    const expected = new Set(upcoming.flatMap((l) => l.text.split(/\s+/).flatMap((w) => w.split("-")).map(normWord)).filter(Boolean));
    const prompt = promptFor(upcoming);
    let got = null;
    for (const len of [WINDOW_SEC, RETRY_SEC]) {
      const to = Math.min(durationSec, from + len);
      onProgress?.({ window: windowNo, from, to });
      const res = await transcribe(await cutAudio(from, to), prompt);
      const words = trimLoops(shift(res.words || [], from));
      const reason = rejectPass(words, expected);
      passes.push({ from, to, status: reason ? "rejected" : "used", ...(reason ? { reason } : {}) });
      if (!reason) { got = { words, to }; break; }
    }
    if (!got) { frontierTime = Math.min(durationSec, from + RETRY_SEC); continue; }
    heard = [...heard.filter((w) => w.start < frontierTime), ...got.words.filter((w) => w.start >= frontierTime)];
    placed = placeLines(lines, heard, { durationSec });
    const nextFrontier = frontierOf(placed, frontier + 1);
    const nextTime = nextFrontier > 0 ? placed[nextFrontier - 1].end : 0;
    frontierTime = nextTime > frontierTime ? nextTime : got.to - 5;
    frontier = Math.max(nextFrontier, frontier + 1);
    heard = heard.filter((w) => w.start < frontierTime + 0.5);
  }
  return { heard, passes };
}
```

```js
// server/src/lib/lyricVideo/whisperPrompted.js
import fs from "node:fs";
import path from "node:path";

const URL_ = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 120_000;

const envKey = () => (process.env.OPENAI_API_KEY || "").replace(/['"]/g, "").trim();

/** Whisper with a lyric prompt and word timestamps. Throws on failure, so the timing job can say why. */
export async function transcribePrompted(audioPath, prompt, { fetchImpl = fetch, apiKey = envKey() } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set on the server");
  const form = new FormData();
  form.set("file", new File([fs.readFileSync(audioPath)], path.basename(audioPath), { type: "audio/mp4" }));
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.set("language", "en");
  form.set("temperature", "0");
  form.set("prompt", String(prompt || "").slice(0, 900));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetchImpl(URL_, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
    if (!resp.ok) throw new Error(`Whisper ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
    const j = await resp.json();
    return { words: (j.words || []).map((w) => ({ word: String(w.word ?? ""), start: Number(w.start), end: Number(w.end) })) };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/passQuality.test.js src/lib/lyricVideo/transcribeWindows.test.js src/lib/lyricVideo/whisperPrompted.test.js`
Expected: PASS. If the acceptance test fails, print the per-line diff (expected vs placed start) and tune **only** the window/frontier logic or alignment — never the bar (0.85 / 0.3 s, spec §5.4).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/passQuality.* server/src/lib/lyricVideo/transcribeWindows.* server/src/lib/lyricVideo/whisperPrompted.*
git commit -m "feat: time sung lyrics with lyric-prompted Whisper windows"
```

---

### Task 5: Beat grid

**Files:**
- Create: `server/src/lib/lyricVideo/beats.js`
- Test: `server/src/lib/lyricVideo/beats.test.js`

**Interfaces:**
- Produces:
  - `onsetEnvelope(samples: Float32Array, sr: number, hop = 256, frame = 1024) → Float32Array`
  - `estimateTempo(env: Float32Array, sr: number, hop: number, { min = 70, max = 180 } = {}) → number` (BPM)
  - `beatTimes(env, sr, hop, bpm, durationSec) → number[]`
  - `decodeMono(filePath, sr = 11025) → Promise<Float32Array>`
  - `detectBeats(filePath) → Promise<{ bpm: number, times: number[] }>`

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/beats.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { onsetEnvelope, estimateTempo, beatTimes, detectBeats } from "./beats.js";

const SR = 11025;
const HOP = 256;
function clicks(bpm, seconds, offset = 0.1) {
  const s = new Float32Array(SR * seconds);
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const i = Math.round(t * SR);
    for (let k = 0; k < 200 && i + k < s.length; k += 1) s[i + k] = Math.sin(k / 3) * Math.exp(-k / 40);
  }
  return s;
}

describe("tempo on click tracks", () => {
  for (const bpm of [100, 120]) {
    test(`${bpm} BPM`, () => {
      const env = onsetEnvelope(clicks(bpm, 20), SR, HOP);
      const got = estimateTempo(env, SR, HOP);
      assert.ok(Math.abs(got - bpm) <= 1, `got ${got}`);
      const times = beatTimes(env, SR, HOP, got, 20);
      assert.ok(Math.abs(times[0] - 0.1) < 0.03, `first beat ${times[0]}`);
    });
  }
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");

test("matches librosa on the reference song excerpt", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const { bpm, times } = await detectBeats(path.join(FIX, "song-60-90s.m4a"));
  const ref = JSON.parse(fs.readFileSync(path.join(FIX, "librosa-beats.json"), "utf8"));
  assert.ok(Math.abs(bpm - ref.bpm) <= 1, `bpm ${bpm} vs ${ref.bpm}`);
  const refTimes = ref.beats.filter((t) => t >= 61 && t <= 89).map((t) => t - 60);
  const dists = refTimes.map((r) => Math.min(...times.map((t) => Math.abs(t - r)))).sort((a, b) => a - b);
  const median = dists[Math.floor(dists.length / 2)];
  assert.ok(median < 0.04, `median distance ${median}s`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/beats.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/beats.js
import { spawn } from "node:child_process";

/** Positive change in log energy per hop: where hits land. */
export function onsetEnvelope(samples, sr, hop = 256, frame = 1024) {
  const n = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);
  const energy = new Float32Array(n);
  for (let f = 0; f < n; f += 1) {
    let e = 0;
    const o = f * hop;
    for (let k = 0; k < frame; k += 1) e += samples[o + k] * samples[o + k];
    energy[f] = Math.log1p(1000 * (e / frame));
  }
  const env = new Float32Array(n);
  for (let f = 1; f < n; f += 1) env[f] = Math.max(0, energy[f] - energy[f - 1]);
  return env;
}

/** Autocorrelation over 70–180 BPM, weighted towards ~115 BPM like librosa's prior. */
export function estimateTempo(env, sr, hop, { min = 70, max = 180 } = {}) {
  const fps = sr / hop;
  const mean = env.reduce((a, b) => a + b, 0) / (env.length || 1);
  const x = Array.from(env, (v) => v - mean);
  const lagMin = Math.floor((60 * fps) / max);
  const lagMax = Math.ceil((60 * fps) / min);
  const ac = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i += 1) s += x[i] * x[i + lag];
    ac[lag] = s;
  }
  let best = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag += 1) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 1) ** 2);
    const score = ac[lag] * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // Parabolic refinement of the peak.
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const denom = a - 2 * b + c;
  const refined = denom !== 0 ? best + (0.5 * (a - c)) / denom : best;
  return Math.round(((60 * fps) / refined) * 100) / 100;
}

/** A constant grid at `bpm`, phased to where the hits line up best. */
export function beatTimes(env, sr, hop, bpm, durationSec) {
  const fps = sr / hop;
  const period = (60 * fps) / bpm;
  let bestOff = 0;
  let bestSum = -Infinity;
  for (let off = 0; off < period; off += 0.25) {
    let s = 0;
    for (let t = off; t < env.length; t += period) s += env[Math.round(t)] || 0;
    if (s > bestSum) { bestSum = s; bestOff = off; }
  }
  const times = [];
  for (let t = bestOff; t / fps < durationSec; t += period) times.push(Math.round((t / fps) * 1000) / 1000);
  return times;
}

export function decodeMono(filePath, sr = 11025) {
  return new Promise((resolve, reject) => {
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, ["-v", "error", "-i", filePath, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"]);
    const chunks = [];
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg decode exited ${code}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

export async function detectBeats(filePath) {
  const sr = 11025;
  const hop = 256;
  const samples = await decodeMono(filePath, sr);
  const env = onsetEnvelope(samples, sr, hop);
  const bpm = estimateTempo(env, sr, hop);
  return { bpm, times: beatTimes(env, sr, hop, bpm, samples.length / sr) };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/beats.test.js`
Expected: PASS. If the reference test is off by a constant (~20–50 ms), the AAC priming delay is the cause: subtract the first-frame delay reported by `ffprobe -show_entries stream=start_time` from the times inside `detectBeats` rather than loosening the 40 ms bar.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/beats.js server/src/lib/lyricVideo/beats.test.js
git commit -m "feat: find a song's tempo and beat grid"
```

---

### Task 6: Shorts-safe layout in the kinetic engine

**Files:**
- Modify: `server/src/lib/kinetic/layout.js`, `server/src/lib/kinetic/ass.js`, `server/src/lib/kinetic/effects/{curve,frame,pop,quote,slam,stack,title}.js`
- Test: `server/src/lib/kinetic/layout.test.js` (add cases), `server/src/lib/kinetic/shortsLayout.test.js` (new)

**Interfaces:**
- Produces:
  - `isTall(aspect) → boolean` (true for `"tall"` and `"shorts"`)
  - layout tables gain a `shorts` entry; `clampBlockY(cy, bh, h, "shorts")` bounds to `[0.11 h, 0.75 h]`
  - `buildAss({ …, layout: "default"|"shorts" })` — `"shorts"` on a tall frame uses aspect `"shorts"`
  - `export const EFFECTS` and `export function assHeader(w, h)` from `ass.js`

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/kinetic/shortsLayout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, EFFECTS, assHeader } from "./ass.js";
import { isTall, clampBlockY, slotsFor } from "./layout.js";

const W = 720;
const H = 1280;
const words = (text, t0) => text.split(" ").map((t, i) => ({ text: t, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.3 }));
const song = [
  ...words("Eh yeah eh yeah", 0.5), ...words("Dem say make I calm down", 3),
  ...words("Who talk say I no go shine", 8), ...words("My time no late my time no late", 12),
  ...words("Oya dance dance dance", 16), ...words("This one na celebration", 19),
];
const ys = (ass) => [...ass.matchAll(/\\(?:move\(-?\d+,-?\d+,-?\d+,|pos\(-?\d+,)(-?\d+)/g)].map((m) => Number(m[1]));

test("isTall covers tall and shorts", () => {
  assert.equal(isTall("tall"), true);
  assert.equal(isTall("shorts"), true);
  assert.equal(isTall("wide"), false);
});

test("shorts blocks are clamped into the safe band", () => {
  assert.equal(clampBlockY(50, 100, H, "shorts"), Math.ceil(H * 0.11 + 50));
  assert.equal(clampBlockY(1200, 100, H, "shorts"), Math.floor(H * 0.75 - 50));
  assert.equal(slotsFor("shorts").length, 3);
});

test("a shorts render keeps every text anchor inside 0.11h–0.75h", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const ass = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed, layout: "shorts" });
    const bad = ys(ass.split("\n").filter((l) => !/\\p1/.test(l) && !/\\clip/.test(l)).join("\n"))
      .filter((y) => y < H * 0.11 - 1 || y > H * 0.75 + 1);
    assert.deepEqual(bad, [], `seed ${seed}`);
  }
});

test("the default layout is unchanged", () => {
  const a = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed: 3 });
  const b = buildAss({ words: song, w: W, h: H, look: "studio-lagos-night", energy: "wild", seed: 3, layout: "default" });
  assert.equal(a, b);
});

test("EFFECTS and assHeader are exported for lyric videos", () => {
  assert.deepEqual(Object.keys(EFFECTS).sort(), ["curve", "frame", "pop", "quote", "slam", "stack", "title"]);
  assert.match(assHeader(W, H), /PlayResX: 720\nPlayResY: 1280/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/kinetic/shortsLayout.test.js`
Expected: FAIL — `isTall` / `EFFECTS` not exported.

- [ ] **Step 3: Implement**

In `server/src/lib/kinetic/layout.js`:

```js
const SIDE = 0.06;
const TALL_BOTTOM = 0.82;
const TALL_X = 0.47; // centre of the band left after the right-hand 12%
// YouTube Shorts covers the top ~11% (status bar, back/search) and the bottom
// ~25% (channel, title, Share): measured from the operator's screenshots.
const SHORTS_TOP = 0.11;
const SHORTS_BOTTOM = 0.75;

const SLOTS = Object.freeze({
  wide: [ /* unchanged */ ],
  tall: [ /* unchanged */ ],
  shorts: [
    { x: TALL_X, y: 0.24, side: false },
    { x: TALL_X, y: 0.42, side: false },
    { x: TALL_X, y: 0.60, side: false },
  ],
});

export const LOWER = Object.freeze({ wide: { x: 0.5, y: 0.80 }, tall: { x: TALL_X, y: 0.70 }, shorts: { x: TALL_X, y: 0.66 } });
export const CENTRE = Object.freeze({ wide: { x: 0.5, y: 0.45 }, tall: { x: TALL_X, y: 0.42 }, shorts: { x: TALL_X, y: 0.42 } });

/** Portrait frames: "tall", or "shorts" (tall with the Shorts/TikTok safe band). */
export function isTall(aspect) {
  return aspect === "tall" || aspect === "shorts";
}

export function maxWidthFor(slot, w, aspect) {
  if (isTall(aspect)) return w * (1 - SIDE - 0.12);
  return slot?.side ? w * 0.42 : w * (1 - 2 * SIDE);
}

export function clampBlockY(cy, blockHeight, h, aspect) {
  const topFrac = aspect === "shorts" ? SHORTS_TOP : SIDE;
  const bottomFrac = aspect === "shorts" ? SHORTS_BOTTOM : aspect === "tall" ? TALL_BOTTOM : 1 - SIDE;
  const top = Math.ceil(h * topFrac + blockHeight / 2);
  const bottom = Math.floor(h * bottomFrac - blockHeight / 2);
  return Math.round(Math.min(Math.max(cy, top), Math.max(top, bottom)));
}

export const ARC = Object.freeze({
  wide: { x: 0.5, y: 0.17, r: 0.45, half: 0.40 },
  tall: { x: TALL_X, y: 0.15, r: 0.55, half: 0.38 },
  shorts: { x: TALL_X, y: 0.19, r: 0.55, half: 0.38 },
});
```

(Keep `aspectOf` and `slotsFor` as they are; `slotsFor("shorts")` now finds its entry.)

In `server/src/lib/kinetic/effects/frame.js` `frameBox`:

```js
import { isTall } from "../layout.js";
export function frameBox(w, h, aspect) {
  if (aspect === "shorts") return { left: 0.06 * w, top: 0.11 * h, right: 0.88 * w, bottom: 0.75 * h };
  return isTall(aspect)
    ? { left: 0.06 * w, top: 0.05 * h, right: 0.88 * w, bottom: 0.82 * h }
    : { left: 0.04 * w, top: 0.05 * h, right: 0.96 * w, bottom: 0.95 * h };
}
```

In every other effect file listed, import `isTall` from `../layout.js` and replace each `aspect === "tall"` with `isTall(aspect)` (curve.js:45, frame.js:58 and :78, pop.js:19, quote.js:54, slam.js:15 and :23, stack.js:40, title.js:34). `LOWER[aspect]`, `CENTRE[aspect]` and `ARC[aspect]` lookups already work once the tables have `shorts`.

In `server/src/lib/kinetic/ass.js`: rename the local `header` to `export function assHeader(w, h)`, change `const EFFECTS = …` to `export const EFFECTS = …`, and in `buildAss` add the parameter and aspect choice:

```js
export function buildAss({ words, lines, w, h, look, energy, seed = 1, overrides = {}, title = "", layout = "default" }) {
  const phrases = phrasesFrom({ words, lines });
  if (!phrases.length) return "";
  const base = aspectOf(w, h);
  const aspect = layout === "shorts" && base === "tall" ? "shorts" : base;
  // …rest unchanged, using assHeader(w, h)
```

- [ ] **Step 4: Run the new test and the whole kinetic suite**

Run: `cd server && node --test src/lib/kinetic/`
Expected: PASS, including every existing kinetic test (the default layout must not move).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/kinetic
git commit -m "feat: Shorts-safe layout for kinetic captions"
```

---

### Task 7: Section effect policy and the lyric ASS

**Files:**
- Create: `server/src/lib/lyricVideo/policy.js`, `server/src/lib/lyricVideo/lyricAss.js`
- Test: `server/src/lib/lyricVideo/policy.test.js`, `server/src/lib/lyricVideo/lyricAss.test.js`

**Interfaces:**
- Consumes: `PlacedLine` (Task 3), `Section` (Task 2), `EFFECTS`, `assHeader`, `planPhrases`, `resolveLook`, `resolveEnergy`, `slotsFor` (engine, Task 6).
- Produces:
  - `chooseEffects({ lines: PlacedLine[], sections: Section[], title: string }) → string[]` (one effect id per line)
  - `titleLineIndexes(lines, title) → Set<number>`
  - `buildLyricAss(project, { w, h, layout = "shorts" }) → string` (`""` when no line is placed)

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/policy.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chooseEffects, titleLineIndexes } from "./policy.js";

const S = (id, kind) => ({ id, kind, label: kind.toUpperCase() });
let t = 0;
const L = (sectionId, text, kind = "lead") => {
  const n = text.split(" ").length;
  const line = { id: `l${t}`, sectionId, kind, text, start: t, end: t + n * 0.4, effect: "auto",
    words: text.split(" ").map((w, i) => ({ text: w, start: t + i * 0.4, end: t + i * 0.4 + 0.4 })) };
  t += n * 0.4 + 1;
  return line;
};

describe("chooseEffects", () => {
  t = 0;
  const sections = [S("s1", "intro"), S("s2", "verse"), S("s3", "chorus"), S("s4", "outro")];
  const lines = [
    L("s1", "Eh-yeah, eh-yeah!"), L("s1", "Dem say make I calm down..."), L("s1", "Oya!"),
    L("s2", "I remember days wey the road no clear,"), L("s2", "Pocket nearly empty but my dreams dey there."),
    L("s2", "But my mama tell me, \"Ọmọ mi\""),
    L("s3", "Who talk say I no go shine?"), L("s3", "(WHO TALK SAY?!)", "response"),
    L("s3", "My time no late, my time no late!"), L("s3", "Na grace carry me,"),
    L("s4", "Who talk say?"), L("s4", "Nobody fit stop wetin God don start!"), L("s4", "Eh-yeah!"),
  ];
  const fx = chooseEffects({ lines, sections, title: "My Time No Late" });
  test("intro opens on a title card and slams a short shout", () => {
    assert.equal(fx[0], "title");
    assert.equal(fx[2], "slam");
  });
  test("verses alternate stack and pop; a quotation is a quote", () => {
    assert.deepEqual(fx.slice(3, 5), ["stack", "pop"]);
    assert.equal(fx[5], "quote");
  });
  test("the chorus frames its title line and the response pops", () => {
    assert.equal(fx[8], "frame");
    assert.equal(fx[7], "pop");
  });
  test("a long chorus line is never a slam", () => {
    assert.notEqual(fx[6], "slam");
  });
  test("outro: curve first, slam last", () => {
    assert.equal(fx[10], "curve");
    assert.equal(fx[12], "slam");
  });
  test("a line's own choice wins", () => {
    const own = lines.map((l, i) => (i === 3 ? { ...l, effect: "curve" } : l));
    assert.equal(chooseEffects({ lines: own, sections, title: "x" })[3], "curve");
  });
  test("two slams never land within 4 s of each other", () => {
    t = 0;
    const tight = [S("s1", "chorus")];
    const ls = [L("s1", "Oya dance!"), L("s1", "Dance dance!"), L("s1", "Celebrate!")].map((l, i) => ({ ...l, start: i, end: i + 0.5 }));
    const out = chooseEffects({ lines: ls, sections: tight, title: "zzz" });
    assert.equal(out.filter((e) => e === "slam").length, 1);
  });
});

describe("titleLineIndexes", () => {
  test("by the song title, else the most repeated chorus line", () => {
    const sections = [S("c", "chorus")];
    const lines = [{ sectionId: "c", text: "Na grace carry me" }, { sectionId: "c", text: "Who talk say?" }, { sectionId: "c", text: "Who talk say?" }];
    assert.deepEqual([...titleLineIndexes(lines, "Not In Lyrics", sections)], [1, 2]);
    assert.deepEqual([...titleLineIndexes(lines, "Na grace", sections)], [0]);
  });
});
```

```js
// server/src/lib/lyricVideo/lyricAss.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLyricAss } from "./lyricAss.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected-lines.json"), "utf8"));
const kinds = { intro: "intro", verse1: "verse", pre: "pre", chorus1: "chorus", verse2: "verse", bridge: "bridge", final: "final", outro: "outro" };
const sectionIds = [...new Set(expected.map((l) => l.section))];
const project = {
  title: "My Time No Late",
  look: { id: "studio-lagos-night", energy: "wild", seed: 2026 },
  sections: sectionIds.map((s) => ({ id: s, kind: kinds[s], label: s })),
  lines: expected.map((l, i) => ({ id: `l${i}`, sectionId: l.section, kind: l.kind === "response" ? "response" : "lead",
    text: l.text, words: l.words, start: l.start, end: l.end, effect: "auto", confidence: 1, flag: null })),
};

test("builds a full ASS document with every line's words", () => {
  const ass = buildLyricAss(project, { w: 720, h: 1280 });
  assert.match(ass, /^\[Script Info\]/);
  assert.match(ass, /PlayResY: 1280/);
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(events.length >= project.lines.length);
  assert.match(ass, /MY TIME/);
});

test("the same project renders the same ASS", () => {
  assert.equal(buildLyricAss(project, { w: 720, h: 1280 }), buildLyricAss(project, { w: 720, h: 1280 }));
});

test("unplaced lines are left out; none placed gives an empty string", () => {
  const empty = { ...project, lines: project.lines.map((l) => ({ ...l, words: [] })) };
  assert.equal(buildLyricAss(empty, { w: 720, h: 1280 }), "");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/policy.test.js src/lib/lyricVideo/lyricAss.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/policy.js
/**
 * Which effect each line gets, from its section and its shape (spec §6.1).
 * Effects are forced into the engine's plan, so this keeps the engine's own
 * spacing rules: slams 4 s apart and at most 4 words, a frame every 30 s,
 * a curve every 20 s, and only pop/stack past 5 words.
 */
const SLAM_GAP = 4;
const FRAME_GAP = 30;
const CURVE_GAP = 20;
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export function titleLineIndexes(lines, title, sections) {
  const hookSections = new Set(sections.filter((s) => s.kind === "chorus" || s.kind === "final").map((s) => s.id));
  const t = norm(title);
  const byTitle = new Set();
  lines.forEach((l, i) => { if (t && hookSections.has(l.sectionId) && norm(l.text).includes(t)) byTitle.add(i); });
  if (byTitle.size) return byTitle;
  const counts = new Map();
  lines.forEach((l) => { if (hookSections.has(l.sectionId)) counts.set(norm(l.text), (counts.get(norm(l.text)) || 0) + 1); });
  const top = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])[0]?.[0];
  const out = new Set();
  if (top) lines.forEach((l, i) => { if (hookSections.has(l.sectionId) && norm(l.text) === top) out.add(i); });
  return out;
}

export function chooseEffects({ lines, sections, title }) {
  const kindOf = new Map(sections.map((s) => [s.id, s.kind]));
  const titleLines = titleLineIndexes(lines, title, sections);
  let lastSlamEnd = -Infinity;
  let lastFrame = -Infinity;
  let lastCurve = -Infinity;
  const framedSection = new Set();
  const curvedSection = new Set();
  const alt = new Map();
  const firstInSection = new Map();
  const lastInSection = new Map();
  lines.forEach((l, i) => { if (!firstInSection.has(l.sectionId)) firstInSection.set(l.sectionId, i); lastInSection.set(l.sectionId, i); });
  const flip = (sid) => { const n = (alt.get(sid) || 0) + 1; alt.set(sid, n); return n % 2 === 1 ? "stack" : "pop"; };
  return lines.map((l, i) => {
    const words = wordCount(l.text);
    const kind = kindOf.get(l.sectionId) || "other";
    const canSlam = words <= 4 && l.start - lastSlamEnd >= SLAM_GAP;
    const canCurve = words <= 5 && l.start - lastCurve >= CURVE_GAP;
    let fx;
    if (l.effect && l.effect !== "auto") fx = l.effect;
    else if (l.kind === "response") fx = "pop";
    else if (kind === "intro") {
      if (i === firstInSection.get(l.sectionId) && words <= 5) fx = "title";
      else if (words <= 2 && /!$/.test(l.text) && canSlam) fx = "slam";
      else fx = flip(l.sectionId);
    } else if (kind === "verse" || kind === "other") {
      fx = /["“”]/.test(l.text) ? "quote" : flip(l.sectionId);
    } else if (kind === "pre") {
      const mid = Math.round((firstInSection.get(l.sectionId) + lastInSection.get(l.sectionId)) / 2);
      fx = i === mid && canCurve && !curvedSection.has(l.sectionId) ? "curve" : "stack";
    } else if (kind === "chorus" || kind === "final") {
      if (titleLines.has(i) && !framedSection.has(l.sectionId) && l.start - lastFrame >= FRAME_GAP) fx = "frame";
      else if (canSlam) fx = "slam";
      else if (words > 5) fx = "pop";
      else fx = "stack";
    } else if (kind === "bridge") {
      fx = i === firstInSection.get(l.sectionId) ? "quote" : flip(l.sectionId);
    } else if (kind === "outro") {
      if (i === firstInSection.get(l.sectionId) && canCurve) fx = "curve";
      else if (i === lastInSection.get(l.sectionId) && canSlam) fx = "slam";
      else fx = "stack";
    } else fx = flip(l.sectionId);
    if (words > 5 && fx !== "pop" && fx !== "stack" && (l.effect === "auto" || !l.effect)) fx = "pop";
    if (fx === "slam") lastSlamEnd = l.end;
    if (fx === "frame") { lastFrame = l.start; framedSection.add(l.sectionId); }
    if (fx === "curve") { lastCurve = l.start; curvedSection.add(l.sectionId); }
    return fx;
  });
}
```

```js
// server/src/lib/lyricVideo/lyricAss.js
import { EFFECTS, assHeader } from "../kinetic/ass.js";
import { planPhrases } from "../kinetic/director.js";
import { resolveLook, resolveEnergy } from "../kinetic/looks.js";
import { aspectOf, slotsFor } from "../kinetic/layout.js";
import { chooseEffects } from "./policy.js";

/** The project's captions as an ASS document, exactly as the render draws them. */
export function buildLyricAss(project, { w, h, layout = "shorts" }) {
  const placed = (project.lines || []).filter((l) => Array.isArray(l.words) && l.words.length && Number.isFinite(l.start));
  if (!placed.length) return "";
  const base = aspectOf(w, h);
  const aspect = layout === "shorts" && base === "tall" ? "shorts" : base;
  const look = resolveLook(project.look?.id || "studio-lagos-night");
  const energy = resolveEnergy(project.look?.energy, "wild");
  const effects = chooseEffects({ lines: placed, sections: project.sections || [], title: project.title || "" });
  const phrases = placed.map((l) => ({ text: l.text, start: l.start, end: l.end, words: l.words }));
  const overrides = Object.fromEntries(effects.map((fx, i) => [i, fx]));
  const plan = planPhrases({ phrases, energy, seed: Number(project.look?.seed) || 1, overrides, slotCount: slotsFor(aspect).length, titleFirst: false });
  const events = plan.flatMap((planned, i) => EFFECTS[planned.effect]({
    planned, look, energy, w, h, aspect,
    nextStart: i + 1 < plan.length ? plan[i + 1].phrase.start : Infinity,
  }));
  return `${assHeader(w, h)}\n${events.join("\n")}\n`;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/policy.test.js src/lib/lyricVideo/lyricAss.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/policy.* server/src/lib/lyricVideo/lyricAss.*
git commit -m "feat: choose caption effects by song section"
```

---

### Task 8: Lyric project store

**Files:**
- Create: `server/src/lib/lyricVideo/projectStore.js`
- Test: `server/src/lib/lyricVideo/projectStore.test.js`

**Interfaces:**
- Consumes: `parseSheet` (Task 2).
- Produces:
  - `createProject(dataDir, { title, artist }) → Project`
  - `readProject(dataDir, id) → Project|null`, `writeProject(dataDir, project) → Project` (atomic; bumps `updatedAt`)
  - `listProjects(dataDir) → Array<{ projectId, title, artist, updatedAt, hasRender: boolean }>` (newest first)
  - `deleteProject(dataDir, id) → boolean`
  - `readPrefs(dataDir) → { artist: string }`, `writePrefs(dataDir, { artist }) → { artist }`
  - `cleanText(value, max = 100) → string` (control chars removed, trimmed, capped)
  - `applySheet(project, raw) → Project` (parse; carry timing over by text — see below)
  - `carryOverTiming(oldLines, newLines) → newLines` (a new line takes the old line's words/start/end/locked/effect when the same text appears at the same occurrence number)
  - Project shape as spec §4 with defaults: `look: { id: "studio-lagos-night", energy: "wild", seed: 1 }`, `timing: { status: "idle" }`, `background: null`, `renders: []`.

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/projectStore.test.js
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, readProject, writeProject, listProjects, deleteProject, readPrefs, writePrefs, cleanText, applySheet, carryOverTiming } from "./projectStore.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-store-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("projects", () => {
  test("create, read, list, delete", () => {
    const p = createProject(dir, { title: " My Time No Late ", artist: "Sthill Waters" });
    assert.match(p.projectId, /^lv_[a-z0-9]+$/);
    assert.equal(p.title, "My Time No Late");
    assert.deepEqual(p.look, { id: "studio-lagos-night", energy: "wild", seed: 1 });
    assert.equal(readProject(dir, p.projectId).title, "My Time No Late");
    assert.equal(listProjects(dir)[0].projectId, p.projectId);
    assert.equal(deleteProject(dir, p.projectId), true);
    assert.equal(readProject(dir, p.projectId), null);
  });
  test("a malicious id never escapes the folder", () => {
    assert.equal(readProject(dir, "../../etc/passwd"), null);
  });
  test("writes are atomic and bump updatedAt", async () => {
    const p = createProject(dir, { title: "A", artist: "" });
    await new Promise((r) => setTimeout(r, 5));
    const next = writeProject(dir, { ...p, title: "B" });
    assert.ok(next.updatedAt > p.updatedAt);
    assert.deepEqual(fs.readdirSync(path.join(dir, "lyric-projects")).filter((f) => f.endsWith(".tmp")), []);
  });
});

test("artist is remembered per user", () => {
  assert.deepEqual(readPrefs(dir), { artist: "" });
  writePrefs(dir, { artist: "Sthill Waters" });
  assert.deepEqual(readPrefs(dir), { artist: "Sthill Waters" });
});

test("cleanText strips control characters and caps length", () => {
  assert.equal(cleanText("a\u0000b\u0007c"), "abc");
  assert.equal(cleanText("x".repeat(150)).length, 100);
});

describe("carryOverTiming", () => {
  const timed = (text, start, locked = false) => ({ text, words: [{ text, start, end: start + 1 }], start, end: start + 1, locked, effect: "slam" });
  test("same text at the same occurrence keeps its timing, lock and effect", () => {
    const old = [timed("Who talk say?", 10, true), timed("Who talk say?", 20, true), timed("Eh!", 30)];
    const next = [{ text: "Who talk say?" }, { text: "New line" }, { text: "Who talk say?" }, { text: "Eh!" }];
    const out = carryOverTiming(old, next);
    assert.equal(out[0].start, 10);
    assert.equal(out[0].locked, true);
    assert.equal(out[1].words, undefined);
    assert.equal(out[2].start, 20);
    assert.equal(out[3].effect, "slam");
  });
});

test("applySheet parses the sheet and records it", () => {
  const p = createProject(dir, { title: "T", artist: "" });
  const next = applySheet(p, "[CHORUS]\nWho talk say?\n(WHO TALK SAY?!)");
  assert.equal(next.sheet.raw.includes("CHORUS"), true);
  assert.deepEqual(next.lines.map((l) => [l.kind, l.text, l.effect]), [["lead", "Who talk say?", "auto"], ["response", "(WHO TALK SAY?!)", "auto"]]);
  assert.equal(next.timing.status, "idle");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/projectStore.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/projectStore.js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseSheet } from "./sheetParser.js";

const DIR = "lyric-projects";
const PREFS = "lyric-video-prefs.json";

const dirOf = (dataDir) => path.join(dataDir, DIR);
function fileOf(dataDir, id) {
  const safe = String(id || "");
  if (!/^lv_[a-z0-9]+$/.test(safe)) return null;
  return path.join(dirOf(dataDir), `${safe}.json`);
}

export function cleanText(value, max = 100) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
  fs.renameSync(tmp, file);
}

export function createProject(dataDir, { title, artist }) {
  const now = new Date().toISOString();
  const project = {
    projectId: `lv_${crypto.randomBytes(8).toString("hex")}`,
    version: 1, createdAt: now, updatedAt: now,
    title: cleanText(title) || "Untitled song", artist: cleanText(artist),
    song: null, sheet: { raw: "", parsedAt: null }, sections: [], lines: [],
    timing: { status: "idle" },
    look: { id: "studio-lagos-night", energy: "wild", seed: 1 },
    background: null, renders: [],
  };
  atomicWrite(fileOf(dataDir, project.projectId), project);
  return project;
}

export function readProject(dataDir, id) {
  const file = fileOf(dataDir, id);
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function writeProject(dataDir, project) {
  const file = fileOf(dataDir, project.projectId);
  if (!file) throw new Error("invalid projectId");
  const next = { ...project, updatedAt: new Date().toISOString() };
  atomicWrite(file, next);
  return next;
}

export function listProjects(dataDir) {
  if (!fs.existsSync(dirOf(dataDir))) return [];
  return fs.readdirSync(dirOf(dataDir)).filter((f) => /^lv_[a-z0-9]+\.json$/.test(f))
    .map((f) => readProject(dataDir, f.replace(/\.json$/, ""))).filter(Boolean)
    .map((p) => ({ projectId: p.projectId, title: p.title, artist: p.artist, updatedAt: p.updatedAt, hasRender: (p.renders || []).length > 0 }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteProject(dataDir, id) {
  const file = fileOf(dataDir, id);
  if (!file || !fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export function readPrefs(dataDir) {
  try { return { artist: cleanText(JSON.parse(fs.readFileSync(path.join(dataDir, PREFS), "utf8")).artist) }; } catch { return { artist: "" }; }
}

export function writePrefs(dataDir, { artist }) {
  const prefs = { artist: cleanText(artist) };
  atomicWrite(path.join(dataDir, PREFS), prefs);
  return prefs;
}

export function carryOverTiming(oldLines, newLines) {
  const pool = new Map();
  for (const l of oldLines || []) {
    const k = l.text.trim();
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(l);
  }
  const seen = new Map();
  return newLines.map((l) => {
    const k = l.text.trim();
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    const old = pool.get(k)?.[n];
    if (!old) return l;
    const { words, start, end, locked, effect, confidence, flag } = old;
    return { ...l, words, start, end, locked, effect, confidence, flag };
  });
}

export function applySheet(project, raw) {
  const parsed = parseSheet(raw);
  const fresh = parsed.lines.map((l) => ({ ...l, effect: "auto", locked: false }));
  return {
    ...project,
    sheet: { raw: String(raw), parsedAt: new Date().toISOString(), skipped: parsed.skipped },
    sections: parsed.sections,
    lines: carryOverTiming(project.lines, fresh),
    timing: { ...(project.timing || {}), status: "idle" },
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/projectStore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/projectStore.*
git commit -m "feat: store lyric video projects per user"
```

---

### Task 9: The timing job

**Files:**
- Create: `server/src/lib/lyricVideo/alignJob.js`
- Test: `server/src/lib/lyricVideo/alignJob.test.js`

**Interfaces:**
- Consumes: `readProject`, `writeProject` (Task 8); `transcribeSong` (Task 4); `transcribePrompted` (Task 4); `placeLines` (Task 3); `detectBeats` (Task 5).
- Produces:
  - `runAlignJob({ dataDir, workDir, projectId, deps? }) → Promise<Project>` — sets `timing.status` to `"running"` with `timing.progress = { step, window?, total? }`, then `"done"` (lines placed, sections given `start`, `timing.beats`, `timing.passes`) or `"error"` (`timing.error` set). Never throws.
  - `deps` (for tests) = `{ transcribe, cutAudio, prepareAudio, detectBeats }`; defaults use ffmpeg + `transcribePrompted`.
  - `isAligning(projectId) → boolean` (in-memory guard: one job per project)

- [ ] **Step 1: Write the failing test**

```js
// server/src/lib/lyricVideo/alignJob.test.js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, readProject, writeProject, applySheet } from "./projectStore.js";
import { runAlignJob } from "./alignJob.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-job-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function setup() {
  let p = createProject(dir, { title: "T", artist: "A" });
  p = applySheet(p, "[INTRO]\nMy time no late\n[CHORUS]\nWho talk say?\n(WHO TALK SAY?!)");
  p.song = { file: path.join(dir, "song.m4a"), durationSec: 20 };
  return writeProject(dir, p);
}
const heardSong = [
  { word: "My", start: 1, end: 1.3 }, { word: "time", start: 1.3, end: 1.6 }, { word: "no", start: 1.6, end: 1.9 }, { word: "late", start: 1.9, end: 2.4 },
  { word: "Who", start: 5, end: 5.3 }, { word: "talk", start: 5.3, end: 5.6 }, { word: "say", start: 5.6, end: 6 },
];
const deps = (over = {}) => ({
  prepareAudio: async () => path.join(dir, "prepared.m4a"),
  cutAudio: async (from, to) => `cut:${from}:${to}`,
  transcribe: async () => ({ words: heardSong }),
  detectBeats: async () => ({ bpm: 120, times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] }),
  ...over,
});

test("places lines, sets section starts on the beat, stores beats", async () => {
  const p = setup();
  const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId, deps: deps() });
  assert.equal(done.timing.status, "done");
  assert.equal(done.lines[0].start, 1);
  assert.equal(done.lines[1].start, 5);
  assert.equal(done.lines[2].kind, "response");
  assert.equal(done.lines[2].flag, "check");
  assert.equal(done.sections[1].start, 4.5); // 5 minus half a beat (0.25) snapped to the grid
  assert.equal(done.timing.beats.bpm, 120);
  assert.equal(readProject(dir, p.projectId).timing.status, "done");
});

test("a Whisper failure is stored as an error, not thrown", async () => {
  const p = setup();
  const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId, deps: deps({ transcribe: async () => { throw new Error("Whisper 429: rate limited"); } }) });
  assert.equal(done.timing.status, "error");
  assert.match(done.timing.error, /429/);
});

test("locked lines keep their timing on a re-run", async () => {
  let p = setup();
  p.lines[0] = { ...p.lines[0], locked: true, words: [{ text: "My", start: 0.5, end: 0.8 }, { text: "time", start: 0.8, end: 1 }, { text: "no", start: 1, end: 1.2 }, { text: "late", start: 1.2, end: 1.5 }], start: 0.5, end: 1.5 };
  p = writeProject(dir, p);
  const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId, deps: deps() });
  assert.equal(done.lines[0].start, 0.5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && node --test src/lib/lyricVideo/alignJob.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/alignJob.js
import path from "node:path";
import { spawn } from "node:child_process";
import { readProject, writeProject } from "./projectStore.js";
import { transcribeSong } from "./transcribeWindows.js";
import { transcribePrompted } from "./whisperPrompted.js";
import { placeLines } from "./align.js";
import { detectBeats as realDetectBeats } from "./beats.js";

const running = new Set();
export function isAligning(projectId) { return running.has(projectId); }

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-y", ...args]);
    let err = "";
    proc.stderr.on("data", (d) => { err = (err + d).slice(-500); });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
}

function defaultDeps(workDir, projectId) {
  let prepared = null;
  return {
    prepareAudio: async (song) => {
      prepared = path.join(workDir, `lyric-${projectId}-16k.m4a`);
      await ffmpeg(["-i", song, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", prepared]);
      return prepared;
    },
    cutAudio: async (from, to) => {
      const out = path.join(workDir, `lyric-${projectId}-${Math.round(from * 10)}.m4a`);
      await ffmpeg(["-ss", String(from), "-to", String(to), "-i", prepared, "-c", "copy", out]);
      return out;
    },
    transcribe: (file, prompt) => transcribePrompted(file, prompt),
    detectBeats: realDetectBeats,
  };
}

function snapToBeat(t, beats) {
  if (!beats?.length) return Math.max(0, t);
  return beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]);
}

export async function runAlignJob({ dataDir, workDir, projectId, deps }) {
  let project = readProject(dataDir, projectId);
  if (!project) return null;
  if (running.has(projectId)) return project;
  running.add(projectId);
  const d = { ...defaultDeps(workDir, projectId), ...(deps || {}) };
  const save = (patch) => { project = writeProject(dataDir, { ...project, ...patch, timing: { ...project.timing, ...patch.timing } }); return project; };
  try {
    save({ timing: { status: "running", progress: { step: "preparing" }, error: null } });
    const durationSec = Number(project.song?.durationSec) || 0;
    const audio = await d.prepareAudio(project.song.file);
    save({ timing: { progress: { step: "listening" } } });
    const { heard, passes } = await transcribeSong({
      audioPath: audio, durationSec, lines: project.lines,
      transcribe: d.transcribe, cutAudio: d.cutAudio,
      onProgress: ({ window }) => save({ timing: { progress: { step: "listening", window } } }),
    });
    save({ timing: { progress: { step: "matching" } } });
    const locked = new Map(project.lines.filter((l) => l.locked && l.words?.length).map((l) => [l.id, { words: l.words }]));
    const placed = placeLines(project.lines, heard, { locked, durationSec })
      .map((l, i) => ({ ...l, locked: Boolean(project.lines[i].locked), effect: project.lines[i].effect || "auto" }));
    save({ timing: { progress: { step: "beats" } } });
    const beats = await d.detectBeats(project.song.file);
    const period = beats.bpm > 0 ? 60 / beats.bpm : 0;
    const sections = project.sections.map((s) => {
      const first = placed.find((l) => l.sectionId === s.id);
      return first ? { ...s, start: snapToBeat(first.start - period / 2, beats.times) } : s;
    });
    return save({ lines: placed, sections, timing: { status: "done", progress: null, beats, passes, finishedAt: new Date().toISOString() } });
  } catch (err) {
    return save({ timing: { status: "error", progress: null, error: String(err?.message || err) } });
  } finally {
    running.delete(projectId);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && node --test src/lib/lyricVideo/alignJob.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/alignJob.*
git commit -m "feat: timing job that places every lyric line and finds the beat"
```

---

### Task 10: Render pipeline

**Files:**
- Create: `server/src/lib/lyricVideo/lyricRender.js`
- Test: `server/src/lib/lyricVideo/lyricRender.test.js`

**Interfaces:**
- Consumes: `sceneFrameFilter`, `toFilterScriptArgs` (`story/storyRender.js`); `FIT_COVER`, `FIT_CONTAIN`, `chooseSceneFit`, `probeMediaSize` (`story/sceneFraming.js`); `escapeFontPath`, `FONT_DIR` (`videoFilters.js`); `markRunning`, `markProgress`, `markDone`, `markError`, `attachProc`, `getJob` (`renderJobs.js`).
- Produces:
  - `renderSize(aspect: "portrait"|"landscape"|"square", quality: "720p"|"1080p") → { width, height }`
  - `buildLyricRenderArgs({ songPath, background: { file, kind: "video"|"image", fit: "cover"|"contain" } | null, assPath, width, height, durationSec, outPath }) → string[]`
  - `runLyricRender({ jobId, songPath, background, assPath, width, height, durationSec, outPath }) → Promise<{ ok: true, file } | { ok: false, error }>` (probes the background to resolve `fit: "auto"`)

- [ ] **Step 1: Write the failing tests**

```js
// server/src/lib/lyricVideo/lyricRender.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderSize, buildLyricRenderArgs, runLyricRender } from "./lyricRender.js";
import { createJob } from "../renderJobs.js";

describe("renderSize", () => {
  test("720p and 1080p for each frame", () => {
    assert.deepEqual(renderSize("portrait", "720p"), { width: 720, height: 1280 });
    assert.deepEqual(renderSize("portrait", "1080p"), { width: 1080, height: 1920 });
    assert.deepEqual(renderSize("landscape", "720p"), { width: 1280, height: 720 });
    assert.deepEqual(renderSize("square", "1080p"), { width: 1080, height: 1080 });
    assert.deepEqual(renderSize("nonsense", "nope"), { width: 720, height: 1280 });
  });
});

describe("buildLyricRenderArgs", () => {
  const base = { songPath: "/s/song.m4a", assPath: "/w/c.ass", width: 720, height: 1280, durationSec: 12.5, outPath: "/o/out.mp4" };
  test("a looping video background, captions, the song's audio", () => {
    const args = buildLyricRenderArgs({ ...base, background: { file: "/b/clip.mp4", kind: "video", fit: "contain" } });
    const s = args.join(" ");
    assert.match(s, /-stream_loop -1 -i \/b\/clip\.mp4/);
    assert.match(s, /-i \/s\/song\.m4a/);
    assert.match(s, /boxblur/);
    assert.match(s, /ass=filename=/);
    assert.match(s, /-map 1:a/);
    assert.match(s, /-t 12\.5/);
    assert.match(s, /-movflags \+faststart/);
  });
  test("a still image loops; no background uses a dark colour", () => {
    assert.match(buildLyricRenderArgs({ ...base, background: { file: "/b/a.jpg", kind: "image", fit: "cover" } }).join(" "), /-loop 1 -framerate 30 -i \/b\/a\.jpg/);
    assert.match(buildLyricRenderArgs({ ...base, background: null }).join(" "), /color=c=0x101820:s=720x1280/);
  });
});

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

test("renders a real 2-second video with captions", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-render-"));
  try {
    const song = path.join(dir, "song.m4a");
    const bg = path.join(dir, "bg.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2", "-c:a", "aac", song]);
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:d=1:r=30", bg]);
    const ass = path.join(dir, "c.ass");
    fs.writeFileSync(ass, "[Script Info]\nPlayResX: 360\nPlayResY: 640\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Kinetic,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.20,0:00:01.80,Kinetic,,0,0,0,,{\\pos(180,300)}HELLO\n");
    const out = path.join(dir, "out.mp4");
    const job = createJob("u1", { durationSec: 2 });
    const r = await runLyricRender({ jobId: job.jobId, songPath: song, background: { file: bg, kind: "video", fit: "auto" }, assPath: ass, width: 360, height: 640, durationSec: 2, outPath: out });
    assert.equal(r.ok, true, r.error);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", out]).stdout.toString();
    assert.match(probe, /video,360,640/);
    assert.match(probe, /audio/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/lib/lyricVideo/lyricRender.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/src/lib/lyricVideo/lyricRender.js
import { spawn } from "node:child_process";
import { sceneFrameFilter, toFilterScriptArgs } from "../story/storyRender.js";
import { FIT_CONTAIN, chooseSceneFit, probeMediaSize } from "../story/sceneFraming.js";
import { escapeFontPath, FONT_DIR } from "../videoFilters.js";
import { markRunning, markProgress, markDone, markError, attachProc, getJob } from "../renderJobs.js";

const SIZES = {
  portrait: { "720p": [720, 1280], "1080p": [1080, 1920] },
  landscape: { "720p": [1280, 720], "1080p": [1920, 1080] },
  square: { "720p": [720, 720], "1080p": [1080, 1080] },
};

export function renderSize(aspect, quality) {
  const [width, height] = (SIZES[aspect] || SIZES.portrait)[quality] || (SIZES[aspect] || SIZES.portrait)["720p"];
  return { width, height };
}

export function buildLyricRenderArgs({ songPath, background, assPath, width, height, durationSec, outPath }) {
  let input;
  if (!background) input = ["-f", "lavfi", "-i", `color=c=0x101820:s=${width}x${height}:r=30`];
  else if (background.kind === "image") input = ["-loop", "1", "-framerate", "30", "-i", background.file];
  else input = ["-stream_loop", "-1", "-i", background.file];
  const framed = background
    ? sceneFrameFilter({ src: "[0:v]", i: 0, width, height, fit: background.fit === "contain" ? FIT_CONTAIN : "cover" })
    : [`[0:v]null[s0]`];
  const captions = `[s0]fps=30,ass=filename='${escapeFontPath(assPath)}':fontsdir='${escapeFontPath(FONT_DIR)}',format=yuv420p[v]`;
  return [
    "-y", "-hide_banner", ...input, "-i", songPath,
    "-filter_complex", [...framed, captions].join(";"),
    "-map", "[v]", "-map", "1:a", "-t", String(durationSec),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
  ];
}

async function resolveFit(background, width, height) {
  if (!background || background.fit !== "auto") return background;
  const size = await probeMediaSize(background.file);
  const fit = chooseSceneFit({ mediaWidth: size?.width, mediaHeight: size?.height, frameWidth: width, frameHeight: height });
  return { ...background, fit };
}

export async function runLyricRender(opts) {
  const background = await resolveFit(opts.background, opts.width, opts.height);
  if (getJob(opts.jobId)?.cancelled) return { ok: false, error: "Render cancelled" };
  return new Promise((resolve) => {
    const built = buildLyricRenderArgs({ ...opts, background });
    const { args } = toFilterScriptArgs(built, opts.outPath);
    markRunning(opts.jobId);
    let proc;
    try { proc = spawn(process.env.FFMPEG_PATH?.trim() || "ffmpeg", args); } catch (err) {
      markError(opts.jobId, err?.message || err);
      return resolve({ ok: false, error: String(err?.message || err) });
    }
    attachProc(opts.jobId, proc);
    let tail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && opts.durationSec > 0) markProgress(opts.jobId, ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / opts.durationSec) * 100);
    });
    proc.on("error", (err) => { markError(opts.jobId, err?.message || err); resolve({ ok: false, error: String(err?.message || err) }); });
    proc.on("close", (code) => {
      if (code === 0) { markDone(opts.jobId, opts.outPath); resolve({ ok: true, file: opts.outPath }); }
      else { markError(opts.jobId, `ffmpeg exited ${code}: ${tail.slice(-400)}`); resolve({ ok: false, error: `ffmpeg exited ${code}` }); }
    });
  });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && node --test src/lib/lyricVideo/lyricRender.test.js`
Expected: PASS (the real-render test runs when ffmpeg is installed).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lyricVideo/lyricRender.*
git commit -m "feat: render a lyric video over one background"
```

---

### Task 11: API routes, mounting and capability

**Files:**
- Create: `server/src/routes/lyricVideo.js`
- Modify: `server/index.js` (import + mount; the `/caption-fonts` static line from Task 1), `server/src/middleware/featureGate.js`
- Test: `server/src/routes/lyricVideo.test.js`

**Interfaces:**
- Consumes: Tasks 7–10; `confineToDir`; `probeAudioDurationSec` (`story/storyRender.js`); `probeMediaSize`; `createJob`, `persistJob`, `getJob`, `cancelJob` (`renderJobs.js`).
- Produces (payloads as listed; errors are `{ error }` with a 4xx status, the same convention as the Story routes; `captions.ass` is plain text):
  - `GET /api/lyric-video` → `{ projects }`; `POST /` `{ title, artist }` → `{ project }`; `GET /:id` → `{ project }`; `DELETE /:id`
  - `GET /prefs` → `{ artist }`; `PUT /prefs` `{ artist }`
  - `POST /:id/song` `{ path }` → `{ project }` (400 "That file has no sound in it" when ffprobe finds no audio stream)
  - `PUT /:id/sheet` `{ sheet }` → `{ project }` (400 over 20 000 chars, or no lines)
  - `POST /:id/align` → 202 `{ project }` (409 when running or no song/lines)
  - `PATCH /:id/lines/:lineId` `{ start?, effect? }` → `{ project }` (start shifts the whole line, clamped between neighbours and inside the song; sets `locked: true`, `flag: null`)
  - `PUT /:id/look` `{ id?, energy?, seed? }`; `PUT /:id/background` `{ path: string|null, fit?: "auto"|"cover"|"contain" }`
  - `GET /:id/captions.ass?w=&h=` → `text/plain` ASS
  - `POST /:id/render` `{ aspect, quality }` → 202 `{ jobId }`; `GET /:id/render/:jobId` → `{ job }`; `POST /:id/render/:jobId/cancel`

- [ ] **Step 1: Write the failing tests**

```js
// server/src/routes/lyricVideo.test.js
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import lyricVideoRouter from "./lyricVideo.js";

let dir;
let server;
let base;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-route-"));
  fs.mkdirSync(path.join(dir, "out"), { recursive: true });
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir: dir, outputDir: path.join(dir, "out"), plan: "free" }; next(); });
  app.use("/api/lyric-video", lyricVideoRouter);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/lyric-video`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const call = async (method, url, body) => {
  const r = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, text }; }
};
const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;

describe("projects", () => {
  test("create, list, read, delete", async () => {
    const c = await call("POST", "/", { title: "My Time No Late", artist: "Sthill Waters" });
    assert.equal(c.status, 200);
    const id = c.json.project.projectId;
    assert.equal((await call("GET", "/")).json.projects[0].projectId, id);
    assert.equal((await call("GET", `/${id}`)).json.project.title, "My Time No Late");
    assert.equal((await call("DELETE", `/${id}`)).status, 200);
    assert.equal((await call("GET", `/${id}`)).status, 404);
  });
  test("artist prefs", async () => {
    await call("PUT", "/prefs", { artist: "Sthill Waters" });
    assert.equal((await call("GET", "/prefs")).json.artist, "Sthill Waters");
  });
});

describe("sheet and lines", () => {
  test("sheet over the limit is refused; a good sheet is parsed", async () => {
    const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
    assert.equal((await call("PUT", `/${id}/sheet`, { sheet: "x".repeat(20001) })).status, 400);
    assert.equal((await call("PUT", `/${id}/sheet`, { sheet: "   " })).status, 400);
    const ok = await call("PUT", `/${id}/sheet`, { sheet: "[CHORUS]\nWho talk say?\nMy time no late" });
    assert.deepEqual(ok.json.project.lines.map((l) => l.text), ["Who talk say?", "My time no late"]);
  });
  test("a nudge is clamped between neighbours and inside the song, and locks the line", async () => {
    const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
    await call("PUT", `/${id}/sheet`, { sheet: "aa bb\ncc dd\nee ff" });
    // Pretend timing ran: write words directly through the store.
    const { readProject, writeProject } = await import("../lib/lyricVideo/projectStore.js");
    const p = readProject(dir, id);
    const w = (a, b, s) => [{ text: a, start: s, end: s + 0.5 }, { text: b, start: s + 0.5, end: s + 1 }];
    writeProject(dir, { ...p, song: { file: "x", durationSec: 10 }, lines: p.lines.map((l, i) => ({ ...l, words: w(...l.text.split(" "), i * 3 + 1), start: i * 3 + 1, end: i * 3 + 2 })) });
    const lineId = p.lines[1].id;
    const r = await call("PATCH", `/${id}/lines/${lineId}`, { start: 0.2 });
    const moved = r.json.project.lines[1];
    assert.ok(moved.start >= 2, `clamped after line 1 ends, got ${moved.start}`);
    assert.equal(moved.locked, true);
    assert.equal(moved.flag, null);
    const late = await call("PATCH", `/${id}/lines/${p.lines[2].id}`, { start: 99 });
    assert.ok(late.json.project.lines[2].end <= 10);
    assert.equal((await call("PATCH", `/${id}/lines/${lineId}`, { effect: "explode" })).status, 400);
  });
});

describe("song upload", () => {
  test("a path outside the outputs folder is refused", async () => {
    const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
    assert.equal((await call("POST", `/${id}/song`, { path: "/etc/passwd" })).status, 400);
  });
  test("a silent video is refused with a plain message", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
    const silent = path.join(dir, "out", "silent.mp4");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:d=1", silent]);
    const r = await call("POST", `/${id}/song`, { path: silent });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /no sound/);
  });
  test("an audio file is attached with its duration", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
    const song = path.join(dir, "out", "song.m4a");
    spawnSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=d=3", "-c:a", "aac", song]);
    const r = await call("POST", `/${id}/song`, { path: song });
    assert.equal(r.status, 200);
    assert.ok(Math.abs(r.json.project.song.durationSec - 3) < 0.2);
  });
});

test("captions.ass returns text for placed lines", async () => {
  const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
  await call("PUT", `/${id}/sheet`, { sheet: "My time no late" });
  const { readProject, writeProject } = await import("../lib/lyricVideo/projectStore.js");
  const p = readProject(dir, id);
  writeProject(dir, { ...p, lines: p.lines.map((l) => ({ ...l, words: l.text.split(" ").map((t, i) => ({ text: t, start: 1 + i * 0.3, end: 1.3 + i * 0.3 })), start: 1, end: 2.2 })) });
  const r = await call("GET", `/${id}/captions.ass?w=720&h=1280`);
  assert.equal(r.status, 200);
  assert.match(r.text, /PlayResY: 1280/);
});

test("align without a song is refused", async () => {
  const id = (await call("POST", "/", { title: "T" })).json.project.projectId;
  assert.equal((await call("POST", `/${id}/align`)).status, 409);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && node --test src/routes/lyricVideo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

```js
// server/src/routes/lyricVideo.js
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { v4 as uuid } from "uuid";
import { confineToDir } from "../lib/confinePath.js";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";
import { probeMediaSize } from "../lib/story/sceneFraming.js";
import { createJob, persistJob, getJob, cancelJob } from "../lib/renderJobs.js";
import { EFFECT_IDS } from "../lib/kinetic/director.js";
import { ENERGIES, isStudioLook } from "../lib/kinetic/looks.js";
import { SHEET_MAX_CHARS } from "../lib/lyricVideo/sheetParser.js";
import { createProject, readProject, writeProject, listProjects, deleteProject, readPrefs, writePrefs, cleanText, applySheet } from "../lib/lyricVideo/projectStore.js";
import { runAlignJob, isAligning } from "../lib/lyricVideo/alignJob.js";
import { buildLyricAss } from "../lib/lyricVideo/lyricAss.js";
import { renderSize, runLyricRender } from "../lib/lyricVideo/lyricRender.js";

const router = Router();
const ok = (res, data) => res.json(data);
const bad = (res, status, error) => res.status(status).json({ error });
const EFFECTS_ALLOWED = new Set(["auto", ...EFFECT_IDS]);
const MIN_GAP = 0.05;

function load(req, res) {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) { bad(res, 404, "That song project was not found"); return null; }
  return project;
}

function hasAudioStream(file) {
  return new Promise((resolve) => {
    const p = spawn(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => resolve(false));
    p.on("close", () => resolve(out.trim().length > 0));
  });
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-y", ...args]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

router.get("/prefs", (req, res) => ok(res, readPrefs(req.ctx.dataDir)));
router.put("/prefs", (req, res) => ok(res, writePrefs(req.ctx.dataDir, { artist: req.body?.artist })));

router.get("/", (req, res) => ok(res, { projects: listProjects(req.ctx.dataDir) }));
router.post("/", (req, res) => {
  const project = createProject(req.ctx.dataDir, { title: req.body?.title, artist: req.body?.artist });
  if (project.artist) writePrefs(req.ctx.dataDir, { artist: project.artist });
  ok(res, { project });
});
router.get("/:id", (req, res) => { const p = load(req, res); if (p) ok(res, { project: p }); });
router.delete("/:id", (req, res) => {
  if (!deleteProject(req.ctx.dataDir, req.params.id)) return bad(res, 404, "That song project was not found");
  ok(res, {});
});

router.post("/:id/song", async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const file = confineToDir(req.ctx.outputDir, String(req.body?.path || ""));
  if (!file || !fs.existsSync(file)) return bad(res, 400, "That upload could not be found. Please upload the song again.");
  if (!(await hasAudioStream(file))) return bad(res, 400, "That file has no sound in it. Upload the song itself.");
  const durationSec = await probeAudioDurationSec(file);
  if (!durationSec) return bad(res, 400, "That song could not be read. Try an MP3, M4A or WAV file.");
  let coverStill = null;
  const size = await probeMediaSize(file);
  if (size) {
    coverStill = path.join(req.ctx.outputDir, `lyric-cover-${uuid()}.jpg`);
    try { await ffmpeg(["-ss", "1", "-i", file, "-frames:v", "1", coverStill]); } catch { coverStill = null; }
  }
  const next = writeProject(req.ctx.dataDir, { ...project, song: { file, durationSec: Math.round(durationSec * 100) / 100, coverStill }, timing: { status: "idle" } });
  ok(res, { project: next });
});

router.put("/:id/sheet", (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const sheet = String(req.body?.sheet ?? "");
  if (sheet.length > SHEET_MAX_CHARS) return bad(res, 400, `The lyrics are too long (over ${SHEET_MAX_CHARS} characters).`);
  const next = applySheet(project, sheet);
  if (!next.lines.length) return bad(res, 400, "Paste the lyrics, one line per line.");
  ok(res, { project: writeProject(req.ctx.dataDir, next) });
});

router.post("/:id/align", (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!project.song?.file) return bad(res, 409, "Upload the song first.");
  if (!project.lines?.length) return bad(res, 409, "Paste the lyrics first.");
  if (isAligning(project.projectId)) return bad(res, 409, "Timing is already running for this song.");
  const marked = writeProject(req.ctx.dataDir, { ...project, timing: { ...project.timing, status: "running", progress: { step: "preparing" }, error: null } });
  runAlignJob({ dataDir: req.ctx.dataDir, workDir: req.ctx.outputDir, projectId: project.projectId }).catch(() => {});
  res.status(202).json({ project: marked });
});

router.patch("/:id/lines/:lineId", (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const i = project.lines.findIndex((l) => l.id === req.params.lineId);
  if (i < 0) return bad(res, 404, "That line was not found");
  let line = { ...project.lines[i] };
  if (req.body?.effect !== undefined) {
    if (!EFFECTS_ALLOWED.has(req.body.effect)) return bad(res, 400, "Unknown effect");
    line.effect = req.body.effect;
  }
  if (req.body?.start !== undefined) {
    const want = Number(req.body.start);
    if (!Number.isFinite(want) || !line.words?.length) return bad(res, 400, "That line has no timing yet");
    const len = line.end - line.start;
    const prevEnd = i > 0 ? project.lines[i - 1].end ?? 0 : 0;
    const nextStart = i + 1 < project.lines.length ? project.lines[i + 1].start ?? Infinity : Infinity;
    const songEnd = Number(project.song?.durationSec) || Infinity;
    const upper = Math.min(nextStart - MIN_GAP, songEnd) - len;
    const start = Math.max(prevEnd + MIN_GAP, Math.min(want, upper));
    const shift = start - line.start;
    line = { ...line, words: line.words.map((w) => ({ ...w, start: round(w.start + shift), end: round(w.end + shift) })), start: round(start), end: round(line.end + shift), locked: true, flag: null };
  }
  const lines = project.lines.map((l, k) => (k === i ? line : l));
  ok(res, { project: writeProject(req.ctx.dataDir, { ...project, lines }) });
});

router.put("/:id/look", (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const look = { ...project.look };
  if (req.body?.id !== undefined) { if (!isStudioLook(req.body.id)) return bad(res, 400, "Unknown look"); look.id = req.body.id; }
  if (req.body?.energy !== undefined) { if (!ENERGIES.some((e) => e.id === req.body.energy)) return bad(res, 400, "Unknown energy"); look.energy = req.body.energy; }
  if (req.body?.seed !== undefined) { const s = Number(req.body.seed); if (!Number.isInteger(s) || s < 0) return bad(res, 400, "Bad mix"); look.seed = s; }
  ok(res, { project: writeProject(req.ctx.dataDir, { ...project, look }) });
});

router.put("/:id/background", async (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (req.body?.path === null) return ok(res, { project: writeProject(req.ctx.dataDir, { ...project, background: null }) });
  const file = confineToDir(req.ctx.outputDir, String(req.body?.path || ""));
  if (!file || !fs.existsSync(file)) return bad(res, 400, "That background could not be found");
  const fit = ["auto", "cover", "contain"].includes(req.body?.fit) ? req.body.fit : "auto";
  const kind = /\.(jpe?g|png|webp)$/i.test(file) ? "image" : "video";
  ok(res, { project: writeProject(req.ctx.dataDir, { ...project, background: { file, kind, fit } }) });
});

router.get("/:id/captions.ass", (req, res) => {
  const project = load(req, res);
  if (!project) return;
  const w = Math.min(3840, Math.max(160, Number(req.query.w) || 720));
  const h = Math.min(3840, Math.max(160, Number(req.query.h) || 1280));
  res.type("text/plain").set("Cache-Control", "no-store").send(buildLyricAss(project, { w, h }));
});

router.post("/:id/render", (req, res) => {
  const project = load(req, res);
  if (!project) return;
  if (!project.song?.file || !project.lines.some((l) => l.words?.length)) return bad(res, 409, "Time the lyrics before rendering.");
  const aspect = ["portrait", "landscape", "square"].includes(req.body?.aspect) ? req.body.aspect : "portrait";
  const quality = req.body?.quality === "1080p" ? "1080p" : "720p";
  const { width, height } = renderSize(aspect, quality);
  const durationSec = Number(project.song.durationSec);
  const assPath = path.join(req.ctx.outputDir, `lyric-${project.projectId}-${width}x${height}.ass`);
  fs.writeFileSync(assPath, buildLyricAss(project, { w: width, h: height, layout: aspect === "portrait" ? "shorts" : "default" }), "utf8");
  const outPath = path.join(req.ctx.outputDir, `lyric-${project.projectId}-${Date.now()}.mp4`);
  const job = createJob(req.ctx.userId, { durationSec });
  persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
  const background = project.background || (project.song.coverStill ? { file: project.song.coverStill, kind: "image", fit: "auto" } : null);
  runLyricRender({ jobId: job.jobId, songPath: project.song.file, background, assPath, width, height, durationSec, outPath })
    .then((r) => {
      persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: r.ok ? "done" : "error", outputPath: r.ok ? outPath : null });
      if (!r.ok) return;
      const latest = readProject(req.ctx.dataDir, project.projectId);
      if (latest) writeProject(req.ctx.dataDir, { ...latest, renders: [...(latest.renders || []), { jobId: job.jobId, aspect, quality, file: outPath, durationSec, at: new Date().toISOString() }] });
    });
  res.status(202).json({ jobId: job.jobId });
});

router.get("/:id/render/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.userId !== req.ctx.userId) return bad(res, 404, "No such render");
  ok(res, { job: { jobId: job.jobId, status: job.status, progress: job.percent, error: job.error, file: job.file ? path.basename(job.file) : null } });
});

router.post("/:id/render/:jobId/cancel", (req, res) => {
  cancelJob(req.params.jobId, req.ctx.userId);
  ok(res, {});
});

function round(n) { return Math.round(n * 100) / 100; }

export default router;
```

Check `createJob`/`getJob` field names in `server/src/lib/renderJobs.js` (lines 48–110: `jobId`, `userId`, `status`, `progress`, `error`, `file`) and adjust the `GET /:id/render/:jobId` mapping if a field is named differently.

- [ ] **Step 4: Mount it and add the capability**

In `server/index.js`: add `import lyricVideoRouter from "./src/routes/lyricVideo.js";` with the other route imports, and after the `/api/story` line:

```js
app.use("/api/lyric-video", requireAuth, withUserScope, requireVerifiedEmail, featureGate("lyric.video"), quota("render"), lyricVideoRouter);
```

In `server/src/middleware/featureGate.js` add `"lyric.video"` to both the `premium` and `free` sets. Add one assertion to the existing featureGate test file (`server/src/middleware/featureGate.test.js` if present, else the route test above) that `PLAN_CAPABILITIES.free.has("lyric.video")`.

- [ ] **Step 5: Run to verify they pass, then the whole server suite**

Run: `cd server && node --test src/routes/lyricVideo.test.js && npm test`
Expected: PASS, with no regressions in the full suite.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/lyricVideo.* server/index.js server/src/middleware/featureGate.js
git commit -m "feat: lyric video API"
```

---

### Task 12: Client types, API and project hook

**Files:**
- Create: `client/src/lib/lyricVideoTypes.ts`, `client/src/lib/lyricVideoApi.ts`, `client/src/hooks/useLyricProject.ts`
- Test: `client/src/lib/__tests__/lyricVideoApi.test.ts`

**Interfaces:**
- Consumes: `api` (`client/src/lib/api.ts`), `uploadMedia` (`client/src/lib/mediaUpload.ts`).
- Produces: the types below and `lyricVideoApi` with these methods (each throws `Error(message)` when `ok` is false):
  `list()`, `create(title, artist)`, `get(id)`, `remove(id)`, `prefs()`, `setPrefs(artist)`, `uploadSong(id, file, onProgress?)`, `setSheet(id, sheet)`, `align(id)`, `patchLine(id, lineId, { start?, effect? })`, `setLook(id, look)`, `setBackground(id, path, fit?)`, `uploadBackground(id, file, onProgress?)`, `captionsUrl(id, w, h)`, `captions(id, w, h): Promise<string>`, `render(id, aspect, quality): Promise<string /* jobId */>`, `renderStatus(id, jobId)`, `cancelRender(id, jobId)`. And `useLyricProject(id)` polling every 2 s while `timing.status === 'running'`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/lib/__tests__/lyricVideoApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  TRANSCRIBE_TIMEOUT_MS: 1,
}));
vi.mock('../mediaUpload', () => ({ uploadMedia: vi.fn() }));

import { api } from '../api';
import { uploadMedia } from '../mediaUpload';
import { lyricVideoApi } from '../lyricVideoApi';

const project = { projectId: 'lv_1', title: 'T', lines: [] };

describe('lyricVideoApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a project', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, data: { project } });
    await expect(lyricVideoApi.create('T', 'A')).resolves.toEqual(project);
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video', { title: 'T', artist: 'A' });
  });

  it('throws the server message', async () => {
    vi.mocked(api.put).mockResolvedValue({ ok: false, error: 'Paste the lyrics, one line per line.' });
    await expect(lyricVideoApi.setSheet('lv_1', ' ')).rejects.toThrow('Paste the lyrics');
  });

  it('uploads the song then attaches it', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ ok: true, file: '/app/outputs/source-video-1.mp4' } as never);
    vi.mocked(api.post).mockResolvedValue({ ok: true, data: { project } });
    const f = new File(['x'], 'song.mp4', { type: 'video/mp4' });
    await lyricVideoApi.uploadSong('lv_1', f);
    expect(uploadMedia).toHaveBeenCalledWith(f, 'song.mp4', 'source-video', undefined);
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video/lv_1/song', { path: '/app/outputs/source-video-1.mp4' });
  });

  it('patches a line', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ok: true, data: { project } });
    await lyricVideoApi.patchLine('lv_1', 'l3', { start: 12.4 });
    expect(api.patch).toHaveBeenCalledWith('/api/lyric-video/lv_1/lines/l3', { start: 12.4 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/lib/__tests__/lyricVideoApi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/lib/lyricVideoTypes.ts
export type SectionKind = 'intro' | 'verse' | 'pre' | 'chorus' | 'final' | 'bridge' | 'outro' | 'other';
export type LineKind = 'lead' | 'response' | 'soft';
export type LyricEffect = 'auto' | 'pop' | 'stack' | 'slam' | 'quote' | 'curve' | 'frame' | 'title';
export type RenderAspect = 'portrait' | 'landscape' | 'square';
export type RenderQuality = '720p' | '1080p';

export interface LyricWord { text: string; start: number; end: number }
export interface LyricSection { id: string; kind: SectionKind; label: string; start?: number }
export interface LyricLine {
  id: string; sectionId: string; kind: LineKind; text: string;
  words?: LyricWord[]; start?: number; end?: number;
  confidence?: number; flag?: 'check' | null; locked?: boolean; effect: LyricEffect;
}
export interface LyricTiming {
  status: 'idle' | 'running' | 'done' | 'error';
  progress?: { step: 'preparing' | 'listening' | 'matching' | 'beats'; window?: number } | null;
  error?: string | null;
  beats?: { bpm: number; times: number[] };
}
export interface LyricProject {
  projectId: string; title: string; artist: string; updatedAt: string;
  song: { file: string; durationSec: number; coverStill: string | null } | null;
  sheet: { raw: string; parsedAt: string | null; skipped?: string[] };
  sections: LyricSection[]; lines: LyricLine[]; timing: LyricTiming;
  look: { id: string; energy: string; seed: number };
  background: { file: string; kind: 'video' | 'image'; fit: 'auto' | 'cover' | 'contain' } | null;
  renders: Array<{ jobId: string; aspect: RenderAspect; quality: RenderQuality; file: string; durationSec: number; at: string }>;
}
export interface LyricProjectSummary { projectId: string; title: string; artist: string; updatedAt: string; hasRender: boolean }
export interface LyricRenderJob { jobId: string; status: string; progress?: number; error?: string | null; file?: string | null }
```

```ts
// client/src/lib/lyricVideoApi.ts
import { api } from './api';
import { uploadMedia } from './mediaUpload';
import type { LyricEffect, LyricProject, LyricProjectSummary, LyricRenderJob, RenderAspect, RenderQuality } from './lyricVideoTypes';

const BASE = '/api/lyric-video';
interface Res<T> { ok: boolean; data?: T; error?: string }

function unwrap<T>(res: Res<T>): T {
  // `api` already unwraps axios: `data` is the server body itself.
  if (!res.ok || res.data === undefined) throw new Error(res.error || 'Something went wrong');
  return res.data;
}
const project = async (p: Promise<Res<{ project: LyricProject }>>) => unwrap(await p).project;

export const lyricVideoApi = {
  async list(): Promise<LyricProjectSummary[]> { return unwrap(await api.get(BASE)).projects; },
  create: (title: string, artist: string) => project(api.post(BASE, { title, artist })),
  get: (id: string) => project(api.get(`${BASE}/${id}`)),
  async remove(id: string) { unwrap(await api.delete(`${BASE}/${id}`)); },
  async prefs(): Promise<{ artist: string }> { return unwrap(await api.get(`${BASE}/prefs`)); },
  async setPrefs(artist: string) { unwrap(await api.put(`${BASE}/prefs`, { artist })); },
  async uploadSong(id: string, file: File, onProgress?: (pct: number) => void) {
    const up = await uploadMedia(file, file.name, 'source-video', onProgress);
    if (!up.file) throw new Error('The song did not upload. Please try again.');
    return project(api.post(`${BASE}/${id}/song`, { path: up.file }));
  },
  setSheet: (id: string, sheet: string) => project(api.put(`${BASE}/${id}/sheet`, { sheet })),
  align: (id: string) => project(api.post(`${BASE}/${id}/align`, {})),
  patchLine: (id: string, lineId: string, patch: { start?: number; effect?: LyricEffect }) =>
    project(api.patch(`${BASE}/${id}/lines/${lineId}`, patch)),
  setLook: (id: string, look: Partial<LyricProject['look']>) => project(api.put(`${BASE}/${id}/look`, look)),
  setBackground: (id: string, path: string | null, fit?: 'auto' | 'cover' | 'contain') =>
    project(api.put(`${BASE}/${id}/background`, { path, ...(fit ? { fit } : {}) })),
  async uploadBackground(id: string, file: File, onProgress?: (pct: number) => void) {
    const up = await uploadMedia(file, file.name, 'background', onProgress);
    if (!up.file) throw new Error('The background did not upload. Please try again.');
    return lyricVideoApi.setBackground(id, up.file);
  },
  captionsUrl: (id: string, w: number, h: number) => `${BASE}/${id}/captions.ass?w=${w}&h=${h}`,
  async captions(id: string, w: number, h: number): Promise<string> {
    const res = await api.getText(lyricVideoApi.captionsUrl(id, w, h));
    return res;
  },
  async render(id: string, aspect: RenderAspect, quality: RenderQuality): Promise<string> {
    return unwrap(await api.post(`${BASE}/${id}/render`, { aspect, quality })).jobId;
  },
  async renderStatus(id: string, jobId: string): Promise<LyricRenderJob> { return unwrap(await api.get(`${BASE}/${id}/render/${jobId}`)).job; },
  async cancelRender(id: string, jobId: string) { unwrap(await api.post(`${BASE}/${id}/render/${jobId}/cancel`, {})); },
};
```

`api.put` and `api.getText` do not exist yet. Add both to `ApiClient` in `client/src/lib/api.ts`, next to `patch`, using its private `getHeaders` and `handleError`. `getText` throws `Error("HTTP <status>")` when the response is not ok:

```ts
    async put<T = any>(url: string, body?: any, customHeaders?: Record<string, string>): Promise<ApiResponse<T>> {
        try {
            const response = await axios.put(url, body, { headers: this.getHeaders(customHeaders), timeout: DEFAULT_TIMEOUT_MS });
            return { ok: true, status: response.status, data: response.data };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async getText(url: string): Promise<string> {
        const resp = await fetch(url, { headers: this.getHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
    }
```

Check the shape `uploadMedia` resolves with in `client/src/lib/mediaUpload.ts` (`UploadResult`, lines 12–20); if the uploaded path field is not `file`, use the right field name in both upload methods and the test.

```ts
// client/src/hooks/useLyricProject.ts
import { useQuery } from '@tanstack/react-query';
import { lyricVideoApi } from '../lib/lyricVideoApi';
import type { LyricProject } from '../lib/lyricVideoTypes';

export function useLyricProject(projectId: string | null) {
  return useQuery<LyricProject>({
    queryKey: ['lyric-project', projectId],
    queryFn: () => lyricVideoApi.get(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (q) => (q.state.data?.timing?.status === 'running' ? 2000 : false),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/lib/__tests__/lyricVideoApi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/lyricVideoTypes.ts client/src/lib/lyricVideoApi.ts client/src/hooks/useLyricProject.ts client/src/lib/__tests__/lyricVideoApi.test.ts client/src/lib/api.ts
git commit -m "feat: client API for lyric videos"
```

---

### Task 13: Timing helpers

**Files:**
- Create: `client/src/lib/lyricTiming.ts`
- Test: `client/src/lib/__tests__/lyricTiming.test.ts`

**Interfaces:**
- Consumes: `LyricLine` (Task 12).
- Produces:
  - `nudgeLine(lines: LyricLine[], index: number, delta: number, songEnd: number) → number` (the clamped new start; mirrors the server's PATCH clamp so the UI moves immediately)
  - `lineAt(lines: LyricLine[], t: number) → number` (index of the line on screen at `t`, or −1)
  - `formatTime(sec: number) → string` (`"1:07.4"`)
  - `flaggedCount(lines) → number`

- [ ] **Step 1: Write the failing test**

```ts
// client/src/lib/__tests__/lyricTiming.test.ts
import { describe, it, expect } from 'vitest';
import { nudgeLine, lineAt, formatTime, flaggedCount } from '../lyricTiming';
import type { LyricLine } from '../lyricVideoTypes';

const line = (start: number, end: number, flag: 'check' | null = null): LyricLine =>
  ({ id: `l${start}`, sectionId: 's', kind: 'lead', text: 'x', effect: 'auto', start, end, flag, words: [{ text: 'x', start, end }] });
const lines = [line(1, 2), line(3, 4, 'check'), line(6, 7)];

describe('nudgeLine', () => {
  it('moves by the delta', () => expect(nudgeLine(lines, 1, 0.1, 10)).toBeCloseTo(3.1));
  it('never crosses the line before', () => expect(nudgeLine(lines, 1, -5, 10)).toBeCloseTo(2.05));
  it('never crosses the line after', () => expect(nudgeLine(lines, 1, 5, 10)).toBeCloseTo(4.95));
  it('never runs past the song', () => expect(nudgeLine(lines, 2, 9, 7.5)).toBeCloseTo(6.5));
});

describe('lineAt', () => {
  it('finds the line on screen', () => {
    expect(lineAt(lines, 3.5)).toBe(1);
    expect(lineAt(lines, 5)).toBe(-1);
  });
});

it('formats times', () => {
  expect(formatTime(67.42)).toBe('1:07.4');
  expect(formatTime(0)).toBe('0:00.0');
});

it('counts flagged lines', () => expect(flaggedCount(lines)).toBe(1));
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/lib/__tests__/lyricTiming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/lib/lyricTiming.ts
import type { LyricLine } from './lyricVideoTypes';

const MIN_GAP = 0.05;

export function nudgeLine(lines: LyricLine[], index: number, delta: number, songEnd: number): number {
  const l = lines[index];
  const start = l.start ?? 0;
  const len = (l.end ?? start) - start;
  const prevEnd = index > 0 ? lines[index - 1].end ?? 0 : 0;
  const nextStart = index + 1 < lines.length ? lines[index + 1].start ?? Infinity : Infinity;
  const upper = Math.min(nextStart - MIN_GAP, songEnd) - len;
  return Math.round(Math.max(prevEnd + MIN_GAP, Math.min(start + delta, upper)) * 100) / 100;
}

export function lineAt(lines: LyricLine[], t: number): number {
  return lines.findIndex((l) => l.start !== undefined && l.end !== undefined && t >= l.start && t < l.end);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function flaggedCount(lines: LyricLine[]): number {
  return lines.filter((l) => l.flag === 'check').length;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && npx vitest run src/lib/__tests__/lyricTiming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/lyricTiming.ts client/src/lib/__tests__/lyricTiming.test.ts
git commit -m "feat: timing helpers for the lyric timing step"
```

---

### Task 14: Live preview

**Files:**
- Create: `client/src/components/lyricVideo/LivePreview.tsx`
- Test: `client/src/components/lyricVideo/__tests__/LivePreview.test.tsx`

**Interfaces:**
- Consumes: `lyricVideoApi.captions` (Task 12); Task 1 decision.
- Produces: `<LivePreview project={LyricProject} assVersion={number} onTime?={(t: number) => void} />` — plays the song with the background (video, cover still, or dark), draws captions; refetches captions whenever `assVersion` changes and swaps them without reloading. Exposes `data-testid="lyric-preview"`. The `<video>` element carries `controls`.

**If `JASSUB_OK = yes` (Task 1):**

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/lyricVideo/__tests__/LivePreview.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const setTrack = vi.fn();
const destroy = vi.fn();
const ctor = vi.fn();
vi.mock('jassub', () => ({ default: class { constructor(o: unknown) { ctor(o); } setTrack = setTrack; destroy = destroy; } }));
vi.mock('jassub/dist/jassub-worker.js?url', () => ({ default: '/w.js' }));
vi.mock('jassub/dist/jassub-worker.wasm?url', () => ({ default: '/w.wasm' }));
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { captions: vi.fn() } }));
vi.mock('../../../lib/authedMedia', () => ({ useAuthedMediaUrl: (p: string | null) => (p ? `blob:${p}` : null) }));

import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LivePreview } from '../LivePreview';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const project = {
  projectId: 'lv_1', song: { file: '/o/song.m4a', durationSec: 10, coverStill: null }, background: null,
  look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 }, lines: [],
} as unknown as LyricProject;

describe('LivePreview', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(lyricVideoApi.captions).mockResolvedValue('[Script Info]\nA'); });

  it('starts the caption renderer with the project captions and the Studio fonts', async () => {
    render(<LivePreview project={project} assVersion={1} />);
    expect(screen.getByTestId('lyric-preview')).toBeTruthy();
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const opts = ctor.mock.calls[0][0] as { subContent: string; availableFonts: Record<string, string> };
    expect(opts.subContent).toBe('[Script Info]\nA');
    expect(opts.availableFonts['permanent marker']).toBe('/caption-fonts/PermanentMarker.ttf');
  });

  it('swaps captions in place when they change', async () => {
    const { rerender } = render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    vi.mocked(lyricVideoApi.captions).mockResolvedValue('[Script Info]\nB');
    rerender(<LivePreview project={project} assVersion={2} />);
    await waitFor(() => expect(setTrack).toHaveBeenCalledWith('[Script Info]\nB'));
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});
```

`lib/authedMedia` — check whether the client already has a hook that turns an `/outputs/...` path into an authed blob/object URL (search `rg -n "createObjectURL" client/src`; `AuthedImage.tsx` does it for images). If a reusable hook exists, use it and point the mock at its module; otherwise create `client/src/lib/authedMedia.ts` with `useAuthedMediaUrl(path: string | null): string | null` that fetches `toOutputUrl(path, '')` with the bearer token into an object URL (revoking it on change/unmount), and give it a two-case test (null path → null; path → `blob:` URL from a mocked `fetch`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/components/lyricVideo/__tests__/LivePreview.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// client/src/components/lyricVideo/LivePreview.tsx
import { useEffect, useRef } from 'react';
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { useAuthedMediaUrl } from '../../lib/authedMedia';
import type { LyricProject } from '../../lib/lyricVideoTypes';

const PREVIEW_W = 360;
const PREVIEW_H = 640;
const FONTS: Record<string, string> = {
  'permanent marker': '/caption-fonts/PermanentMarker.ttf',
  knewave: '/caption-fonts/Knewave-Regular.ttf',
  anton: '/caption-fonts/Anton.ttf',
  caveat: '/caption-fonts/Caveat-Bold.ttf',
  'playfair display': '/caption-fonts/PlayfairDisplay-BoldItalic.ttf',
  'dejavu sans': '/caption-fonts/DejaVuSans.ttf',
};

interface Props { project: LyricProject; assVersion: number; onTime?: (t: number) => void }

/**
 * The song over its background with the captions drawn live by libass in the
 * browser, from the same caption file the render uses. A change to timing,
 * effects or look swaps the captions without reloading the video.
 */
export function LivePreview({ project, assVersion, onTime }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const renderer = useRef<JASSUB | null>(null);
  const songUrl = useAuthedMediaUrl(project.song?.file ?? null);
  const bg = project.background?.kind === 'video' ? project.background.file : null;
  const still = project.background?.kind === 'image' ? project.background.file : project.song?.coverStill ?? null;
  const bgUrl = useAuthedMediaUrl(bg);
  const stillUrl = useAuthedMediaUrl(bg ? null : still);

  useEffect(() => {
    let cancelled = false;
    lyricVideoApi.captions(project.projectId, PREVIEW_W, PREVIEW_H).then((text) => {
      if (cancelled || !video.current) return;
      if (renderer.current) { renderer.current.setTrack(text); return; }
      renderer.current = new JASSUB({ video: video.current, subContent: text, workerUrl, wasmUrl, availableFonts: FONTS, fallbackFont: 'dejavu sans' });
    }).catch(() => { /* the step shows the timing list either way */ });
    return () => { cancelled = true; };
  }, [project.projectId, assVersion]);

  useEffect(() => () => { renderer.current?.destroy(); renderer.current = null; }, []);

  // The video element is the clock: the song plays alongside it, kept in step.
  const sync = () => {
    const v = video.current;
    const a = audio.current;
    if (!v || !a) return;
    if (Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
    onTime?.(v.currentTime);
  };

  return (
    <div data-testid="lyric-preview" className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-xl bg-[#101820]" style={{ aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}` }}>
      {stillUrl && <img src={stillUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" />}
      <video
        ref={video}
        src={bgUrl ?? songUrl ?? undefined}
        loop={Boolean(bgUrl)}
        muted={Boolean(bgUrl)}
        controls
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        onPlay={() => { void audio.current?.play(); }}
        onPause={() => audio.current?.pause()}
        onSeeked={sync}
        onTimeUpdate={sync}
      />
      {bgUrl && songUrl && <audio ref={audio} src={songUrl} preload="auto" />}
    </div>
  );
}
```

A looping background video's own clock restarts each loop, so with a video background the **song's** time must drive captions: when `bgUrl` is set, JASSUB is attached to the `<video>`, but its time comes from the video. Handle this by giving JASSUB the song instead: when a video background exists, render the song in a hidden `<video>` (audio only) that JASSUB is attached to, and play the background `<video>` muted and looped beside it with no captions attached. Implement it that way — the test above already passes with either element as long as the renderer is constructed once and `setTrack` swaps text. Add a third test: with `background: { kind: 'video', file: '/o/bg.mp4' }`, the element passed to `JASSUB` as `video` has `src` equal to the song URL.

- [ ] **Step 4: Run to verify they pass**

Run: `cd client && npx vitest run src/components/lyricVideo/__tests__/LivePreview.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/lyricVideo/LivePreview.tsx client/src/components/lyricVideo/__tests__/LivePreview.test.tsx client/src/lib/authedMedia*
git commit -m "feat: live caption preview for lyric videos"
```

**If `JASSUB_OK = no` (fallback, spec §9):** replace this task with a "Preview 10 seconds" button: server route `POST /api/lyric-video/:id/preview-clip { at }` renders `max(0, at-2)` … `+10 s` at 360×640 with `runLyricRender` into `lyric-preview-<id>.mp4` (args from `buildLyricRenderArgs` plus `-ss`/`-t`), and the component plays the returned file. Tests: the route returns a job id; the component shows the button, calls the API with the selected line's start, then plays the result. Commit as `feat: short preview renders for lyric videos`.

---

### Task 15: The Lyric video page and its steps

**Files:**
- Create: `client/src/pages/LyricVideoPage.tsx`, `client/src/components/lyricVideo/{LyricStepper,SongStep,LyricsStep,TimingStep,LookStep,RenderStep}.tsx`
- Modify: `client/src/App.tsx`, `client/src/pages/StudioHubPage.tsx`
- Test: `client/src/components/lyricVideo/__tests__/{LyricsStep,TimingStep,RenderStep}.test.tsx`, `client/src/pages/__tests__/LyricVideoPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 12–14; `StudioLookOptions` and the energy list (`client/src/components/captions/StudioEffects.tsx`); `fieldLabelCls, inputCls, primaryBtnCls, secondaryBtnCls, panelCls` (`client/src/components/story/formStyles.ts`); `DropZone`, `ScreenHeader`, `RenderProgressOverlay`; `toOutputUrl`.
- Produces: route `/app/lyric-video` and `/app/lyric-video/:projectId`; Studio hub card **Lyric video** ("Turn your song into a lyric video."). Steps: `Song → Lyrics → Timing → Look → Render` (Phase 1 has one background, chosen on the Look step).

Step behaviour (each in its own component, props `{ project: LyricProject; onChange: (p: LyricProject) => void }`):

- **SongStep:** title + artist fields (artist prefilled from `lyricVideoApi.prefs()`), a `DropZone` accepting audio and video (`accept="audio/*,video/*"`), upload progress, then "Song: 3:01" with the cover still if found. Errors show the server message.
- **LyricsStep:** a `<textarea>` (16 rows) with the sheet; **Read lyrics** calls `setSheet`; then shows the parsed result grouped by section label, responses indented and in yellow, and "Skipped: …" lines in grey with the text "These look like notes, not lyrics." **Time the lyrics** calls `align` (enabled when a song and lines exist).
- **TimingStep:** while `timing.status === 'running'`: "Listening to your song… (part N)" with a spinner; on `error`: the message and **Try again**. When done: `LivePreview` on top; below it the line list — each row shows time (`formatTime`), text, a yellow **Check this line** tag when flagged, and buttons **−0.1 s**, **+0.1 s**, **Start here** (uses the preview's current time), **Play from here**. Every change calls `patchLine` and bumps `assVersion`. A banner: "N lines to check" (`flaggedCount`), or "Every line is timed." Over half flagged: "Most lines could not be heard — check the lyrics match the song."
- **LookStep:** look `<select>` with `StudioLookOptions`, an energy `<select>` built from the same energy list `StudioEffectsControls` uses (no Shuffle in Phase 1: every line's effect comes from the section rules, so a new mix would change nothing on screen; Shuffle arrives with per-line choices in Phase 2), background upload (`uploadBackground`) or "Use the song's cover", fit select (Auto / Fill the frame / Show it whole), and the `LivePreview`.
- **RenderStep:** frame select (Portrait 9:16 — "best for Shorts and TikTok", Landscape 16:9, Square 1:1), quality (720p default, 1080p "takes longer"), **Render video**, progress via `renderStatus` polling every 2 s with `RenderProgressOverlay`, **Cancel**; when done, a `<video controls>` of the result and **Download** (`toOutputUrl(file) + '?dl=<title>.mp4'`). Earlier renders listed below.

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/lyricVideo/__tests__/LyricsStep.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { setSheet: vi.fn(), align: vi.fn() } }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LyricsStep } from '../LyricsStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const base = { projectId: 'lv_1', song: { file: 'x', durationSec: 10, coverStill: null }, sheet: { raw: '', parsedAt: null }, sections: [], lines: [], timing: { status: 'idle' } } as unknown as LyricProject;

describe('LyricsStep', () => {
  it('reads the sheet and shows sections, responses and skipped notes', async () => {
    const parsed = { ...base, sheet: { raw: 'x', parsedAt: 't', skipped: ['(Talking drum)'] },
      sections: [{ id: 's1', kind: 'chorus', label: 'CHORUS' }],
      lines: [{ id: 'l1', sectionId: 's1', kind: 'lead', text: 'Who talk say?', effect: 'auto' }, { id: 'l2', sectionId: 's1', kind: 'response', text: '(WHO TALK SAY?!)', effect: 'auto' }] } as LyricProject;
    vi.mocked(lyricVideoApi.setSheet).mockResolvedValue(parsed);
    const onChange = vi.fn();
    render(<LyricsStep project={base} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '[CHORUS]\nWho talk say?' } });
    fireEvent.click(screen.getByRole('button', { name: /read lyrics/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(parsed));
  });
  it('shows the parsed result and enables timing', () => {
    const parsed = { ...base, sheet: { raw: 'x', parsedAt: 't', skipped: ['(Talking drum)'] },
      sections: [{ id: 's1', kind: 'chorus', label: 'CHORUS' }],
      lines: [{ id: 'l1', sectionId: 's1', kind: 'lead', text: 'Who talk say?', effect: 'auto' }, { id: 'l2', sectionId: 's1', kind: 'response', text: '(WHO TALK SAY?!)', effect: 'auto' }] } as LyricProject;
    render(<LyricsStep project={parsed} onChange={vi.fn()} />);
    expect(screen.getByText('CHORUS')).toBeTruthy();
    expect(screen.getByText('(WHO TALK SAY?!)')).toBeTruthy();
    expect(screen.getByText(/look like notes/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /time the lyrics/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
```

```tsx
// client/src/components/lyricVideo/__tests__/TimingStep.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { patchLine: vi.fn(), align: vi.fn() } }));
vi.mock('../LivePreview', () => ({ LivePreview: () => <div data-testid="lyric-preview" /> }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { TimingStep } from '../TimingStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const line = (id: string, start: number, flag: 'check' | null = null) =>
  ({ id, sectionId: 's1', kind: 'lead', text: `line ${id}`, effect: 'auto', start, end: start + 1, flag, words: [{ text: 'x', start, end: start + 1 }] });
const done = { projectId: 'lv_1', song: { file: 'x', durationSec: 30, coverStill: null }, sections: [{ id: 's1', kind: 'verse', label: 'VERSE 1' }],
  lines: [line('l1', 1), line('l2', 5, 'check'), line('l3', 9)], timing: { status: 'done' } } as unknown as LyricProject;

describe('TimingStep', () => {
  it('lists lines, tags the flagged one and counts it', () => {
    render(<TimingStep project={done} onChange={vi.fn()} />);
    expect(screen.getByText('1 line to check')).toBeTruthy();
    expect(screen.getAllByText(/check this line/i)).toHaveLength(1);
  });
  it('nudges a line and saves it', async () => {
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(done);
    render(<TimingStep project={done} onChange={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '+0.1 s' })[1]);
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l2', { start: 5.1 }));
  });
  it('shows progress while timing runs and the error when it fails', () => {
    const { rerender } = render(<TimingStep project={{ ...done, timing: { status: 'running', progress: { step: 'listening', window: 3 } } }} onChange={vi.fn()} />);
    expect(screen.getByText(/listening to your song/i)).toBeTruthy();
    rerender(<TimingStep project={{ ...done, timing: { status: 'error', error: 'Whisper 429' } }} onChange={vi.fn()} />);
    expect(screen.getByText(/Whisper 429/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
```

```tsx
// client/src/components/lyricVideo/__tests__/RenderStep.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { render: vi.fn(), renderStatus: vi.fn(), cancelRender: vi.fn(), get: vi.fn() } }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { RenderStep } from '../RenderStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const p = { projectId: 'lv_1', title: 'My Time', renders: [], lines: [{ id: 'l1', words: [{ text: 'x', start: 0, end: 1 }] }] } as unknown as LyricProject;

describe('RenderStep', () => {
  it('renders portrait 720p by default and shows the result', async () => {
    vi.mocked(lyricVideoApi.render).mockResolvedValue('job1');
    vi.mocked(lyricVideoApi.renderStatus).mockResolvedValue({ jobId: 'job1', status: 'done', progress: 100, file: 'lyric-lv_1.mp4' });
    vi.mocked(lyricVideoApi.get).mockResolvedValue(p);
    render(<RenderStep project={p} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /render video/i }));
    await waitFor(() => expect(lyricVideoApi.render).toHaveBeenCalledWith('lv_1', 'portrait', '720p'));
    await waitFor(() => expect(screen.getByRole('link', { name: /download/i })).toBeTruthy(), { timeout: 4000 });
  });
});
```

```tsx
// client/src/pages/__tests__/LyricVideoPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../../lib/lyricVideoApi', () => ({ lyricVideoApi: { list: vi.fn().mockResolvedValue([]), prefs: vi.fn().mockResolvedValue({ artist: 'Sthill Waters' }) } }));
import { LyricVideoPage } from '../LyricVideoPage';

it('shows the start screen with the remembered artist', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/app/lyric-video']}>
        <Routes><Route path="/app/lyric-video" element={<LyricVideoPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: /lyric video/i })).toBeTruthy();
  expect(await screen.findByDisplayValue('Sthill Waters')).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd client && npx vitest run src/components/lyricVideo src/pages/__tests__/LyricVideoPage.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

Implement each step exactly as described in this task's "Step behaviour" list, in the style of `client/src/pages/StoryVideoPage.tsx` (same `formStyles` classes, `toast` for errors, `ScreenHeader` with eyebrow "Studio" and title "Lyric video"). Key code that the tests pin:

```tsx
// client/src/components/lyricVideo/TimingStep.tsx — core
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { flaggedCount, formatTime, nudgeLine } from '../../lib/lyricTiming';
import type { LyricProject } from '../../lib/lyricVideoTypes';
import { LivePreview } from './LivePreview';
import { panelCls, secondaryBtnCls } from '../story/formStyles';

export function TimingStep({ project, onChange }: { project: LyricProject; onChange: (p: LyricProject) => void }) {
  const [assVersion, setAssVersion] = useState(1);
  const [now, setNow] = useState(0);
  const { timing, lines } = project;
  const songEnd = project.song?.durationSec ?? Infinity;

  if (timing.status === 'running') {
    return <div className={panelCls}><Loader2 className="inline h-4 w-4 animate-spin" /> Listening to your song…{timing.progress?.window ? ` (part ${timing.progress.window})` : ''}</div>;
  }
  if (timing.status === 'error') {
    return (
      <div className={panelCls}>
        <p className="text-bf-danger">{timing.error}</p>
        <button type="button" className={secondaryBtnCls} onClick={() => lyricVideoApi.align(project.projectId).then(onChange).catch((e: Error) => toast.error(e.message))}>Try again</button>
      </div>
    );
  }
  const save = (lineId: string, start: number) =>
    lyricVideoApi.patchLine(project.projectId, lineId, { start })
      .then((p) => { onChange(p); setAssVersion((v) => v + 1); })
      .catch((e: Error) => toast.error(e.message));
  const flagged = flaggedCount(lines);
  return (
    <div className="space-y-4">
      <LivePreview project={project} assVersion={assVersion} onTime={setNow} />
      <p className="text-sm">{flagged === 0 ? 'Every line is timed.' : `${flagged} line${flagged === 1 ? '' : 's'} to check`}</p>
      {flagged > lines.length / 2 && <p className="text-sm text-bf-danger">Most lines could not be heard — check the lyrics match the song.</p>}
      <ul className="space-y-1">
        {lines.map((l, i) => (
          <li key={l.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 ${l.kind === 'response' ? 'pl-6 text-bf-gold' : ''}`}>
            <span className="w-16 tabular-nums text-xs text-content-secondary">{l.start !== undefined ? formatTime(l.start) : '—'}</span>
            <span className="flex-1">{l.text}</span>
            {l.flag === 'check' && <span className="rounded bg-[rgba(245,211,58,0.15)] px-1.5 text-xs text-bf-gold">Check this line</span>}
            <button type="button" className={secondaryBtnCls} onClick={() => save(l.id, nudgeLine(lines, i, -0.1, songEnd))}>−0.1 s</button>
            <button type="button" className={secondaryBtnCls} onClick={() => save(l.id, nudgeLine(lines, i, 0.1, songEnd))}>+0.1 s</button>
            <button type="button" className={secondaryBtnCls} onClick={() => save(l.id, nudgeLine(lines, i, now - (l.start ?? 0), songEnd))}>Start here</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

(The "+0.1 s" test expects `{ start: 5.1 }` for line `l2` at 5; `nudgeLine` rounds to 0.01. The "−0.1 s" label uses a real minus sign "−" in both the component and any test that queries it.)

```tsx
// client/src/components/lyricVideo/RenderStep.tsx — core polling
const [jobId, setJobId] = useState<string | null>(null);
const [job, setJob] = useState<LyricRenderJob | null>(null);
useEffect(() => {
  if (!jobId) return;
  const t = setInterval(async () => {
    const j = await lyricVideoApi.renderStatus(project.projectId, jobId);
    setJob(j);
    if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') {
      clearInterval(t);
      if (j.status === 'done') onChange(await lyricVideoApi.get(project.projectId));
    }
  }, 2000);
  return () => clearInterval(t);
}, [jobId, project.projectId, onChange]);
// Download link: <a href={`${toOutputUrl(job.file, '')}?dl=${encodeURIComponent(project.title)}.mp4`}>Download</a>
```

In `client/src/App.tsx` add, next to the Story lazy import and route:

```tsx
const LyricVideoPage = lazy(() => import('./pages/LyricVideoPage').then((m) => ({ default: m.LyricVideoPage })));
// …
<Route path="lyric-video" element={<LyricVideoPage />} />
<Route path="lyric-video/:projectId" element={<LyricVideoPage />} />
```

In `client/src/pages/StudioHubPage.tsx` add to `tools` (import `Music` from `lucide-react`):

```tsx
{ to: '/app/lyric-video', icon: Music, title: 'Lyric video', desc: 'Turn your song into a lyric video.' },
```

- [ ] **Step 4: Run to verify they pass, then the whole client**

Run: `cd client && npx vitest run src/components/lyricVideo src/pages/__tests__/LyricVideoPage.test.tsx && npm test && npx eslint src/components/lyricVideo src/pages/LyricVideoPage.tsx src/lib/lyricVideoApi.ts src/lib/lyricTiming.ts && npm run build`
Expected: all PASS; eslint prints nothing for these files; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/LyricVideoPage.tsx client/src/components/lyricVideo client/src/App.tsx client/src/pages/StudioHubPage.tsx client/src/pages/__tests__/LyricVideoPage.test.tsx
git commit -m "feat: Lyric video page — song, lyrics, timing, look and render"
```

---

### Task 16: End-to-end check on real songs, bundle, review

The repo has no Playwright setup (no `playwright.config.*`), so spec §13's end-to-end run is done as a scripted server flow plus a manual browser pass; adding Playwright is out of Phase 1.

**Files:**
- Create: `server/scripts/lyric-video-smoke.mjs`
- Modify: `server/public/**` (rebuilt bundle)

- [ ] **Step 1: Write the smoke script**

```js
// server/scripts/lyric-video-smoke.mjs
// Usage: node --env-file=.env scripts/lyric-video-smoke.mjs <song file> <lyrics.txt> [out.mp4]
// Runs the real pipeline (Whisper, beats, render) on one song and prints the flag count.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, writeProject, applySheet, readProject } from "../src/lib/lyricVideo/projectStore.js";
import { runAlignJob } from "../src/lib/lyricVideo/alignJob.js";
import { buildLyricAss } from "../src/lib/lyricVideo/lyricAss.js";
import { runLyricRender } from "../src/lib/lyricVideo/lyricRender.js";
import { probeAudioDurationSec } from "../src/lib/story/storyRender.js";
import { createJob } from "../src/lib/renderJobs.js";

const [song, sheetFile, outArg] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-smoke-"));
let p = createProject(dir, { title: path.basename(song, path.extname(song)), artist: "Smoke test" });
p = applySheet(p, fs.readFileSync(sheetFile, "utf8"));
p.song = { file: path.resolve(song), durationSec: await probeAudioDurationSec(song), coverStill: null };
writeProject(dir, p);
const t0 = Date.now();
const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId });
console.log(`timing: ${done.timing.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${done.lines.length} lines, ${done.lines.filter((l) => l.flag).length} flagged; ${done.timing.passes?.length} passes; ${done.timing.beats?.bpm} BPM`);
for (const l of done.lines) console.log(`${l.start?.toFixed(2).padStart(7)} ${l.flag ? "CHECK" : "     "} ${l.text}`);
if (outArg) {
  const ass = path.join(dir, "c.ass");
  fs.writeFileSync(ass, buildLyricAss(readProject(dir, p.projectId), { w: 720, h: 1280 }));
  const job = createJob("smoke", { durationSec: done.song.durationSec });
  const r = await runLyricRender({ jobId: job.jobId, songPath: done.song.file, background: null, assPath: ass, width: 720, height: 1280, durationSec: done.song.durationSec, outPath: path.resolve(outArg) });
  console.log("render:", r.ok ? r.file : r.error);
}
```

- [ ] **Step 2: Run it on the reference song and two more of the operator's tracks**

Run (reference): `cd server && node --env-file="C:/Users/segun/source/repos/biblefuel-studio/server/.env" scripts/lyric-video-smoke.mjs "<path to My Time No Late audio>" src/lib/lyricVideo/__fixtures__/my-time-no-late/sheet.txt C:/tmp/lyric-smoke.mp4`
Expected: `timing: done`, ≤ 10 flagged of ~60, a playable 720×1280 mp4. Then ask the operator for two more Gemini tracks with lyric sheets and run the same command on each; record the flag counts in the PR description (spec §15).

- [ ] **Step 3: Manual browser pass**

With the local stack running: Studio → Lyric video → create → upload the song (> 90 MB file goes through the resumable path) → paste the sheet → Read lyrics → Time the lyrics → nudge a flagged line in the preview → Look: Lagos Night, Wild → Render portrait 720p → play and download. Check on a phone-width window (375 px). Note anything that fails as a fix before the PR.

- [ ] **Step 4: Rebuild the bundle and run everything**

Run: `cd client && npm test && npm run build && cd ../server && npm test`
Expected: all green.

```bash
git add server/public server/scripts/lyric-video-smoke.mjs
git commit -m "chore: rebuild client bundle"
```

- [ ] **Step 5: Hand over**

Report: per-task test counts, the smoke results on three songs (flag counts, timing duration, render time), the JASSUB decision, and anything deferred. Do **not** push; the operator decides when to open the PR (it must reference `Closes #51` only after all four phases; Phase 1's PR uses `Refs #51`).
