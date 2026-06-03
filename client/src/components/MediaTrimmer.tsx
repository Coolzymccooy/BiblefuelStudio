import { useEffect, useRef, useState } from 'react';
import { X, Scissors, Play, Pause, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { api } from '../lib/api';
import { pxToTime, timeToPct, enforceHandles, type Selection } from '../lib/trimMath';
import toast from 'react-hot-toast';

const MIN_GAP = 0.5; // seconds — smallest allowed selection

interface MediaTrimmerProps {
  /** Absolute server path of the uploaded file (e.g. .../outputs/user-audio-x.mp3). */
  serverPath: string;
  kind: 'audio' | 'video';
  onApply: (newServerPath: string, newDurationSec: number) => void;
  onCancel: () => void;
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MediaTrimmer({ serverPath, kind, onApply, onCancel }: MediaTrimmerProps) {
  const basename = serverPath.split(/[\\/]/).pop() || '';
  const previewUrl = api.mediaUrl(basename);
  const token = api.getToken();
  const waveformUrl = `${api.baseUrl}/api/audio-adv/waveform.png?inputPath=${encodeURIComponent(serverPath)}&w=1200&h=240${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  const [duration, setDuration] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  const [applying, setApplying] = useState(false);
  const [playing, setPlaying] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<(HTMLVideoElement & HTMLAudioElement) | null>(null);
  const draggingRef = useRef<null | 'start' | 'end'>(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/audio-adv/info?inputPath=${encodeURIComponent(serverPath)}`).then((res) => {
      if (cancelled) return;
      const d = Number(res.data?.durationSec);
      if (res.ok && Number.isFinite(d) && d > 0) {
        setDuration(d);
        setSel({ start: 0, end: d });
      }
    });
    return () => { cancelled = true; };
  }, [serverPath]);

  const onLoadedMetadata = () => {
    const d = mediaRef.current?.duration;
    if (duration == null && Number.isFinite(d) && (d as number) > 0) {
      setDuration(d as number);
      setSel({ start: 0, end: d as number });
    }
  };

  const startDrag = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = which;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const which = draggingRef.current;
      const track = trackRef.current;
      if (!which || !track || duration == null) return;
      const rect = track.getBoundingClientRect();
      const t = pxToTime(e.clientX - rect.left, rect.width, duration);
      setSel((cur) => {
        const next = enforceHandles(which, t, cur, duration, MIN_GAP);
        if (mediaRef.current) mediaRef.current.currentTime = which === 'start' ? next.start : next.end;
        return next;
      });
    };

    const endDrag = () => { draggingRef.current = null; };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
    };
  }, [duration]);

  const playSelection = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    el.currentTime = sel.start;
    void el.play();
    setPlaying(true);
  };
  const onTimeUpdate = () => {
    const el = mediaRef.current;
    if (el && playing && el.currentTime >= sel.end) { el.pause(); setPlaying(false); }
  };

  const applyTrim = async () => {
    if (duration == null) return;
    setApplying(true);
    const res = await api.post('/api/media/trim', {
      inputPath: serverPath,
      startSec: sel.start,
      endSec: sel.end,
    });
    setApplying(false);
    if (res.ok && res.data?.file) {
      toast.success(`Trimmed to ${fmt(Number(res.data.durationSec) || (sel.end - sel.start))}`, { id: 'trim-ok' });
      onApply(res.data.file as string, Number(res.data.durationSec) || (sel.end - sel.start));
    } else {
      toast.error(res.error || 'Trim failed — original kept', { id: 'trim-err' });
    }
  };

  const selDur = Math.max(0, sel.end - sel.start);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-2xl max-h-[88dvh] flex flex-col rounded-xl bg-dark-900/95 backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={18} className="text-primary-300" />
            <h3 className="font-bold text-lg text-white">Trim clip</h3>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-white p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {kind === 'video' ? (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={previewUrl}
              playsInline
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              className="w-full max-h-[40vh] rounded-lg bg-black"
            />
          ) : (
            <>
              <img
                src={waveformUrl}
                alt="Audio waveform"
                className="w-full h-28 object-cover rounded-lg bg-black/40"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
              />
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={previewUrl}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                className="hidden"
              />
            </>
          )}

          <div
            ref={trackRef}
            className="relative h-12 rounded-lg bg-white/5 border border-white/10 select-none touch-none"
          >
            {duration != null && (
              <>
                <div
                  className="absolute inset-y-0 bg-primary-500/25 border-x-2 border-primary-400"
                  style={{ left: `${timeToPct(sel.start, duration)}%`, right: `${100 - timeToPct(sel.end, duration)}%` }}
                />
                <div
                  role="slider"
                  aria-label="Trim start"
                  aria-valuenow={sel.start}
                  onPointerDown={startDrag('start')}
                  className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex items-center justify-center"
                  style={{ left: `${timeToPct(sel.start, duration)}%` }}
                >
                  <span className="h-8 w-1.5 rounded-full bg-primary-300 shadow" />
                </div>
                <div
                  role="slider"
                  aria-label="Trim end"
                  aria-valuenow={sel.end}
                  onPointerDown={startDrag('end')}
                  className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex items-center justify-center"
                  style={{ left: `${timeToPct(sel.end, duration)}%` }}
                >
                  <span className="h-8 w-1.5 rounded-full bg-primary-300 shadow" />
                </div>
              </>
            )}
          </div>

          <p className="text-[11px] text-gray-500 text-center">
            Drag the handles to choose the part you want to keep, then Apply trim.
          </p>

          <div className="flex items-center justify-between text-xs text-gray-300 tabular-nums">
            <span>In <span className="text-white font-semibold">{fmt(sel.start)}</span></span>
            <span>Selected <span className="text-primary-300 font-semibold">{fmt(selDur)}</span></span>
            <span>Out <span className="text-white font-semibold">{fmt(sel.end)}</span></span>
          </div>

          <Button variant="secondary" onClick={playSelection} className="h-9 text-xs" disabled={duration == null}>
            {playing ? <Pause size={14} className="mr-1.5" /> : <Play size={14} className="mr-1.5" />}
            {playing ? 'Stop' : 'Play selection'}
          </Button>
        </div>

        <div className="flex items-center justify-end gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/30 shrink-0">
          <Button variant="secondary" onClick={onCancel} className="h-9 text-xs" disabled={applying}>Cancel</Button>
          <Button onClick={applyTrim} className="h-9 text-xs" disabled={applying || duration == null}>
            {applying ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Scissors size={14} className="mr-1.5" />}
            {applying ? 'Trimming…' : 'Apply trim'}
          </Button>
        </div>
      </div>
    </div>
  );
}
