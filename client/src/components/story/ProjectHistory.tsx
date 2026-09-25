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
      <div className="field-label">Recent projects</div>
      <ul className="space-y-2">
        {projects.map((p) => {
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
    </div>
  );
}
