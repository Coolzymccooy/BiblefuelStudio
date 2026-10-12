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
  // Oldest is Version 1. The render on show is not repeated in the list, but keeps its place in the numbering.
  const versions = [...project.history]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((h, i) => ({ ...h, version: i + 1 }))
    .filter((h) => h.jobId !== r?.jobId)
    .reverse();
  return (
    <div className="space-y-4">
      {r?.status === 'running' && (
        <div className={panelCls}>
          <div className="text-sm text-bf-cream">{STAGE_WORDS[r.stage] ?? 'Making your Moment…'}</div>
          <div role="progressbar" aria-label="Making your Moment" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent} className="mt-2 h-2 overflow-hidden rounded-full bg-bf-card2">
            <div className="h-full bg-bf-gold transition-all" style={{ width: `${r.percent}%` }} />
          </div>
          <button type="button" className={`${secondaryBtnCls} mt-3`} onClick={onCancel}><X size={16} /> Cancel</button>
        </div>
      )}

      {r?.status === 'done' && r.file && (
        <div className="space-y-3">
          <video src={api.mediaUrl(r.file)} controls playsInline className="mx-auto aspect-[9/16] max-h-[70vh] rounded-bf bg-black" />
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={primaryBtnCls} onClick={() => api.downloadMedia(api.mediaUrl(r.file), 'moment.mp4')}>
              <Download size={16} /> Download
            </button>
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

      {versions.length > 0 && (
        <div className="space-y-1">
          <div className="field-label">Earlier versions</div>
          {versions.map((h) => (
            <a key={h.jobId} href={api.mediaUrl(h.file)} target="_blank" rel="noreferrer" className="block text-sm text-bf-gold hover:underline">
              Version {h.version} · {new Date(h.createdAt).toLocaleString()}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
