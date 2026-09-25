# Story Video Render Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Story Video captions cutting off before the voice ends (#2) by making scenes contiguous + audio-length-matched, and add a music bed with autoduck (#3).

**Architecture:** `storyRender` scene durations become contiguous (each scene shows until the next starts; last scene stretches to the probed audio length), and the output `-t` uses the audio length. A ported `sidechaincompress` autoduck chain mixes an optional music bed under the voice. The `/render` route probes the audio and passes duration + music settings through; a new `PATCH /:id/music` stores the bed; the review step gets a small music control.

**Tech Stack:** Node/Express + `node:test`; React 19 + Vitest. Reuses render.js's autoduck filtergraph + `/api/media/upload-audio`.

**Spec:** `docs/superpowers/specs/2026-06-08-story-video-render-quality-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/src/lib/story/storyRender.js` | contiguous scenes, `-t`=audio len, autoduck chain, `probeAudioDurationSec` | Modify |
| `server/src/lib/story/storyRender.test.js` | timing + audio-chain tests | Modify |
| `server/src/routes/story.js` | probe audio in `/render`; `PATCH /:id/music` | Modify |
| `server/src/routes/story.test.js` | music PATCH test | Modify |
| `client/src/lib/storyTypes.ts` | `music.autoDuck?` | Modify |
| `client/src/lib/storyApi.ts` | `setMusic` | Modify |
| `client/src/lib/__tests__/storyApi.test.ts` | setMusic test | Modify |
| `client/src/components/story/MusicControl.tsx` | review-step music UI | Create |
| `client/src/components/story/__tests__/MusicControl.test.tsx` | component test | Create |
| `client/src/pages/StoryVideoPage.tsx` | mount MusicControl in Step 2 | Modify |
| `server/public/**` | rebuilt bundle | Modify |

---

## Task 1: storyRender — contiguous scenes + audio length + autoduck

**Files:**
- Modify: `server/src/lib/story/storyRender.js`
- Test: `server/src/lib/story/storyRender.test.js`

- [ ] **Step 1: Add failing tests** to `server/src/lib/story/storyRender.test.js` (inside the existing `describe`)

```javascript
  // Scenes WITH gaps between them (inter-word silence) — the real-world case.
  const GAPPY = [
    { id: "scene-001", startMs: 500, endMs: 7000, imagePath: "/a.png" },
    { id: "scene-002", startMs: 9000, endMs: 15000, imagePath: "/b.png" },
    { id: "scene-003", startMs: 17000, endMs: 20000, imagePath: "/c.png" },
  ];

  test("sceneSegmentsSec makes scenes contiguous and covers the full audio length", () => {
    const segs = sceneSegmentsSec(GAPPY, 25); // 25s audio
    // scene0: 0 -> next start 9000 = 9s; scene1: 9000 -> 17000 = 8s; scene2: 17000 -> 25000 = 8s
    assert.deepEqual(segs.map((s) => s.durationSec), [9, 8, 8]);
    const sum = segs.reduce((a, s) => a + s.durationSec, 0);
    assert.equal(Number(sum.toFixed(3)), 25); // exactly the audio length, no gaps
  });

  test("output -t uses the audio length when provided, scene-end as fallback", () => {
    const withAudio = buildStoryFfmpegArgs({
      scenes: GAPPY, words: WORDS, audioPath: "/v.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/o.mp4", audioDurationSec: 25,
    });
    const tIdx1 = withAudio.args.indexOf("-t");
    assert.equal(withAudio.args[tIdx1 + 1], "25.000");

    const noAudio = buildStoryFfmpegArgs({
      scenes: GAPPY, words: WORDS, audioPath: "/v.mp3", musicPath: null,
      width: 1080, height: 1920, outPath: "/o.mp4",
    });
    const tIdx2 = noAudio.args.indexOf("-t");
    assert.equal(noAudio.args[tIdx2 + 1], "20.000"); // last scene endMs
  });

  test("autoduck builds a sidechaincompress chain; without it a plain amix", () => {
    const fcOf = (extra) => {
      const { args } = buildStoryFfmpegArgs({
        scenes: GAPPY, words: WORDS, audioPath: "/v.mp3", musicPath: "/m.mp3",
        width: 1080, height: 1920, outPath: "/o.mp4", audioDurationSec: 25, ...extra,
      });
      return args[args.indexOf("-filter_complex") + 1];
    };
    const ducked = fcOf({ autoDuck: true, musicVolume: 0.25 });
    assert.match(ducked, /sidechaincompress/);
    assert.match(ducked, /volume=0\.25/);
    const flat = fcOf({ autoDuck: false, musicVolume: 0.4 });
    assert.doesNotMatch(flat, /sidechaincompress/);
    assert.match(flat, /amix=inputs=2/);
    assert.match(flat, /volume=0\.4/);
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/lib/story/storyRender.test.js`
Expected: FAIL — `sceneSegmentsSec` takes 1 arg; no `audioDurationSec`/`autoDuck` handling.

- [ ] **Step 3: Implement** in `server/src/lib/story/storyRender.js`

(a) Add an ffprobe import at the top (after the existing imports):
```javascript
// (spawn is already imported from "child_process")
```
(b) Replace `sceneSegmentsSec`:
```javascript
/**
 * Per-scene display durations. Scenes are made CONTIGUOUS: scene i shows from
 * its start until scene i+1 starts (scene 0 starts at 0), and the last scene
 * stretches to audioDurationSec — so the video timeline equals the audio
 * timeline and the absolute-timed captions stay in sync. Falls back to each
 * scene's own word-span end for the last scene when audioDurationSec is absent.
 */
export function sceneSegmentsSec(scenes, audioDurationSec) {
  const total = Number(audioDurationSec);
  const useTotal = Number.isFinite(total) && total > 0;
  const lastEndMs = scenes.length ? scenes[scenes.length - 1].endMs : 0;
  const finalMs = useTotal ? total * 1000 : lastEndMs;
  return scenes.map((s, i) => {
    const startMs = i === 0 ? 0 : s.startMs;
    const nextMs = i < scenes.length - 1 ? scenes[i + 1].startMs : finalMs;
    return {
      id: s.id,
      durationSec: Math.max(0.1, (nextMs - startMs) / 1000),
      imagePath: s.imagePath,
    };
  });
}
```
(c) In `buildStoryFfmpegArgs`, change the signature and the `segs`/`totalDurationSec` lines:
```javascript
export function buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height, outPath, audioDurationSec }) {
  if (!scenes.length) throw new Error("story render: no scenes");
  for (const s of scenes) {
    if (!s.imagePath) throw new Error(`story render: scene ${s.id} missing image`);
  }
  const segs = sceneSegmentsSec(scenes, audioDurationSec);
  const totalDurationSec = (Number.isFinite(audioDurationSec) && audioDurationSec > 0)
    ? Number(Number(audioDurationSec).toFixed(3))
    : Number((scenes[scenes.length - 1].endMs / 1000).toFixed(3));
```
(d) Replace the audio-mix block (the `if (musicInputIdx >= 0) { ... } else { ... }` that builds `[mlow]`/`amix`) with the ducked chain:
```javascript
  let audioMap;
  if (musicInputIdx >= 0) {
    const vol = Math.min(1, Math.max(0, Number(musicVolume ?? 0.3)));
    if (autoDuck) {
      filterParts.push(
        `[${audioInputIdx}:a]asplit=2[v1][v2];` +
          `[${musicInputIdx}:a]volume=${vol}[m1];` +
          `[m1][v1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[ducked];` +
          `[v2][ducked]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      );
    } else {
      filterParts.push(
        `[${audioInputIdx}:a]volume=1[a1];` +
          `[${musicInputIdx}:a]volume=${vol}[m1];` +
          `[a1][m1]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      );
    }
    audioMap = "[aout]";
  } else {
    audioMap = `${audioInputIdx}:a`;
  }
```
(e) Thread the new params through `runStoryRender` — change its destructure and the `buildStoryFfmpegArgs` call:
```javascript
export function runStoryRender({ jobId, scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height, outPath, audioDurationSec }) {
  return new Promise((resolve) => {
    let built;
    try {
      built = buildStoryFfmpegArgs({ scenes, words, audioPath, musicPath, musicVolume, autoDuck, width, height, outPath, audioDurationSec });
    } catch (err) {
```
(f) Add an exported audio-duration probe at the end of the file:
```javascript
/** Probe an audio file's duration in seconds via ffprobe. Resolves null on failure. */
export function probeAudioDurationSec(filePath) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const proc = spawn(ffprobe, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const sec = Number(String(out).trim());
      resolve(Number.isFinite(sec) && sec > 0 ? sec : null);
    });
  });
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/lib/story/storyRender.test.js`
Expected: all pass (existing + 3 new). The existing `[8,8,4]` test still passes — its scenes are already contiguous so the new calc yields the same.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/lib/story/storyRender.js server/src/lib/story/storyRender.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "fix(story): contiguous audio-length scenes (caption sync) + autoduck music chain"
```

---

## Task 2: route — probe audio in /render + PATCH /:id/music

**Files:**
- Modify: `server/src/routes/story.js`
- Test: `server/src/routes/story.test.js`

- [ ] **Step 1: Add failing test** to `server/src/routes/story.test.js` (inside `describe("story routes", ...)`)

```javascript
  test("PATCH /:id/music stores path/volume/autoDuck and clamps; null path clears", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;

    const set = mockReqRes({ params: { id }, body: { path: "/out/music.mp3", volume: 5, autoDuck: true }, dataDir, outputDir });
    await handlerFor("patch", "/:id/music")(set.req, set.res);
    assert.equal(set.res.payload.ok, true);
    assert.equal(set.res.payload.project.music.path, "/out/music.mp3");
    assert.equal(set.res.payload.project.music.volume, 1); // clamped to <=1
    assert.equal(set.res.payload.project.music.autoDuck, true);

    const clear = mockReqRes({ params: { id }, body: { path: null }, dataDir, outputDir });
    await handlerFor("patch", "/:id/music")(clear.req, clear.res);
    assert.equal(clear.res.payload.project.music.path, null);
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/routes/story.test.js`
Expected: FAIL — no `patch /:id/music` handler.

- [ ] **Step 3: Implement** in `server/src/routes/story.js`

(a) Add `probeAudioDurationSec` to the storyRender import:
```javascript
import { runStoryRender, probeAudioDurationSec } from "../lib/story/storyRender.js";
```
(b) Add the music PATCH route after the existing `PATCH /:id/scenes/:sid` handler:
```javascript
// PATCH /:id/music — set/clear the background music bed
router.patch("/:id/music", (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const path = req.body?.path ? String(req.body.path) : null;
    const volume = Math.min(1, Math.max(0, Number(req.body?.volume ?? project.music?.volume ?? 0.3)));
    const autoDuck = req.body?.autoDuck === undefined ? (project.music?.autoDuck ?? true) : Boolean(req.body.autoDuck);
    const updated = writeProject(req.ctx.dataDir, {
      ...project,
      music: { path, volume, autoDuck },
    });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
```
(c) In the `POST /:id/render` handler, probe the audio and pass the new params. Find the `runStoryRender({ ... })` call and replace its construction so it first probes:
```javascript
    const audioPath = project.source?.audioPath;
    const audioDurationSec = await probeAudioDurationSec(audioPath);
    runStoryRender({
      jobId: job.jobId,
      scenes,
      words: project.transcript?.words || [],
      audioPath,
      musicPath: project.music?.path || null,
      musicVolume: project.music?.volume ?? 0.3,
      autoDuck: project.music?.autoDuck ?? true,
      width: 1080, height: 1920,
      outPath,
      audioDurationSec: audioDurationSec || undefined,
    }).then((r) => {
```
(Keep the rest of the `.then(...)` body unchanged.)

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/routes/story.test.js` → all pass. Then `cd server && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/routes/story.js server/src/routes/story.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): probe audio length for render + PATCH /:id/music"
```

---

## Task 3: client — setMusic + MusicControl in the review step

**Files:**
- Modify: `client/src/lib/storyTypes.ts`, `client/src/lib/storyApi.ts`, `client/src/pages/StoryVideoPage.tsx`
- Create: `client/src/components/story/MusicControl.tsx`
- Test: `client/src/lib/__tests__/storyApi.test.ts`, `client/src/components/story/__tests__/MusicControl.test.tsx`

- [ ] **Step 1: Type + storyApi test + MusicControl test**

(a) In `client/src/lib/storyTypes.ts`, change the `music` field of `StoryProject`:
```typescript
  music: { path: string | null; volume: number; autoDuck?: boolean };
```

(b) Add to `client/src/lib/__tests__/storyApi.test.ts` (inside `describe('storyApi', ...)`):
```typescript
  it('setMusic PATCHes the project music', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: { projectId: 'p' } } });
    await storyApi.setMusic('p', { path: '/m.mp3', volume: 0.3, autoDuck: true });
    expect(spy).toHaveBeenCalledWith('/api/story/p/music', { path: '/m.mp3', volume: 0.3, autoDuck: true });
  });
```

(c) Create `client/src/components/story/__tests__/MusicControl.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MusicControl } from '../MusicControl';

describe('MusicControl', () => {
  it('shows an add-music control when no music set', () => {
    render(<MusicControl music={{ path: null, volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: /add background music/i })).toBeInTheDocument();
  });

  it('shows volume + autoduck + remove when music is set, and toggling autoduck calls onChange', async () => {
    const onChange = vi.fn();
    render(<MusicControl music={{ path: '/m.mp3', volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    expect(screen.getByRole('button', { name: /remove music/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /autoduck/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autoDuck: false }));
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts src/components/story/__tests__/MusicControl.test.tsx`

- [ ] **Step 3: Implement**

(a) Add to the `storyApi` object in `client/src/lib/storyApi.ts` (after `patchScene`):
```typescript
  async setMusic(id: string, music: { path: string | null; volume: number; autoDuck: boolean }): Promise<StoryProject> {
    const res = await api.patch(`/api/story/${id}/music`, music);
    if (!res.ok || !res.data?.project) throw new Error(res.error || 'Failed to set music');
    return res.data.project as StoryProject;
  },
```

(b) Create `client/src/components/story/MusicControl.tsx`:
```tsx
import { useRef } from 'react';
import { Music, X, Loader2 } from 'lucide-react';
import { storyApi } from '../../lib/storyApi';
import toast from 'react-hot-toast';

type Music = { path: string | null; volume: number; autoDuck?: boolean };

interface MusicControlProps {
  music: Music;
  onChange: (next: Music) => void;
  busy: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function MusicControl({ music, onChange, busy }: MusicControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autoDuck = music.autoDuck ?? true;

  const upload = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const path = await storyApi.uploadAudio(dataUrl, file.name);
      onChange({ path, volume: music.volume ?? 0.3, autoDuck });
      toast.success('Music added');
    } catch (e) {
      toast.error((e as Error).message || 'Music upload failed');
    }
  };

  if (!music.path) {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:border-primary-400 disabled:opacity-50"
        >
          <Music size={14} /> Add background music
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-300">
      <span className="inline-flex items-center gap-1"><Music size={14} /> Music</span>
      <label className="inline-flex items-center gap-1">
        Volume
        <input
          type="range" min={0} max={1} step={0.05} value={music.volume}
          onChange={(e) => onChange({ ...music, autoDuck, volume: Number(e.target.value) })}
          className="accent-primary-500"
        />
      </label>
      <label className="inline-flex items-center gap-1">
        <input
          type="checkbox" checked={autoDuck} aria-label="autoduck"
          onChange={(e) => onChange({ ...music, autoDuck: e.target.checked })}
        />
        Autoduck
      </label>
      <button
        type="button"
        onClick={() => onChange({ path: null, volume: music.volume, autoDuck })}
        className="inline-flex items-center gap-1 text-gray-400 hover:text-red-300"
      >
        <X size={12} /> Remove music
      </button>
      {busy && <Loader2 size={12} className="animate-spin" />}
    </div>
  );
}
```

(c) Wire into `client/src/pages/StoryVideoPage.tsx` Step 2. Import it:
```tsx
import { MusicControl } from '../components/story/MusicControl';
```
Add a handler near the other handlers:
```tsx
  const onMusicChange = async (next: { path: string | null; volume: number; autoDuck?: boolean }) => {
    if (!projectId) return;
    try {
      await storyApi.setMusic(projectId, { path: next.path, volume: next.volume, autoDuck: next.autoDuck ?? true });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };
```
In the `step === 2` block, just BEFORE the render button (`<button ... onClick={onRender} ...>`), add:
```tsx
          {project.music && (
            <MusicControl music={project.music} onChange={onMusicChange} busy={busy} />
          )}
```
NOTE: `project.music` always exists (created by `createProject`), so this renders. If TypeScript complains `project.music` could be undefined, use `project.music ?? { path: null, volume: 0.3, autoDuck: true }`.

- [ ] **Step 4: Run, confirm PASS + type-check**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts src/components/story/__tests__/MusicControl.test.tsx src/pages/__tests__/StoryVideoPage.test.tsx`
Then `cd client && npx tsc -b 2>&1 | tail -20` → no errors.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyTypes.ts client/src/lib/storyApi.ts client/src/lib/__tests__/storyApi.test.ts client/src/components/story/MusicControl.tsx client/src/components/story/__tests__/MusicControl.test.tsx client/src/pages/StoryVideoPage.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): music bed + autoduck control in the review step"
```

---

## Task 4: full sweep + rebuild bundle

- [ ] **Step 1:** `cd server && npm test` → green; `cd client && npm test` → green.
- [ ] **Step 2:** `cd client && npm run build`, then:
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(story-ui): rebuild bundle with render-quality fixes"
```

---

## Notes for the Implementer

- **#2 proof (live):** render a clip with multi-second gaps/pauses and **watch captions track the voice to the very end** — before this fix they stopped early. Confirm output duration == audio duration (`ffprobe`).
- **`duration=first`** in the amix keeps the mix at the **voice** length (voice is the first amix input), so a short music loop doesn't truncate the audio and a long bed is cut to the voice. The output `-t` (= audio length) caps it.
- **Existing storyRender tests stay green** because their sample scenes are already contiguous (`[8,8,4]` holds under the new next-start math).
- The `sidechaincompress` params are copied verbatim from the proven `render.js` autoduck so behaviour matches the rest of the app.
