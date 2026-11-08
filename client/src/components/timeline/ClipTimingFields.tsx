import { useState } from 'react';
import type { TimelineClip, TimelineTrack } from '../../lib/timelineProject';
import { clipTimingUnavailableReason } from '../../lib/timelineClipEditing';

/** Drafts commit together: clearing a touch keyboard field never changes media. */
export function ClipTimingFields({ track, clip, disabled, onApply }: {
  track: TimelineTrack; clip: TimelineClip; disabled: boolean;
  onApply: (timing: { startSec: number; sourceStartSec: number; durationSec: number }) => boolean;
}) {
  const [start, setStart] = useState(String(clip.startSec));
  const [source, setSource] = useState(String(clip.sourceStartSec || 0));
  const [duration, setDuration] = useState(String(clip.durationSec));
  const [error, setError] = useState('');
  const reason = clipTimingUnavailableReason(track, clip) || (disabled ? 'Timing is read-only in this view.' : undefined);
  return <form className="flex flex-wrap items-end gap-2 border-b border-editor-line bg-editor-panel px-3 py-2 text-xs" onSubmit={(event) => {
    event.preventDefault();
    if (reason) return;
    if (![start, source, duration].every((v) => v.trim() !== '') || !onApply({ startSec: Number(start), sourceStartSec: Number(source), durationSec: Number(duration) })) {
      setError('Use a positive duration within the project and source media.');
    } else setError('');
  }}>
    <fieldset disabled={Boolean(reason)} className="contents">
      {([['Start (s)', start, setStart], ['Source in (s)', source, setSource], ['Duration (s)', duration, setDuration]] as const).map(([label, value, change]) =>
        <label key={label} className="min-w-0 flex-1 basis-20 text-editor-dim">{label}
          <input aria-label={label} type="number" inputMode="decimal" min={label === 'Duration (s)' ? 0.05 : 0} step="any" required value={value} onChange={(e) => { change(e.target.value); setError(''); }} className="mt-1 h-11 w-full min-w-0 rounded border border-editor-line bg-editor-chrome px-2 text-base tabular-nums text-editor-text disabled:opacity-50" />
        </label>)}
      <button type="submit" className="h-11 rounded-lg border border-editor-line px-3 font-semibold text-editor-text disabled:opacity-40">Apply timing</button>
    </fieldset>
    {reason && <p className="w-full text-editor-faint">{reason}</p>}
    {error && <p role="alert" className="w-full text-editor-text">{error}</p>}
  </form>;
}
