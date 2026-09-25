# Story Video Audio Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert an optional, skippable trim step between uploading a sermon and running the Story Video pipeline, reusing the existing `MediaTrimmer` + `POST /api/media/trim`.

**Architecture:** A single-file change to `client/src/pages/StoryVideoPage.tsx`. Split the current `handleCreateAndUpload` into `handlePickFile` (upload → hold path) and `startPipeline(path)` (create→transcribe→segment→images). After upload show a small "ready" panel (Trim / Use full / Pick different); "Trim" opens the MediaTrimmer modal. No backend changes.

**Tech Stack:** React 19 + TanStack Query + Vitest/testing-library. `MediaTrimmer` modal + `/api/media/trim` already exist (verified: trim output lands in the user's output dir and passes the `/transcribe` guard).

**Spec:** `docs/superpowers/specs/2026-06-07-story-video-audio-trim-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `client/src/pages/StoryVideoPage.tsx` | upload→trim→pipeline phasing | Modify |
| `client/src/pages/__tests__/StoryVideoPage.test.tsx` | trim-flow tests (MediaTrimmer mocked) | Modify |
| `server/public/**` | rebuilt bundle | Modify |

---

## Task 1: Trim step in StoryVideoPage

**Files:**
- Modify: `client/src/pages/StoryVideoPage.tsx`
- Test: `client/src/pages/__tests__/StoryVideoPage.test.tsx`

- [ ] **Step 1: Add the failing tests**

In `client/src/pages/__tests__/StoryVideoPage.test.tsx`:

(a) At the TOP of the file (after the existing imports), add a `MediaTrimmer` mock and ensure `fireEvent`/`userEvent` are imported:
```tsx
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub the MediaTrimmer modal so tests never touch the waveform/network.
vi.mock('../../components/MediaTrimmer', () => ({
  MediaTrimmer: ({ onApply, onCancel }: any) => (
    <div data-testid="media-trimmer">
      <button onClick={() => onApply('/out/trimmed.mp3', 12)}>trimmer-apply</button>
      <button onClick={() => onCancel()}>trimmer-close</button>
    </div>
  ),
}));
```
(If `fireEvent`/`userEvent` are already imported in the file, don't duplicate them.)

(b) Add these tests inside the existing `describe('StoryVideoPage', ...)`. They use a shared draft-project fixture so the post-create polling render is valid:
```tsx
  function mkDraft(id = 'np') {
    return {
      projectId: id, title: 'T', style: 'cinematic-bible', status: 'draft',
      source: { audioPath: null, durationMs: 0 }, transcript: { words: [], hash: null },
      scenes: [], music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any;
  }
  function mockPipeline() {
    vi.spyOn(storyApi, 'createProject').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'segment').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'generateImages').mockResolvedValue(mkDraft());
    return vi.spyOn(storyApi, 'transcribe').mockResolvedValue(mkDraft());
  }
  function pickFile() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['xxxxxxxx'], 'sermon.mp3', { type: 'audio/mpeg' });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('after picking a file, shows the ready panel — NOT an immediate transcribe', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    const transcribe = mockPipeline();
    renderPage();
    pickFile();
    expect(await screen.findByRole('button', { name: /use full audio/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trim audio/i })).toBeInTheDocument();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('"Use full audio" runs the pipeline with the uploaded path', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    const transcribe = mockPipeline();
    renderPage();
    pickFile();
    await userEvent.click(await screen.findByRole('button', { name: /use full audio/i }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledWith('np', '/out/full.mp3'));
  });

  it('"Trim audio" → apply runs the pipeline with the trimmed path', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue('/out/full.mp3');
    const transcribe = mockPipeline();
    renderPage();
    pickFile();
    await userEvent.click(await screen.findByRole('button', { name: /trim audio/i }));
    await userEvent.click(await screen.findByRole('button', { name: /trimmer-apply/i }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledWith('np', '/out/trimmed.mp3'));
  });

  it('upload error returns to the form (no ready panel)', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockRejectedValue(new Error('upload boom'));
    renderPage();
    pickFile();
    await waitFor(() => expect(storyApi.uploadAudio).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /use full audio/i })).toBeNull();
    expect(screen.getByRole('button', { name: /upload a sermon/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: the new tests fail (no "Use full audio"/"Trim audio" buttons; picking a file currently transcribes immediately).

- [ ] **Step 3: Implement** — edit `client/src/pages/StoryVideoPage.tsx`

(a) Add the MediaTrimmer import with the other component imports:
```tsx
import { MediaTrimmer } from '../components/MediaTrimmer';
```

(b) Add new state next to the existing `useState`s (after the `fileInputRef` line):
```tsx
  const [pendingAudio, setPendingAudio] = useState<string | null>(null);
  const [showTrimmer, setShowTrimmer] = useState(false);
  const [defaultTitle, setDefaultTitle] = useState('');
```

(c) REPLACE the whole `handleCreateAndUpload` function with two functions:
```tsx
  // Phase 1: upload the picked file, then hold its server path for the trim step.
  const handlePickFile = async (file: File) => {
    setBusy(true);
    try {
      setDefaultTitle(file.name.replace(/\.[^.]+$/, ''));
      const dataUrl = await readFileAsDataUrl(file);
      const path = await storyApi.uploadAudio(dataUrl, file.name);
      setPendingAudio(path);
    } catch (e) {
      toast.error((e as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  // Phase 2: run the pipeline on the chosen audio path (trimmed or full).
  const startPipeline = async (audioPath: string) => {
    setBusy(true);
    setShowTrimmer(false);
    try {
      const created = await storyApi.createProject(title || defaultTitle, style);
      setActive(created.projectId);
      await storyApi.transcribe(created.projectId, audioPath);
      await storyApi.segment(created.projectId);
      await storyApi.generateImages(created.projectId);
      setPendingAudio(null);
      qc.invalidateQueries({ queryKey: ['story-project', created.projectId] });
      toast.success('Scenes ready — review below');
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong');
      refresh();
    } finally {
      setBusy(false);
    }
  };
```

(d) In the file input's `onChange`, call `handlePickFile` instead of `handleCreateAndUpload`:
```tsx
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePickFile(f);
                  e.target.value = '';
                }}
```

(e) REPLACE the Step-1 render branch. The current code is:
```tsx
          {transient && busy ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 text-sm text-gray-300">
              <Loader2 className="animate-spin text-primary-400" size={18} />
              {progressLabel(project!.status)}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-8 text-sm text-gray-300 hover:border-primary-400 disabled:opacity-60 ${busy ? 'cursor-default' : 'cursor-pointer'}`}
              >
                {busy ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                {busy ? 'Working…' : 'Upload a sermon (MP3/M4A/MP4)'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePickFile(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
```
Replace it with a three-way branch (busy spinner → ready panel → upload button), keeping the hidden input always mounted:
```tsx
          {busy ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 text-sm text-gray-300">
              <Loader2 className="animate-spin text-primary-400" size={18} />
              {project && isTransientStatus(project.status) ? progressLabel(project.status) : 'Working…'}
            </div>
          ) : pendingAudio ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm text-gray-200">Audio uploaded. Trim it, or use the whole thing.</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowTrimmer(true)}
                  className="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-dark-900 hover:bg-primary-400"
                >
                  Trim audio
                </button>
                <button
                  type="button"
                  onClick={() => startPipeline(pendingAudio)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-200 hover:border-primary-400"
                >
                  Use full audio
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAudio(null)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
                >
                  Pick a different file
                </button>
              </div>
              {showTrimmer && (
                <MediaTrimmer
                  serverPath={pendingAudio}
                  kind="audio"
                  onApply={(trimmedPath) => { setShowTrimmer(false); startPipeline(trimmedPath); }}
                  onCancel={() => setShowTrimmer(false)}
                />
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-8 text-sm text-gray-300 hover:border-primary-400 cursor-pointer"
              >
                <Upload size={18} />
                Upload a sermon (MP3/M4A/MP4)
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePickFile(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
```
NOTE: `transient` (the `const transient = ...` line) may now be unused — if `npx tsc -b` flags it as unused under `noUnusedLocals`, delete that line. `isTransientStatus` IS still used (in the busy spinner branch), keep its import.

- [ ] **Step 4: Run, confirm PASS**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: all pass (existing + 4 new). The existing "upload control is a real button" test still finds the upload `<button>` (rendered when not busy and no pendingAudio). The existing resume/step tests don't pick a file, so they're unaffected.

- [ ] **Step 5: Type-check + commit**

Run: `cd client && npx tsc -b 2>&1 | tail -20` → no errors (delete the now-unused `transient` const if flagged).
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/pages/StoryVideoPage.tsx client/src/pages/__tests__/StoryVideoPage.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): optional audio trim step before processing"
```

---

## Task 2: Full sweep + rebuild bundle

- [ ] **Step 1: Run the client suite**

Run: `cd client && npm test` → all green. (Server is untouched, but a quick `cd server && npm test` confirms no accidental breakage.)

- [ ] **Step 2: Build + commit the bundle**

Run: `cd client && npm run build` (emits into `server/public`).
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(story-ui): rebuild bundle with audio trim"
```

---

## Notes for the Implementer

- **`MediaTrimmer` is a named export** (`export function MediaTrimmer`) — the `vi.mock` factory returns `{ MediaTrimmer: ... }` to match.
- **`readFileAsDataUrl`** already exists in the file (uses `FileReader`); jsdom supports it for the test's stub `File`.
- **Why the busy spinner is checked first** in the render branch: during `startPipeline`, `busy` is true and `pendingAudio` is still set until the chain completes — checking `busy` first prevents the ready-panel buttons from flashing during processing.
- **Manual check (live smoke test):** upload a real multi-minute clip → "Trim audio" opens the waveform modal → drag to a window → Apply → only that window is transcribed/segmented/rendered. "Use full audio" processes the whole clip. The unit tests mock the trimmer, so the real waveform/cut is verified live.
