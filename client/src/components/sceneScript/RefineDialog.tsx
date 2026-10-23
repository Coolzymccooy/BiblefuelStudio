import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { checkboxCls, segmentCls, segmentedCls } from '../story/formStyles';
import type { GradeName, SceneScriptProject, SceneScriptShot, ShotRefine } from '../../lib/sceneScriptTypes';
import { GRADE_LABELS, RATES, UNREFINED, isUnrefined, playbackFor, previewLoop, previewStyle } from './refine';

interface Props {
  shot: SceneScriptShot;
  /** The project's frame: the preview crops the clip the way the render will. */
  aspect: SceneScriptProject['meta']['aspect'];
  busy: boolean;
  /** null resets the shot to the clip as made. Resolves false when saving failed, which keeps the dialog open. */
  onSave: (refine: ShotRefine | null) => Promise<boolean | void>;
  onClose: () => void;
}

const MIN_PLAY_SEC = 0.5;
const END_SNAP_SEC = 0.1;
const secs = (v: number) => `${v.toFixed(1)} s`;

// Each frame has a fixed height: in the scrolling grid a box sized only by its
// aspect ratio shrinks to nothing and spills over the controls.
const FRAME_CLS: Record<Props['aspect'], string> = {
  portrait: 'aspect-[9/16] h-[45dvh] md:h-[min(32rem,70dvh)]',
  square: 'aspect-square h-[min(40dvh,calc(100vw_-_3rem))] md:h-[min(24rem,60dvh)]',
  landscape: 'aspect-video h-[min(30dvh,calc((100vw_-_3rem)*9/16))] md:h-[min(20rem,45dvh)]',
};
const rateLabel = (r: number | null) => (r === null ? 'Fit the shot' : `${r}×`);
const round2 = (v: number) => Math.round(v * 100) / 100;

function Slider({ id, label, value, min, max, step, shown, disabled, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step: number; shown: string; disabled?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="field-label !mb-0">{label}</label>
        <span className="text-xs tabular-nums text-bf-sub">{shown}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-bf-gold disabled:opacity-50" />
    </div>
  );
}

/** Refine a shot's clip for free: the part that plays, speed, mirror, framing and grade. The clip file is not changed. */
export function RefineDialog({ shot, aspect, busy, onSave, onClose }: Props) {
  const clipDur = shot.clip?.durationSec || 0;
  const saved = shot.refine || UNREFINED;
  const [r, setR] = useState<ShotRefine>(saved);
  const [saving, setSaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const out = r.out ?? clipDur;
  const place = shot.playback?.placeSec || 0;
  const plays = useMemo(() => (place ? playbackFor(r, clipDur, place) : null), [r, clipDur, place]);
  const loop = useMemo(() => previewLoop(r, clipDur, place), [r, clipDur, place]);
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = JSON.stringify(r) !== JSON.stringify(saved);
  const set = (patch: Partial<ShotRefine>) => setR((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (video.current && plays) video.current.playbackRate = plays.rate;
  }, [plays]);

  const seek = (t: number) => { if (video.current) video.current.currentTime = t; };
  const setIn = (v: number) => { const at = round2(Math.min(v, out - MIN_PLAY_SEC)); set({ in: Math.max(0, at) }); seek(Math.max(0, at)); };
  const setOut = (v: number) => {
    const at = round2(Math.max(v, r.in + MIN_PLAY_SEC));
    // The slider snaps to its step, so its far end can sit just short of the clip's length.
    set({ out: at >= clipDur - END_SNAP_SEC ? null : at });
    seek(Math.max(r.in, at - 0.3));
  };
  // Loop what the shot shows in the video: from the in point to where the render
  // cuts away, then the held last frame if the clip runs short.
  const restart = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = loop.from;
    void v.play().catch(() => {});
  };
  const atEnd = () => {
    const v = video.current;
    if (!v || holding.current) return;
    if (loop.hold <= 0) { restart(); return; }
    v.pause();
    holding.current = setTimeout(() => { holding.current = null; restart(); }, loop.hold * 1000);
  };
  const onTime = () => {
    const v = video.current;
    if (!v || holding.current) return;
    if (v.currentTime < loop.from - 0.05) restart();
    else if (v.currentTime >= loop.end - 0.05) atEnd();
  };
  // An edit changes the loop: drop a pending hold and play the new one from its start.
  useEffect(() => () => {
    if (holding.current) { clearTimeout(holding.current); holding.current = null; }
  }, [loop]);

  const save = async () => {
    setSaving(true);
    try {
      const ok = await onSave(isUnrefined(r) ? null : r);
      if (ok !== false) onClose();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={`Refine shot ${shot.id}`} className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-editor-line bg-bf-card">
        <div className="flex items-center justify-between gap-3 border-b border-editor-line p-4">
          <div>
            <h2 className="text-base font-semibold text-bf-cream">Refine shot {shot.id}</h2>
            <p className="text-help">Free. Only this video changes; the clip in your library stays as it is.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-bf-sub hover:bg-editor-hover hover:text-bf-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className={`grid gap-4 overflow-y-auto p-4 ${aspect === 'landscape' ? '' : 'md:grid-cols-[auto_1fr]'}`}>
          <div data-testid="refine-frame" className={`mx-auto overflow-hidden rounded-lg bg-editor-stage ${FRAME_CLS[aspect] || FRAME_CLS.portrait}`}>
            {shot.clip?.url && (
              <video ref={video} src={shot.clip.url} poster={shot.clip.posterUrl || undefined} muted autoPlay playsInline
                onLoadedMetadata={() => seek(r.in)} onTimeUpdate={onTime} onEnded={atEnd}
                className="h-full w-full object-cover" style={previewStyle(r)} aria-label={`Preview of shot ${shot.id}`} />
            )}
          </div>
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Slider id="refine-in" label="Starts at" value={r.in} min={0} max={clipDur} step={0.1} shown={secs(r.in)} onChange={setIn} />
              <Slider id="refine-out" label="Ends at" value={out} min={0} max={clipDur} step={0.1} shown={secs(out)} onChange={setOut} />
            </div>
            <div>
              <label htmlFor="refine-rate" className="field-label">Speed</label>
              <Select id="refine-rate" value={r.rate === null ? '' : String(r.rate)} onChange={(e) => set({ rate: e.target.value === '' ? null : Number(e.target.value) })}>
                {RATES.map((v) => <option key={String(v)} value={v === null ? '' : String(v)}>{rateLabel(v)}</option>)}
              </Select>
              {plays && (
                <p className="field-help tabular-nums">
                  On screen for {secs(place)}. Uses {secs(plays.clipSec)} of clip at {round2(plays.rate)}×
                  {plays.hold > 0 ? `, then holds its last frame for ${secs(plays.hold)}.` : '.'}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-bf-cream">
              <input type="checkbox" checked={r.flip} onChange={(e) => set({ flip: e.target.checked })} className={checkboxCls} />
              Mirror left to right
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <Slider id="refine-zoom" label="Zoom" value={r.zoom} min={1} max={2} step={0.05} shown={`${r.zoom.toFixed(2)}×`}
                onChange={(v) => set(v === 1 ? { zoom: 1, x: 0, y: 0 } : { zoom: round2(v) })} />
              <Slider id="refine-x" label="Left or right" value={r.x} min={-1} max={1} step={0.05} shown={r.x.toFixed(2)} disabled={r.zoom === 1} onChange={(v) => set({ x: round2(v) })} />
              <Slider id="refine-y" label="Up or down" value={r.y} min={-1} max={1} step={0.05} shown={r.y.toFixed(2)} disabled={r.zoom === 1} onChange={(v) => set({ y: round2(v) })} />
            </div>
            {r.zoom === 1 && <p className="field-help -mt-2">Zoom in to move the frame.</p>}
            <div>
              <div className="field-label">Grade</div>
              <div className={`${segmentedCls} flex-wrap`} role="group" aria-label="Grade">
                {(Object.keys(GRADE_LABELS) as GradeName[]).map((g) => (
                  <button key={g} type="button" aria-pressed={r.grade === g} onClick={() => set({ grade: g })} className={segmentCls(r.grade === g)}>
                    {GRADE_LABELS[g]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-editor-line p-4">
          <Button variant="ghost" className="mr-auto" disabled={isUnrefined(r)} onClick={() => setR(UNREFINED)}>Reset</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!dirty || busy || saving} onClick={() => { void save(); }}>Save</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
