# Moments Client (Moments Phase 1, plan C of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Moments page: pick an occasion, add photos, choose sound, edit statements, choose a style, then **Make it**. The result offers Play, Download and Shuffle, plus a history of past renders. Add a Create-hub card and four looping style preview clips.

**Architecture:**
- **Structure:** one page with step tabs, mirroring `AmbientPage`.
- **Data:** react-query for the project (polled every 2.5 s while a render runs); a thin `momentsApi` over `/api/moments` (plan B).
- **Logic:** pure helpers in `momentsWizard.ts` hold the logic worth testing (hero bookkeeping, readiness, limits).
- **Steps:** each step is its own small component that saves through `momentsApi.update` and calls `refresh()`.

**Tech Stack:** React 18, TypeScript, @tanstack/react-query, Tailwind classes from `components/story/formStyles.ts`, lucide-react icons, react-hot-toast, Vitest with Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-moments-motion-engine-design.md`

## Global Constraints

- **Make it** is enabled once the Moment has an occasion and at least 3 photos. Everything else has a default.
- **One tap:** if the title and statements are still empty when Make it is pressed, the page first fetches AI suggestions, saves them, then renders.
- **Limits** come from `GET /api/moments/meta`, never hard-coded:
  - statements per length: 15 s → 3, 30 s → 5, 60 s → 8;
  - title ≤ 40 characters, statements ≤ 60 characters, photos 3–20.
- **Shuffle** renders again with a new random seed (an integer 0–2147483647) and nothing else changed.
- **History** shows the last 20 renders, newest first.
- **Media URLs:** videos and photos use `api.mediaUrl(...)`. Server paths are never shown to the user.
- **Builds:** verify with `cd client && npm run build` (`tsc -b`, which Coolify runs), not `tsc -p .`.
- **Commits:**
  - Run `git add` and `git commit` as separate commands. Never use `--no-verify`.
  - Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Writing code:** write code with regexes or backslashes using the Write/Edit tools, never shell heredocs.
- **Tests:** run them with `cd client && npx vitest run <path>`.

## Review Focus

1. **Removing the starred hero photo.** The hero falls back to the first photo, and the next save is not refused by the server. → Task 1 (`removePhoto`) tests.
2. **Moving photos.** The star follows the photo it was on, not its old slot. → Task 1 (`movePhoto`) test.
3. **Switching to a shorter length while holding more statements than it allows.** A visible warning says only the first N are used. → Task 5 test.
4. **Pressing Make it twice quickly.** Only one render request is sent. → Task 7 test.
5. **Returning to a Moment whose render was interrupted by a restart.** It shows "Make it again", not an endless spinner. → Task 7 test.

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/lib/momentsTypes.ts` | Types mirroring plan B's JSON. |
| `client/src/lib/momentsApi.ts` | `/api/moments` client. |
| `client/src/lib/momentsWizard.ts` | Pure helpers: readiness, photo/hero bookkeeping, limits, seed, verse line. |
| `client/src/components/moments/MomentsHistory.tsx` | Moments list (open, delete). |
| `client/src/components/moments/MomentsOccasionPicker.tsx` | Occasion grid that creates a Moment. |
| `client/src/components/moments/MomentsDetailsStep.tsx` | Occasion and detail fields. |
| `client/src/components/moments/MomentsPhotosStep.tsx` | Upload or pick photos, reorder, remove, star the hero. |
| `client/src/components/moments/MomentsSoundStep.tsx` | Song, window start, voiceover. |
| `client/src/components/moments/MomentsWordsStep.tsx` | Title and statements: edit, reorder, Suggest/Reshuffle, verse. |
| `client/src/components/moments/MomentsStyleStep.tsx` | Style cards with previews, Energy, length. |
| `client/src/components/moments/MomentsResult.tsx` | Progress, result (Play/Download/Shuffle), failure, render history. |
| `client/src/pages/MomentsPage.tsx` | The page: steps, the Make it flow, polling. |
| `client/src/App.tsx`, `client/src/pages/CreateHubPage.tsx` | Route and hub card. |
| `server/scripts/make-moment-previews.mjs` | Renders the four style preview loops with the real engine. |
| `client/public/moments/previews/{glow,celebrate,hype,gallery}.mp4` | The preview loops (committed). |

---

### Task 1: Types, API client and wizard helpers

**Files:**
- Create: `client/src/lib/momentsTypes.ts`
- Create: `client/src/lib/momentsApi.ts`
- Create: `client/src/lib/momentsWizard.ts`
- Test: `client/src/lib/__tests__/momentsWizard.test.ts`
- Test: `client/src/lib/__tests__/momentsApi.test.ts`

**Interfaces:**
- Consumes: `api` from `./api` (`get/post/put/delete` → `{ ok, status, data?, error? }`).
- Produces: the types below; `momentsApi`; and the helpers `canMake`, `statementLimit`, `statementOverflow`, `removePhoto`, `movePhoto`, `verseStatement`, `newSeed`, `isRunning`, `DETAIL_LABELS`.

- [ ] **Step 1: Write the types**

`client/src/lib/momentsTypes.ts`:

```ts
export type MomentStyle = 'glow' | 'celebrate' | 'hype' | 'gallery';
export type DetailField = 'name' | 'milestone' | 'eventTitle' | 'date' | 'venue' | 'verse';

export type PhotoRef = { kind: 'upload'; path: string } | { kind: 'library'; id: string };

export interface MomentPhoto {
  ref: PhotoRef;
  url: string;
  width: number;
  height: number;
}

export interface MomentRender {
  jobId: string | null;
  status: 'running' | 'done' | 'error' | 'interrupted';
  percent: number;
  stage: string;
  file?: string;
  error?: string;
  notes?: string[];
}

export interface MomentHistoryEntry {
  jobId: string;
  file: string;
  createdAt: number;
  seed: number;
  notes?: string[];
}

export interface MomentProject {
  projectId: string;
  createdAt: number;
  updatedAt: number;
  occasion: string;
  details: Partial<Record<DetailField, string>>;
  photos: MomentPhoto[];
  heroIndex: number;
  sound: {
    song: { ref: string; windowStartSec: number | null } | null;
    voiceover: { script: string; voiceId: string | null; file: string } | null;
  };
  title: string;
  statements: string[];
  style: MomentStyle;
  energy: number;
  lengthSec: number;
  seed: number;
  render: MomentRender | null;
  history: MomentHistoryEntry[];
}

export interface MomentSummary {
  projectId: string;
  occasion: string;
  title: string;
  updatedAt: number;
  thumb: string | null;
  lastFile: string | null;
}

export interface MomentOccasion {
  id: string;
  label: string;
  church: boolean;
  fields: DetailField[];
  style: MomentStyle;
  energy: number;
  song: string;
}

export interface MomentMeta {
  occasions: MomentOccasion[];
  styles: Array<{ id: MomentStyle; label: string; description: string }>;
  lengths: number[];
  limits: {
    statements: Record<string, number>;
    maxStatements: number;
    title: number;
    statement: number;
    detail: number;
    minPhotos: number;
    maxPhotos: number;
  };
}

export interface MomentSuggestion {
  title: string;
  statements: string[];
  verse?: { reference: string; text: string };
  source: 'ai' | 'template';
}

export interface SongWindow {
  durationSec: number;
  tempo: number | null;
  windowStartSec: number;
  autoStartSec: number;
}

export interface LibraryImage {
  id: string;
  url: string;
  aspect: string;
  source: 'upload' | 'generated';
  createdAt: number;
}

/** What PUT /api/moments/:id accepts. Photos go up as refs; the server resolves them. */
export interface MomentPatch {
  occasion?: string;
  details?: Partial<Record<DetailField, string>>;
  photos?: PhotoRef[];
  heroIndex?: number;
  title?: string;
  statements?: string[];
  style?: MomentStyle;
  energy?: number;
  lengthSec?: number;
  seed?: number;
  sound?: { song?: { ref: string; windowStartSec: number | null } | null; voiceover?: null };
}
```

- [ ] **Step 2: Write the failing tests**

`client/src/lib/__tests__/momentsWizard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  canMake, statementLimit, statementOverflow, removePhoto, movePhoto, verseStatement, newSeed, isRunning,
} from '../momentsWizard';
import type { MomentMeta, MomentPhoto, MomentProject } from '../momentsTypes';

const meta = {
  occasions: [], styles: [], lengths: [15, 30, 60],
  limits: { statements: { 15: 3, 30: 5, 60: 8 }, maxStatements: 8, title: 40, statement: 60, detail: 80, minPhotos: 3, maxPhotos: 20 },
} as MomentMeta;
const photo = (n: number): MomentPhoto => ({ ref: { kind: 'upload', path: `p${n}` }, url: `/outputs/p${n}.jpg`, width: 1, height: 1 });
const project = (over: Partial<MomentProject> = {}) => ({
  projectId: 'm1', occasion: 'birthday', photos: [photo(1), photo(2), photo(3)], heroIndex: 0, statements: [], title: '',
  lengthSec: 15, render: null, ...over,
}) as MomentProject;

describe('canMake', () => {
  it('needs the minimum photos', () => {
    expect(canMake(project(), meta).ok).toBe(true);
    const r = canMake(project({ photos: [photo(1), photo(2)] }), meta);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/3 photos/);
  });
  it('is off while rendering', () => {
    expect(canMake(project({ render: { jobId: 'j', status: 'running', percent: 10, stage: 'shots' } }), meta).ok).toBe(false);
  });
});

describe('statement limits', () => {
  it('follow the length', () => {
    expect(statementLimit(15, meta)).toBe(3);
    expect(statementLimit(60, meta)).toBe(8);
  });
  it('count the statements past the limit', () => {
    expect(statementOverflow(project({ statements: ['a', 'b', 'c', 'd', 'e'] }), meta)).toBe(2);
    expect(statementOverflow(project({ statements: ['a'] }), meta)).toBe(0);
  });
});

describe('photo bookkeeping', () => {
  it('removing the hero falls back to the first photo', () => {
    const r = removePhoto([photo(1), photo(2), photo(3)], 1, 1);
    expect(r.photos.map((p) => p.url)).toEqual(['/outputs/p1.jpg', '/outputs/p3.jpg']);
    expect(r.heroIndex).toBe(0);
  });
  it('removing a photo before the hero keeps the star on the same photo', () => {
    const r = removePhoto([photo(1), photo(2), photo(3)], 2, 0);
    expect(r.heroIndex).toBe(1);
    expect(r.photos[r.heroIndex].url).toBe('/outputs/p3.jpg');
  });
  it('moving photos keeps the star on its photo', () => {
    const r = movePhoto([photo(1), photo(2), photo(3)], 0, 0, 2);
    expect(r.photos.map((p) => p.url)).toEqual(['/outputs/p2.jpg', '/outputs/p3.jpg', '/outputs/p1.jpg']);
    expect(r.heroIndex).toBe(2);
  });
  it('a move out of range changes nothing', () => {
    const list = [photo(1), photo(2)];
    expect(movePhoto(list, 0, 0, -1)).toEqual({ photos: list, heroIndex: 0 });
  });
});

describe('verseStatement', () => {
  it('quotes a short verse with its reference', () => {
    expect(verseStatement({ reference: 'John 11:35', text: 'Jesus wept.' }, 60)).toBe('“Jesus wept.” John 11:35');
  });
  it('falls back to the reference when the verse is too long', () => {
    expect(verseStatement({ reference: 'John 3:16', text: 'x'.repeat(80) }, 60)).toBe('John 3:16');
  });
});

describe('seeds and status', () => {
  it('newSeed is an integer in range and changes', () => {
    const a = newSeed();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(2147483647);
    expect(new Set(Array.from({ length: 20 }, newSeed)).size).toBeGreaterThan(1);
  });
  it('isRunning only while a render runs', () => {
    expect(isRunning(project())).toBe(false);
    expect(isRunning(project({ render: { jobId: 'j', status: 'running', percent: 0, stage: '' } }))).toBe(true);
    expect(isRunning(project({ render: { jobId: 'j', status: 'interrupted', percent: 0, stage: '' } }))).toBe(false);
  });
});
```

`client/src/lib/__tests__/momentsApi.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { momentsApi } from '../momentsApi';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('momentsApi', () => {
  it('unwraps a project and throws the server error', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ ok: true, status: 200, data: { ok: true, project: { projectId: 'm1' } } });
    expect((await momentsApi.get('m1')).projectId).toBe('m1');
    vi.spyOn(api, 'put').mockResolvedValueOnce({ ok: false, status: 400, error: 'Photo 2: that photo was not found.' });
    await expect(momentsApi.update('m1', { title: 'x' })).rejects.toThrow('Photo 2');
  });
  it('sends the seed only when Shuffle gives one', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, jobId: 'j' } });
    await momentsApi.render('m1');
    await momentsApi.render('m1', 42);
    expect(post.mock.calls[0][1]).toEqual({});
    expect(post.mock.calls[1][1]).toEqual({ seed: 42 });
  });
  it('a 409 reads as already rendering', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 409, error: 'this Moment is already rendering' });
    await expect(momentsApi.render('m1')).rejects.toThrow(/already rendering/);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd client && npx vitest run src/lib/__tests__/momentsWizard.test.ts src/lib/__tests__/momentsApi.test.ts`
Expected: FAIL (the modules are missing).

- [ ] **Step 4: Implement `momentsApi.ts`**

`client/src/lib/momentsApi.ts`:

```ts
import { api } from './api';
import type {
  LibraryImage, MomentMeta, MomentPatch, MomentProject, MomentSuggestion, MomentSummary, SongWindow,
} from './momentsTypes';

// The AI writes statements and voiceovers in a few seconds, but the server
// allows it 15 s, plus speech synthesis for a voiceover.
const AI_TIMEOUT_MS = 60_000;

type Res = { ok: boolean; status?: number; data?: any; error?: string };

function unwrap<T>(res: Res, key: string): T {
  if (!res.ok || res.data?.[key] === undefined) throw new Error(res.error || res.data?.error || 'Request failed');
  return res.data[key] as T;
}

export const momentsApi = {
  async meta(): Promise<MomentMeta> {
    const res = await api.get('/api/moments/meta');
    if (!res.ok || !res.data) throw new Error(res.error || 'Could not load Moments');
    return res.data as MomentMeta;
  },
  async list(): Promise<MomentSummary[]> {
    return unwrap<MomentSummary[]>(await api.get('/api/moments'), 'projects');
  },
  async create(occasion: string): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.post('/api/moments', { occasion }), 'project');
  },
  async get(id: string): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.get(`/api/moments/${id}`), 'project');
  },
  async update(id: string, patch: MomentPatch): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.put(`/api/moments/${id}`, patch), 'project');
  },
  async remove(id: string): Promise<void> {
    const res = await api.delete(`/api/moments/${id}`);
    if (!res.ok) throw new Error(res.error || 'Could not delete this Moment');
  },
  async suggest(id: string): Promise<MomentSuggestion> {
    return unwrap<MomentSuggestion>(await api.post(`/api/moments/${id}/statements`, {}, undefined, { timeout: AI_TIMEOUT_MS }), 'suggestion');
  },
  async voiceover(id: string, body: { script?: string; idea?: string; voiceId?: string }): Promise<MomentProject> {
    return unwrap<MomentProject>(await api.post(`/api/moments/${id}/voiceover`, body, undefined, { timeout: AI_TIMEOUT_MS }), 'project');
  },
  async render(id: string, seed?: number): Promise<string> {
    return unwrap<string>(await api.post(`/api/moments/${id}/render`, seed === undefined ? {} : { seed }), 'jobId');
  },
  async cancel(id: string): Promise<void> {
    const res = await api.post(`/api/moments/${id}/cancel`, {});
    if (!res.ok) throw new Error(res.error || 'Could not cancel');
  },
  async libraryImages(): Promise<LibraryImage[]> {
    return unwrap<LibraryImage[]>(await api.get('/api/moments/library-images'), 'images');
  },
  async songWindow(id: string): Promise<SongWindow> {
    const res = await api.get(`/api/moments/${id}/song-window`);
    if (!res.ok || !res.data) throw new Error(res.error || 'Could not read the song');
    return res.data as SongWindow;
  },
};
```

Check `api.post`'s signature in `client/src/lib/api.ts`. `ambientApi` calls `api.post(url, body, undefined, { timeout })`, so the third argument is headers and the fourth is options. Match that.

- [ ] **Step 5: Implement `momentsWizard.ts`**

`client/src/lib/momentsWizard.ts`:

```ts
import type { DetailField, MomentMeta, MomentPhoto, MomentProject } from './momentsTypes';

const SEED_MAX = 2147483647;

export const DETAIL_LABELS: Record<DetailField, { label: string; placeholder: string }> = {
  name: { label: 'Name', placeholder: 'Tolu' },
  milestone: { label: 'Age or milestone', placeholder: '40th' },
  eventTitle: { label: 'Event title', placeholder: 'Fire Night' },
  date: { label: 'Date', placeholder: 'Sunday 19 October' },
  venue: { label: 'Venue', placeholder: 'Grace Chapel, Manchester' },
  verse: { label: 'Bible verse (optional)', placeholder: 'Psalm 118:24' },
};

export function isRunning(project: Pick<MomentProject, 'render'>): boolean {
  return project.render?.status === 'running';
}

export function canMake(project: MomentProject, meta: MomentMeta): { ok: boolean; reason?: string } {
  if (isRunning(project)) return { ok: false, reason: 'Already making this Moment.' };
  const min = meta.limits.minPhotos;
  if (project.photos.length < min) return { ok: false, reason: `Add at least ${min} photos.` };
  return { ok: true };
}

export function statementLimit(lengthSec: number, meta: MomentMeta): number {
  return meta.limits.statements[String(lengthSec)] ?? meta.limits.statements['15'];
}

export function statementOverflow(project: MomentProject, meta: MomentMeta): number {
  return Math.max(0, project.statements.length - statementLimit(project.lengthSec, meta));
}

/** Remove one photo. The star stays on its photo, or goes to the first when its photo is removed. */
export function removePhoto(photos: MomentPhoto[], heroIndex: number, index: number) {
  const next = photos.filter((_, i) => i !== index);
  let hero = heroIndex;
  if (index === heroIndex) hero = 0;
  else if (index < heroIndex) hero = heroIndex - 1;
  return { photos: next, heroIndex: next.length ? Math.min(hero, next.length - 1) : 0 };
}

/** Move one photo to a new slot. The star follows its photo. */
export function movePhoto(photos: MomentPhoto[], heroIndex: number, from: number, to: number) {
  if (from < 0 || from >= photos.length || to < 0 || to >= photos.length || from === to) return { photos, heroIndex };
  const next = [...photos];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { photos: next, heroIndex: next.indexOf(photos[heroIndex]) };
}

/** A verse as one statement: quoted with its reference when it fits, else the reference alone. */
export function verseStatement(verse: { reference: string; text: string }, max: number): string {
  const quoted = `“${verse.text}” ${verse.reference}`;
  return quoted.length <= max ? quoted : verse.reference.slice(0, max);
}

export function newSeed(): number {
  return Math.floor(Math.random() * SEED_MAX);
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd client && npx vitest run src/lib/__tests__/momentsWizard.test.ts src/lib/__tests__/momentsApi.test.ts`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/momentsTypes.ts client/src/lib/momentsApi.ts client/src/lib/momentsWizard.ts client/src/lib/__tests__/momentsWizard.test.ts client/src/lib/__tests__/momentsApi.test.ts
```

```bash
git commit -m "feat: Moments client types, API and wizard helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Page shell, history, occasion picker, route and hub card

**Files:**
- Create: `client/src/components/moments/MomentsHistory.tsx`
- Create: `client/src/components/moments/MomentsOccasionPicker.tsx`
- Create: `client/src/pages/MomentsPage.tsx` (shell: list + create + step tabs; the steps are placeholders filled by Tasks 3–7)
- Modify: `client/src/App.tsx` (lazy import + `<Route path="moments" element={<MomentsPage />} />` beside `ambient`)
- Modify: `client/src/pages/CreateHubPage.tsx` (a card)
- Test: `client/src/pages/__tests__/MomentsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `MomentsPage` with `type Step = 'details' | 'photos' | 'sound' | 'words' | 'style' | 'result'`.
  - Query keys: `['moment', id]`, `MOMENTS_LIST_KEY = ['moments']`, `MOMENTS_META_KEY = ['moments-meta']`.
  - A step component's props are `{ project: MomentProject; meta: MomentMeta; refresh: () => void; busy: boolean; setBusy: (b: boolean) => void }`. Export this as `MomentStepProps` from `MomentsPage.tsx`.

- [ ] **Step 1: Write the failing page test**

`client/src/pages/__tests__/MomentsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MomentsPage } from '../MomentsPage';
import { momentsApi } from '../../lib/momentsApi';
import type { MomentMeta, MomentProject } from '../../lib/momentsTypes';

export const META: MomentMeta = {
  occasions: [
    { id: 'birthday', label: 'Birthday', church: false, fields: ['name', 'milestone'], style: 'celebrate', energy: 0.8, song: 'library:gospel-fire' },
    { id: 'memorial', label: 'Memorial', church: true, fields: ['name', 'date', 'verse'], style: 'glow', energy: 0.15, song: 'library:prayer-piano' },
  ],
  styles: [
    { id: 'glow', label: 'Glow', description: 'Calm' }, { id: 'celebrate', label: 'Celebrate', description: 'Party' },
    { id: 'hype', label: 'Hype', description: 'Energy' }, { id: 'gallery', label: 'Gallery', description: 'Clean' },
  ],
  lengths: [15, 30, 60],
  limits: { statements: { 15: 3, 30: 5, 60: 8 }, maxStatements: 8, title: 40, statement: 60, detail: 80, minPhotos: 3, maxPhotos: 20 },
};

export function mkMoment(over: Partial<MomentProject> = {}): MomentProject {
  return {
    projectId: 'm1', createdAt: 0, updatedAt: 0, occasion: 'birthday', details: {}, photos: [], heroIndex: 0,
    sound: { song: { ref: 'library:gospel-fire', windowStartSec: null }, voiceover: null },
    title: '', statements: [], style: 'celebrate', energy: 0.8, lengthSec: 15, seed: 5, render: null, history: [], ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><MomentsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(momentsApi, 'meta').mockResolvedValue(META);
  vi.spyOn(momentsApi, 'list').mockResolvedValue([]);
});

describe('MomentsPage shell', () => {
  it('picking an occasion creates a Moment and opens the photos step', async () => {
    const create = vi.spyOn(momentsApi, 'create').mockResolvedValue(mkMoment());
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /birthday/i }));
    expect(create).toHaveBeenCalledWith('birthday');
    expect(await screen.findByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBe('m1');
  });

  it('lists earlier Moments and reopens one', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([
      { projectId: 'm9', occasion: 'memorial', title: 'In loving memory', updatedAt: 1, thumb: null, lastFile: '/outputs/moment-1.mp4' },
    ]);
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment({ projectId: 'm9', occasion: 'memorial' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /open in loving memory/i }));
    await waitFor(() => expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBe('m9'));
  });

  it('Start new returns to the list', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /start new/i }));
    expect(await screen.findByRole('button', { name: /birthday/i })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd client && npx vitest run src/pages/__tests__/MomentsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MomentsHistory.tsx`**

`client/src/components/moments/MomentsHistory.tsx`:

```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2, Film } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { api } from '../../lib/api';

export const MOMENTS_LIST_KEY = ['moments'];

export function MomentsHistory({ onOpen }: { onOpen: (id: string, finished: boolean) => void }) {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: MOMENTS_LIST_KEY, queryFn: () => momentsApi.list() });
  const remove = async (id: string) => {
    if (!window.confirm('Delete this Moment and its videos?')) return;
    try {
      await momentsApi.remove(id);
      qc.invalidateQueries({ queryKey: MOMENTS_LIST_KEY });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!list.length) return <p className="text-help">Your Moments will appear here.</p>;
  return (
    <div className="space-y-2">
      <div className="field-label">Your Moments</div>
      {list.map((m) => (
        <div key={m.projectId} className="glass flex items-center gap-3 rounded-bf p-2">
          <button
            type="button"
            onClick={() => onOpen(m.projectId, Boolean(m.lastFile))}
            aria-label={`Open ${m.title || m.occasion}`}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            {m.thumb
              ? <img src={api.mediaUrl(m.thumb)} alt="" className="h-14 w-10 rounded-lg object-cover" />
              : <div className="flex h-14 w-10 items-center justify-center rounded-lg bg-bf-card2"><Film size={16} /></div>}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-bf-cream">{m.title || 'Untitled Moment'}</div>
              <div className="text-help capitalize">{m.occasion}{m.lastFile ? ' · made' : ''}</div>
            </div>
          </button>
          <button type="button" onClick={() => remove(m.projectId)} aria-label={`Delete ${m.title || m.occasion}`} className="p-2 text-content-tertiary hover:text-red-300">
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `MomentsOccasionPicker.tsx`**

`client/src/components/moments/MomentsOccasionPicker.tsx`:

```tsx
import type { MomentMeta } from '../../lib/momentsTypes';

export function MomentsOccasionPicker({ meta, onPick, busy }: { meta: MomentMeta; onPick: (id: string) => void; busy: boolean }) {
  return (
    <div className="space-y-3">
      <div className="field-label">What's the occasion?</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {meta.occasions.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(o.id)}
            className="glass rounded-bf px-3 py-4 text-sm font-semibold text-bf-cream transition-colors hover:border-bf-goldDeep disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement the `MomentsPage.tsx` shell**

`client/src/pages/MomentsPage.tsx`. Tasks 3–7 replace each `<StepPlaceholder>` with the real step, and Task 7 adds the Make it flow:

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { momentsApi } from '../lib/momentsApi';
import { isRunning } from '../lib/momentsWizard';
import type { MomentMeta, MomentProject } from '../lib/momentsTypes';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { MomentsHistory, MOMENTS_LIST_KEY } from '../components/moments/MomentsHistory';
import { MomentsOccasionPicker } from '../components/moments/MomentsOccasionPicker';
import { segmentCls, segmentedCls } from '../components/story/formStyles';

const ACTIVE_KEY = 'BF_MOMENTS_ACTIVE';
const POLL_MS = 2500;
export const MOMENTS_META_KEY = ['moments-meta'];

export type Step = 'details' | 'photos' | 'sound' | 'words' | 'style' | 'result';
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'details', label: 'Occasion' },
  { id: 'photos', label: 'Photos' },
  { id: 'sound', label: 'Sound' },
  { id: 'words', label: 'Words' },
  { id: 'style', label: 'Style' },
  { id: 'result', label: 'Result' },
];

export interface MomentStepProps {
  project: MomentProject;
  meta: MomentMeta;
  refresh: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

function StepPlaceholder({ name }: { name: string }) {
  return <p className="text-help">{name}</p>;
}

export function MomentsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [step, setStep] = useState<Step>('photos');
  const [busy, setBusy] = useState(false);

  const { data: meta } = useQuery({ queryKey: MOMENTS_META_KEY, queryFn: () => momentsApi.meta(), staleTime: Infinity });
  const { data: project } = useQuery({
    queryKey: ['moment', projectId],
    queryFn: () => momentsApi.get(projectId as string),
    enabled: Boolean(projectId),
    refetchInterval: (query) => (query.state.data && isRunning(query.state.data) ? POLL_MS : false),
  });

  const refresh = () => { if (projectId) qc.invalidateQueries({ queryKey: ['moment', projectId] }); };

  const setActive = (id: string | null, startAt: Step = 'photos') => {
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    setStep(startAt);
    if (!id) qc.invalidateQueries({ queryKey: MOMENTS_LIST_KEY });
  };

  const create = async (occasion: string) => {
    setBusy(true);
    try {
      const created = await momentsApi.create(occasion);
      qc.setQueryData(['moment', created.projectId], created);
      setActive(created.projectId, 'photos');
    } catch (e) {
      toast.error((e as Error).message || 'Could not start a Moment');
    } finally {
      setBusy(false);
    }
  };

  if (!meta) return <Loader2 className="animate-spin text-primary-400" />;

  const tabs = project && (
    <div className="flex flex-wrap items-center gap-3">
      <div className={segmentedCls} role="tablist" aria-label="Moment step">
        {STEPS.map((s) => (
          <button key={s.id} type="button" aria-pressed={step === s.id} onClick={() => setStep(s.id)} className={segmentCls(step === s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setActive(null)} className="text-xs text-content-tertiary hover:text-bf-cream">Start new</button>
    </div>
  );

  const stepProps = project ? { project, meta, refresh, busy, setBusy } : null;
  return (
    <div className="w-full">
      <ScreenHeader
        className="flex-wrap lg:pr-14"
        eyebrow={project ? 'Create · Moments' : 'Create'}
        title={project ? (project.title || 'Your Moment') : <>Photos that <em>speak</em>.</>}
        subtitle={project ? undefined : 'Birthdays, sermons, events: your photos, cut to the beat, with words that land.'}
        right={tabs || undefined}
      />
      <div className="h-5" />
      {!project && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <MomentsOccasionPicker meta={meta} onPick={create} busy={busy} />
          <MomentsHistory onOpen={(id, finished) => setActive(id, finished ? 'result' : 'photos')} />
        </div>
      )}
      {stepProps && (
        <div className="space-y-4">
          {step === 'details' && <StepPlaceholder name="Occasion" />}
          {step === 'photos' && <StepPlaceholder name="Photos" />}
          {step === 'sound' && <StepPlaceholder name="Sound" />}
          {step === 'words' && <StepPlaceholder name="Words" />}
          {step === 'style' && <StepPlaceholder name="Style" />}
          {step === 'result' && <StepPlaceholder name="Result" />}
        </div>
      )}
    </div>
  );
}
```

`segmentCls` is the existing helper. If its buttons do not set `aria-pressed` themselves, the explicit `aria-pressed` above is what the test's `{ pressed: true }` reads.

- [ ] **Step 6: Add the route and the hub card**

In `client/src/App.tsx`, next to the `AmbientPage` lazy import:

```tsx
const MomentsPage = lazy(() => import('./pages/MomentsPage').then((m) => ({ default: m.MomentsPage })));
```

and next to `<Route path="ambient" ... />`:

```tsx
<Route path="moments" element={<MomentsPage />} />
```

In `client/src/pages/CreateHubPage.tsx`, add `PartyPopper` to the lucide import, and add this as the **first** entry of `tools`:

```tsx
{ to: '/app/moments', icon: PartyPopper, title: 'Moments', desc: 'Your photos cut to the beat: birthdays, sermons, events.' },
```

- [ ] **Step 7: Run the tests and the build, and confirm both pass**

Run: `cd client && npx vitest run src/pages/__tests__/MomentsPage.test.tsx`
Expected: PASS.

Run: `cd client && npm run build`
Expected: the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/moments/MomentsHistory.tsx client/src/components/moments/MomentsOccasionPicker.tsx client/src/pages/MomentsPage.tsx client/src/pages/__tests__/MomentsPage.test.tsx client/src/App.tsx client/src/pages/CreateHubPage.tsx
```

```bash
git commit -m "feat: Moments page shell, history, occasion picker and Create card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Details and Photos steps

**Files:**
- Create: `client/src/components/moments/MomentsDetailsStep.tsx`
- Create: `client/src/components/moments/MomentsPhotosStep.tsx`
- Modify: `client/src/pages/MomentsPage.tsx` (render both steps instead of their placeholders)
- Test: `client/src/components/moments/__tests__/MomentsPhotosStep.test.tsx`
- Test: `client/src/components/moments/__tests__/MomentsDetailsStep.test.tsx`

**Interfaces:**
- Consumes:
  - `MomentStepProps` (Task 2);
  - `removePhoto`, `movePhoto`, `DETAIL_LABELS` (Task 1);
  - `uploadMedia(file, name, 'background')` from `../../lib/mediaUpload`, which returns `{ file }`, the server path whose basename the server resolves.
- Produces: `MomentsDetailsStep` and `MomentsPhotosStep`, both taking `MomentStepProps`.

- [ ] **Step 1: Write the failing tests**

`client/src/components/moments/__tests__/MomentsPhotosStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsPhotosStep } from '../MomentsPhotosStep';
import { momentsApi } from '../../../lib/momentsApi';
import * as upload from '../../../lib/mediaUpload';
import { META, mkMoment } from '../../../pages/__tests__/MomentsPage.test';
import type { MomentPhoto } from '../../../lib/momentsTypes';

const photo = (n: number): MomentPhoto => ({ ref: { kind: 'upload', path: `bg-image-${n}.jpg` }, url: `/outputs/bg-image-${n}.jpg`, width: 1, height: 1 });
const props = (over = {}) => ({ project: mkMoment({ photos: [photo(1), photo(2), photo(3)], heroIndex: 0, ...over }), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn() });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([]);
});

describe('MomentsPhotosStep', () => {
  it('uploads each file in turn, then saves the photos as refs', async () => {
    const up = vi.spyOn(upload, 'uploadMedia')
      .mockResolvedValueOnce({ file: '/data/out/bg-image-a.jpg' })
      .mockResolvedValueOnce({ file: '/data/out/bg-image-b.jpg' });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props({ photos: [] });
    render(<MomentsPhotosStep {...p} />);
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })];
    await userEvent.upload(screen.getByLabelText(/add photos/i), files);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(up).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.at(-1)?.[1]).toEqual({
      photos: [{ kind: 'upload', path: '/data/out/bg-image-a.jpg' }, { kind: 'upload', path: '/data/out/bg-image-b.jpg' }],
      heroIndex: 0,
    });
    expect(p.refresh).toHaveBeenCalled();
  });

  it('starring a photo makes it the hero', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsPhotosStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /make photo 3 the hero/i }));
    expect(update.mock.calls[0][1]).toEqual({ heroIndex: 2 });
  });

  it('removing the hero sends the new list with the hero reset', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsPhotosStep {...props({ heroIndex: 1 })} />);
    await userEvent.click(screen.getByRole('button', { name: /remove photo 2/i }));
    expect(update.mock.calls[0][1]).toEqual({
      photos: [{ kind: 'upload', path: 'bg-image-1.jpg' }, { kind: 'upload', path: 'bg-image-3.jpg' }],
      heroIndex: 0,
    });
  });

  it('moving a photo later keeps the star on it', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsPhotosStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /move photo 1 later/i }));
    expect(update.mock.calls[0][1]).toEqual({
      photos: [{ kind: 'upload', path: 'bg-image-2.jpg' }, { kind: 'upload', path: 'bg-image-1.jpg' }, { kind: 'upload', path: 'bg-image-3.jpg' }],
      heroIndex: 1,
    });
  });

  it('says how many more photos are needed', () => {
    render(<MomentsPhotosStep {...props({ photos: [photo(1)] })} />);
    expect(screen.getByText(/add 2 more photos/i)).toBeInTheDocument();
  });

  it('a server refusal is shown and nothing is lost', async () => {
    vi.spyOn(momentsApi, 'update').mockRejectedValue(new Error('Photo 2: that photo was not found.'));
    render(<MomentsPhotosStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /make photo 2 the hero/i }));
    expect(await screen.findByText(/photo 2: that photo was not found/i)).toBeInTheDocument();
  });
});
```

`client/src/components/moments/__tests__/MomentsDetailsStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsDetailsStep } from '../MomentsDetailsStep';
import { momentsApi } from '../../../lib/momentsApi';
import { META, mkMoment } from '../../../pages/__tests__/MomentsPage.test';

beforeEach(() => vi.restoreAllMocks());

describe('MomentsDetailsStep', () => {
  it("shows the occasion's fields and saves a detail on blur", async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsDetailsStep project={mkMoment()} meta={META} refresh={vi.fn()} busy={false} setBusy={vi.fn()} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Age or milestone')).toBeInTheDocument();
    expect(screen.queryByLabelText('Venue')).toBeNull();
    await userEvent.type(screen.getByLabelText('Name'), 'Tolu');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('m1', { details: { name: 'Tolu' } });
  });

  it("changing the occasion saves it", async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsDetailsStep project={mkMoment()} meta={META} refresh={vi.fn()} busy={false} setBusy={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/occasion/i), 'memorial');
    expect(update).toHaveBeenCalledWith('m1', { occasion: 'memorial' });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd client && npx vitest run src/components/moments/__tests__/`
Expected: FAIL.

- [ ] **Step 3: Implement `MomentsDetailsStep.tsx`**

`client/src/components/moments/MomentsDetailsStep.tsx`:

```tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { momentsApi } from '../../lib/momentsApi';
import { DETAIL_LABELS } from '../../lib/momentsWizard';
import type { DetailField } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls } from '../story/formStyles';

export function MomentsDetailsStep({ project, meta, refresh, busy }: MomentStepProps) {
  const occasion = meta.occasions.find((o) => o.id === project.occasion) ?? meta.occasions[0];
  const [details, setDetails] = useState(project.details);
  useEffect(() => setDetails(project.details), [project.details]);

  const save = async (patch: Parameters<typeof momentsApi.update>[1]) => {
    try {
      await momentsApi.update(project.projectId, patch);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <label className={fieldLabelCls}>
        Occasion
        <select value={project.occasion} disabled={busy} onChange={(e) => save({ occasion: e.target.value })} className={inputCls}>
          {meta.occasions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      {occasion.fields.map((field: DetailField) => (
        <label key={field} className={fieldLabelCls}>
          {DETAIL_LABELS[field].label}
          <input
            value={details[field] ?? ''}
            maxLength={meta.limits.detail}
            placeholder={DETAIL_LABELS[field].placeholder}
            disabled={busy}
            onChange={(e) => setDetails({ ...details, [field]: e.target.value })}
            onBlur={() => { if ((details[field] ?? '') !== (project.details[field] ?? '')) save({ details }); }}
            className={inputCls}
          />
        </label>
      ))}
      <p className="text-help">These help the AI write your statements. Nothing here is required.</p>
    </div>
  );
}
```

The `<label>` wraps the control, so `getByLabelText('Name')` finds the input by the label's own text. If `fieldLabelCls` labels add other text, match by `{ exact: false }`.

- [ ] **Step 4: Implement `MomentsPhotosStep.tsx`**

`client/src/components/moments/MomentsPhotosStep.tsx`:

```tsx
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { Star, X, ChevronLeft, ChevronRight, ImagePlus, Loader2 } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { uploadMedia } from '../../lib/mediaUpload';
import { api } from '../../lib/api';
import { movePhoto, removePhoto } from '../../lib/momentsWizard';
import type { MomentPatch, MomentPhoto, PhotoRef } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { DropZone } from '../ui/DropZone';
import { dropZoneCls, secondaryBtnCls } from '../story/formStyles';

const refs = (photos: MomentPhoto[]): PhotoRef[] => photos.map((p) => p.ref);

export function MomentsPhotosStep({ project, meta, refresh, busy, setBusy }: MomentStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const { data: library = [] } = useQuery({ queryKey: ['moments-library'], queryFn: () => momentsApi.libraryImages(), enabled: showLibrary });
  const { photos, heroIndex } = project;
  const room = meta.limits.maxPhotos - photos.length;

  const save = async (patch: MomentPatch) => {
    setError('');
    setBusy(true);
    try {
      await momentsApi.update(project.projectId, patch);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addFiles = async (files: File[]) => {
    const list = files.slice(0, Math.max(0, room));
    if (files.length > list.length) toast(`Only ${meta.limits.maxPhotos} photos fit a Moment.`);
    if (!list.length) return;
    setUploading(true);
    const added: PhotoRef[] = [];
    const toastId = toast.loading(`Uploading 1 of ${list.length}…`);
    try {
      for (let i = 0; i < list.length; i += 1) {
        toast.loading(`Uploading ${i + 1} of ${list.length}…`, { id: toastId });
        try {
          const up = await uploadMedia(list[i], list[i].name, 'background');
          added.push({ kind: 'upload', path: up.file });
        } catch (e) {
          toast.error(`${list[i].name}: ${(e as Error).message}`);
        }
      }
    } finally {
      toast.dismiss(toastId);
      setUploading(false);
    }
    if (added.length) await save({ photos: [...refs(photos), ...added], heroIndex });
  };

  const pickLibrary = (id: string) => save({ photos: [...refs(photos), { kind: 'library', id }], heroIndex });
  const doRemove = (i: number) => { const r = removePhoto(photos, heroIndex, i); save({ photos: refs(r.photos), heroIndex: r.heroIndex }); };
  const doMove = (from: number, to: number) => { const r = movePhoto(photos, heroIndex, from, to); save({ photos: refs(r.photos), heroIndex: r.heroIndex }); };
  const need = meta.limits.minPhotos - photos.length;

  return (
    <div className="space-y-4">
      <DropZone onFiles={addFiles} accept={['image/*']} disabled={busy || uploading || room <= 0} overlayLabel="Drop photos">
        <button type="button" disabled={busy || uploading || room <= 0} onClick={() => input.current?.click()} className={dropZoneCls}>
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          Add photos ({photos.length}/{meta.limits.maxPhotos})
        </button>
      </DropZone>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        aria-label="Add photos"
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ''; }}
      />
      <button type="button" className={secondaryBtnCls} onClick={() => setShowLibrary((v) => !v)}>
        {showLibrary ? 'Hide my pictures' : 'Pick from my pictures'}
      </button>
      {showLibrary && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {library.map((img) => (
            <button key={img.id} type="button" disabled={busy || room <= 0} onClick={() => pickLibrary(img.id)} aria-label="Add this picture">
              <img src={api.mediaUrl(img.url)} alt="" className="aspect-[9/16] w-full rounded-lg object-cover" />
            </button>
          ))}
          {!library.length && <p className="text-help col-span-full">No pictures in your library yet.</p>}
        </div>
      )}
      {need > 0 && <p className="text-help">Add {need} more photo{need === 1 ? '' : 's'} to make your Moment.</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {photos.map((p, i) => (
          <div key={`${i}-${p.url}`} className={`relative overflow-hidden rounded-lg border ${i === heroIndex ? 'border-bf-gold' : 'border-transparent'}`}>
            <img src={api.mediaUrl(p.url)} alt={`Photo ${i + 1}`} className="aspect-[9/16] w-full object-cover" />
            <div className="absolute inset-x-0 top-0 flex justify-between p-1">
              <button type="button" disabled={busy} onClick={() => save({ heroIndex: i })} aria-label={`Make photo ${i + 1} the hero`} aria-pressed={i === heroIndex} className="rounded-full bg-black/50 p-1">
                <Star size={14} className={i === heroIndex ? 'fill-bf-gold text-bf-gold' : 'text-white'} />
              </button>
              <button type="button" disabled={busy} onClick={() => doRemove(i)} aria-label={`Remove photo ${i + 1}`} className="rounded-full bg-black/50 p-1">
                <X size={14} />
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex justify-between p-1">
              <button type="button" disabled={busy || i === 0} onClick={() => doMove(i, i - 1)} aria-label={`Move photo ${i + 1} earlier`} className="rounded-full bg-black/50 p-1">
                <ChevronLeft size={14} />
              </button>
              <button type="button" disabled={busy || i === photos.length - 1} onClick={() => doMove(i, i + 1)} aria-label={`Move photo ${i + 1} later`} className="rounded-full bg-black/50 p-1">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {photos.length > 0 && <p className="text-help">The starred photo opens and closes your Moment, with the title.</p>}
    </div>
  );
}
```

- [ ] **Step 5: Render both steps in `MomentsPage.tsx`**

Import `MomentsDetailsStep` and `MomentsPhotosStep`, and replace their placeholders:

```tsx
{step === 'details' && <MomentsDetailsStep {...stepProps} />}
{step === 'photos' && <MomentsPhotosStep {...stepProps} />}
```

- [ ] **Step 6: Run the tests and the build, and confirm both pass**

Run: `cd client && npx vitest run src/components/moments/__tests__/ src/pages/__tests__/MomentsPage.test.tsx`
Expected: PASS.

Run: `cd client && npm run build`
Expected: the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/moments/MomentsDetailsStep.tsx client/src/components/moments/MomentsPhotosStep.tsx client/src/components/moments/__tests__/MomentsPhotosStep.test.tsx client/src/components/moments/__tests__/MomentsDetailsStep.test.tsx client/src/pages/MomentsPage.tsx
```

```bash
git commit -m "feat: Moments occasion details and photos steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sound step

**Files:**
- Create: `client/src/components/moments/MomentsSoundStep.tsx`
- Modify: `client/src/pages/MomentsPage.tsx`
- Test: `client/src/components/moments/__tests__/MomentsSoundStep.test.tsx`

**Interfaces:**
- Consumes:
  - `MusicPicker` from `../MusicPicker`, with `value: { path, volume }` and `onChange(next)`, where `next.path` is a ref like `library:<id>`;
  - `STORY_VOICES` from `../../lib/storyScript`;
  - `momentsApi.songWindow`, `momentsApi.voiceover`, `momentsApi.update`.
- Produces: `MomentsSoundStep(props: MomentStepProps)`.

- [ ] **Step 1: Write the failing tests**

`client/src/components/moments/__tests__/MomentsSoundStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MomentsSoundStep } from '../MomentsSoundStep';
import { momentsApi } from '../../../lib/momentsApi';
import { api } from '../../../lib/api';
import { META, mkMoment } from '../../../pages/__tests__/MomentsPage.test';

vi.mock('../../MusicPicker', () => ({
  MusicPicker: ({ value, onChange }: { value: { path: string | null }; onChange: (v: { path: string | null; volume: number }) => void }) => (
    <button type="button" onClick={() => onChange({ path: 'library:hopeful', volume: 1 })}>picker:{value.path ?? 'none'}</button>
  ),
}));

function renderStep(project = mkMoment()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { project, meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn() };
  render(<QueryClientProvider client={qc}><MomentsSoundStep {...props} /></QueryClientProvider>);
  return props;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'get').mockResolvedValue({ ok: false, status: 404 } as never);
  vi.spyOn(momentsApi, 'songWindow').mockResolvedValue({ durationSec: 180, tempo: 100, windowStartSec: 42, autoStartSec: 42 });
});

describe('MomentsSoundStep', () => {
  it('choosing a song saves it with an automatic window', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.click(screen.getByRole('button', { name: /picker:library:gospel-fire/ }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { song: { ref: 'library:hopeful', windowStartSec: null } } });
  });

  it('shows the auto window and saves a nudged start', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    const slider = await screen.findByLabelText(/start at/i);
    expect(slider).toHaveAttribute('max', '165');
    fireEvent.change(slider, { target: { value: '30' } });
    fireEvent.mouseUp(slider);
    await waitFor(() => expect(update).toHaveBeenCalledWith('m1', { sound: { song: { ref: 'library:gospel-fire', windowStartSec: 30 } } }));
  });

  it('No music removes the song', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.click(screen.getByRole('button', { name: /no music/i }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { song: null } });
  });

  it('a typed voiceover is made with the chosen voice', async () => {
    const vo = vi.spyOn(momentsApi, 'voiceover').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.type(screen.getByLabelText(/voiceover script/i), 'Happy birthday Tolu, God bless you.');
    await userEvent.selectOptions(screen.getByLabelText(/voice/i, { selector: 'select' }), 'en-NG-EzinneNeural');
    await userEvent.click(screen.getByRole('button', { name: /make voiceover/i }));
    expect(vo).toHaveBeenCalledWith('m1', { script: 'Happy birthday Tolu, God bless you.', voiceId: 'en-NG-EzinneNeural' });
  });

  it('Write it for me sends the idea instead of a script', async () => {
    const vo = vi.spyOn(momentsApi, 'voiceover').mockResolvedValue(mkMoment());
    renderStep();
    await userEvent.type(screen.getByLabelText(/voiceover script/i), 'a blessing for my mum turning 60');
    await userEvent.click(screen.getByRole('button', { name: /write it for me/i }));
    expect(vo).toHaveBeenCalledWith('m1', { idea: 'a blessing for my mum turning 60', voiceId: expect.any(String) });
  });

  it('an existing voiceover can be played and removed', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(mkMoment({ sound: { song: null, voiceover: { script: 'Hi', voiceId: null, file: 'moment-vo-1.mp3' } } }));
    expect(document.querySelector('audio')?.getAttribute('src')).toContain('moment-vo-1.mp3');
    await userEvent.click(screen.getByRole('button', { name: /remove voiceover/i }));
    expect(update).toHaveBeenCalledWith('m1', { sound: { voiceover: null } });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsSoundStep.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MomentsSoundStep.tsx`**

`client/src/components/moments/MomentsSoundStep.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { MusicPicker } from '../MusicPicker';
import { momentsApi } from '../../lib/momentsApi';
import { api } from '../../lib/api';
import { STORY_VOICES } from '../../lib/storyScript';
import type { MomentPatch } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function MomentsSoundStep({ project, refresh, busy, setBusy }: MomentStepProps) {
  const song = project.sound.song;
  const vo = project.sound.voiceover;
  const [script, setScript] = useState('');
  const [voiceId, setVoiceId] = useState(vo?.voiceId || STORY_VOICES[0].id);
  const [making, setMaking] = useState(false);
  const { data: win } = useQuery({
    queryKey: ['moment-song-window', project.projectId, song?.ref, song?.windowStartSec, project.lengthSec],
    queryFn: () => momentsApi.songWindow(project.projectId),
    enabled: Boolean(song),
  });
  const [start, setStart] = useState(0);
  useEffect(() => { if (win) setStart(win.windowStartSec); }, [win]);

  const save = async (patch: MomentPatch) => {
    setBusy(true);
    try {
      await momentsApi.update(project.projectId, patch);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const makeVoice = async (body: { script?: string; idea?: string }) => {
    setMaking(true);
    try {
      await momentsApi.voiceover(project.projectId, { ...body, voiceId });
      setScript('');
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMaking(false);
    }
  };

  const maxStart = win ? Math.max(0, Math.floor(win.durationSec - project.lengthSec)) : 0;
  const commitStart = () => {
    if (song && win && start !== win.windowStartSec) save({ sound: { song: { ref: song.ref, windowStartSec: start } } });
  };

  return (
    <div className="space-y-4">
      <div className={panelCls}>
        <div className="field-label">Song</div>
        <MusicPicker
          value={{ path: song?.ref ?? null, volume: 1 }}
          onChange={(next) => save({ sound: { song: next.path ? { ref: next.path, windowStartSec: null } : null } })}
          busy={busy}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={secondaryBtnCls} disabled={busy || !song} onClick={() => save({ sound: { song: null } })}>No music</button>
          {win && (
            <label className={`${fieldLabelCls} flex-1`}>
              Start at {fmt(start)}{win.tempo ? ` · ${Math.round(win.tempo)} BPM` : ''}
              <input
                type="range"
                min={0}
                max={maxStart}
                step={1}
                value={Math.min(start, maxStart)}
                disabled={busy}
                onChange={(e) => setStart(Number(e.target.value))}
                onMouseUp={commitStart}
                onTouchEnd={commitStart}
                onKeyUp={commitStart}
                className="w-full"
              />
            </label>
          )}
          {win && song?.windowStartSec !== null && (
            <button type="button" className="text-xs text-content-tertiary hover:text-bf-cream" onClick={() => save({ sound: { song: { ref: song!.ref, windowStartSec: null } } })}>
              Auto ({fmt(win.autoStartSec)})
            </button>
          )}
        </div>
        <p className="text-help mt-2">We pick the liveliest {project.lengthSec} seconds of the song for you.</p>
      </div>

      <div className={panelCls}>
        <div className="field-label">Voiceover (optional)</div>
        {vo && (
          <div className="mb-3 space-y-2">
            <audio controls src={api.mediaUrl(vo.file)} className="w-full" />
            <p className="text-help">“{vo.script}”</p>
            <button type="button" className={secondaryBtnCls} disabled={busy} onClick={() => save({ sound: { voiceover: null } })}>Remove voiceover</button>
          </div>
        )}
        <label className={fieldLabelCls}>
          Voiceover script
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={3}
            maxLength={1200}
            placeholder="Type what to say, or describe it and let the AI write it."
            className={inputCls}
          />
        </label>
        <label className={fieldLabelCls}>
          Voice
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={inputCls}>
            {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <div className="mt-3 flex gap-2">
          <button type="button" className={primaryBtnCls} disabled={making || script.trim().length < 3} onClick={() => makeVoice({ script: script.trim() })}>
            {making ? <Loader2 size={16} className="animate-spin" /> : null} Make voiceover
          </button>
          <button type="button" className={secondaryBtnCls} disabled={making || script.trim().length < 3} onClick={() => makeVoice({ idea: script.trim() })}>
            Write it for me
          </button>
        </div>
        <p className="text-help mt-2">With a song, the music dips under your voice.</p>
      </div>
    </div>
  );
}
```

The window slider's `max` is the song length minus the Moment's length (180 − 15 = 165 in the test).

- [ ] **Step 4: Render the step in `MomentsPage.tsx`**

```tsx
{step === 'sound' && <MomentsSoundStep {...stepProps} />}
```

- [ ] **Step 5: Run the tests and the build, and confirm both pass**

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsSoundStep.test.tsx`
Expected: PASS.

Run: `cd client && npm run build`
Expected: the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/moments/MomentsSoundStep.tsx client/src/components/moments/__tests__/MomentsSoundStep.test.tsx client/src/pages/MomentsPage.tsx
```

```bash
git commit -m "feat: Moments sound step (song, window start, voiceover)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Words step

**Files:**
- Create: `client/src/components/moments/MomentsWordsStep.tsx`
- Modify: `client/src/pages/MomentsPage.tsx`
- Test: `client/src/components/moments/__tests__/MomentsWordsStep.test.tsx`

**Interfaces:**
- Consumes: `momentsApi.suggest`, `momentsApi.update`, `statementLimit`, `statementOverflow`, `verseStatement`.
- Produces: `MomentsWordsStep(props: MomentStepProps)`.

- [ ] **Step 1: Write the failing tests**

`client/src/components/moments/__tests__/MomentsWordsStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsWordsStep } from '../MomentsWordsStep';
import { momentsApi } from '../../../lib/momentsApi';
import { META, mkMoment } from '../../../pages/__tests__/MomentsPage.test';

beforeEach(() => vi.restoreAllMocks());
const props = (over = {}) => ({ project: mkMoment(over), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn() });

describe('MomentsWordsStep', () => {
  it('Suggest fills the title and statements and saves them', async () => {
    vi.spyOn(momentsApi, 'suggest').mockResolvedValue({ title: 'Happy 40th!', statements: ['Grace', 'Rising'], source: 'ai' });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));
    expect(update).toHaveBeenCalledWith('m1', { title: 'Happy 40th!', statements: ['Grace', 'Rising'] });
  });

  it('with statements already there the button reads Reshuffle', () => {
    render(<MomentsWordsStep {...props({ statements: ['A'] })} />);
    expect(screen.getByRole('button', { name: /reshuffle/i })).toBeInTheDocument();
  });

  it('edits a statement and saves on blur', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ statements: ['Grace'] })} />);
    const field = screen.getByLabelText('Statement 1');
    await userEvent.clear(field);
    await userEvent.type(field, 'Amazing grace');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('m1', { statements: ['Amazing grace'] });
  });

  it('reorders, deletes and adds statements', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ statements: ['A', 'B'] })} />);
    await userEvent.click(screen.getByRole('button', { name: /move statement 2 up/i }));
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['B', 'A'] });
    await userEvent.click(screen.getByRole('button', { name: /delete statement 1/i }));
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['B'] });
    await userEvent.type(screen.getByLabelText(/new statement/i), 'C{Enter}');
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['A', 'B', 'C'] });
  });

  it('warns when the length uses fewer statements than there are', () => {
    render(<MomentsWordsStep {...props({ statements: ['A', 'B', 'C', 'D', 'E'], lengthSec: 15 })} />);
    expect(screen.getByText(/only the first 3 are used/i)).toBeInTheDocument();
  });

  it('a church occasion offers its verse as a statement', async () => {
    vi.spyOn(momentsApi, 'suggest').mockResolvedValue({
      title: 'In loving memory', statements: ['Forever loved'], verse: { reference: 'John 11:35', text: 'Jesus wept.' }, source: 'ai',
    });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ occasion: 'memorial' })} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));
    await userEvent.click(await screen.findByRole('button', { name: /add john 11:35/i }));
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['“Jesus wept.” John 11:35'] });
  });
});
```

The "add" assertion expects `['A', 'B', 'C']` because the component's local list still holds the original `['A', 'B']` from props: the mocked `update` does not change props. Each action builds from `project.statements`, which is what the component must do, because the server copy is the truth.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsWordsStep.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MomentsWordsStep.tsx`**

`client/src/components/moments/MomentsWordsStep.tsx`:

```tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowUp, ArrowDown, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { statementLimit, statementOverflow, verseStatement } from '../../lib/momentsWizard';
import type { MomentPatch, MomentSuggestion } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls, panelCls, secondaryBtnCls } from '../story/formStyles';

export function MomentsWordsStep({ project, meta, refresh, busy, setBusy }: MomentStepProps) {
  const [title, setTitle] = useState(project.title);
  const [drafts, setDrafts] = useState(project.statements);
  const [suggesting, setSuggesting] = useState(false);
  const [verse, setVerse] = useState<MomentSuggestion['verse']>();
  const [extra, setExtra] = useState('');
  useEffect(() => setTitle(project.title), [project.title]);
  useEffect(() => setDrafts(project.statements), [project.statements]);
  const limit = statementLimit(project.lengthSec, meta);
  const overflow = statementOverflow(project, meta);

  const save = async (patch: MomentPatch) => {
    setBusy(true);
    try {
      await momentsApi.update(project.projectId, patch);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const s = await momentsApi.suggest(project.projectId);
      setVerse(s.verse);
      await save({ title: s.title, statements: s.statements });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const list = project.statements;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    save({ statements: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryBtnCls} disabled={busy || suggesting} onClick={suggest}>
          {suggesting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {list.length ? 'Reshuffle' : 'Suggest'}
        </button>
        <span className="text-help">The AI writes from your occasion and details. Edit anything.</span>
      </div>

      <label className={fieldLabelCls}>
        Title
        <input
          value={title}
          maxLength={meta.limits.title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() !== project.title) save({ title: title.trim() }); }}
          className={inputCls}
        />
      </label>

      <div className={panelCls}>
        <div className="field-label">Statements ({list.length}/{limit} for {project.lengthSec} s)</div>
        {overflow > 0 && <p className="text-sm text-amber-300">This length shows {limit} statements, so only the first {limit} are used.</p>}
        <div className="space-y-2">
          {drafts.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Statement ${i + 1}`}
                value={s}
                maxLength={meta.limits.statement}
                onChange={(e) => setDrafts(drafts.map((d, k) => (k === i ? e.target.value : d)))}
                onBlur={() => {
                  const v = drafts[i].trim();
                  if (v && v !== list[i]) save({ statements: list.map((d, k) => (k === i ? v : d)) });
                }}
                className={`${inputCls} mt-0 flex-1 ${i >= limit ? 'opacity-50' : ''}`}
              />
              <button type="button" aria-label={`Move statement ${i + 1} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
              <button type="button" aria-label={`Move statement ${i + 1} down`} disabled={busy || i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
              <button type="button" aria-label={`Delete statement ${i + 1}`} disabled={busy} onClick={() => save({ statements: list.filter((_, k) => k !== i) })}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        {list.length < meta.limits.maxStatements && (
          <input
            aria-label="New statement"
            value={extra}
            maxLength={meta.limits.statement}
            placeholder="Add a statement and press Enter"
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && extra.trim()) {
                save({ statements: [...list, extra.trim()] });
                setExtra('');
              }
            }}
            className={inputCls}
          />
        )}
      </div>

      {verse && (
        <div className={panelCls}>
          <div className="field-label">Scripture</div>
          <p className="text-sm text-bf-cream">“{verse.text}” {verse.reference}</p>
          <button
            type="button"
            className={secondaryBtnCls}
            disabled={busy || list.length >= meta.limits.maxStatements}
            onClick={() => save({ statements: [...list, verseStatement(verse, meta.limits.statement)] })}
          >
            Add {verse.reference}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render the step in `MomentsPage.tsx`**

```tsx
{step === 'words' && <MomentsWordsStep {...stepProps} />}
```

- [ ] **Step 5: Run the tests and the build, and confirm both pass**

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsWordsStep.test.tsx`
Expected: PASS.

Run: `cd client && npm run build`
Expected: the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/moments/MomentsWordsStep.tsx client/src/components/moments/__tests__/MomentsWordsStep.test.tsx client/src/pages/MomentsPage.tsx
```

```bash
git commit -m "feat: Moments words step (suggest, reshuffle, edit, reorder, verse)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Style step and preview loops

**Files:**
- Create: `client/src/components/moments/MomentsStyleStep.tsx`
- Create: `server/scripts/make-moment-previews.mjs`
- Create, by running the script: `client/public/moments/previews/{glow,celebrate,hype,gallery}.mp4`
- Modify: `client/src/pages/MomentsPage.tsx`
- Test: `client/src/components/moments/__tests__/MomentsStyleStep.test.tsx`

**Interfaces:**
- Consumes:
  - `momentsApi.update`;
  - for the script: the motion engine (`workImageArgs`, `directMoment`, `beatGridOf`, `renderPlan`, `runFfmpeg`).
- Produces: `MomentsStyleStep(props: MomentStepProps)`. Previews are served at `/moments/previews/<style>.mp4`.

- [ ] **Step 1: Write the failing tests**

`client/src/components/moments/__tests__/MomentsStyleStep.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsStyleStep } from '../MomentsStyleStep';
import { momentsApi } from '../../../lib/momentsApi';
import { META, mkMoment } from '../../../pages/__tests__/MomentsPage.test';

beforeEach(() => vi.restoreAllMocks());
const props = (over = {}) => ({ project: mkMoment(over), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn() });

describe('MomentsStyleStep', () => {
  it('shows the four styles with looping previews and marks the current one', () => {
    render(<MomentsStyleStep {...props()} />);
    for (const name of ['Glow', 'Celebrate', 'Hype', 'Gallery']) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /celebrate/i })).toHaveAttribute('aria-pressed', 'true');
    const video = document.querySelector('video[src="/moments/previews/glow.mp4"]');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('loop');
  });

  it('picking a style saves it', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /hype/i }));
    expect(update).toHaveBeenCalledWith('m1', { style: 'hype' });
  });

  it('Energy saves on release, as 0..1', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    const slider = screen.getByLabelText(/energy/i);
    fireEvent.change(slider, { target: { value: '25' } });
    fireEvent.mouseUp(slider);
    expect(update).toHaveBeenCalledWith('m1', { energy: 0.25 });
  });

  it('length is 15, 30 or 60 seconds', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsStyleStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: '30 s' }));
    expect(update).toHaveBeenCalledWith('m1', { lengthSec: 30 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsStyleStep.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MomentsStyleStep.tsx`**

`client/src/components/moments/MomentsStyleStep.tsx`:

```tsx
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { momentsApi } from '../../lib/momentsApi';
import type { MomentPatch } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, panelCls, segmentCls, segmentedCls } from '../story/formStyles';

const energyWord = (e: number) => (e < 0.34 ? 'Calm' : e <= 0.66 ? 'Lively' : 'Hype');

export function MomentsStyleStep({ project, meta, refresh, busy, setBusy }: MomentStepProps) {
  const [energy, setEnergy] = useState(Math.round(project.energy * 100));
  useEffect(() => setEnergy(Math.round(project.energy * 100)), [project.energy]);

  const save = async (patch: MomentPatch) => {
    setBusy(true);
    try {
      await momentsApi.update(project.projectId, patch);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const commitEnergy = () => { if (energy / 100 !== project.energy) save({ energy: energy / 100 }); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {meta.styles.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={project.style === s.id}
            disabled={busy}
            onClick={() => save({ style: s.id })}
            className={`glass overflow-hidden rounded-bf text-left ${project.style === s.id ? 'ring-2 ring-bf-gold' : ''}`}
          >
            <video src={`/moments/previews/${s.id}.mp4`} autoPlay muted loop playsInline className="aspect-[9/16] w-full object-cover" />
            <div className="p-2">
              <div className="text-sm font-semibold text-bf-cream">{s.label}</div>
              <div className="text-help">{s.description}</div>
            </div>
          </button>
        ))}
      </div>
      <div className={panelCls}>
        <label className={fieldLabelCls}>
          Energy: {energyWord(energy / 100)}
          <input
            type="range"
            min={0}
            max={100}
            value={energy}
            disabled={busy}
            onChange={(e) => setEnergy(Number(e.target.value))}
            onMouseUp={commitEnergy}
            onTouchEnd={commitEnergy}
            onKeyUp={commitEnergy}
            className="w-full"
          />
        </label>
        <div className="mt-1 flex justify-between text-help"><span>Calm</span><span>Hype</span></div>
      </div>
      <div>
        <div className={fieldLabelCls}>Length</div>
        <div className={segmentedCls} role="tablist" aria-label="Length">
          {meta.lengths.map((l) => (
            <button key={l} type="button" aria-pressed={project.lengthSec === l} disabled={busy} onClick={() => save({ lengthSec: l })} className={segmentCls(project.lengthSec === l)}>
              {l} s
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render the step in `MomentsPage.tsx`, then run the tests and the build**

Add to `MomentsPage.tsx`:

```tsx
{step === 'style' && <MomentsStyleStep {...stepProps} />}
```

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsStyleStep.test.tsx`
Expected: PASS.

Run: `cd client && npm run build`
Expected: the build succeeds.

- [ ] **Step 5: Write the preview script**

`server/scripts/make-moment-previews.mjs`:

```js
// Renders the four Moments style previews with the real motion engine:
// client/public/moments/previews/<style>.mp4 (360x640, ~6 s, silent, looping).
// The "photos" are generated colour gradients, so no personal pictures are
// shipped in this public repo. Run from server/: node scripts/make-moment-previews.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workImageArgs } from "../src/lib/motion/prepare.js";
import { directMoment } from "../src/lib/motion/director.js";
import { beatGridOf } from "../src/lib/motion/cuts.js";
import { renderPlan, runFfmpeg } from "../src/lib/motion/render.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../client/public/moments/previews");
const LENGTH = 6;
const STYLES = { glow: 0.2, celebrate: 0.8, hype: 0.95, gallery: 0.5 };
const COLOURS = [["0xF5B041", "0x6C3483"], ["0x48C9B0", "0x1B4F72"], ["0xEC7063", "0xF7DC6F"], ["0x5DADE2", "0x0B0B10"]];

async function run(args) {
  const r = await runFfmpeg(args);
  if (!r.ok) throw new Error(r.stderr || r.error);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "moment-previews-"));
try {
  fs.mkdirSync(outDir, { recursive: true });
  const photos = [];
  for (let i = 0; i < COLOURS.length; i += 1) {
    const src = path.join(work, `src-${i}.png`);
    const [c0, c1] = COLOURS[i];
    await run(["-v", "error", "-y", "-f", "lavfi", "-i", `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1080:y1=1920:d=1`, "-frames:v", "1", src]);
    const out = path.join(work, `work-${i}.jpg`);
    const { args, shape } = workImageArgs({ src, out, width: 1080, height: 1920, orientation: 1 });
    await run(args);
    photos.push({ file: out, shape });
  }
  const beats = [];
  for (let t = 0.25; t < LENGTH; t += 0.5) beats.push(Math.round(t * 1000) / 1000);
  const grid = beatGridOf({ beats, downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0), strong: [4, 8], period: 0.5 });
  for (const [style, energy] of Object.entries(STYLES)) {
    const { plan } = directMoment({
      photos: photos.map((p) => ({ shape: p.shape })), heroIndex: 0, grid, title: "Your title",
      statements: ["Your words here", "Made with BibleFuel"], styleId: style, energy, lengthSec: LENGTH, seed: 7,
    });
    const workDir = fs.mkdtempSync(path.join(work, `${style}-`));
    const full = path.join(work, `${style}-full.mp4`);
    const r = await renderPlan({ plan, workImages: photos.map((p) => p.file), song: null, voice: null, workDir, out: full });
    if (!r.ok) throw new Error(`${style}: ${r.error} ${r.detail || ""}`);
    await run(["-v", "error", "-y", "-i", full, "-an", "-vf", "scale=360:640", "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(outDir, `${style}.mp4`)]);
    console.log(`wrote ${style}.mp4`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
```

- [ ] **Step 6: Run the script and check the four files**

Run: `cd server && node scripts/make-moment-previews.mjs`
Expected: four `wrote <style>.mp4` lines. Each file under `client/public/moments/previews/` is under 600 KB.

Then extract one frame from each preview and look at it, to confirm the motion and captions show:

```bash
ffmpeg -v error -y -ss 2 -i client/public/moments/previews/hype.mp4 -frames:v 1 hype.png
```

Open the PNG with the Read tool, then delete it. Do not commit it.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/moments/MomentsStyleStep.tsx client/src/components/moments/__tests__/MomentsStyleStep.test.tsx client/src/pages/MomentsPage.tsx server/scripts/make-moment-previews.mjs client/public/moments/previews/glow.mp4 client/public/moments/previews/celebrate.mp4 client/public/moments/previews/hype.mp4 client/public/moments/previews/gallery.mp4
```

```bash
git commit -m "feat: Moments style step with engine-rendered preview loops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Make it, result and render history

**Files:**
- Create: `client/src/components/moments/MomentsResult.tsx`
- Modify: `client/src/pages/MomentsPage.tsx` (the Make it button and its flow; render `MomentsResult`; switch to the Result step when a render starts)
- Test: `client/src/components/moments/__tests__/MomentsResult.test.tsx`
- Test: add Make it tests to `client/src/pages/__tests__/MomentsPage.test.tsx`

**Interfaces:**
- Consumes: `canMake`, `isRunning`, `newSeed`; `momentsApi.render`, `cancel`, `suggest`, `update`.
- Produces:
  - `MomentsResult({ project, onShuffle, onRetry, onCancel, busy })`.
  - In `MomentsPage`: `makeIt(seed?: number)`. It does the following, in order:
    1. guards against re-entry;
    2. if the title and statements are empty, suggests, saves, and refreshes;
    3. calls `momentsApi.render(id, seed)`;
    4. switches to `result`;
    5. invalidates the project query.

- [ ] **Step 1: Write the failing tests**

`client/src/components/moments/__tests__/MomentsResult.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsResult } from '../MomentsResult';
import { mkMoment } from '../../../pages/__tests__/MomentsPage.test';

const handlers = () => ({ onShuffle: vi.fn(), onRetry: vi.fn(), onCancel: vi.fn(), busy: false });

describe('MomentsResult', () => {
  it('while rendering shows the stage and percent, with Cancel', async () => {
    const h = handlers();
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'running', percent: 42, stage: 'shots' } })} {...h} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(/cutting your photos/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(h.onCancel).toHaveBeenCalled();
  });

  it('when done plays the video, offers Download and Shuffle, and lists notes', async () => {
    const h = handlers();
    render(<MomentsResult
      project={mkMoment({ render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4', notes: ['Photo 3 was skipped: format.'] } })}
      {...h}
    />);
    expect(document.querySelector('video')?.getAttribute('src')).toContain('/outputs/moment-1.mp4');
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('download');
    expect(screen.getByText(/photo 3 was skipped/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /shuffle/i }));
    expect(h.onShuffle).toHaveBeenCalled();
  });

  it('a failure shows the message and Make it again', async () => {
    const h = handlers();
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'error', percent: 0, stage: 'error', error: 'Need at least 3 readable photos.' } })} {...h} />);
    expect(screen.getByText(/need at least 3 readable photos/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /make it again/i }));
    expect(h.onRetry).toHaveBeenCalled();
  });

  it('an interrupted render (a server restart) offers Make it again, not a spinner', () => {
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'interrupted', percent: 40, stage: 'shots' } })} {...handlers()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/was interrupted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /make it again/i })).toBeInTheDocument();
  });

  it('lists earlier renders newest first', () => {
    render(<MomentsResult project={mkMoment({
      history: [
        { jobId: 'a', file: '/outputs/moment-a.mp4', createdAt: 1, seed: 1 },
        { jobId: 'b', file: '/outputs/moment-b.mp4', createdAt: 2, seed: 2 },
      ],
    })} {...handlers()} />);
    const links = screen.getAllByRole('link', { name: /version/i });
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('moment-b.mp4'));
  });
});
```

Add to `client/src/pages/__tests__/MomentsPage.test.tsx`, inside a new `describe('Make it', ...)`:

```tsx
describe('Make it', () => {
  const ready = () => mkMoment({
    photos: [1, 2, 3].map((n) => ({ ref: { kind: 'upload' as const, path: `p${n}` }, url: `/outputs/p${n}.jpg`, width: 1, height: 1 })),
  });

  it('is disabled until there are 3 photos', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    expect(await screen.findByRole('button', { name: /make it/i })).toBeDisabled();
  });

  it('with empty words, suggests and saves them first, then renders once', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    const suggest = vi.spyOn(momentsApi, 'suggest').mockResolvedValue({ title: 'Happy birthday!', statements: ['A'], source: 'template' });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(ready());
    let resolveRender: (v: string) => void = () => {};
    const renderCall = vi.spyOn(momentsApi, 'render').mockImplementation(() => new Promise((r) => { resolveRender = r; }));
    renderPage();
    const button = await screen.findByRole('button', { name: /make it/i });
    await userEvent.click(button);
    await userEvent.click(button);
    await waitFor(() => expect(renderCall).toHaveBeenCalledTimes(1));
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('m1', { title: 'Happy birthday!', statements: ['A'] });
    expect(suggest.mock.invocationCallOrder[0]).toBeLessThan(renderCall.mock.invocationCallOrder[0]);
    resolveRender('job-1');
    expect(await screen.findByRole('button', { name: 'Result', pressed: true })).toBeInTheDocument();
  });

  it('with words already written, renders straight away', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue({ ...ready(), title: 'Mine', statements: ['Mine too'] });
    const suggest = vi.spyOn(momentsApi, 'suggest');
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-1');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /make it/i }));
    await waitFor(() => expect(renderCall).toHaveBeenCalledWith('m1', undefined));
    expect(suggest).not.toHaveBeenCalled();
  });
});
```

The double click lands while the first `makeIt` is still waiting on `suggest`. A `useRef` guard, not the `busy` state (which updates asynchronously), is what makes the second click a no-op.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd client && npx vitest run src/components/moments/__tests__/MomentsResult.test.tsx src/pages/__tests__/MomentsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `MomentsResult.tsx`**

`client/src/components/moments/MomentsResult.tsx`:

```tsx
import { Download, Shuffle, RotateCcw, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { MomentProject } from '../../lib/momentsTypes';
import { panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';

const STAGE_WORDS: Record<string, string> = {
  waiting: 'Waiting to start…',
  'waiting for another video to finish': 'Waiting for another video to finish…',
  prepare: 'Getting your photos ready…',
  analyse: 'Finding the beat…',
  shots: 'Cutting your photos to the music…',
  join: 'Putting it together…',
  finish: 'Adding your words and the sound…',
};

interface Props {
  project: MomentProject;
  onShuffle: () => void;
  onRetry: () => void;
  onCancel: () => void;
  busy: boolean;
}

export function MomentsResult({ project, onShuffle, onRetry, onCancel, busy }: Props) {
  const r = project.render;
  const history = [...project.history].reverse();
  return (
    <div className="space-y-4">
      {r?.status === 'running' && (
        <div className={panelCls}>
          <div className="text-sm text-bf-cream">{STAGE_WORDS[r.stage] ?? 'Making your Moment…'}</div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent} className="mt-2 h-2 overflow-hidden rounded-full bg-bf-card2">
            <div className="h-full bg-bf-gold transition-all" style={{ width: `${r.percent}%` }} />
          </div>
          <button type="button" className={`${secondaryBtnCls} mt-3`} onClick={onCancel}><X size={16} /> Cancel</button>
        </div>
      )}

      {r?.status === 'done' && r.file && (
        <div className="space-y-3">
          <video src={api.mediaUrl(r.file)} controls playsInline className="mx-auto aspect-[9/16] max-h-[70vh] rounded-bf bg-black" />
          <div className="flex flex-wrap justify-center gap-2">
            <a href={api.mediaUrl(r.file)} download className={primaryBtnCls}><Download size={16} /> Download</a>
            <button type="button" className={secondaryBtnCls} disabled={busy} onClick={onShuffle}><Shuffle size={16} /> Shuffle</button>
          </div>
          {r.notes?.length ? <ul className="text-help list-disc pl-5">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        </div>
      )}

      {(r?.status === 'error' || r?.status === 'interrupted') && (
        <div className={panelCls}>
          <p className="text-sm text-red-300">
            {r.status === 'interrupted' ? 'Making this Moment was interrupted (the server restarted). Please make it again.' : r.error}
          </p>
          <button type="button" className={`${primaryBtnCls} mt-3`} disabled={busy} onClick={onRetry}><RotateCcw size={16} /> Make it again</button>
        </div>
      )}

      {!r && <p className="text-help">Press Make it when you're ready. Your video will appear here.</p>}

      {history.length > 0 && (
        <div className="space-y-1">
          <div className="field-label">Earlier versions</div>
          {history.map((h, i) => (
            <a key={h.jobId} href={api.mediaUrl(h.file)} target="_blank" rel="noreferrer" className="block text-sm text-bf-gold hover:underline">
              Version {history.length - i} · {new Date(h.createdAt).toLocaleString()}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the Make it flow to `MomentsPage.tsx`**

Add these imports:

```tsx
import { useRef } from 'react';
import { Wand2 } from 'lucide-react';
import { canMake, newSeed } from '../lib/momentsWizard';
import { MomentsResult } from '../components/moments/MomentsResult';
import { primaryBtnCls } from '../components/story/formStyles';
```

Inside the component, after `refresh`:

```tsx
  const making = useRef(false);
  const makeIt = async (seed?: number) => {
    if (!project || making.current) return;
    making.current = true;
    setBusy(true);
    try {
      if (!project.title.trim() && project.statements.length === 0) {
        const s = await momentsApi.suggest(project.projectId);
        await momentsApi.update(project.projectId, { title: s.title, statements: s.statements });
      }
      await momentsApi.render(project.projectId, seed);
      setStep('result');
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Could not start your Moment');
    } finally {
      making.current = false;
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!project) return;
    try { await momentsApi.cancel(project.projectId); } catch (e) { toast.error((e as Error).message); }
    refresh();
  };
```

Add the Make it button under the step content, visible on every step:

```tsx
{project && (() => {
  const ready = canMake(project, meta);
  return (
    <div className="sticky bottom-4 mt-6 flex flex-col items-center gap-1">
      <button type="button" onClick={() => makeIt()} disabled={!ready.ok || busy} className={`${primaryBtnCls} px-8 py-3`}>
        <Wand2 size={18} /> Make it
      </button>
      {!ready.ok && <span className="text-help">{ready.reason}</span>}
    </div>
  );
})()}
```

Replace the Result placeholder:

```tsx
{step === 'result' && (
  <MomentsResult project={project} busy={busy} onShuffle={() => makeIt(newSeed())} onRetry={() => makeIt()} onCancel={cancel} />
)}
```

Remove `StepPlaceholder` once no step uses it.

- [ ] **Step 5: Run the tests and the build, and confirm both pass**

Run: `cd client && npx vitest run src/components/moments/ src/pages/__tests__/MomentsPage.test.tsx src/lib/__tests__/momentsWizard.test.ts src/lib/__tests__/momentsApi.test.ts`
Expected: all PASS.

Run: `cd client && npm test`
Expected: all PASS.

Run: `cd client && npm run build`
Expected: the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/moments/MomentsResult.tsx client/src/components/moments/__tests__/MomentsResult.test.tsx client/src/pages/MomentsPage.tsx client/src/pages/__tests__/MomentsPage.test.tsx
```

```bash
git commit -m "feat: Moments Make it flow, result, Shuffle and render history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rebuild the bundle and run an end-to-end browser pass

**Files:**
- Modify: `server/public/**` (the built client bundle, via `npm run build`, as in earlier PRs)

The repo commits the built bundle; earlier PRs ended with a `chore: rebuild client bundle` commit.

- [ ] **Step 1: Build**

Run: `cd client && npm run build`
Expected: success. `server/public` is updated.

- [ ] **Step 2: Browser pass on the local stack**

Start the dev stack the usual way: pm2 per the project's dev-stack notes, or `.claude/launch.json` via the browser preview. Sign in with the local test account from the project's seed or config, then:
1. Open Create and choose **Moments**.
2. Pick Birthday.
3. Upload 4 photos (any JPGs, e.g. from `server/assets`, or generate them with ffmpeg).
4. Leave the words empty and press **Make it**.
5. Watch the progress until the video plays.
6. Press **Shuffle** and confirm a second version appears under "Earlier versions".

Capture a screenshot of the finished result.

Check:
- the browser console has no errors;
- the server log shows no `[moments]` errors.

- [ ] **Step 3: Commit the bundle**

```bash
git add server/public
```

```bash
git commit -m "chore: rebuild client bundle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
