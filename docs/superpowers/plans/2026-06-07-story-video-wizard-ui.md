# Story Video Wizard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 3-step Story Video wizard page (`/app/story`) — upload a sermon → auto transcribe/segment/illustrate → review & edit scenes → durable render → download MP4 — consuming the finished `/api/story` backend.

**Architecture:** Keep logic in pure, unit-testable modules (a typed `storyApi` client over the existing `api` singleton, and pure `storyWizard` helpers for step/status derivation), with thin React components on top. The page is status-driven: it polls `GET /api/story/:id` via TanStack Query (single source of truth) and renders whichever of the 3 steps the project's `status` implies, so a reload resumes exactly where the user left off.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, react-router-dom v7, react-hot-toast, lucide-react, Tailwind, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-07-story-video-script-to-visuals-design.md` (§3 Wizard UI)
**Backend plan (done):** `docs/superpowers/plans/2026-06-07-story-video-backend.md`

---

## Conventions to follow (from the existing client)

- API calls go through the `api` singleton (`client/src/lib/api.ts`): `api.get/post/patch` return `{ ok, status, data, error }`. Never use axios directly.
- Audio upload: `api.post('/api/media/upload-audio', { dataUrl, filename }, undefined, { timeout: UPLOAD_TIMEOUT_MS, onUploadProgress })` → `response.data.file` is the server path (absolute, within the user's outputDir).
- Transcription POSTs need a long timeout: `TRANSCRIBE_TIMEOUT_MS` (exported from `api.ts`).
- Protected images render via `<AuthedImage src="/outputs/..." />` (`client/src/components/AuthedImage.tsx`) — it fetches with the bearer token.
- Pages are lazy-loaded **named** exports, registered in `client/src/App.tsx` under the `/app` `<Layout>` route; nav items live in `client/src/components/Layout.tsx` (`navItems` + the mobile array).
- Tests live in a sibling `__tests__/` dir, run with `npx vitest run <path>` (globals on, jsdom). Pure-logic tests preferred; component tests use `@testing-library/react`.
- Toasts: `import toast from 'react-hot-toast'` (used as `toast.success/error`).
- Tailwind dark theme; reuse `RenderProgressOverlay` for in-flight render UI.

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/src/routes/story.js` | Store `imageUrl` (publicUrl) on scenes so the browser can display them | Modify |
| `client/src/lib/storyTypes.ts` | Shared TypeScript types (Project, Scene, Word, Status, styles) | Create |
| `client/src/lib/storyWizard.ts` | Pure helpers: deriveStep, isTransientStatus, allScenesDone, canRender, sceneTimeLabel, progressLabel, imageCounts, STORY_STYLES | Create |
| `client/src/lib/__tests__/storyWizard.test.ts` | Unit tests for the pure helpers | Create |
| `client/src/lib/storyApi.ts` | Typed wrapper over `api` for every /api/story endpoint + upload | Create |
| `client/src/lib/__tests__/storyApi.test.ts` | Tests (mock the `api` singleton) | Create |
| `client/src/hooks/useStoryProject.ts` | TanStack Query hook: fetch project, poll while transient | Create |
| `client/src/components/story/StylePicker.tsx` | 4-style selector | Create |
| `client/src/components/story/__tests__/StylePicker.test.tsx` | Component test | Create |
| `client/src/components/story/SceneCard.tsx` | One scene: thumbnail, caption edit, prompt edit, regenerate | Create |
| `client/src/components/story/__tests__/SceneCard.test.tsx` | Component test | Create |
| `client/src/pages/StoryVideoPage.tsx` | The 3-step wizard, status-driven | Create |
| `client/src/pages/__tests__/StoryVideoPage.test.tsx` | Smoke/integration test (mock storyApi + hook) | Create |
| `client/src/App.tsx` | Register `/app/story` lazy route | Modify |
| `client/src/components/Layout.tsx` | Add Story nav item | Modify |

---

## Task 1: Backend — expose a browser image URL on scenes

**Files:**
- Modify: `server/src/routes/story.js`
- Test: `server/src/routes/story.test.js` (existing)

The `/images` and `/regenerate` handlers store `result.path` (absolute fs path, needed by FFmpeg) as `imagePath`. Add `imageUrl` from `result.publicUrl` so the client can show a thumbnail. `imagePath` stays for the render.

- [ ] **Step 1: Update the existing idempotency test to assert imageUrl is carried**

In `server/src/routes/story.test.js`, find the test `"images stage is idempotent — already-done scenes are skipped"`. Its mock is:
```javascript
    _setImageGenImpl(async () => { calls += 1; return { ok: true, path: "/new.png" }; });
```
Change it to also return a publicUrl, and assert it lands on the scene:
```javascript
    _setImageGenImpl(async () => { calls += 1; return { ok: true, path: "/new.png", publicUrl: "/outputs/genImg/p/part-2.png" }; });
```
Then after the existing assertions add:
```javascript
    assert.equal(after.scenes[1].imageUrl, "/outputs/genImg/p/part-2.png");
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `node --test server/src/routes/story.test.js`
Expected: the idempotency test fails — `after.scenes[1].imageUrl` is `undefined`.

- [ ] **Step 3: Store imageUrl in both image handlers**

In `server/src/routes/story.js`, in `router.post("/:id/images", ...)`, find:
```javascript
      scenes[i] = result?.ok
        ? { ...scenes[i], imagePath: result.path, imageStatus: "done" }
        : { ...scenes[i], imageStatus: "error" };
```
Replace with:
```javascript
      scenes[i] = result?.ok
        ? { ...scenes[i], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done" }
        : { ...scenes[i], imageStatus: "error" };
```
And in `router.post("/:id/scenes/:sid/regenerate", ...)`, find:
```javascript
    scenes[idx] = result?.ok
      ? { ...scenes[idx], imagePath: result.path, imageStatus: "done" }
      : { ...scenes[idx], imageStatus: "error" };
```
Replace with:
```javascript
    scenes[idx] = result?.ok
      ? { ...scenes[idx], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done" }
      : { ...scenes[idx], imageStatus: "error" };
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `node --test server/src/routes/story.test.js`
Expected: all pass (9). Then `cd server && npm test` → still all green.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/routes/story.js server/src/routes/story.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): expose scene imageUrl for the wizard UI"
```

---

## Task 2: Shared types + pure wizard helpers

**Files:**
- Create: `client/src/lib/storyTypes.ts`
- Create: `client/src/lib/storyWizard.ts`
- Test: `client/src/lib/__tests__/storyWizard.test.ts`

Pure functions only — no React, no network. These drive the whole page, so they get the most tests.

- [ ] **Step 1: Write the types**

`client/src/lib/storyTypes.ts`:
```typescript
export type StoryStatus =
  | 'draft' | 'transcribing' | 'segmenting' | 'generating_images'
  | 'ready_to_render' | 'rendering' | 'done' | 'error';

export type ImageStatus = 'pending' | 'generating' | 'done' | 'error';

export interface StoryWord { text: string; startMs: number; endMs: number }

export interface StoryScene {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  imagePrompt: string;
  imagePath: string | null;
  imageUrl?: string | null;
  imageStatus: ImageStatus;
  promptEditedByUser: boolean;
}

export interface StoryProject {
  projectId: string;
  title: string;
  style: string;
  status: StoryStatus;
  source: { audioPath: string | null; durationMs: number };
  transcript: { words: StoryWord[]; hash: string | null };
  scenes: StoryScene[];
  music: { path: string | null; volume: number };
  captionPreset: string;
  render: { jobId: string | null; outputPath: string | null; status: string | null };
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoryProjectSummary {
  projectId: string;
  title: string;
  status: StoryStatus;
  style: string;
  updatedAt: number;
}

export interface StoryStyleOption { id: string; label: string; blurb: string }
```

- [ ] **Step 2: Write the failing test**

`client/src/lib/__tests__/storyWizard.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  STORY_STYLES, deriveStep, isTransientStatus, allScenesDone,
  canRender, sceneTimeLabel, progressLabel, imageCounts,
} from '../storyWizard';
import type { StoryProject, StoryScene } from '../storyTypes';

function scene(over: Partial<StoryScene> = {}): StoryScene {
  return {
    id: 'scene-001', text: 'x', startMs: 0, endMs: 8000, imagePrompt: 'p',
    imagePath: null, imageStatus: 'pending', promptEditedByUser: false, ...over,
  };
}
function project(over: Partial<StoryProject> = {}): StoryProject {
  return {
    projectId: 'p', title: 'T', style: 'cinematic-bible', status: 'draft',
    source: { audioPath: null, durationMs: 0 }, transcript: { words: [], hash: null },
    scenes: [], music: { path: null, volume: 0.3 }, captionPreset: 'default',
    render: { jobId: null, outputPath: null, status: null }, error: null,
    createdAt: 0, updatedAt: 0, ...over,
  };
}

describe('STORY_STYLES', () => {
  it('lists the 4 v1 styles matching the backend ids', () => {
    expect(STORY_STYLES.map((s) => s.id).sort()).toEqual(
      ['ancient-scripture', 'cinematic-bible', 'heavenly-atmosphere', 'modern-devotional'],
    );
  });
});

describe('deriveStep', () => {
  it('step 1 for a fresh draft', () => {
    expect(deriveStep(project({ status: 'draft' }))).toBe(1);
  });
  it('step 1 while transcribing/segmenting (no scenes yet)', () => {
    expect(deriveStep(project({ status: 'transcribing' }))).toBe(1);
    expect(deriveStep(project({ status: 'segmenting' }))).toBe(1);
  });
  it('step 2 once scenes exist (review)', () => {
    expect(deriveStep(project({ status: 'generating_images', scenes: [scene()] }))).toBe(2);
    expect(deriveStep(project({ status: 'ready_to_render', scenes: [scene()] }))).toBe(2);
  });
  it('step 3 while rendering or done', () => {
    expect(deriveStep(project({ status: 'rendering', scenes: [scene()] }))).toBe(3);
    expect(deriveStep(project({ status: 'done', scenes: [scene()] }))).toBe(3);
  });
  it('error during transcribe (no scenes) stays on step 1; error during images stays on step 2', () => {
    expect(deriveStep(project({ status: 'error', scenes: [] }))).toBe(1);
    expect(deriveStep(project({ status: 'error', scenes: [scene()] }))).toBe(2);
  });
});

describe('isTransientStatus', () => {
  it('true for in-flight statuses, false otherwise', () => {
    expect(isTransientStatus('transcribing')).toBe(true);
    expect(isTransientStatus('segmenting')).toBe(true);
    expect(isTransientStatus('generating_images')).toBe(true);
    expect(isTransientStatus('rendering')).toBe(true);
    expect(isTransientStatus('draft')).toBe(false);
    expect(isTransientStatus('ready_to_render')).toBe(false);
    expect(isTransientStatus('done')).toBe(false);
    expect(isTransientStatus('error')).toBe(false);
  });
});

describe('allScenesDone / canRender', () => {
  it('false when empty, false with any non-done, true when all done', () => {
    expect(allScenesDone([])).toBe(false);
    expect(allScenesDone([scene({ imageStatus: 'done', imagePath: '/a.png' }), scene({ imageStatus: 'pending' })])).toBe(false);
    expect(allScenesDone([scene({ imageStatus: 'done', imagePath: '/a.png' })])).toBe(true);
  });
  it('canRender mirrors allScenesDone on the project scenes', () => {
    expect(canRender(project({ scenes: [scene({ imageStatus: 'done', imagePath: '/a.png' })] }))).toBe(true);
    expect(canRender(project({ scenes: [] }))).toBe(false);
  });
});

describe('sceneTimeLabel', () => {
  it('formats ms windows as m:ss–m:ss', () => {
    expect(sceneTimeLabel(scene({ startMs: 0, endMs: 8000 }))).toBe('0:00–0:08');
    expect(sceneTimeLabel(scene({ startMs: 65000, endMs: 72000 }))).toBe('1:05–1:12');
  });
});

describe('progressLabel', () => {
  it('maps transient statuses to human text', () => {
    expect(progressLabel('transcribing')).toMatch(/transcrib/i);
    expect(progressLabel('segmenting')).toMatch(/scene/i);
    expect(progressLabel('generating_images')).toMatch(/image/i);
    expect(progressLabel('rendering')).toMatch(/render/i);
  });
});

describe('imageCounts', () => {
  it('counts done vs total', () => {
    expect(imageCounts([scene({ imageStatus: 'done' }), scene({ imageStatus: 'pending' })])).toEqual({ done: 1, total: 2 });
  });
});
```

- [ ] **Step 3: Run it, confirm it FAILS**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts`
Expected: FAIL — cannot find module `../storyWizard`.

- [ ] **Step 4: Write the implementation**

`client/src/lib/storyWizard.ts`:
```typescript
import type { StoryProject, StoryScene, StoryStatus, StoryStyleOption } from './storyTypes';

export const STORY_STYLES: StoryStyleOption[] = [
  { id: 'cinematic-bible', label: 'Cinematic Bible', blurb: 'Dramatic, film-still lighting' },
  { id: 'modern-devotional', label: 'Modern Devotional', blurb: 'Soft, clean, calm tones' },
  { id: 'heavenly-atmosphere', label: 'Heavenly Atmosphere', blurb: 'Glowing light, ethereal' },
  { id: 'ancient-scripture', label: 'Ancient Scripture', blurb: 'Weathered, historical desert' },
];

const TRANSIENT: StoryStatus[] = ['transcribing', 'segmenting', 'generating_images', 'rendering'];

export function isTransientStatus(status: StoryStatus): boolean {
  return TRANSIENT.includes(status);
}

/** Which wizard step (1 upload, 2 review, 3 render) the project is in. */
export function deriveStep(project: StoryProject): 1 | 2 | 3 {
  if (project.status === 'rendering' || project.status === 'done') return 3;
  if (project.scenes.length > 0) return 2;
  return 1;
}

export function allScenesDone(scenes: StoryScene[]): boolean {
  return scenes.length > 0 && scenes.every((s) => s.imageStatus === 'done');
}

export function canRender(project: StoryProject): boolean {
  return allScenesDone(project.scenes);
}

export function imageCounts(scenes: StoryScene[]): { done: number; total: number } {
  return { done: scenes.filter((s) => s.imageStatus === 'done').length, total: scenes.length };
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function sceneTimeLabel(scene: StoryScene): string {
  return `${fmt(scene.startMs)}–${fmt(scene.endMs)}`; // en-dash
}

export function progressLabel(status: StoryStatus): string {
  switch (status) {
    case 'transcribing': return 'Transcribing your audio…';
    case 'segmenting': return 'Breaking it into scenes…';
    case 'generating_images': return 'Generating images…';
    case 'rendering': return 'Rendering your video…';
    default: return 'Working…';
  }
}
```

- [ ] **Step 5: Run it, confirm it PASSES**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyTypes.ts client/src/lib/storyWizard.ts client/src/lib/__tests__/storyWizard.test.ts
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): shared types + pure wizard helpers"
```

---

## Task 3: Typed story API client

**Files:**
- Create: `client/src/lib/storyApi.ts`
- Test: `client/src/lib/__tests__/storyApi.test.ts`

A thin typed layer over the `api` singleton. Each method returns the parsed `StoryProject` (or throws an `Error` with the server message on `!ok`), so components don't repeat `{ok,data,error}` handling.

- [ ] **Step 1: Write the failing test**

`client/src/lib/__tests__/storyApi.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';
import { storyApi } from '../storyApi';

const fakeProject = { projectId: 'p', title: 'T', status: 'draft', scenes: [] };

beforeEach(() => { vi.restoreAllMocks(); });

describe('storyApi', () => {
  it('createProject posts title+style and returns the project', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    const p = await storyApi.createProject('T', 'cinematic-bible');
    expect(spy).toHaveBeenCalledWith('/api/story', { title: 'T', style: 'cinematic-bible' });
    expect(p.projectId).toBe('p');
  });

  it('getProject GETs by id', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    await storyApi.getProject('p');
    expect(spy).toHaveBeenCalledWith('/api/story/p');
  });

  it('transcribe posts the mediaPath with the long timeout', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    await storyApi.transcribe('p', '/out/a.mp3');
    expect(spy).toHaveBeenCalledWith('/api/story/p/transcribe', { mediaPath: '/out/a.mp3' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('patchScene PATCHes the scene fields', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    await storyApi.patchScene('p', 'scene-001', { imagePrompt: 'new' });
    expect(spy).toHaveBeenCalledWith('/api/story/p/scenes/scene-001', { imagePrompt: 'new' });
  });

  it('throws the server error message on failure', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 400, error: 'no transcript to segment' });
    await expect(storyApi.segment('p')).rejects.toThrow('no transcript to segment');
  });

  it('uploadAudio returns the server file path', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, file: '/out/user-audio-1.mp3' } });
    const file = await storyApi.uploadAudio('data:audio/mp3;base64,AAA', 'sermon.mp3', () => {});
    expect(file).toBe('/out/user-audio-1.mp3');
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts`
Expected: FAIL — cannot find module `../storyApi`.

- [ ] **Step 3: Write the implementation**

`client/src/lib/storyApi.ts`:
```typescript
import { api, TRANSCRIBE_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './api';
import type { StoryProject, StoryProjectSummary, StoryScene } from './storyTypes';

function unwrapProject(res: { ok: boolean; data?: any; error?: string }): StoryProject {
  if (!res.ok || !res.data?.project) throw new Error(res.error || res.data?.error || 'Request failed');
  return res.data.project as StoryProject;
}

export const storyApi = {
  async createProject(title: string, style: string): Promise<StoryProject> {
    return unwrapProject(await api.post('/api/story', { title, style }));
  },

  async listProjects(): Promise<StoryProjectSummary[]> {
    const res = await api.get('/api/story');
    if (!res.ok) throw new Error(res.error || 'Failed to list projects');
    return (res.data?.projects ?? []) as StoryProjectSummary[];
  },

  async getProject(id: string): Promise<StoryProject> {
    return unwrapProject(await api.get(`/api/story/${id}`));
  },

  async transcribe(id: string, mediaPath: string): Promise<StoryProject> {
    return unwrapProject(
      await api.post(`/api/story/${id}/transcribe`, { mediaPath }, undefined, { timeout: TRANSCRIBE_TIMEOUT_MS }),
    );
  },

  async segment(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/segment`, {}));
  },

  async generateImages(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/images`, {}, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }));
  },

  async regenerateScene(id: string, sceneId: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/scenes/${sceneId}/regenerate`, {}, undefined, { timeout: GENERATE_IMAGES_TIMEOUT_MS }));
  },

  async patchScene(id: string, sceneId: string, patch: Partial<Pick<StoryScene, 'text' | 'imagePrompt'>>): Promise<StoryProject> {
    return unwrapProject(await api.patch(`/api/story/${id}/scenes/${sceneId}`, patch));
  },

  async render(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/story/${id}/render`, {}));
  },

  async uploadAudio(dataUrl: string, filename: string, onProgress?: (pct: number) => void): Promise<string> {
    const res = await api.post('/api/media/upload-audio', { dataUrl, filename }, undefined, {
      timeout: UPLOAD_TIMEOUT_MS,
      onUploadProgress: onProgress,
    });
    if (!res.ok || !res.data?.file) throw new Error(res.error || 'Audio upload failed');
    return res.data.file as string;
  },
};

// Generating ~30 images can run for minutes; reuse a generous ceiling.
const GENERATE_IMAGES_TIMEOUT_MS = 15 * 60_000;
```

NOTE: `GENERATE_IMAGES_TIMEOUT_MS` is declared with `const` after use — that fails (temporal dead zone for `const` in module scope when referenced at call time is fine, but referencing it in object-literal method bodies is fine because they run later; however declaration order can confuse linters). To be safe, MOVE the `const GENERATE_IMAGES_TIMEOUT_MS = 15 * 60_000;` line to the TOP of the file (just under the imports) so it's defined before the `storyApi` object. Verify the file lints clean.

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyApi.ts client/src/lib/__tests__/storyApi.test.ts
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): typed story API client"
```

---

## Task 4: useStoryProject hook (fetch + poll while transient)

**Files:**
- Create: `client/src/hooks/useStoryProject.ts`
- Test: `client/src/hooks/__tests__/useStoryProject.test.tsx`

TanStack Query hook that fetches a project and auto-polls every 2.5s while its status is transient (transcribing/segmenting/generating_images/rendering), so the UI reflects backend progress without manual refresh.

- [ ] **Step 1: Write the failing test**

`client/src/hooks/__tests__/useStoryProject.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../lib/storyApi';
import { useStoryProject } from '../useStoryProject';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => vi.restoreAllMocks());

describe('useStoryProject', () => {
  it('returns the fetched project', async () => {
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({ projectId: 'p', status: 'ready_to_render', scenes: [] } as any);
    const { result } = renderHook(() => useStoryProject('p'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.projectId).toBe('p'));
  });

  it('is disabled when id is null', async () => {
    const spy = vi.spyOn(storyApi, 'getProject').mockResolvedValue({} as any);
    renderHook(() => useStoryProject(null), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `cd client && npx vitest run src/hooks/__tests__/useStoryProject.test.tsx`
Expected: FAIL — cannot find module `../useStoryProject`.

- [ ] **Step 3: Write the implementation**

`client/src/hooks/useStoryProject.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import { isTransientStatus } from '../lib/storyWizard';
import type { StoryProject } from '../lib/storyTypes';

const POLL_MS = 2500;

/** Fetch a story project; auto-poll while its status is transient. */
export function useStoryProject(projectId: string | null) {
  return useQuery<StoryProject>({
    queryKey: ['story-project', projectId],
    queryFn: () => storyApi.getProject(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTransientStatus(status) ? POLL_MS : false;
    },
  });
}
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `cd client && npx vitest run src/hooks/__tests__/useStoryProject.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/hooks/useStoryProject.ts client/src/hooks/__tests__/useStoryProject.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): useStoryProject polling hook"
```

---

## Task 5: StylePicker component

**Files:**
- Create: `client/src/components/story/StylePicker.tsx`
- Test: `client/src/components/story/__tests__/StylePicker.test.tsx`

A radio-group of the 4 styles; calls `onChange(styleId)` when one is clicked; highlights the selected one.

- [ ] **Step 1: Write the failing test**

`client/src/components/story/__tests__/StylePicker.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StylePicker } from '../StylePicker';

describe('StylePicker', () => {
  it('renders all 4 styles and marks the selected one pressed', () => {
    render(<StylePicker value="cinematic-bible" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Cinematic Bible/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Modern Devotional/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('calls onChange with the style id when a style is clicked', async () => {
    const onChange = vi.fn();
    render(<StylePicker value="cinematic-bible" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Heavenly Atmosphere/i }));
    expect(onChange).toHaveBeenCalledWith('heavenly-atmosphere');
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `cd client && npx vitest run src/components/story/__tests__/StylePicker.test.tsx`
Expected: FAIL — cannot find module `../StylePicker`.

- [ ] **Step 3: Write the implementation**

`client/src/components/story/StylePicker.tsx`:
```tsx
import { STORY_STYLES } from '../../lib/storyWizard';

interface StylePickerProps {
  value: string;
  onChange: (styleId: string) => void;
}

export function StylePicker({ value, onChange }: StylePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-label="Visual style">
      {STORY_STYLES.map((style) => {
        const selected = style.id === value;
        return (
          <button
            key={style.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(style.id)}
            className={`text-left rounded-xl border p-3 transition-colors ${
              selected
                ? 'border-primary-400 bg-primary-500/10'
                : 'border-white/10 bg-white/[0.03] hover:border-white/20'
            }`}
          >
            <div className="text-sm font-semibold text-white">{style.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{style.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `cd client && npx vitest run src/components/story/__tests__/StylePicker.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/components/story/StylePicker.tsx client/src/components/story/__tests__/StylePicker.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): StylePicker component"
```

---

## Task 6: SceneCard component

**Files:**
- Create: `client/src/components/story/SceneCard.tsx`
- Test: `client/src/components/story/__tests__/SceneCard.test.tsx`

One reviewable scene: thumbnail (via `AuthedImage` when `imageUrl` present; spinner while `generating`; retry on `error`), inline-editable caption (calls `onPatch(sceneId,{text})` on blur), a collapsible prompt editor (calls `onPatch(sceneId,{imagePrompt})`), a Regenerate button (`onRegenerate(sceneId)`), and a read-only time label.

- [ ] **Step 1: Write the failing test**

`client/src/components/story/__tests__/SceneCard.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SceneCard } from '../SceneCard';
import type { StoryScene } from '../../../lib/storyTypes';

function scene(over: Partial<StoryScene> = {}): StoryScene {
  return {
    id: 'scene-001', text: 'When life feels dark', startMs: 0, endMs: 8000,
    imagePrompt: 'a lonely figure', imagePath: '/a.png', imageUrl: '/outputs/genImg/p/part-1.png',
    imageStatus: 'done', promptEditedByUser: false, ...over,
  };
}

describe('SceneCard', () => {
  it('shows the caption text and time label', () => {
    render(<SceneCard scene={scene()} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    expect(screen.getByDisplayValue('When life feels dark')).toBeInTheDocument();
    expect(screen.getByText('0:00–0:08')).toBeInTheDocument();
  });

  it('patches the caption on blur when changed', async () => {
    const onPatch = vi.fn();
    render(<SceneCard scene={scene()} onPatch={onPatch} onRegenerate={vi.fn()} busy={false} />);
    const input = screen.getByDisplayValue('When life feels dark');
    await userEvent.clear(input);
    await userEvent.type(input, 'New caption');
    await userEvent.tab(); // blur
    expect(onPatch).toHaveBeenCalledWith('scene-001', { text: 'New caption' });
  });

  it('calls onRegenerate when Regenerate is clicked', async () => {
    const onRegenerate = vi.fn();
    render(<SceneCard scene={scene()} onPatch={vi.fn()} onRegenerate={onRegenerate} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledWith('scene-001');
  });

  it('shows a retry affordance when the image errored', () => {
    render(<SceneCard scene={scene({ imageStatus: 'error', imageUrl: null })} onPatch={vi.fn()} onRegenerate={vi.fn()} busy={false} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `cd client && npx vitest run src/components/story/__tests__/SceneCard.test.tsx`
Expected: FAIL — cannot find module `../SceneCard`.

- [ ] **Step 3: Write the implementation**

`client/src/components/story/SceneCard.tsx`:
```tsx
import { useState } from 'react';
import { Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { sceneTimeLabel } from '../../lib/storyWizard';
import type { StoryScene } from '../../lib/storyTypes';

interface SceneCardProps {
  scene: StoryScene;
  onPatch: (sceneId: string, patch: { text?: string; imagePrompt?: string }) => void;
  onRegenerate: (sceneId: string) => void;
  busy: boolean;
}

export function SceneCard({ scene, onPatch, onRegenerate, busy }: SceneCardProps) {
  const [text, setText] = useState(scene.text);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const [showPrompt, setShowPrompt] = useState(false);

  const commitText = () => {
    if (text !== scene.text) onPatch(scene.id, { text });
  };
  const commitPrompt = () => {
    if (prompt !== scene.imagePrompt) onPatch(scene.id, { imagePrompt: prompt });
  };

  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="w-24 shrink-0">
        <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-white/5">
          {scene.imageStatus === 'generating' ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-primary-400" size={20} />
            </div>
          ) : scene.imageStatus === 'error' || !scene.imageUrl ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center">
              <span className="text-[10px] text-red-400">image failed</span>
            </div>
          ) : (
            <AuthedImage src={scene.imageUrl} alt={scene.text} className="h-full w-full object-cover" openOnClick={false} />
          )}
        </div>
        <div className="mt-1 text-center text-[10px] tabular-nums text-gray-500">{sceneTimeLabel(scene)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          aria-label="Scene caption"
          className="w-full rounded-md border border-white/10 bg-transparent px-2 py-1 text-sm text-white focus:border-primary-400 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          className="mt-2 text-xs text-gray-400 hover:text-gray-200"
        >
          {showPrompt ? 'Hide prompt' : 'Edit image prompt'}
        </button>
        {showPrompt && (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={commitPrompt}
            aria-label="Image prompt"
            rows={3}
            className="mt-1 w-full rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs text-gray-300 focus:border-primary-400 focus:outline-none"
          />
        )}

        <div className="mt-2">
          <button
            type="button"
            onClick={() => onRegenerate(scene.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-gray-200 hover:border-primary-400 disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Regenerate
          </button>
          {scene.promptEditedByUser && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-primary-300">
              <Wand2 size={10} /> edited
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `cd client && npx vitest run src/components/story/__tests__/SceneCard.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/components/story/SceneCard.tsx client/src/components/story/__tests__/SceneCard.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): SceneCard review component"
```

---

## Task 7: StoryVideoPage (the 3-step wizard)

**Files:**
- Create: `client/src/pages/StoryVideoPage.tsx`
- Test: `client/src/pages/__tests__/StoryVideoPage.test.tsx`

Composes everything. Local state holds the active `projectId` (persisted to `localStorage` so a reload resumes). `useStoryProject(projectId)` is the source of truth; `deriveStep` picks the rendered step. Mutations go through `storyApi`, then `queryClient.invalidateQueries(['story-project', id])` to refetch.

- [ ] **Step 1: Write the failing test**

`client/src/pages/__tests__/StoryVideoPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StoryVideoPage } from '../StoryVideoPage';
import { storyApi } from '../../lib/storyApi';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(StoryVideoPage)),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('StoryVideoPage', () => {
  it('shows step 1 (upload/setup) when there is no active project', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /story video/i })).toBeInTheDocument();
    expect(screen.getByText(/upload/i)).toBeInTheDocument();
  });

  it('resumes an active project from localStorage and shows review when scenes exist', async () => {
    localStorage.setItem('BF_STORY_ACTIVE', 'p1');
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({
      projectId: 'p1', title: 'T', style: 'cinematic-bible', status: 'ready_to_render',
      source: { audioPath: 'a', durationMs: 8000 }, transcript: { words: [], hash: 'h' },
      scenes: [{ id: 'scene-001', text: 'a', startMs: 0, endMs: 8000, imagePrompt: 'p', imagePath: '/a.png', imageUrl: '/outputs/x.png', imageStatus: 'done', promptEditedByUser: false }],
      music: { path: null, volume: 0.3 }, captionPreset: 'default',
      render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
    } as any);
    renderPage();
    expect(await screen.findByDisplayValue('a')).toBeInTheDocument(); // scene caption shown => step 2
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: FAIL — cannot find module `../StoryVideoPage`.

- [ ] **Step 3: Write the implementation**

`client/src/pages/StoryVideoPage.tsx`:
```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Upload, Loader2, Film, Download } from 'lucide-react';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useStoryProject } from '../hooks/useStoryProject';
import {
  deriveStep, progressLabel, canRender, imageCounts, isTransientStatus,
} from '../lib/storyWizard';
import { StylePicker } from '../components/story/StylePicker';
import { SceneCard } from '../components/story/SceneCard';
import { RenderProgressOverlay } from '../components/RenderProgressOverlay';

const ACTIVE_KEY = 'BF_STORY_ACTIVE';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function StoryVideoPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('cinematic-bible');
  const [busy, setBusy] = useState(false);

  const { data: project } = useStoryProject(projectId);
  const refresh = () => projectId && qc.invalidateQueries({ queryKey: ['story-project', projectId] });

  const setActive = (id: string | null) => {
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  };

  // --- Step 1: create + upload + kick off the pipeline ---
  const handleCreateAndUpload = async (file: File) => {
    setBusy(true);
    try {
      const created = await storyApi.createProject(title || file.name.replace(/\.[^.]+$/, ''), style);
      setActive(created.projectId);
      const dataUrl = await readFileAsDataUrl(file);
      const mediaPath = await storyApi.uploadAudio(dataUrl, file.name);
      await storyApi.transcribe(created.projectId, mediaPath);
      await storyApi.segment(created.projectId);
      await storyApi.generateImages(created.projectId);
      refresh();
      toast.success('Scenes ready — review below');
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const onPatch = async (sceneId: string, patch: { text?: string; imagePrompt?: string }) => {
    if (!projectId) return;
    try { await storyApi.patchScene(projectId, sceneId, patch); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const onRegenerate = async (sceneId: string) => {
    if (!projectId) return;
    setBusy(true);
    try { await storyApi.regenerateScene(projectId, sceneId); refresh(); toast.success('Image regenerated'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const onRender = async () => {
    if (!projectId) return;
    setBusy(true);
    try { await storyApi.render(projectId); refresh(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const step = project ? deriveStep(project) : 1;
  const transient = project ? isTransientStatus(project.status) : false;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Story Video</h1>
        {project && (
          <button onClick={() => setActive(null)} className="text-xs text-gray-400 hover:text-gray-200">
            Start new
          </button>
        )}
      </div>

      {/* Step 1 — Upload & setup */}
      {step === 1 && (
        <div className="mt-6 space-y-4">
          {project?.error && <ErrorBanner message={project.error} />}
          <label className="block text-sm text-gray-300">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Trusting God in the waiting"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none"
            />
          </label>

          <div>
            <div className="text-sm text-gray-300 mb-2">Visual style</div>
            <StylePicker value={style} onChange={setStyle} />
          </div>

          {transient ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 text-sm text-gray-300">
              <Loader2 className="animate-spin text-primary-400" size={18} />
              {progressLabel(project!.status)}
            </div>
          ) : (
            <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-8 text-sm text-gray-300 hover:border-primary-400 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              {busy ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
              {busy ? 'Working…' : 'Upload a sermon (MP3/M4A/MP4)'}
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCreateAndUpload(f); }}
              />
            </label>
          )}
        </div>
      )}

      {/* Step 2 — Review scenes */}
      {step === 2 && project && (
        <div className="mt-6 space-y-3">
          {project.error && <ErrorBanner message={project.error} />}
          <ImageProgress project={project} />
          {project.scenes.map((s) => (
            <SceneCard key={s.id} scene={s} onPatch={onPatch} onRegenerate={onRegenerate} busy={busy} />
          ))}
          <button
            onClick={onRender}
            disabled={!canRender(project) || busy}
            className="w-full rounded-xl bg-primary-500 px-4 py-3 text-sm font-semibold text-dark-900 hover:bg-primary-400 disabled:opacity-50"
          >
            {canRender(project) ? 'Looks good → Render' : 'Waiting for all images…'}
          </button>
        </div>
      )}

      {/* Step 3 — Render & download */}
      {step === 3 && project && (
        <div className="mt-6 space-y-4">
          {project.status === 'rendering' && <RenderProgressOverlay active mode="queued" />}
          {project.status === 'done' && project.render.outputPath && (
            <DonePanel projectId={project.projectId} />
          )}
          {project.status === 'error' && <ErrorBanner message={project.error || 'Render failed'} />}
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </div>
  );
}

function ImageProgress({ project }: { project: import('../lib/storyTypes').StoryProject }) {
  const { done, total } = imageCounts(project.scenes);
  if (done >= total) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <Loader2 className="animate-spin text-primary-400" size={14} />
      Generating images… {done}/{total}
    </div>
  );
}

function DonePanel({ projectId }: { projectId: string }) {
  // The render output is deterministic: outputs/story/<projectId>/video.mp4.
  // projectId is a uuid (untouched by the server's path sanitiser), so we can
  // build the public URL without a separate backend round-trip. Token is
  // appended because <video> can't send an Authorization header and the
  // server's requireAuth accepts ?token= (see api.ts). Harmless if /outputs
  // is public.
  const token = api.getToken();
  const base = `${api.mediaBaseUrl}/outputs/story/${projectId}/video.mp4`;
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  return (
    <div className="space-y-3">
      <video src={url} controls className="w-full rounded-xl border border-white/10" />
      <button
        onClick={() => api.downloadMedia(base, 'story-video.mp4')}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-dark-900 hover:bg-primary-400"
      >
        <Download size={16} /> Download MP4
      </button>
    </div>
  );
}
```

NOTE: the `Film` import is unused in this version — remove it from the lucide import line to keep the lint clean (`import { Upload, Loader2, Download } from 'lucide-react';`). Verify no other unused imports before committing.

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/pages/StoryVideoPage.tsx client/src/pages/__tests__/StoryVideoPage.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): StoryVideoPage 3-step wizard"
```

---

## Task 8: Wire the route + nav, then build + full sweep

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: Register the lazy route in App.tsx**

In `client/src/App.tsx`, next to the other `const XPage = lazy(...)` lines (around line 21), add:
```tsx
const StoryVideoPage = lazy(() => import('./pages/StoryVideoPage').then((m) => ({ default: m.StoryVideoPage })));
```
Then inside `<Route path="/app" element={<Layout />}>`, next to the other child routes (around line 65), add:
```tsx
                  <Route path="story" element={<StoryVideoPage />} />
```

- [ ] **Step 2: Add the nav item in Layout.tsx**

In `client/src/components/Layout.tsx`, find the `navItems` array (around line 16). Add an entry (use an existing lucide icon already imported in the file — `Film` is imported; reuse it, or import `Clapperboard` if available). To avoid an import error, REUSE an already-imported icon. Add after the Timeline entry:
```tsx
    { path: '/app/story', label: 'Story Video', icon: Film },
```
(If `Film` is already used for Timeline and you prefer a distinct icon, add `Clapperboard` to the existing `lucide-react` import at the top of the file and use it instead. Verify the icon name exists in lucide-react before using it — `Clapperboard` does.)

- [ ] **Step 3: Type-check and build**

Run: `cd client && npx tsc -b`
Expected: no type errors. Fix any (e.g. unused imports flagged by `noUnusedLocals`).

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run the full client test suite**

Run: `cd client && npm test`
Expected: all suites pass (existing + the new story-ui ones).

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/App.tsx client/src/components/Layout.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): mount /app/story route + nav"
```

---

## Task 9: Build the production bundle for deploy

**Files:**
- Modify: `server/public/**` (the committed prebuilt bundle)

Per repo convention (`biblefuel-deploy-prebuilt-bundle`): the deployed app serves the committed `server/public` bundle. Client source changes are invisible in production until the bundle is rebuilt and committed.

- [ ] **Step 1: Confirm how the bundle is produced**

Read `client/vite.config.ts` and the root/`server` `package.json` to find the build output path. The build likely outputs to `server/public` (or a `build`/`dist` that gets copied). Run the project's canonical build command (e.g. from repo root `npm run build`, or `cd client && npm run build` if it emits straight into `server/public`). Confirm `server/public` now contains updated hashed assets.

- [ ] **Step 2: Commit the rebuilt bundle**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(story-ui): rebuild prebuilt bundle with Story Video wizard"
```

> If the build does NOT emit into `server/public` (e.g. it stays in `client/dist`), STOP and confirm the deploy's actual static-serve path before committing — do not guess. The memory note `biblefuel-deploy-prebuilt-bundle` is the source of truth.

---

## Notes for the Implementer

- **Manual smoke test after Task 8** (needs the dev server + a real short audio clip): `cd server && npm run dev` and `cd client && npm run dev`, open `/app/story`, upload a 30–60s clip, watch it transcribe → segment → generate images → review → render → download. This is the real proof the wizard works end-to-end; the unit tests mock the network.
- **Rendered-video URL (verify in smoke test):** DonePanel builds the URL deterministically as `<mediaBase>/outputs/story/<projectId>/video.mp4?token=…` rather than using `api.mediaUrl()` (which keeps only the basename and would drop the `story/<id>/` subpath). Two things to confirm during the Task-8 manual smoke test, since no unit test exercises real playback: (1) `/outputs` actually serves the per-user nested story path for the authed user (the genImg images prove `/outputs/<nested>` works, so this should too); (2) whether `/outputs` requires the `?token=` (kept for safety) or is public. If playback 404s or 401s, the fallback is to have the backend store a `render.outputUrl` public field on render completion and consume that instead — but try the deterministic path first.
- **Caption preset + music controls** (spec §3 global controls) are intentionally deferred from this plan to keep it focused; they're additive follow-ups (a `<select>` for `captionPreset` and a music upload that PATCHes `music.path`). Ship the core wizard first.
- **Merge-scene action** (spec §3) is also deferred — it needs a backend endpoint that doesn't exist yet. Out of scope for v1 UI.
```
