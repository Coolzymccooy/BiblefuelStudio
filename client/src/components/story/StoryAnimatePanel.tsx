import { useState } from 'react';
import toast from 'react-hot-toast';
import { Clapperboard, Loader2, Square } from 'lucide-react';
import { storyApi } from '../../lib/storyApi';
import { isAnimatingScenes } from '../../lib/storyWizard';
import type { AnimateEstimate, AnimateQuality, StoryProject } from '../../lib/storyTypes';
import { inputCls, panelCls, secondaryBtnCls } from './formStyles';

/** Spending more than this in one go asks first: a batch, or a single scene. */
export const CONFIRM_ABOVE_USD = 2;

const money = (usd: number) => `$${usd.toFixed(2)}`;

/**
 * One scene's clip: true to go ahead. Above CONFIRM_ABOVE_USD it asks first
 * (a High-quality 12 s scene is about $4.49); declining means no request.
 */
export function confirmSceneSpend(sceneNumber: number, usd: number): boolean {
  if (!(usd > CONFIRM_ABOVE_USD)) return true;
  return window.confirm(`Animate scene ${sceneNumber} for about ${money(usd)}? This is charged to your BytePlus balance.`);
}

interface StoryAnimatePanelProps {
  project: StoryProject;
  estimate: AnimateEstimate;
  quality: AnimateQuality;
  onQualityChange: (q: AnimateQuality) => void;
  onChanged: () => void;
  /** A page-wide operation is running. */
  busy: boolean;
  /** The estimate on screen is the last one while a new one loads, so its price may be stale. */
  refreshing?: boolean;
}

/** Animate every scene at once (BytePlus Seedance), with its price and the month's spend. */
export function StoryAnimatePanel({ project, estimate, quality, onQualityChange, onChanged, busy, refreshing = false }: StoryAnimatePanelProps) {
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
        className={`${inputCls.replace('mt-1.5', '').trim()} w-auto py-1.5 text-sm`}
      >
        <option value="standard">Standard · 720p</option>
        <option value="high">High · 1080p</option>
      </select>
      {animating ? (
        <button type="button" onClick={stop} className={btnCls}>
          <Square size={14} aria-hidden /> Stop ordering clips
        </button>
      ) : (
        <button type="button" onClick={start} disabled={busy || starting || refreshing || estimate.clips === 0} className={btnCls}>
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
