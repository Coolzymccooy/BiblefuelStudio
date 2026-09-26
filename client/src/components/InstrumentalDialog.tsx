import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import {
  startInstrumental, getInstrumental, cancelInstrumental, discardInstrumental,
  type InstrumentalJob, type InstrumentalQuality, type MusicTrack,
} from '../lib/musicLibraryApi';
import { primaryBtnCls, secondaryBtnCls } from './story/formStyles';

// Solid, not the page's translucent card: it opens over a busy track list,
// and the rows behind must not show through the words.
const dialogCls = 'space-y-3 rounded-2xl border border-[rgba(216,184,120,0.3)] bg-bf-bg p-5 shadow-2xl';

export interface InstrumentalDialogProps {
  track: MusicTrack;
  onClose: () => void;
  /** The server saved the instrumental to the library (fires once per job). */
  onSaved: (track: MusicTrack) => void;
  /** Put the instrumental in place of the original in the current video. */
  onUse?: (track: MusicTrack) => void;
  /** Poll interval; tests shorten it. */
  pollMs?: number;
}

/**
 * Remove the vocals from one library track: choose a quality, watch it run,
 * then listen to both versions. The server saves the instrumental to the
 * library as soon as it finishes (it carries the original's licence and
 * credit), so leaving the page cannot lose it; here it can be put into the
 * current video, or deleted.
 */
// A poll failure is tolerated for this many CONSECUTIVE misses (a blip in the
// connection, or the server briefly unavailable) before the dialog gives up
// and shows the error — a success in between resets the count.
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

/** What a running job is doing, in words; the live site's jobs run on the laptop. */
function progressLine(job: InstrumentalJob | null): string {
  const onLaptop = job?.where === 'laptop';
  if (job?.status === 'queued') {
    if (!onLaptop) return 'Waiting for another job to finish…';
    return job.laptopOnline
      ? 'Waiting for your laptop to pick this up…'
      : "Your laptop is offline — this runs when it's back on. You can close this; the instrumental will appear in your library.";
  }
  return `Removing vocals${onLaptop ? ' on your laptop' : ''}… ${job?.percent ?? 0}%`;
}

export function InstrumentalDialog({ track, onClose, onSaved, onUse, pollMs = 2000 }: InstrumentalDialogProps) {
  const [quality, setQuality] = useState<InstrumentalQuality>('best');
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<InstrumentalJob | null>(null);
  const [starting, setStarting] = useState(false);
  const announced = useRef<string | null>(null);
  const saved = job?.status === 'done' ? job.track : null;

  // Tell the host once, so its library list shows the new track right away.
  useEffect(() => {
    if (saved && announced.current !== saved.id) {
      announced.current = saved.id;
      onSaved(saved);
    }
  }, [saved, onSaved]);

  useEffect(() => {
    if (!jobId) return undefined;
    let stopped = false;
    let failures = 0;
    const tick = async () => {
      try {
        const next = await getInstrumental(jobId);
        if (stopped) return;
        failures = 0;
        setJob(next);
        if (next.status === 'queued' || next.status === 'running') setTimeout(tick, pollMs);
      } catch (e) {
        if (stopped) return;
        failures += 1;
        if (failures < MAX_CONSECUTIVE_POLL_FAILURES) {
          setTimeout(tick, pollMs);
          return;
        }
        // Exhausted our tolerance for transient failures. If the first poll
        // never landed, `job` is still null — without a synthesized error
        // job the dialog would show "Removing vocals… 0%" forever.
        const message = (e as Error).message || 'Failed to check vocal removal progress';
        setJob((j) => (j
          ? { ...j, status: 'error', error: message }
          : { jobId, status: 'error', percent: 0, error: message, sourceRef: '', sourcePreview: null, resultFile: null, track: null }));
      }
    };
    tick();
    return () => { stopped = true; };
  }, [jobId, pollMs]);

  const start = async () => {
    setStarting(true);
    try {
      setJob(null);
      setJobId(await startInstrumental(track.id, quality));
    } catch (e) {
      toast.error((e as Error).message || 'Failed to start vocal removal');
    } finally {
      setStarting(false);
    }
  };

  // Task 10 ruling: cancelInstrumental / discardInstrumental now THROW on
  // failure instead of resolving silently. We must not swallow that with a
  // bare `.catch(() => undefined)` — surface it as a toast — but the dialog
  // still closes either way, because the server sweeps any leftover job on
  // its own regardless of whether this request landed.
  const discard = async () => {
    try {
      if (jobId) await discardInstrumental(jobId);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to delete the instrumental');
    } finally {
      onClose();
    }
  };

  const cancel = async () => {
    try {
      if (jobId) await cancelInstrumental(jobId);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to cancel vocal removal');
    } finally {
      onClose();
    }
  };

  const running = job?.status === 'queued' || job?.status === 'running' || (jobId !== null && job === null);

  // Bundled tracks' sourcePreview is already their /music/... preview URL —
  // pass it through unchanged. api.mediaUrl() would otherwise treat a bare
  // name as an /outputs/<name> file and point it at something that doesn't
  // exist. Everything else (uploads, the result file) goes through mediaUrl.
  const originalSrc = job?.sourcePreview?.startsWith('/music/') ? job.sourcePreview : api.mediaUrl(job?.sourcePreview);

  return (
    <div role="dialog" aria-label={`Remove vocals from ${track.label}`} className={dialogCls}>
      <div className="font-displaySerif text-lg leading-snug text-bf-cream">Remove vocals — {track.label}</div>
      <p className="text-xs text-content-secondary">
        The instrumental is saved to your library as a new track and keeps the original's licence and credit. Removing vocals does not clear a song for YouTube.
      </p>

      {!jobId && (
        <>
          <div role="radiogroup" aria-label="Quality" className="flex gap-4 text-sm text-content-secondary">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="quality" checked={quality === 'best'} onChange={() => setQuality('best')} /> Best quality (about the song's length)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="quality" aria-label="Fast" checked={quality === 'fast'} onChange={() => setQuality('fast')} /> Fast (a little quicker)
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={start} disabled={starting} className={primaryBtnCls}>Remove vocals</button>
            <button type="button" onClick={onClose} className={secondaryBtnCls}>Close</button>
          </div>
        </>
      )}

      {running && (
        <div className="space-y-2">
          <div className="text-sm text-content-secondary">{progressLine(job)}</div>
          <div className="h-1.5 w-full rounded bg-white/10">
            <div className="h-1.5 rounded bg-primary-500" style={{ width: `${job?.percent ?? 0}%` }} />
          </div>
          <button type="button" onClick={cancel} className={secondaryBtnCls}>Cancel</button>
        </div>
      )}

      {job?.status === 'error' && (
        <div className="space-y-2 text-sm text-bf-danger">
          <div>{job.error}</div>
          <button type="button" onClick={onClose} className={secondaryBtnCls}>Close</button>
        </div>
      )}

      {job?.status === 'done' && job.resultFile && (
        <div className="space-y-2">
          {saved && (
            <div className="text-sm text-content-secondary">Saved to your library as "{saved.label}".</div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-content-secondary">
              Original
              <audio controls preload="none" aria-label="original preview" src={originalSrc} className="w-full" />
            </label>
            <label className="text-xs text-content-secondary">
              Instrumental
              <audio controls preload="none" aria-label="instrumental preview" src={api.mediaUrl(job.resultFile)} className="w-full" />
            </label>
          </div>
          <div className="flex gap-2">
            {saved && onUse && (
              <button type="button" onClick={() => onUse(saved)} className={primaryBtnCls}>Use in this video</button>
            )}
            <button type="button" onClick={onClose} className={secondaryBtnCls}>Done</button>
            <button type="button" onClick={discard} className={secondaryBtnCls}>Delete it</button>
          </div>
        </div>
      )}
    </div>
  );
}
