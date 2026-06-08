# Gumroad & Timeline Refinements — Design

**Date:** 2026-06-08
**Branch:** `worktree-feat-gumroad-timeline-refinements` (off `master` @ 86f1244)
**Status:** Approved design, pending spec review

A cohesive batch of three refinements that build on the shipped "Send to Timeline" feature.

---

## Refinement 1 — Per-day "Send to Timeline"

### Problem
The current single "Send to Timeline" button concatenates **all 7 days** of the free devotional into one narration → one audio file → ~40 caption lines → one long video. The Timeline holds one source at a time, so an all-in-one send is unfocused. Per-day sends produce short, focused captioned videos (mirroring the Series model).

### Parser
Add to `client/src/lib/gumroadToTimeline.ts`:

```
interface DevotionalDay {
  dayNumber: number;      // 1..7
  reference: string;      // e.g. "Philippians 4:6-7"
  narrationText: string;  // exactly lines.join(' ')
  lines: string[];        // <=8-word caption lines for this day
}
parseFreeDevotionalDays(markdown: string): DevotionalDay[]
```

- Split the markdown on `## Day N: <reference>` headings.
- Within each day, reuse the existing Verse/Reflection/Prayer extraction + ≤8-word chunking (the same `LABEL_RE` + chunk logic that `parseFreeDevotional` already uses).
- `narrationText === lines.join(' ')` per day (same positional-alignment invariant the Timeline relies on).
- Tolerant of a missing prayer/reflection line; ignores the title/intro/footer.

### UI (GumroadPage)
Below the free markdown `<pre>`, render a **"Send a day to Timeline"** list — one row per parsed day: `Day {n} · {reference}` + a **Send** button. The previous single all-in-one button is **removed**.

### Handler
Refactor the existing send logic into a reusable helper:

```
narrateAndSendToTimeline(narrationText: string, lines: string[]): Promise<void>
```

It performs the existing flow unchanged: `POST /api/tts/synthesize-category` (category `devotional`, `withTimestamps`) → measure duration → `extractTranscript` → seed `timelineClips=[]`, `sclSourcePath`, `sclSourceKind`, `sclTranscript`, `sclEditedLines` → `navigate('/app/timeline')`. Each day's button calls it with that day's `narrationText` + `lines`. A per-row loading state disables only the active day's button.

### Out of scope
No Timeline, TTS, or render changes. Paid product still has no buttons (placeholder verses).

---

## Refinement 2 — Gumroad history (server-backed)

### Problem
Generated packs live only in client state + an in-memory server `last` var; navigating away wipes them. Persist per-account history so users can revisit and re-action packs. This is also the first slice of the future "product catalog" moat.

### Store
New `server/src/lib/gumroadStore.js`, modeled exactly on `server/src/lib/transcriptStore.js`:

- File: `${dataDir}/gumroad-history.json` (resolved per-request from `req.ctx.dataDir`).
- On-disk shape: `{ packs: GumroadRecord[] }`.
- Atomic writes (temp file + rename); corruption-tolerant reads (return `[]`).
- Per-`userId` filtering; cap `MAX_RECENT = 50`.
- **Upsert by (freeTitle + paidTitle)**: regenerating the same titles updates the existing record (refresh `updatedAt`, move to front, preserve `createdAt`) instead of duplicating.

```
GumroadRecord = {
  id: string,            // uuid
  userId: string,        // req.ctx.userId
  freeTitle: string,
  paidTitle: string,
  freeMarkdown: string,
  paidMarkdown: string,
  createdAt: string,     // ISO, preserved on upsert
  updatedAt: string,     // ISO, refreshed on upsert
}
```

Exposed functions: `saveGumroadPack(ctx, { freeTitle, paidTitle, freeMarkdown, paidMarkdown })`, `listGumroadPacks(ctx, limit)`, `deleteGumroadPack(ctx, id)`.

### Routes (`server/src/routes/gumroad.js`)
- `POST /api/gumroad/generate` — after building the markdown, **best-effort** `saveGumroadPack(...)` and include the saved record's `id` in the response. A save failure is logged and does **not** fail generation.
- `GET /api/gumroad/history?limit=50` → `{ ok: true, items: GumroadRecord[] }`.
- `DELETE /api/gumroad/history/:id` → `{ ok: true, removed: boolean }`.

(`req.ctx.dataDir` / `userId` are available — the route already runs behind `requireAuth → withUserScope → featureGate("gumroad")`.)

### UI (GumroadPage)
A **History** panel listing saved packs (`freeTitle` + relative date). Clicking an item reloads its `freeMarkdown` / `paidMarkdown` into the result view (so per-day Send buttons work on it). Each item has a delete button. The panel refetches after a successful generate.

---

## Refinement 3 — Trim-output reuse (Timeline: Source ↔ Music Bed)

### Problem
After uploading/trimming a sermon as Source Media, there's no way to reuse that exact (trimmed) file as the Music Bed without re-uploading — and vice versa. Users need the same processed file available in both slots.

### Mechanism (client-only, all on `TimelinePage.tsx`)
1. **Record audio into history.** Start pushing every uploaded/trimmed **audio** file into the existing-but-unused `STORAGE_KEYS.audioHistory` (`AudioItem = { id, path, kind, createdAt }`), deduped by path, capped (e.g. 25), via a small `pushAudioHistory(path, kind)` helper. Hook it into: `handleSourceUpload` (audio), `handleMusicUpload`, and both Source/Music trim `apply` callbacks.
2. **Cross-slot quick actions.**
   - Source Media card (when an audio source is loaded): **"Use as Music Bed"** → `setMusicPath(sourceMediaPath)`.
   - Music Bed card (when music loaded): **"Use as Source"** → `setSourceMediaPath(musicPath)` (+ replace the assembly clip, matching the existing source-trim behavior).
3. **Recent Audio panel.** Populate the existing empty "Recent Audio" panel from `audioHistory`; each item gets **"Use as Source"** and **"Use as Music Bed"** buttons.

### Out of scope (this pass)
No server or `MediaTrimmer` changes (`onApply` already returns the trimmed path). Render/Story pages deferred to a later pass (per the chosen "Timeline first" scope).

---

## Cross-cutting

### Testing
- Unit: `parseFreeDevotionalDays` (per-day split, reference extraction, `narrationText === lines.join(' ')` per day, missing-line tolerance, empty input).
- Unit: `gumroadStore` (upsert by titles, per-user scoping, cap at 50, corruption-tolerant read) — mirroring `transcriptStore` tests if present, else direct fs-temp tests.
- Manual/smoke: per-day send → focused video; history persists across reload + delete; trim a source then "Use as Music Bed".

### Error handling
- History save is best-effort and never blocks generation.
- Per-day narration reuses the existing graceful TTS-failure path (toast, no navigation, no hang).
- Cross-slot actions are no-ops when the relevant path is empty (buttons hidden/disabled).

### Files touched

| File | Change |
|------|--------|
| `client/src/lib/gumroadToTimeline.ts` | **add** `parseFreeDevotionalDays` (+ `DevotionalDay`) |
| `client/src/lib/__tests__/gumroadToTimeline.test.ts` | **add** per-day tests |
| `client/src/pages/GumroadPage.tsx` | per-day list + `narrateAndSendToTimeline` refactor + History panel |
| `server/src/lib/gumroadStore.js` | **new** per-user JSON store |
| `server/src/lib/gumroadStore.test.js` | **new** store tests |
| `server/src/routes/gumroad.js` | persist on generate + history GET/DELETE |
| `client/src/pages/TimelinePage.tsx` | audio-history recording + cross-slot actions + Recent Audio panel |

No changes to: Timeline render, TTS, `MediaTrimmer`, or any other pipeline.
