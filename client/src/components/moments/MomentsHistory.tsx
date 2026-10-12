import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Film } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { api } from '../../lib/api';
import { toastError } from '../../lib/errors';
import type { MomentMeta } from '../../lib/momentsTypes';

export const MOMENTS_LIST_KEY = ['moments'];

/** The occasion picker sits beside this list; an uncapped list pushes it off screen. */
const COLLAPSED_COUNT = 5;

interface MomentsHistoryProps {
  meta: MomentMeta;
  /** `finished` opens straight onto the video. */
  onOpen: (id: string, finished: boolean) => void;
}

/** Every Moment this account has made, newest first. */
export function MomentsHistory({ meta, onOpen }: MomentsHistoryProps) {
  const qc = useQueryClient();
  const { data: list = [], isError, refetch } = useQuery({ queryKey: MOMENTS_LIST_KEY, queryFn: () => momentsApi.list() });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const remove = async (id: string) => {
    try {
      await momentsApi.remove(id);
      qc.invalidateQueries({ queryKey: MOMENTS_LIST_KEY });
    } catch (e) {
      toastError(e);
    } finally {
      setConfirmId(null);
    }
  };

  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-help">Could not load your Moments.</p>
        <button type="button" onClick={() => refetch()} className="btn btn-secondary px-2.5 py-1 text-xs">Retry</button>
      </div>
    );
  }
  if (!list.length) return <p className="text-help">Your Moments will appear here.</p>;

  const overflowing = list.length > COLLAPSED_COUNT;
  const visible = expanded ? list : list.slice(0, COLLAPSED_COUNT);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="field-label">Your Moments</div>
        {overflowing && <span className="text-[11px] text-meta">{list.length} total</span>}
      </div>
      <div className={`space-y-2${expanded && overflowing ? ' max-h-[420px] overflow-y-auto pr-1' : ''}`}>
        {visible.map((m) => {
          const occasion = meta.occasions.find((o) => o.id === m.occasion)?.label ?? m.occasion;
          const name = m.title || occasion;
          return (
            <div key={m.projectId} className="glass flex items-center gap-3 rounded-bf p-2">
              <button
                type="button"
                onClick={() => onOpen(m.projectId, Boolean(m.lastFile))}
                aria-label={`Open ${name}`}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {m.thumb
                  ? <img src={api.mediaUrl(m.thumb)} alt="" className="h-14 w-10 rounded-lg object-cover" />
                  : <div className="flex h-14 w-10 items-center justify-center rounded-lg bg-bf-card2"><Film size={16} /></div>}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-bf-cream">{m.title || 'Untitled Moment'}</div>
                  <div className="text-help">{occasion}{m.lastFile ? ' · made' : ''}</div>
                </div>
              </button>
              {confirmId === m.projectId ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => remove(m.projectId)}
                    aria-label={`Confirm delete ${name}`}
                    className="rounded-md bg-red-500/80 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500"
                  >
                    Delete{m.lastFile ? ' with video' : ''}
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="btn btn-secondary px-2.5 py-1 text-xs">Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(m.projectId)}
                  aria-label={`Delete ${name}`}
                  className="p-2 text-content-tertiary hover:text-red-300"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-bf-goldDim hover:text-bf-cream hover:underline"
        >
          {expanded ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}
