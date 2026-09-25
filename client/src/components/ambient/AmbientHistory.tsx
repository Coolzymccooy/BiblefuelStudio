import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Youtube } from 'lucide-react';
import { ambientApi } from '../../lib/ambientApi';
import type { AmbientProjectSummary } from '../../lib/ambientTypes';
import { formatLength } from '../../lib/ambientLength';
import { ambientStatusMeta, publishedLabel } from '../../lib/ambientHistory';
import { relativeTime, type StatusTone } from '../../lib/storyWizard';

export const AMBIENT_PROJECTS_KEY = ['ambient-projects'];

interface AmbientHistoryProps {
  /** `finished` opens straight onto the video, where it can be published. */
  onOpen: (id: string, finished: boolean) => void;
}

const TONE_CLASS: Record<StatusTone, string> = {
  done: 'bg-[#7fb5aa]/15 text-content-secondary border-[#7fb5aa]/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  busy: 'bg-[rgba(216,184,120,0.12)] text-bf-goldDim border-[rgba(216,184,120,0.3)]',
  idle: 'bg-bf-card2 text-bf-sub border-[rgba(216,184,120,0.22)]',
};

/** The creation form sits below this list; an uncapped list pushes it off screen. */
const COLLAPSED_COUNT = 5;

function lengthOf(p: AmbientProjectSummary): string {
  return p.targetSec ? formatLength(p.targetSec / 60) : '';
}

/**
 * Every ambient session this account has made, newest first. Without it a
 * finished video was only reachable while it was the page's active session:
 * "Start new" (or another device) left it on disk with no way back to it.
 */
export function AmbientHistory({ onOpen }: AmbientHistoryProps) {
  const qc = useQueryClient();
  const { data: sessions } = useQuery({
    queryKey: AMBIENT_PROJECTS_KEY,
    queryFn: () => ambientApi.listProjects(),
  });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [now] = useState(() => Date.now());

  if (!sessions || sessions.length === 0) return null;

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? sessions.filter((p) => (p.title || 'Untitled').toLowerCase().includes(needle))
    : sessions;
  const showAll = expanded || Boolean(needle);
  const visible = showAll ? matches : matches.slice(0, COLLAPSED_COUNT);
  const overflowing = sessions.length > COLLAPSED_COUNT;

  const doDelete = async (id: string) => {
    try {
      await ambientApi.deleteProject(id);
      qc.invalidateQueries({ queryKey: AMBIENT_PROJECTS_KEY });
      toast.success('Session deleted');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to delete');
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <section aria-label="Your sessions" className="mb-6">
      <div className="flex items-center justify-between gap-3">
        <div className="field-label">Your sessions</div>
        {overflowing && <span className="text-[11px] text-meta">{sessions.length} total</span>}
      </div>

      {overflowing && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          aria-label="Search sessions"
          className="mb-2 w-full rounded-lg border border-[rgba(216,184,120,0.18)] bg-bf-card2/60 px-3 py-1.5 text-sm text-bf-cream placeholder:text-meta"
        />
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card2/40 px-3 py-3 text-sm text-meta">
          No sessions match “{query.trim()}”.
        </p>
      ) : (
        <ul className={`space-y-2${showAll ? ' max-h-[420px] overflow-y-auto pr-1' : ''}`}>
          {visible.map((p) => {
            const meta = ambientStatusMeta(p.status);
            const finished = Boolean(p.hasVideo);
            const title = p.title || 'Untitled';
            return (
              <li key={p.projectId} className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card2/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-bf-cream">{title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`rounded-full border px-1.5 py-0.5 ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>
                    {lengthOf(p) && <span className="text-meta">{lengthOf(p)}</span>}
                    <span className="text-meta">{relativeTime(p.updatedAt, now)}</span>
                  </div>
                  {p.lastPublished && (
                    <a
                      href={p.lastPublished.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-bf-goldDim hover:text-bf-cream hover:underline"
                    >
                      <Youtube size={12} /> On YouTube · {publishedLabel(p.lastPublished, now)}
                    </a>
                  )}
                </div>
                {confirmId === p.projectId ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => doDelete(p.projectId)} className="rounded-md bg-red-500/80 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500">
                      Delete{finished ? ' with video' : ''}
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="btn btn-secondary px-2.5 py-1 text-xs">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(p.projectId, finished)}
                      aria-label={`${finished ? 'Watch or publish' : 'Open'} ${title}`}
                      className="btn btn-secondary px-2.5 py-1 text-xs hover:border-bf-goldDeep"
                    >
                      {finished ? 'Watch · Publish' : 'Open'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(p.projectId)}
                      aria-label={`Delete ${title}`}
                      className="btn btn-secondary px-2.5 py-1 text-xs hover:border-bf-danger hover:text-bf-danger"
                    >
                      Delete
                    </button>
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
          {expanded ? 'Show fewer' : `Show all ${sessions.length}`}
        </button>
      )}
    </section>
  );
}
