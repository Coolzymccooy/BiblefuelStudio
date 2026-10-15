import { useState } from 'react';
import toast from 'react-hot-toast';
import { Clapperboard, Loader2, Square } from 'lucide-react';
import { storyApi } from '../../lib/storyApi';
import { isAnimatingScenes } from '../../lib/storyWizard';
import type { AnimateEstimate, AnimateQuality, StoryProject } from '../../lib/storyTypes';
import { panelCls, secondaryBtnCls } from './formStyles';

/** A batch above this asks before spending. */
export const CONFIRM_ABOVE_USD = 2;

const money = (usd: number) => `$${usd.toFixed(2)}`;

interface StoryAnimatePanelProps {
  project: StoryProject;
  estimate: AnimateEstimate;
  quality: AnimateQuality;
  onQualityChange: (q: AnimateQuality) => void;
  onChanged: () => void;
  /** A page-wide operation is running. */
  busy: boolean;
}

/** Animate every scene at once (BytePlus Seedance), with its price and the month's spend. */
export function StoryAnimatePanel({ project, estimate, quality, onQualityChange, onChanged, busy }: StoryAnimatePanelProps) {
  const [starting, setStarting] = useState(false);
  if (!estimate.configured) return null;
  const animating = isAnimatingScenes(project);
  const monthLabel = new Date(`${estimate.month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

  const start = async () => {
    if (estimate.usd > CONFIRM_ABOVE_USD
      && !window.confirm(`Animate ${estimate.clips} ${estimate.clips === 1 ? 'scene' : 'scenes'} for about ${money(estimate.usd)}? This is charged to your BytePlus balance.`)) return;
    setStarting(true);
    try {
      await storyApi.animate(project.projectId, quality);
      toast.success('Animating scenes. Each clip takes a few minutes.');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    try {
      await storyApi.cancelAnimation(project.projectId);
      toast('No more clips will be ordered. Clips already started will still arrive.');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const btnCls = `${secondaryBtnCls} px-3 py-1.5 text-sm disabled:opacity-50`;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${panelCls}`}>
      <select
        aria-label="AI motion quality"
        value={quality}
        onChange={(e) => onQualityChange(e.target.value as AnimateQuality)}
        disabled={animating || starting}
        className="rounded-md border border-[rgba(216,184,120,0.18)] bg-bf-input px-2 py-1.5 text-sm text-bf-cream focus:border-[rgba(216,184,120,0.4)] focus:outline-none"
      >
        <option value="standard">Standard · 720p</option>
        <option value="high">High · 1080p</option>
      </select>
      {animating ? (
        <button type="button" onClick={stop} className={btnCls}>
          <Square size={14} aria-hidden /> Stop ordering clips
        </button>
      ) : (
        <button type="button" onClick={start} disabled={busy || starting || estimate.clips === 0} className={btnCls}>
          {starting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Clapperboard size={14} aria-hidden />}
          {estimate.clips === 0
            ? 'Every scene is animated'
            : <>Animate {estimate.clips === 1 ? 'the 1 scene left' : `all ${estimate.clips} scenes`} · <span className="tabular-nums">≈ {money(estimate.usd)}</span></>}
        </button>
      )}
      <span className="text-help tabular-nums">
        {monthLabel}: {money(estimate.spentUsd + estimate.reservedUsd)} of {money(estimate.capUsd)} used
      </span>
    </div>
  );
}
