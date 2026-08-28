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
  busy: 'bg-white/[0.04] text-content-secondary border-white/10',
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
