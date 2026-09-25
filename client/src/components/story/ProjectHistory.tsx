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
  done: 'bg-[#7fb5aa]/15 text-content-secondary border-[#7fb5aa]/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  busy: 'bg-[rgba(216,184,120,0.12)] text-bf-goldDim border-[rgba(216,184,120,0.3)]',
  idle: 'bg-bf-card2 text-bf-sub border-[rgba(216,184,120,0.22)]',
};

/**
 * How many rows show before the list collapses behind "Show all".
 *
 * The new-project form sits directly below this list, so an uncapped history
 * puts it one screen further down for every few projects you have ever made.
 * At a few hundred, starting new work means scrolling past all your old work.
 */
const COLLAPSED_COUNT = 5;

export function ProjectHistory({ onOpen, activeId, onDeleted }: ProjectHistoryProps) {
  const qc = useQueryClient();
  const { data: projects } = useStoryProjects();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  if (!projects || projects.length === 0) return null;

  // Search is what makes a long history usable: finding one old project
  // should never mean scrolling through the nine hundred in front of it.
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? projects.filter((p) => (p.title || 'Untitled').toLowerCase().includes(needle))
    : projects;

  // Searching implies you want to see what you found, so it expands too.
  const showAll = expanded || Boolean(needle);
  const visible = showAll ? matches : matches.slice(0, COLLAPSED_COUNT);
  const overflowing = projects.length > COLLAPSED_COUNT;

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
      <div className="flex items-center justify-between gap-3">
        <div className="field-label">Recent projects</div>
        {overflowing && (
          <span className="text-[11px] text-meta">{projects.length} total</span>
        )}
      </div>

      {overflowing && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="mb-2 w-full rounded-lg border border-[rgba(216,184,120,0.18)] bg-bf-card2/60 px-3 py-1.5 text-sm text-bf-cream placeholder:text-meta"
        />
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card2/40 px-3 py-3 text-sm text-meta">
          No projects match “{query.trim()}”.
        </p>
      ) : (
      <ul
        data-testid="project-history-list"
        // Expanded, the list scrolls inside a fixed height instead of growing
        // without bound — otherwise "Show all" just recreates the problem.
        className={`space-y-2${showAll ? ' max-h-[420px] overflow-y-auto pr-1' : ''}`}
      >
        {visible.map((p) => {
          const meta = statusMeta(p.status);
          return (
            <li key={p.projectId} className="flex items-center gap-3 rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card2/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-bf-cream">{p.title || 'Untitled'}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                  <span className={`rounded-full border px-1.5 py-0.5 ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>
                  <span className="text-meta">{relativeTime(p.updatedAt, now)}</span>
                </div>
              </div>
              {confirmId === p.projectId ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => doDelete(p.projectId)} className="rounded-md bg-red-500/80 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500">Confirm</button>
                  <button type="button" onClick={() => setConfirmId(null)} className="btn btn-secondary px-2.5 py-1 text-xs">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onOpen(p.projectId)} className="btn btn-secondary px-2.5 py-1 text-xs hover:border-bf-goldDeep">Open</button>
                  <button type="button" onClick={() => setConfirmId(p.projectId)} className="btn btn-secondary px-2.5 py-1 text-xs hover:border-bf-danger hover:text-bf-danger">Delete</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      )}

      {overflowing && !needle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-bf-goldDim hover:text-bf-cream hover:underline"
        >
          {expanded ? 'Show fewer' : `Show all ${projects.length}`}
        </button>
      )}
    </div>
  );
}
