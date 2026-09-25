# Story Video Project History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Recent projects" list (open + delete) to the Story Video wizard's Step 1, and fix the Step-1 upload button so it reliably opens the file chooser.

**Architecture:** A new `DELETE /api/story/:id` endpoint + `projectStore.deleteProject` (JSON only; route cleans assets). Frontend: pure helpers (`relativeTime`, `statusMeta`), a `useStoryProjects` list hook, a `ProjectHistory` component rendered above the new-project form on Step 1, and an upload trigger refactor (ref + button instead of label-wrap).

**Tech Stack:** Node/Express + `node:test` (server); React 19 + TanStack Query v5 + Vitest/testing-library (client). Same conventions as the Story Video wizard.

**Spec:** `docs/superpowers/specs/2026-06-07-story-video-project-history-design.md`

---

## Conventions

- Server tests: `node --test <file>` (colocated `*.test.js`). Client tests: `cd client && npx vitest run <file>`.
- API via the `api` singleton; story calls via `storyApi` (`client/src/lib/storyApi.ts`).
- Routes mounted with `requireAuth, withUserScope` in `server/index.js`; per-user paths from `req.ctx.dataDir` / `req.ctx.outputDir`.
- After client changes, the deploy bundle (`server/public`) must be rebuilt (final task).

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `server/src/lib/story/projectStore.js` | add `deleteProject(baseDir, id)` | Modify |
| `server/src/lib/story/projectStore.test.js` | test deleteProject | Modify |
| `server/src/routes/story.js` | add `DELETE /:id` (JSON + asset cleanup) | Modify |
| `server/src/routes/story.test.js` | test the delete route | Modify |
| `client/src/lib/storyWizard.ts` | add `relativeTime`, `statusMeta` | Modify |
| `client/src/lib/__tests__/storyWizard.test.ts` | test the two helpers | Modify |
| `client/src/lib/storyApi.ts` | add `deleteProject(id)` | Modify |
| `client/src/lib/__tests__/storyApi.test.ts` | test deleteProject | Modify |
| `client/src/hooks/useStoryProjects.ts` | list hook | Create |
| `client/src/components/story/ProjectHistory.tsx` | the list UI | Create |
| `client/src/components/story/__tests__/ProjectHistory.test.tsx` | component test | Create |
| `client/src/pages/StoryVideoPage.tsx` | upload-button fix + mount ProjectHistory | Modify |
| `client/src/pages/__tests__/StoryVideoPage.test.tsx` | upload-button + history-visible tests | Modify |
| `server/public/**` | rebuilt bundle | Modify |

---

## Task 1: Backend — `deleteProject` store function

**Files:**
- Modify: `server/src/lib/story/projectStore.js`
- Test: `server/src/lib/story/projectStore.test.js`

- [ ] **Step 1: Add the failing test** (append inside the existing `describe("projectStore", ...)` block)

```javascript
  test("deleteProject removes the JSON and returns true; false when absent", () => {
    const p = createProject(baseDir, { title: "X", style: "cinematic-bible" });
    assert.equal(readProject(baseDir, p.projectId) !== null, true);
    assert.equal(deleteProject(baseDir, p.projectId), true);
    assert.equal(readProject(baseDir, p.projectId), null);
    assert.equal(deleteProject(baseDir, p.projectId), false); // already gone
  });

  test("deleteProject returns false for an unknown id (no throw)", () => {
    assert.equal(deleteProject(baseDir, "does-not-exist"), false);
  });
```

Add `deleteProject` to the existing import line at the top of the test file:
```javascript
import {
  createProject, readProject, writeProject, listProjects, deleteProject, STORY_STATUS,
} from "./projectStore.js";
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `node --test server/src/lib/story/projectStore.test.js`
Expected: FAIL — `deleteProject` is not exported.

- [ ] **Step 3: Implement** — add to `server/src/lib/story/projectStore.js` (after `listProjects`)

```javascript
/**
 * Delete a project's JSON. Returns true if it existed, false otherwise.
 * Asset cleanup (generated images/video) is the route's responsibility, since
 * those live under the output dir, not baseDir.
 * @param {string} baseDir  caller's req.ctx.dataDir
 * @param {string} projectId
 */
export function deleteProject(baseDir, projectId) {
  let file;
  try {
    file = projectPath(baseDir, projectId);
  } catch {
    return false; // invalid id
  }
  try {
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    console.warn(`[story] deleteProject failed for ${projectId}: ${err?.message || err}`);
    return false;
  }
}
```

- [ ] **Step 4: Run it, confirm PASS**

Run: `node --test server/src/lib/story/projectStore.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/lib/story/projectStore.js server/src/lib/story/projectStore.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): projectStore.deleteProject"
```

---

## Task 2: Backend — `DELETE /api/story/:id` route

**Files:**
- Modify: `server/src/routes/story.js`
- Test: `server/src/routes/story.test.js`

- [ ] **Step 1: Add the failing test** (inside the existing `describe("story routes", ...)`)

```javascript
  test("DELETE /:id removes the project; 404 for unknown id", async () => {
    const create = mockReqRes({ body: { title: "T", style: "cinematic-bible" }, dataDir, outputDir });
    await handlerFor("post", "/")(create.req, create.res);
    const id = create.res.payload.project.projectId;

    const del = mockReqRes({ params: { id }, dataDir, outputDir });
    await handlerFor("delete", "/:id")(del.req, del.res);
    assert.equal(del.res.payload.ok, true);
    assert.equal(readProject(dataDir, id), null);

    const again = mockReqRes({ params: { id }, dataDir, outputDir });
    await handlerFor("delete", "/:id")(again.req, again.res);
    assert.equal(again.res.statusCode, 404);
    assert.equal(again.res.payload.ok, false);
  });
```

`readProject` is already imported in this test file (used elsewhere). If not, add it to the existing `projectStore.js` import.

- [ ] **Step 2: Run it, confirm FAIL**

Run: `node --test server/src/routes/story.test.js`
Expected: FAIL — `handlerFor("delete", "/:id")` throws "no handler" (route doesn't exist).

- [ ] **Step 3: Implement** — in `server/src/routes/story.js`

(a) Add `deleteProject` to the existing `projectStore.js` import:
```javascript
import {
  createProject, readProject, writeProject, listProjects, deleteProject, STORY_STATUS,
} from "../lib/story/projectStore.js";
```
(b) Add the route (place it after the `GET /:id` handler):
```javascript
// DELETE /:id — remove the project JSON + best-effort asset cleanup
router.delete("/:id", (req, res) => {
  try {
    const existed = deleteProject(req.ctx.dataDir, req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "project not found" });
    // Best-effort: remove generated assets. Never fail the request on cleanup error.
    const safeId = String(req.params.id).replace(/[^a-z0-9_-]/gi, "");
    for (const sub of ["story", "genImg"]) {
      try {
        fs.rmSync(path.join(req.ctx.outputDir, sub, safeId), { recursive: true, force: true });
      } catch (e) {
        console.warn(`[story] asset cleanup (${sub}/${safeId}) failed: ${e?.message || e}`);
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});
```
(`fs` and `path` are already imported at the top of `story.js`.)

- [ ] **Step 4: Run it, confirm PASS**

Run: `node --test server/src/routes/story.test.js`
Expected: all pass. Then `cd server && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/src/routes/story.js server/src/routes/story.test.js
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story): DELETE /api/story/:id endpoint"
```

---

## Task 3: Client — pure helpers `relativeTime` + `statusMeta`

**Files:**
- Modify: `client/src/lib/storyWizard.ts`
- Test: `client/src/lib/__tests__/storyWizard.test.ts`

- [ ] **Step 1: Add the failing tests** (append inside the existing top-level `describe` group in the test file)

```typescript
describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it('formats recent times', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now - 30_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
  it('falls back to a date for older than ~a week', () => {
    expect(relativeTime(now - 30 * 86_400_000, now)).toMatch(/\w{3} \d{1,2}/);
  });
});

describe('statusMeta', () => {
  it('maps every status to a label + tone', () => {
    expect(statusMeta('done')).toEqual({ label: 'Done', tone: 'done' });
    expect(statusMeta('error')).toEqual({ label: 'Error', tone: 'error' });
    expect(statusMeta('ready_to_render').tone).toBe('idle');
    expect(statusMeta('rendering').tone).toBe('busy');
    expect(statusMeta('generating_images').tone).toBe('busy');
    expect(statusMeta('draft').tone).toBe('idle');
  });
});
```

Add `relativeTime, statusMeta` to the existing import line at the top of the test file.

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement** — append to `client/src/lib/storyWizard.ts`

```typescript
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** Compact relative time. `nowMs` is injected so the function is deterministic. */
export function relativeTime(ms: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ms);
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type StatusTone = 'done' | 'error' | 'busy' | 'idle';

/** Pill label + tone for a project status. */
export function statusMeta(status: StoryStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'done': return { label: 'Done', tone: 'done' };
    case 'error': return { label: 'Error', tone: 'error' };
    case 'rendering': return { label: 'Rendering', tone: 'busy' };
    case 'generating_images': return { label: 'Generating', tone: 'busy' };
    case 'transcribing': return { label: 'Transcribing', tone: 'busy' };
    case 'segmenting': return { label: 'Segmenting', tone: 'busy' };
    case 'ready_to_render': return { label: 'Ready', tone: 'idle' };
    case 'draft':
    default: return { label: 'Draft', tone: 'idle' };
  }
}
```

- [ ] **Step 4: Run it, confirm PASS**

Run: `cd client && npx vitest run src/lib/__tests__/storyWizard.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyWizard.ts client/src/lib/__tests__/storyWizard.test.ts
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): relativeTime + statusMeta helpers"
```

---

## Task 4: Client — `storyApi.deleteProject`

**Files:**
- Modify: `client/src/lib/storyApi.ts`
- Test: `client/src/lib/__tests__/storyApi.test.ts`

- [ ] **Step 1: Add the failing test** (inside the existing `describe('storyApi', ...)`)

```typescript
  it('deleteProject DELETEs by id', async () => {
    const spy = vi.spyOn(api, 'delete').mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    await storyApi.deleteProject('p1');
    expect(spy).toHaveBeenCalledWith('/api/story/p1');
  });

  it('deleteProject throws the server error on failure', async () => {
    vi.spyOn(api, 'delete').mockResolvedValue({ ok: false, status: 404, error: 'project not found' });
    await expect(storyApi.deleteProject('nope')).rejects.toThrow('project not found');
  });
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts`
Expected: FAIL — `deleteProject` is not a function.

- [ ] **Step 3: Implement** — add to the `storyApi` object in `client/src/lib/storyApi.ts` (after `render`)

```typescript
  async deleteProject(id: string): Promise<void> {
    const res = await api.delete(`/api/story/${id}`);
    if (!res.ok) throw new Error(res.error || 'Failed to delete project');
  },
```

- [ ] **Step 4: Run it, confirm PASS**

Run: `cd client && npx vitest run src/lib/__tests__/storyApi.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/lib/storyApi.ts client/src/lib/__tests__/storyApi.test.ts
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): storyApi.deleteProject"
```

---

## Task 5: Client — `useStoryProjects` list hook

**Files:**
- Create: `client/src/hooks/useStoryProjects.ts`
- Test: `client/src/hooks/__tests__/useStoryProjects.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/hooks/__tests__/useStoryProjects.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../lib/storyApi';
import { useStoryProjects } from '../useStoryProjects';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => vi.restoreAllMocks());

describe('useStoryProjects', () => {
  it('returns the list of project summaries', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue([
      { projectId: 'a', title: 'A', status: 'done', style: 'cinematic-bible', updatedAt: 2 },
    ] as any);
    const { result } = renderHook(() => useStoryProjects(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].projectId).toBe('a');
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd client && npx vitest run src/hooks/__tests__/useStoryProjects.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// client/src/hooks/useStoryProjects.ts
import { useQuery } from '@tanstack/react-query';
import { storyApi } from '../lib/storyApi';
import type { StoryProjectSummary } from '../lib/storyTypes';

/** List the user's Story Video projects (newest first). */
export function useStoryProjects() {
  return useQuery<StoryProjectSummary[]>({
    queryKey: ['story-projects'],
    queryFn: () => storyApi.listProjects(),
  });
}
```

- [ ] **Step 4: Run it, confirm PASS**

Run: `cd client && npx vitest run src/hooks/__tests__/useStoryProjects.test.tsx`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/hooks/useStoryProjects.ts client/src/hooks/__tests__/useStoryProjects.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): useStoryProjects list hook"
```

---

## Task 6: Client — `ProjectHistory` component

**Files:**
- Create: `client/src/components/story/ProjectHistory.tsx`
- Test: `client/src/components/story/__tests__/ProjectHistory.test.tsx`

Renders the list from `useStoryProjects`; Open calls `onOpen(id)`; Delete shows an inline confirm, then calls `storyApi.deleteProject` and invalidates `['story-projects']`. Renders nothing when the list is empty.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/story/__tests__/ProjectHistory.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../../lib/storyApi';
import { ProjectHistory } from '../ProjectHistory';

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => vi.restoreAllMocks());

const LIST = [
  { projectId: 'a', title: 'Alpha', status: 'done', style: 'cinematic-bible', updatedAt: Date.now() - 5 * 60_000 },
  { projectId: 'b', title: 'Beta', status: 'error', style: 'cinematic-bible', updatedAt: Date.now() - 3 * 3_600_000 },
];

describe('ProjectHistory', () => {
  it('renders a row per project with title and status', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(LIST as any);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('renders nothing when the list is empty', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue([] as any);
    const { container } = renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await waitFor(() => expect(storyApi.listProjects).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="project-history"]')).toBeNull();
  });

  it('Open calls onOpen with the project id', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(LIST as any);
    const onOpen = vi.fn();
    renderWith(<ProjectHistory onOpen={onOpen} activeId={null} />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getAllByRole('button', { name: /open/i })[0]);
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('Delete confirms then calls storyApi.deleteProject', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue(LIST as any);
    const del = vi.spyOn(storyApi, 'deleteProject').mockResolvedValue(undefined);
    renderWith(<ProjectHistory onOpen={() => {}} activeId={null} />);
    await screen.findByText('Alpha');
    await userEvent.click(screen.getAllByRole('button', { name: /delete/i })[0]);
    // inline confirm appears
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(del).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd client && npx vitest run src/components/story/__tests__/ProjectHistory.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// client/src/components/story/ProjectHistory.tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useStoryProjects } from '../../hooks/useStoryProjects';
import { storyApi } from '../../lib/storyApi';
import { relativeTime, statusMeta, type StatusTone } from '../../lib/storyWizard';

interface ProjectHistoryProps {
  onOpen: (id: string) => void;
  activeId: string | null;
  /** Called after a delete so the parent can clear the active pointer if needed. */
  onDeleted?: (id: string) => void;
}

const TONE_CLASS: Record<StatusTone, string> = {
  done: 'bg-green-500/15 text-green-300 border-green-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  busy: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  idle: 'bg-white/10 text-gray-300 border-white/15',
};

export function ProjectHistory({ onOpen, activeId, onDeleted }: ProjectHistoryProps) {
  const qc = useQueryClient();
  const { data: projects } = useStoryProjects();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  if (!projects || projects.length === 0) return null;

  const doDelete = async (id: string) => {
    try {
      await storyApi.deleteProject(id);
      qc.invalidateQueries({ queryKey: ['story-projects'] });
      if (id === activeId) onDeleted?.(id);
      toast.success('Project deleted');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div data-testid="project-history" className="mb-6">
      <div className="text-sm text-gray-300 mb-2">Recent projects</div>
      <ul className="space-y-2">
        {projects.map((p) => {
          const meta = statusMeta(p.status);
          return (
            <li key={p.projectId} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{p.title || 'Untitled'}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  <span className={`rounded-full border px-1.5 py-0.5 ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>
                  <span className="text-gray-500">{relativeTime(p.updatedAt, now)}</span>
                </div>
              </div>
              {confirmId === p.projectId ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => doDelete(p.projectId)} className="rounded-md bg-red-500/80 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500">Confirm</button>
                  <button type="button" onClick={() => setConfirmId(null)} className="rounded-md border border-white/15 px-2 py-1 text-xs text-gray-300">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onOpen(p.projectId)} className="rounded-md border border-white/15 px-2 py-1 text-xs text-gray-200 hover:border-primary-400">Open</button>
                  <button type="button" onClick={() => setConfirmId(p.projectId)} className="rounded-md border border-white/15 px-2 py-1 text-xs text-gray-400 hover:border-red-400 hover:text-red-300">Delete</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run it, confirm PASS**

Run: `cd client && npx vitest run src/components/story/__tests__/ProjectHistory.test.tsx`
Expected: 4 tests pass. If the empty-list test's `data-testid` lookup is flaky, confirm the component returns `null` (not an empty wrapper) when `projects.length === 0`.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/components/story/ProjectHistory.tsx client/src/components/story/__tests__/ProjectHistory.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "feat(story-ui): ProjectHistory list component"
```

---

## Task 7: Client — wire history into Step 1 + fix the upload button

**Files:**
- Modify: `client/src/pages/StoryVideoPage.tsx`
- Test: `client/src/pages/__tests__/StoryVideoPage.test.tsx`

Two changes to the Step-1 block: (a) replace the label-wrapped file input with a ref-triggered `<button>` (the upload fix); (b) render `<ProjectHistory>` above the title/style form when there's no active project.

- [ ] **Step 1: Add the failing tests** (inside the existing `describe('StoryVideoPage', ...)`)

```tsx
  it('upload control is a real button wired to a hidden file input (regression: click opens chooser)', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /upload a sermon/i });
    expect(btn.tagName).toBe('BUTTON');
    // a hidden file input exists in the document
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('shows Recent projects above the new-project form when idle', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue([
      { projectId: 'h1', title: 'History One', status: 'done', style: 'cinematic-bible', updatedAt: Date.now() },
    ] as any);
    renderPage();
    expect(await screen.findByText('History One')).toBeInTheDocument();
    expect(screen.getByText(/recent projects/i)).toBeInTheDocument();
  });
```

Ensure `storyApi` is imported in this test file (it is, from the existing tests).

- [ ] **Step 2: Run it, confirm FAIL**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: FAIL — current upload control is a `<label>` (tagName LABEL, not BUTTON) and no "Recent projects".

- [ ] **Step 3: Implement** — edit `client/src/pages/StoryVideoPage.tsx`

(a) Add `useRef` to the React import and `ProjectHistory` import:
```tsx
import { useRef, useState } from 'react';
```
```tsx
import { ProjectHistory } from '../components/story/ProjectHistory';
```

(b) Inside the component, add a ref near the other hooks:
```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);
```

(c) Replace the entire Step-1 `<label>…upload…</label>` block. Find the current block (the one starting `<label className={`flex cursor-pointer items-center justify-center ...`):
```tsx
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
```
Replace with a button + sibling input (the bulletproof trigger):
```tsx
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
                  if (f) handleCreateAndUpload(f);
                  e.target.value = ''; // allow re-selecting the same file
                }}
              />
            </>
```

(d) Mount `ProjectHistory` at the TOP of the Step-1 block. Find the Step-1 wrapper `{step === 1 && (` and its inner `<div className="mt-6 space-y-4">`. Immediately inside that div, before the `{project?.error && ...}` line, add:
```tsx
          {!project && (
            <ProjectHistory
              onOpen={(id) => setActive(id)}
              activeId={projectId}
              onDeleted={() => setActive(null)}
            />
          )}
```

- [ ] **Step 4: Run it, confirm PASS**

Run: `cd client && npx vitest run src/pages/__tests__/StoryVideoPage.test.tsx`
Expected: all pass (existing + 2 new). If the "resume" or existing tests break because `listProjects` isn't mocked, add `vi.spyOn(storyApi, 'listProjects').mockResolvedValue([])` in those tests' setup or a `beforeEach` — an unmocked `listProjects` returns a rejected/real call; default it to `[]` so ProjectHistory renders nothing.

- [ ] **Step 5: Type-check + commit**

Run: `cd client && npx tsc -b 2>&1 | tail -20` → no errors (remove any now-unused imports).
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add client/src/pages/StoryVideoPage.tsx client/src/pages/__tests__/StoryVideoPage.test.tsx
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "fix(story-ui): reliable upload button + mount ProjectHistory on Step 1"
```

---

## Task 8: Full sweep + rebuild bundle

- [ ] **Step 1: Run both suites**

Run: `cd server && npm test` → all green. Run: `cd client && npm test` → all green.

- [ ] **Step 2: Build + commit the bundle**

Run: `cd client && npm run build` (emits into `server/public`).
```bash
git -C "C:/Users/segun/source/repos/biblefuel-studio" add server/public
git -C "C:/Users/segun/source/repos/biblefuel-studio" commit -m "build(story-ui): rebuild bundle with Project History + upload fix"
```

---

## Notes for the Implementer

- **`api.delete` exists** on the `api` singleton (`client/src/lib/api.ts`) and returns `{ ok, status, data, error }` — `storyApi.deleteProject` uses it.
- **Express `router.delete`** registers under `route.methods.delete`, so the test harness `handlerFor("delete", "/:id")` resolves it the same way as get/post.
- **Don't optimistically remove** the deleted row — invalidate `['story-projects']` and let the refetch drop it; simpler and correct on error.
- **Manual check after Task 7:** the upload button must actually open the OS file chooser on click (the whole point of the fix). The unit test only asserts it's a `<button>` + hidden input; real chooser behaviour is verified in the live smoke test.
