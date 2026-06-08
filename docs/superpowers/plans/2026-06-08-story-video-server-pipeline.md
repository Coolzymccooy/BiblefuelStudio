# Story Video Server-Orchestrated Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Story Video transcribe→segment→images pipeline server-side (background) so switching tabs / navigating away never loses an in-progress job.

**Architecture:** Extract the three stage bodies in `routes/story.js` into re-entrant helpers + an exported awaitable `runStoryPipeline`; add a fire-and-forget `POST /:id/process`; the existing per-stage routes become thin wrappers. The client kicks off `process` once and polls; `isStalled` becomes staleness-based so Resume only shows for genuinely stuck jobs.

**Tech Stack:** Node/Express + `node:test`; React 19 + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-story-video-server-pipeline-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/src/routes/story.js` | stage helpers, `runStoryPipeline`, `POST /:id/process`, thin wrappers | Modify |
| `server/src/routes/story.test.js` | process + re-entrancy tests | Modify |
| `client/src/lib/storyWizard.ts` | `isStalled(project, nowMs)` staleness-based | Modify |
| `client/src/lib/__tests__/storyWizard.test.ts` | updated isStalled tests | Modify |
| `client/src/lib/storyApi.ts` | `process(id, mediaPath)` | Modify |
| `client/src/lib/__tests__/storyApi.test.ts` | process test | Modify |
| `client/src/pages/StoryVideoPage.tsx` | startPipeline + resume via `process`; stalled via nowMs | Modify |
| `client/src/pages/__tests__/StoryVideoPage.test.tsx` | assert `process` not transcribe | Modify |
| `server/public/**` | rebuilt bundle | Modify |

---

## Task 1: Backend — stage helpers + runStoryPipeline + /process

**Files:**
- Modify: `server/src/routes/story.js`
- Test: `server/src/routes/story.test.js`

- [ ] **Step 1: Add failing tests** to `server/src/routes/story.test.js` (inside `describe("story routes", ...)`)

```javascript
  test("runStoryPipeline drives a project from a transcript to ready_to_render", async () => {
    const { runStoryPipeline } = await import("./story.js");
    // seed a project + a real audio file in outputDir (transcribe mocked)
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const fs = await import("fs");
    const path = await import("path");
    const audio = path.join(outputDir, "voice.mp3");
    fs.writeFileSync(audio, "ID3");
    _setTranscribeImpl(async () => ({ words: Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })) }));
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 5, imagePrompt: "p" }, { text: "b", startWordIndex: 6, endWordIndex: 11, imagePrompt: "q" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/outputs/img.png" }));
    try {
      await runStoryPipeline({ dataDir, outputDir }, id, audio);
      const p = readProject(dataDir, id);
      assert.equal(p.status, "ready_to_render");
      assert.equal(p.scenes.length, 2);
      assert.equal(p.scenes.every((s) => s.imageStatus === "done"), true);
    } finally {
      _resetTranscribeImpl(); _resetLlmImpl(); _resetImageGenImpl();
    }
  });

  test("runStoryPipeline is re-entrant — skips transcription when a transcript exists", async () => {
    const { runStoryPipeline } = await import("./story.js");
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const proj = readProject(dataDir, id);
    writeProject(dataDir, { ...proj, transcript: { words: Array.from({ length: 8 }, (_, i) => ({ text: `w${i}`, startMs: i * 1000, endMs: i * 1000 + 800 })), hash: "h" } });
    let transcribeCalls = 0;
    _setTranscribeImpl(async () => { transcribeCalls += 1; return { words: [] }; });
    _setLlmImpl(async () => JSON.stringify({ scenes: [{ text: "a", startWordIndex: 0, endWordIndex: 7, imagePrompt: "p" }] }));
    _setImageGenImpl(async () => ({ ok: true, path: "/img.png", publicUrl: "/o/img.png" }));
    try {
      await runStoryPipeline({ dataDir, outputDir }, id, path.join(outputDir, "nope.mp3"));
      assert.equal(transcribeCalls, 0); // transcript already present -> skipped
      assert.equal(readProject(dataDir, id).status, "ready_to_render");
    } finally {
      _resetTranscribeImpl(); _resetLlmImpl(); _resetImageGenImpl();
    }
  });

  test("POST /:id/process returns ok immediately and rejects an out-of-scope mediaPath", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;
    const evil = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/passwd";
    const bad = mockReqRes({ params: { id }, body: { mediaPath: evil }, dataDir, outputDir });
    await handlerFor("post", "/:id/process")(bad.req, bad.res);
    assert.equal(bad.res.statusCode, 403);
  });
```
`_setLlmImpl/_resetLlmImpl` import: at the top of `story.test.js`, ensure `import { _setLlmImpl, _resetLlmImpl } from "../lib/story/sceneSegmenter.js";` exists (it does — used by the segment test). `writeProject`/`readProject` are imported. `path` is imported per-test via `await import`.

- [ ] **Step 2: Run, confirm FAIL**

Run: `node --test server/src/routes/story.test.js`
Expected: FAIL — `runStoryPipeline` not exported; no `/:id/process` handler.

- [ ] **Step 3: Implement** in `server/src/routes/story.js`

(a) Add a path-guard helper near the top (after the seam declarations):
```javascript
// Confine a user-supplied mediaPath to the caller's own dirs (anti path-traversal).
function confineMediaPath(ctx, rawMediaPath) {
  const raw = String(rawMediaPath || "").trim();
  if (!raw) return { ok: false, status: 400, error: "mediaPath required" };
  const resolved = path.resolve(raw);
  const roots = [path.resolve(ctx.outputDir), path.resolve(ctx.dataDir)];
  const within = roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  if (!within) return { ok: false, status: 403, error: "mediaPath is outside the allowed directory" };
  if (!fs.existsSync(resolved)) return { ok: false, status: 400, error: "mediaPath not found" };
  return { ok: true, path: resolved };
}

// --- Pipeline stages (re-entrant). ctx = { dataDir, outputDir }. ---
async function transcribeStage(ctx, projectId, mediaPath) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  if (project.transcript?.words?.length) {
    return writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.SEGMENTING });
  }
  writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.TRANSCRIBING, error: null });
  const isVideo = VIDEO_EXT.has(path.extname(mediaPath).toLowerCase());
  const audioPath = isVideo ? await extractAudioToMp3(mediaPath, ctx.outputDir) : mediaPath;
  const chunks = await chunkAudioForTranscription(audioPath, ctx.outputDir, 0);
  const transcribed = await Promise.all(
    chunks.map(async (c) => ({ offsetMs: c.offsetMs, transcription: await _transcribeFn(c.path) })),
  );
  const stitched = stitchTranscriptions(transcribed);
  if (!stitched.words.length) {
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, projectId), status: STORY_STATUS.ERROR, error: "transcription returned no words" });
    throw new Error("Transcription returned no words");
  }
  const durationMs = stitched.words[stitched.words.length - 1].endMs;
  return writeProject(ctx.dataDir, {
    ...readProject(ctx.dataDir, projectId),
    source: { audioPath, durationMs },
    transcript: { words: stitched.words, hash: String(durationMs) + ":" + stitched.words.length },
    status: STORY_STATUS.SEGMENTING,
  });
}

async function segmentStage(ctx, projectId) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  if (project.scenes?.length) {
    return writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.GENERATING_IMAGES });
  }
  const words = project.transcript?.words || [];
  if (!words.length) throw new Error("no transcript to segment");
  const scenes = await segmentScenes({ words, style: project.style });
  return writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.GENERATING_IMAGES });
}

async function imagesStage(ctx, projectId) {
  let project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  const scenes = [...(project.scenes || [])];
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].imageStatus === "done" && scenes[i].imagePath) continue;
    scenes[i] = { ...scenes[i], imageStatus: "generating" };
    project = writeProject(ctx.dataDir, { ...project, scenes });
    const result = await _imageGenFn({ seriesId: project.projectId, partNumber: i + 1, rawPrompt: scenes[i].imagePrompt, aspect: "portrait" });
    scenes[i] = result?.ok
      ? { ...scenes[i], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done" }
      : { ...scenes[i], imageStatus: "error" };
    project = writeProject(ctx.dataDir, { ...project, scenes });
  }
  const allDone = scenes.every((s) => s.imageStatus === "done");
  return writeProject(ctx.dataDir, { ...project, scenes, status: allDone ? STORY_STATUS.READY_TO_RENDER : STORY_STATUS.GENERATING_IMAGES });
}

/** Run the whole pipeline server-side. Awaitable (tests await it); the route fires it detached. */
export async function runStoryPipeline(ctx, projectId, mediaPath) {
  await transcribeStage(ctx, projectId, mediaPath);
  await segmentStage(ctx, projectId);
  await imagesStage(ctx, projectId);
}
```

(b) Replace the THREE existing route handler bodies (`POST /:id/transcribe`, `/:id/segment`, `/:id/images`) with thin wrappers that call the stages (delete the old bodies). Keep the routes in place:
```javascript
router.post("/:id/transcribe", async (req, res) => {
  try {
    if (!readProject(req.ctx.dataDir, req.params.id)) return res.status(404).json({ ok: false, error: "project not found" });
    const guard = confineMediaPath(req.ctx, req.body?.mediaPath);
    if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });
    const updated = await transcribeStage({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id, guard.path);
    return res.json({ ok: true, project: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(/no words/i.test(msg) ? 502 : 500).json({ ok: false, error: msg });
  }
});

router.post("/:id/segment", async (req, res) => {
  try {
    const updated = await segmentStage({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id);
    return res.json({ ok: true, project: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /not found/i.test(msg) ? 404 : /no transcript/i.test(msg) ? 400 : 500;
    return res.status(status).json({ ok: false, error: msg });
  }
});

router.post("/:id/images", async (req, res) => {
  try {
    const updated = await imagesStage({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id);
    return res.json({ ok: true, project: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(/not found/i.test(msg) ? 404 : 500).json({ ok: false, error: msg });
  }
});
```
NOTE: the `/script-to-audio` route currently sits between `/transcribe` and `/segment` — leave it where it is; only the three stage handlers' bodies change.

(c) Add the `POST /:id/process` route (place it after `/:id/images`):
```javascript
// POST /:id/process — run transcribe -> segment -> images SERVER-SIDE in the
// background. Returns immediately; the client polls. Re-entrant (Resume re-calls).
router.post("/:id/process", (req, res) => {
  if (!readProject(req.ctx.dataDir, req.params.id)) return res.status(404).json({ ok: false, error: "project not found" });
  const guard = confineMediaPath(req.ctx, req.body?.mediaPath);
  if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  runStoryPipeline(ctx, id, guard.path).catch((e) => {
    try {
      const fresh = readProject(ctx.dataDir, id);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
    } catch {}
  });
  return res.json({ ok: true });
});
```

- [ ] **Step 4: Run, confirm PASS**

Run: `node --test server/src/routes/story.test.js` → all pass (existing transcribe/segment/images security + idempotency tests still pass via the wrappers, plus the 3 new). Then `cd server && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/routes/story.js server/src/routes/story.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): server-orchestrated pipeline (POST /:id/process) + re-entrant stages"
```

---

## Task 2: Client — process call + staleness Resume + rewire

**Files:**
- Modify: `client/src/lib/storyWizard.ts`, `client/src/lib/__tests__/storyWizard.test.ts`, `client/src/lib/storyApi.ts`, `client/src/lib/__tests__/storyApi.test.ts`, `client/src/pages/StoryVideoPage.tsx`, `client/src/pages/__tests__/StoryVideoPage.test.tsx`

- [ ] **Step 1: Update isStalled + storyApi tests**

(a) Replace the `isStalled` tests in `client/src/lib/__tests__/storyWizard.test.ts` (the existing `describe('isStalled', ...)` block) with:
```typescript
describe('isStalled', () => {
  const now = 1_000_000_000_000;
  it('true when a transient status has gone stale (server likely died)', () => {
    expect(isStalled(project({ status: 'generating_images', updatedAt: now - 200_000 }), now)).toBe(true);
    expect(isStalled(project({ status: 'transcribing', updatedAt: now - 200_000 }), now)).toBe(true);
  });
  it('false while a transient status is still fresh (server actively working)', () => {
    expect(isStalled(project({ status: 'generating_images', updatedAt: now - 5_000 }), now)).toBe(false);
  });
  it('false for non-transient statuses regardless of age', () => {
    expect(isStalled(project({ status: 'ready_to_render', updatedAt: 0 }), now)).toBe(false);
    expect(isStalled(project({ status: 'done', updatedAt: 0 }), now)).toBe(false);
    expect(isStalled(project({ status: 'error', updatedAt: 0 }), now)).toBe(false);
  });
});
```

(b) Add to `client/src/lib/__tests__/storyApi.test.ts` (inside `describe('storyApi', ...)`):
```typescript
  it('process posts the mediaPath to /process', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    await storyApi.process('p', '/out/a.mp3');
    expect(spy).toHaveBeenCalledWith('/api/story/p/process', { mediaPath: '/out/a.mp3' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
  });
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts src/lib/__tests__/storyApi.test.ts`

- [ ] **Step 3: Implement the lib changes**

(a) In `client/src/lib/storyWizard.ts`, replace the `CLIENT_DRIVEN_TRANSIENT` + `isStalled` block with a staleness-based version:
```typescript
const STALL_MS = 90_000; // a transient status older than this looks stuck (server died)

/**
 * A project is "stalled" when it's in a transient (in-flight) status but its
 * record hasn't been touched in a while — i.e. no server stage is advancing it
 * (e.g. the server restarted mid-pipeline). The server now drives the pipeline,
 * so a fresh transient status just means "working" — NOT stalled.
 */
export function isStalled(project: StoryProject, nowMs: number): boolean {
  return isTransientStatus(project.status) && (nowMs - project.updatedAt) > STALL_MS;
}
```

(b) In `client/src/lib/storyApi.ts`, add a timeout const near the others and a `process` method (after `uploadAudio`):
```typescript
const PROCESS_TIMEOUT_MS = 60_000;
```
```typescript
  async process(id: string, mediaPath: string): Promise<void> {
    const res = await api.post(`/api/story/${id}/process`, { mediaPath }, undefined, { timeout: PROCESS_TIMEOUT_MS });
    if (!res.ok) throw new Error(res.error || 'Failed to start processing');
  },
```

- [ ] **Step 4: Run lib tests, confirm PASS**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts src/lib/__tests__/storyApi.test.ts`

- [ ] **Step 5: Rewire the page + its tests**

(a) In `client/src/pages/StoryVideoPage.tsx`, replace the body of `startPipeline` (the create→transcribe→segment→images chain) with a server-orchestrated kickoff:
```tsx
  const startPipeline = async (audioPath: string) => {
    setBusy(true);
    setShowTrimmer(false);
    try {
      const created = await storyApi.createProject(title || defaultTitle, style);
      setActive(created.projectId);
      await storyApi.process(created.projectId, audioPath);
      setPendingAudio(null);
      qc.invalidateQueries({ queryKey: ['story-project', created.projectId] });
      toast.success('Generating on the server — you can leave this page');
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong');
      refresh();
    } finally {
      setBusy(false);
    }
  };
```
(b) Replace the `resume` handler body so it re-runs the server pipeline:
```tsx
  const resume = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const p = await storyApi.getProject(projectId);
      const audioPath = p.source?.audioPath;
      if (!audioPath) {
        toast.error('Upload was interrupted — please start again.');
        setActive(null);
        return;
      }
      if (p.status === 'rendering') {
        await storyApi.render(projectId);
      } else {
        await storyApi.process(projectId, audioPath);
      }
      qc.invalidateQueries({ queryKey: ['story-project', projectId] });
      toast.success('Resumed');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
```
(c) Change the `stalled` computation to pass the current time (the page re-renders on each 2.5s poll, so `Date.now()` is fresh enough):
```tsx
  const stalled = project ? isStalled(project, Date.now()) : false;
```
(Remove the now-unused `busy` argument from the old `isStalled(project, busy)` call.)

(d) In `client/src/pages/__tests__/StoryVideoPage.test.tsx`, update the flow tests so they mock + assert `storyApi.process` instead of transcribe/segment/generateImages. In the `mockPipeline()` helper, replace the transcribe/segment/generateImages spies with:
```tsx
  function mockPipeline() {
    vi.spyOn(storyApi, 'createProject').mockResolvedValue(mkDraft());
    vi.spyOn(storyApi, 'getProject').mockResolvedValue(mkDraft());
    return vi.spyOn(storyApi, 'process').mockResolvedValue(undefined);
  }
```
Then in the three flow assertions that currently check `expect(transcribe).toHaveBeenCalledWith('np', '<path>')`, change them to:
```tsx
    await waitFor(() => expect(storyApi.process).toHaveBeenCalledWith('np', '<path>'));
```
keeping the same `<path>` (`/out/full.mp3` for "Use full audio", `/out/trimmed.mp3` for the trim-apply test). The "after picking a file, shows the ready panel — NOT an immediate transcribe" test: change its final assertion from `expect(transcribe).not.toHaveBeenCalled()` to `expect(storyApi.process).not.toHaveBeenCalled()` (and have `mockPipeline()` return the process spy). The script-entry test asserts the ready panel appears — unchanged.

- [ ] **Step 6: Run, confirm PASS + type-check**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Then `cd client && npx tsc -b 2>&1 | tail -20` → no errors (remove the now-unused `isTransientStatus`/`busy` references only if the compiler flags them; `isTransientStatus` is still imported by storyWizard internally, and the page may still use it elsewhere — only remove if flagged).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyWizard.ts client/src/lib/__tests__/storyWizard.test.ts client/src/lib/storyApi.ts client/src/lib/__tests__/storyApi.test.ts client/src/pages/StoryVideoPage.tsx client/src/pages/__tests__/StoryVideoPage.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): kick off server pipeline + staleness-based resume"
```

---

## Task 3: full sweep + rebuild bundle

- [ ] **Step 1:** `cd server && npm test` → green; `cd client && npm test` → green.
- [ ] **Step 2:** `cd client && npm run build`, then:
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(story-ui): rebuild bundle with server-orchestrated pipeline"
```

---

## Notes for the Implementer

- **The win:** because `runStoryPipeline` runs detached on the server, the browser tab is irrelevant once `/process` is called. Live-verify by starting a job, navigating to another page mid-processing, and coming back — it kept going.
- **Re-entrancy** makes Resume safe: re-calling `/process` skips transcription (transcript present) and segmentation (scenes present), and the images stage already skips done scenes.
- **Existing route tests stay green:** the security (403/400) + idempotency assertions still hold because the wrappers preserve status codes and the stages preserve behaviour.
- **`mediaPath` for resume:** after transcription the project stores `source.audioPath` (the audio actually used), so Resume re-processes the same audio.
