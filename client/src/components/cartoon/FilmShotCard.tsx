/**
 * One shot on the Film step: its clip (or what is happening to it), its
 * state in words, and the flags the server raises after a clip arrives:
 * "Speech doesn't match" with what was heard, and "Out of date" when the
 * shot before it was re-made after this one started from its last frame.
 * A finished shot can be re-made for the price shown; the earlier clip is
 * never deleted. Re-make stays off, with a reason, while its price is unknown.
 * A re-make that made nothing keeps the earlier clip, and the card says so and
 * why. Nothing here is re-made automatically, because it costs money.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Check, Clock, Film, Loader2, RefreshCw } from 'lucide-react';
import type { CartoonShot } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';
import { clipStatusLabel, isInFlight, priceWords, secs } from './film';
import { money } from '../sceneScript/format';

interface Props {
  shot: CartoonShot;
  index: number;
  /** What re-making this shot costs; null when no price can be worked out. */
  remakeUsd: number | null;
  disabled: boolean;
  onRemake: (shotId: string) => void;
}

const chip = 'inline-flex items-center gap-1 rounded-full border border-editor-line px-2 py-0.5 text-xs';

function StatusChip({ shot, index }: { shot: CartoonShot; index: number }) {
  const status = shot.clip?.status;
  const label = clipStatusLabel(shot, index);
  if (status === 'done') return <span className={`${chip} text-bf-success`}><Check size={12} aria-hidden="true" />{label}</span>;
  if (status === 'error' || status === 'refused') return <span className={`${chip} text-bf-danger`}><AlertTriangle size={12} aria-hidden="true" />{label}</span>;
  if (isInFlight(shot.clip)) return <span className={`${chip} text-bf-cream`}><Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{label}</span>;
  if (status === 'waiting') return <span className={`${chip} text-bf-sub`}><Clock size={12} aria-hidden="true" />{label}</span>;
  return <span className={`${chip} text-bf-muted`}>{label}</span>;
}

function Flag({ children }: { children: ReactNode }) {
  return <span className={`${chip} text-bf-warn`}><AlertTriangle size={12} aria-hidden="true" />{children}</span>;
}

/** The picture area: the clip once it is done, otherwise a quiet line on where it stands. */
function Preview({ shot, n }: { shot: CartoonShot; n: number }) {
  const clip = shot.clip;
  if (clip?.status === 'done' && clip.url) {
    return (
      <video
        src={clip.url}
        poster={clip.posterUrl || undefined}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
        aria-label={`Clip for shot ${n}`}
      />
    );
  }
  const placeholder = (() => {
    switch (clip?.status) {
      case 'queued': return { icon: <Loader2 size={22} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />, text: 'Waiting to be ordered' };
      case 'generating': return { icon: <Loader2 size={22} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />, text: 'BytePlus is making this clip' };
      case 'waiting': return { icon: <Clock size={22} aria-hidden="true" />, text: `Starts once shot ${n - 1} is done` };
      case 'error':
      case 'refused': return { icon: <AlertTriangle size={22} aria-hidden="true" />, text: 'No clip' };
      default: return { icon: <Film size={22} aria-hidden="true" />, text: 'No clip yet' };
    }
  })();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-bf-muted">
      {placeholder.icon}
      <span className="text-xs">{placeholder.text}</span>
    </div>
  );
}

export function FilmShotCard({ shot, index, remakeUsd, disabled, onRemake }: Props) {
  const n = index + 1;
  const clip = shot.clip;
  const done = clip?.status === 'done';
  const failed = clip?.status === 'error' || clip?.status === 'refused';
  const mismatch = done && clip?.speech?.ok === false;
  const unchecked = done && Boolean(shot.line) && clip?.speech?.ok === null;
  const remakeName = remakeUsd === null ? `Re-make shot ${n}` : `Re-make shot ${n}, ${priceWords(remakeUsd)}`;
  const noPriceId = `film-${shot.id}-no-price`;

  return (
    <li aria-label={`Shot ${n}`} className="flex flex-col overflow-hidden rounded-card border border-editor-line bg-bf-card">
      <div className="aspect-[9/16] max-h-80 bg-editor-stage">
        <Preview shot={shot} n={n} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums text-bf-cream">Shot {n}</span>
          <StatusChip shot={shot} index={index} />
        </div>
        {shot.speaker && shot.line ? (
          <p className="text-sm text-bf-sub"><span className="font-medium text-bf-cream">{shot.speaker}:</span> “{shot.line}”</p>
        ) : (
          <p className="text-sm text-bf-sub">No one speaks</p>
        )}
        {(mismatch || clip?.stale) && (
          <div className="flex flex-wrap gap-2">
            {mismatch && <Flag>Speech doesn't match</Flag>}
            {clip?.stale && <Flag>Out of date: starts from the old frame</Flag>}
          </div>
        )}
        {mismatch && clip?.speech?.heard && <p className="text-help">Heard: “{clip.speech.heard}”</p>}
        {unchecked && <p className="text-help">The speech could not be checked.</p>}
        {failed && clip?.error && <p className="text-xs text-bf-danger">{clip.error}</p>}
        {done && clip?.remakeError && (
          <p role="status" className="flex items-start gap-1.5 text-xs text-bf-warn">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>The re-make didn't work; kept the earlier clip. {clip.remakeError}</span>
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs tabular-nums text-bf-muted">
            {secs(shot.seconds)} s{done && typeof clip?.costUsd === 'number' ? ` · ${money(clip.costUsd)} paid` : ''}
          </span>
          {done && (
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 text-xs"
              disabled={disabled || remakeUsd === null}
              onClick={() => onRemake(shot.id)}
              aria-label={remakeName}
              aria-describedby={remakeUsd === null ? noPriceId : undefined}
            >
              <RefreshCw size={14} aria-hidden="true" /> Re-make
              {remakeUsd !== null && <span className="tabular-nums text-bf-sub">{priceWords(remakeUsd)}</span>}
            </Button>
          )}
        </div>
        {done && remakeUsd === null && <p id={noPriceId} className="text-help">The price of a re-make can't be worked out yet.</p>}
      </div>
    </li>
  );
}
