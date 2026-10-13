import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { flaggedCount, formatTime, isPlacedLine, nudgeLine } from '../../lib/lyricTiming';
import type { LyricProject, TimingStep as TimingPhase } from '../../lib/lyricVideoTypes';
import { panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';
import { LazyLivePreview } from './LazyLivePreview';
import { messageOf } from './messageOf';
import { playPreviewFrom } from './previewPlayer';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void }

const PHASE_TEXT: Record<TimingPhase, string> = {
  preparing: 'Getting your song ready…',
  listening: 'Listening to your song…',
  matching: 'Matching your lyrics to the song…',
  beats: 'Finding the beat…',
};

const smallBtnCls = `${secondaryBtnCls} !px-2.5 !py-1 text-xs`;

function RunningNotice({ project }: { project: LyricProject }) {
  const progress = project.timing.progress;
  const text = PHASE_TEXT[progress?.step ?? 'preparing'] ?? PHASE_TEXT.preparing;
  const part = progress?.step === 'listening' && progress.window ? ` (part ${progress.window})` : '';
  return (
    <div className={`${panelCls} flex items-center gap-2`} role="status">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      <span>{text}{part}</span>
    </div>
  );
}

/** Starts the timing run; used by the first run and by "Try again". */
function useTimingRun(project: LyricProject, onChange: (p: LyricProject) => void) {
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    try {
      onChange(await lyricVideoApi.align(project.projectId));
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setStarting(false);
    }
  };
  return { starting, start };
}

/** Step 3: check that each line comes in at the right moment, and nudge the ones that do not. */
export function TimingStep({ project, onChange }: Props) {
  const [assVersion, setAssVersion] = useState(1);
  const [saving, setSaving] = useState(false);
  // "Start here" needs a moment to start from, so it waits until the preview has reported one.
  const [hasTime, setHasTime] = useState(false);
  // Where the preview is playing. A ref, not state: it changes about four times a second and
  // only "Start here" reads it, so the line list must not redraw each time.
  const nowRef = useRef(0);
  const onTime = useCallback((t: number) => { nowRef.current = t; setHasTime(true); }, []);
  const previewBox = useRef<HTMLDivElement>(null);
  const run = useTimingRun(project, onChange);
  const { timing, lines } = project;
  const songEnd = project.song?.durationSec ?? Infinity;

  if (timing.status === 'running') return <RunningNotice project={project} />;
  if (timing.status === 'error') {
    return (
      <div className={`${panelCls} space-y-3`}>
        <p role="alert" className="text-bf-danger">{timing.error || 'Timing did not finish. Please try again.'}</p>
        <button type="button" className={secondaryBtnCls} disabled={run.starting} onClick={run.start}>Try again</button>
      </div>
    );
  }
  if (timing.status === 'idle') {
    return (
      <div className={`${panelCls} space-y-3`}>
        <p>Your lyrics have not been timed to the song yet.</p>
        <button type="button" className={primaryBtnCls} disabled={run.starting || lines.length === 0} onClick={run.start}>Time the lyrics</button>
      </div>
    );
  }

  const save = async (lineId: string, start: number) => {
    setSaving(true);
    try {
      onChange(await lyricVideoApi.patchLine(project.projectId, lineId, { start }));
      setAssVersion((v) => v + 1);
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const flagged = flaggedCount(lines);
  return (
    <div className="space-y-4">
      {timing.lastError && (
        <p role="status" className={`${panelCls} text-sm text-bf-gold`}>
          Timing again didn't work: {timing.lastError} Your earlier timing is kept.
        </p>
      )}
      <div ref={previewBox}>
        <LazyLivePreview project={project} assVersion={assVersion} onTime={onTime} />
      </div>
      <p className="text-sm">{flagged === 0 ? 'Every line is timed.' : `${flagged} line${flagged === 1 ? '' : 's'} to check`}</p>
      {flagged > lines.length / 2 && (
        <p className="text-sm text-bf-danger">Most lines could not be heard — check the lyrics match the song.</p>
      )}
      <ul className="space-y-1">
        {lines.map((l, i) => {
          const placed = isPlacedLine(l);
          return (
            <li
              key={l.id}
              className={`space-y-1 rounded-lg px-2 py-1.5 ${l.kind === 'response' ? 'pl-6 text-bf-gold' : ''}`}
            >
              <div className="flex items-start gap-2">
                <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-content-secondary">{placed ? formatTime(l.start) : '—'}</span>
                <span className="min-w-0 flex-1">{l.text}</span>
                {l.flag === 'check' && (
                  <span className="shrink-0 rounded bg-[rgba(245,211,58,0.15)] px-1.5 text-xs text-bf-gold">Check this line</span>
                )}
              </div>
              {placed ? (
                <span className="flex flex-wrap gap-1.5 pl-14">
                  <button type="button" className={smallBtnCls} disabled={saving} onClick={() => save(l.id, nudgeLine(lines, i, -0.1, songEnd))}>−0.1 s</button>
                  <button type="button" className={smallBtnCls} disabled={saving} onClick={() => save(l.id, nudgeLine(lines, i, 0.1, songEnd))}>+0.1 s</button>
                  <button type="button" className={smallBtnCls} disabled={saving || !hasTime} title={hasTime ? undefined : 'Play the song to the right spot first'} onClick={() => save(l.id, nudgeLine(lines, i, nowRef.current - l.start, songEnd))}>Start here</button>
                  <button type="button" className={smallBtnCls} onClick={() => playPreviewFrom(previewBox.current, l.start)}>Play from here</button>
                </span>
              ) : (
                <p className="pl-14 text-xs text-content-secondary">not timed yet</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
