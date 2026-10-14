import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricProject } from '../../lib/lyricVideoTypes';
import type { SaveProject } from './useProjectSaves';
import { secondaryBtnCls } from '../story/formStyles';
import { messageOf } from './messageOf';

/** A different whole number, at least 2, for the same input every time (so tests can name it). Pure, so fast refresh loses nothing by it living here. */
// eslint-disable-next-line react-refresh/only-export-components
export const nextSeed = (seed: number) => ((Math.abs(Math.trunc(seed)) * 7919 + 13) % 100_000) + 2;

/** How long "Shuffled" stays up before the line goes quiet again. */
const TICK_MS = 1200;

interface Props {
  project: LyricProject;
  /** The step's writer: queues the change behind any still saving and files the reply. */
  save: SaveProject;
  /** Called after the new mix is saved, so the preview can redraw. */
  onPreviewChange: () => void;
}

/** Re-rolls the effects on lines set to Auto; lines with a chosen effect keep it. */
export function ShuffleButton({ project, save, onPreviewChange }: Props) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const shuffle = async () => {
    if (state === 'busy') return; // still saving the last mix
    clearTimeout(timer.current);
    setState('busy');
    try {
      await save(() => lyricVideoApi.setLook(project.projectId, { seed: nextSeed(project.look.seed || 1) }));
      onPreviewChange();
      setState('done');
      timer.current = setTimeout(() => setState('idle'), TICK_MS);
    } catch (e) {
      setState('idle');
      toast.error(messageOf(e));
    }
  };

  return (
    <div className="space-y-1">
      {/* Not `disabled` while saving: a disabled button drops keyboard focus to the page. */}
      <button type="button" className={`${secondaryBtnCls} aria-disabled:opacity-50`} onClick={() => void shuffle()} aria-disabled={state === 'busy' || undefined}>
        Shuffle effects
      </button>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-bf-cream">
        {state === 'busy' ? 'Shuffling…' : state === 'done' ? '✓ Shuffled' : ''}
      </p>
      <p className="text-xs text-content-secondary">Changes the effects on lines set to Auto. Your own choices stay.</p>
    </div>
  );
}
