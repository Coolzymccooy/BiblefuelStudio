# Story Video — Project History (+ upload-button fix) — Design

**Date:** 2026-06-07
**Status:** Approved design — ready for implementation planning
**Sub-project:** 1 of 4 in the Story Video enhancement program (History → Trim → Script entry → Talking video)

## Summary

Add a **Recent projects** list to the Story Video wizard so past projects are reachable instead of lost when you start a new one. The backend already persists every project and exposes `GET /api/story`; this adds the missing list UI plus a **delete** capability (new `DELETE /api/story/:id` endpoint). Bundled with it: a **fix for the Step-1 upload button**, which currently relies on label→hidden-input click forwarding and doesn't reliably open the file chooser in all browsers.

## Goals

- See a list of past Story Video projects on the wizard's Step 1.
- Reopen any project (loads it into the wizard exactly as the existing resume flow does).
- Delete a project (with confirm), removing its JSON + generated assets.
- "Start new" never hides or loses prior projects.
- Fix the upload button so it reliably opens the file chooser everywhere.

## Non-Goals (this sub-project)

- Thumbnails in the list (the summary endpoint returns no image; a later nicety).
- Rename / duplicate (user chose Open + Delete only).
- Pagination / search (project counts are small for a single user; revisit if needed).
- Trim, script entry, talking video — separate sub-projects (2, 3, 4).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Placement | Inline on Step 1 — "Recent projects" list above the new-project form |
| Per-project actions | Open + Delete (with confirm) |
| Delete scope | Remove project JSON **and** its generated assets on disk |
| Thumbnails | Deferred (title + status + relative time is enough) |

## Prerequisite Fix — Upload button

**Problem:** Step 1's upload control is a `<label>` wrapping `<input type="file" className="hidden">`. Clicking the label is supposed to forward to the input, but with a large dashed drop-zone label this is unreliable across browsers (notably Safari/iOS), so clicks do nothing.

**Fix:** Replace the label-wrap with an explicit trigger:
- A `useRef<HTMLInputElement>` on the file input.
- A `<button type="button" onClick={() => inputRef.current?.click()}>` styled as the drop-zone.
- The `<input>` stays `hidden` but is a sibling, triggered programmatically.

This is the standard bulletproof pattern and removes the entire class of label-forwarding quirks. Behaviour is otherwise identical (same `accept`, same `onChange → handleCreateAndUpload`).

## Architecture

### Backend

- **`projectStore.deleteProject(baseDir, projectId)`** — unlink the project JSON only (its domain, mirroring the other store functions that take just `baseDir`). Path-safe via the existing `projectId` sanitisation. Returns `true` if the JSON existed, `false` if not.
- **`DELETE /api/story/:id`** — `requireAuth + withUserScope` like the rest. Calls `deleteProject(req.ctx.dataDir, id)`; if it returns `false` → 404 `{ok:false}`. On success, **the route** does best-effort `fs.rm(..., {recursive:true, force:true})` of the asset dirs under `req.ctx.outputDir`: `story/<id>/` and `genImg/<id>/`. Asset-cleanup errors are logged and never fail the request; returns `{ok:true}`.
- **`GET /api/story`** already returns summaries newest-first — no change.

### Frontend

- **`storyApi.deleteProject(id)`** — `DELETE /api/story/:id`, throws on `!ok`.
- **`useStoryProjects()`** — TanStack Query hook over `storyApi.listProjects()` (queryKey `['story-projects']`); no polling.
- **`relativeTime(ms, nowMs)`** (pure, in `storyWizard.ts`) — `"just now" | "5m ago" | "3h ago" | "2d ago" | "Jun 3"`. Takes `nowMs` as a param so it's deterministic to test.
- **`statusMeta(status)`** (pure) — `{ label, tone }` where tone ∈ `done|error|busy|idle`, mapping each `StoryStatus` to a pill label + colour class.
- **`ProjectHistory` component** (`components/story/ProjectHistory.tsx`) — props `{ onOpen(id), activeId }`. Renders the list from `useStoryProjects()`: each row = title, status pill, relative time, **Open** (calls `onOpen`), **Delete** (inline confirm → `storyApi.deleteProject` → invalidate `['story-projects']` → toast). Empty list → renders nothing (Step 1 just shows the new-project form).
- **`StoryVideoPage` Step 1** — when no active project, render `<ProjectHistory onOpen={setActive} />` above the title/style/upload form. `onOpen(id)` = `setActive(id)`. Deleting the **currently active** project also calls `setActive(null)`.

### Data flow

Open Story Video (no active project) → `useStoryProjects` lists summaries → render history + new-project form. Click **Open** → `setActive(id)` → existing `useStoryProject(id)` drives the wizard. Click **Delete** → confirm → `deleteProject` → list refetches → row gone. Create/finish a project → on next visit it appears in the list (newest first).

## Error Handling

- Delete fails → toast the server message; list unchanged (no optimistic removal, or rollback on error).
- List fails to load → small inline "Couldn't load your projects" note; the new-project form still works.
- Deleting the active project → clear the active pointer so the wizard resets to Step 1 cleanly.
- Backend asset cleanup failure → logged server-side; the JSON delete still succeeds and the API returns ok (a leftover asset dir is harmless; never block the user).
- `deleteProject` on a missing id → `false` → route 404 (idempotent-safe: deleting twice just 404s the second time).

## Testing

**Backend (node:test):**
- `deleteProject` removes the JSON and the asset dirs; returns `false` for a missing id; tolerates already-absent asset dirs.
- `DELETE /api/story/:id` → 404 for unknown id; 200 + project gone from `listProjects` after delete; tenant-scoped (can't delete via another user's dir — covered by the existing `req.ctx.dataDir` scoping).

**Frontend (vitest + testing-library):**
- `relativeTime` — boundaries: <1m "just now", minutes, hours, days, then date fallback.
- `statusMeta` — every `StoryStatus` maps to a label + tone.
- `ProjectHistory` — renders a row per project; **Open** calls `onOpen(id)`; **Delete** shows confirm then calls `storyApi.deleteProject` (mocked) and refetches.
- `storyApi.deleteProject` — issues `DELETE` to the right URL; throws on `!ok`.
- Upload fix — a `StoryVideoPage` test asserting the visible upload control is a real `<button>` (role=button) wired to a hidden file input (guards the regression).

## Reused Existing Systems

- `GET /api/story` list endpoint + `listProjects` (backend, done).
- `storyApi`, `useStoryProject`, `StoryVideoPage` Step-1 (from the wizard sub-project).
- Toasts (`react-hot-toast`), Tailwind pills, the `setActive`/localStorage active-pointer mechanism.

## Deployment Note

Per `biblefuel-deploy-prebuilt-bundle`: client changes require `npm run build` + committing `server/public`, or the deployed UI stays stale.
