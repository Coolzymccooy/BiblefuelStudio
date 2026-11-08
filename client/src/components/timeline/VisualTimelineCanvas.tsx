import { useMemo, useState, useEffect } from 'react';
import { useTimelineScale } from '../../lib/useTimelineScale';
import { clampZoom, MIN_ZOOM, MAX_ZOOM } from '../../lib/timelineScale';
import { loadZoom, saveZoom, nextZoomIn, nextZoomOut, scrollLeftPreservingAnchor } from '../../lib/timelineZoom';
import { timelineAssetThumbPath } from '../../lib/timelineThumb';
import { setTrackFlag } from '../../lib/hiddenLanes';
import { ClipWaveform } from './ClipWaveform';
import { ClipTimingFields } from './ClipTimingFields';
import { LaneActionsMenu } from './LaneActionsMenu';
import { editClipTiming } from '../../lib/timelineClipEditing';
import { Eye, EyeOff, Film, Lock, Mic2, Minus, Music, Plus, Scissors, Sparkles, Subtitles, Trash2, Unlock, Wand2, Eraser, Timer, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import type { TimelineAsset, TimelineClip, TimelineProject, TimelineTrack, TimelineTrackKind } from '../../lib/timelineProject';
import { getTimelineAssetPreviewPath } from '../../lib/timelineProject';

export interface VeoBrollRequest {
  prompt: string;
  aspect: TimelineProject['aspect'];
  durationSec: number;
  targetTrackKind: 'broll';
  startSec: number;
}

interface VisualTimelineCanvasProps {
  timeSec?: number;
  onTimeChange?: (sec: number) => void;
  project: TimelineProject;
  onProjectChange?: (project: TimelineProject) => void;
  onRequestVeoBroll?: (request: VeoBrollRequest) => void;
  /**
   * Scene selection is owned by the PAGE, not by this canvas: the Scenes panel
   * in the rail and the scene blocks here are separate components that must
   * agree on which scene is active. Scene blocks were previously draggable but
   * had no click handler at all, so scenes could not be selected anywhere.
   */
  selectedSceneId?: string | null;
  onSelectScene?: (sceneId: string) => void;
  /**
   * Compact mode for the editor shell's bottom strip.
   *
   * The full layout spends ~180px on chrome before the first lane renders: a
   * Card title, a project-meta block, a settings badge, and a "Selected clip"
   * panel that is mostly instruction text. In a page that scrolls, that is
   * fine. In a fixed-height strip it means the operator scrolls to see lanes
   * that should all be visible at once.
   *
   * Compact keeps every control but folds them into a single toolbar row, so
   * the lanes get the height instead.
   */
  compact?: boolean;
  /** Clicking an empty lane opens the tool that fills it. */
  onEmptyLaneClick?: (kind: TimelineTrackKind) => void;
  /** Clear one lane. Captions and music clear at their SOURCE on the page, or the sync would put them back. */
  onClearLane?: (kind: TimelineTrackKind) => void;
  /** Start fresh: every lane, the source media and the backgrounds. */
  onWipeAll?: () => void;
}

/**
 * Per-lane clip tints from the approved palette. Green was never semantic
 * here; the de-green pass left clips as faint outlines, and the operator
 * asked for "muscle". Hue tells you the lane at a glance, fill gives the
 * block weight, and gold stays reserved for the SELECTED clip.
 */
// LANE FAMILIES — a system, not five loose hues.
//
// Each lane carries a fill, a border and an ink that move together, defined
// per theme in index.css (pale fill + saturated ink on light; deep muted fill
// + light ink on dark and calm). Every pair is measured at >= 4.5:1 against
// its own fill in BOTH directions, so a clip label is legible whichever
// theme is on.
//
// Real footage and Music bed deliberately share the blue family: both are
// the spine of the cut, so the eye groups them.
//
// Gold is still not here. It remains SELECTION only.
const CLIP_TONE: Record<TimelineTrackKind, string> = {
  video: 'lane lane-video',
  broll: 'lane lane-broll',
  voiceover: 'lane lane-vo',
  music: 'lane lane-music',
  captions: 'lane lane-caption',
  effects: 'lane lane-fx',
};

/**
 * Scene-header families, cycled by scene index. Scenes have no inherent kind,
 * but giving each a stable colour from the SAME six families makes the ruler
 * read as part of the timeline rather than a separate grey strip — and it is
 * deterministic, so a scene keeps its colour between renders.
 */
const SCENE_FAMILY = ['lane-video', 'lane-caption', 'lane-vo', 'lane-broll', 'lane-music', 'lane-fx'] as const;

/** Icon chip tint per lane — the small square before each clip label. */
const LANE_CHIP: Record<TimelineTrackKind, string> = {
  video: 'chip chip-video',
  broll: 'chip chip-broll',
  voiceover: 'chip chip-vo',
  music: 'chip chip-music',
  captions: 'chip chip-caption',
  effects: 'chip chip-fx',
};

const TRACK_ICON: Record<TimelineTrackKind, typeof Film> = {
  video: Film,
  broll: Sparkles,
  voiceover: Mic2,
  music: Music,
  captions: Subtitles,
  effects: Wand2,
};

// Short clips still need to be clickable, so they get a minimum width - but
// only up to the room actually available before the next clip starts.
const MIN_CLIP_WIDTH_PCT = 5;

// Below this width a clip cannot hold its Mute + delete controls without them
// overflowing the block. Selecting the clip reveals them regardless.
const CONTROLS_MIN_WIDTH_PCT = 4;

// A waveform needs room of its own BESIDE the label. Splitting a narrow clip
// between the two leaves neither usable — a 77px voice-over clip truncated its
// name to a single character and gave the trace 0px. Under this width the
// label keeps the whole block and the waveform is dropped, which is the same
// bargain the controls above already make.
const WAVEFORM_MIN_WIDTH_PCT = 12;

// Each empty lane says WHERE its content comes from, and clicking it opens
// that tool - the lane itself is the way in.
const EMPTY_HINT: Record<TimelineTrackKind, string> = {
  video: 'No footage yet — Media tool: Insert source media, or Story / Series output',
  broll: 'No B-roll yet — Background tool, or Output → Send backgrounds to B-roll',
  voiceover: 'No voice-over yet — Voice tool: Generate, then Land on VO lane',
  music: 'No music bed yet — Music tool',
  captions: 'No captions yet — Script tool: Captions, or Captions tool',
  effects: 'No effects yet — Scenes tool: pick a scene, then add a transition, grade, glow or light leak',
};

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function sourceLabel(asset?: TimelineAsset): string {
  if (!asset) return 'Asset';
  if (asset.source === 'veo') return 'Veo';
  if (asset.source === 'chatterbox') return 'Chatterbox';
  if (asset.source === 'fish') return 'Fish';
  if (asset.source === 'imagegen') return 'Image AI';
  if (asset.source === 'library') return 'Library';
  return asset.source;
}

function proxyLabel(asset?: TimelineAsset): string | null {
  if (!asset?.proxyPath) return null;
  if (asset.proxyStatus === 'ready') return 'Proxy ready';
  if (asset.proxyStatus === 'failed') return 'Proxy failed';
  return 'Proxy pending';
}

function previewModeLabel(asset?: TimelineAsset): string {
  if (!asset?.proxyPath) return 'preview: original';
  return getTimelineAssetPreviewPath(asset) === asset.proxyPath ? 'preview: proxy' : 'preview: original';
}

function findClip(project: TimelineProject, clipId: string | null): { track: TimelineTrack; clip: TimelineClip; asset?: TimelineAsset } | null {
  if (!clipId) return null;
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip, asset: project.assets[clip.assetId] };
  }
  return null;
}

function withUpdatedTrack(project: TimelineProject, trackId: string, clips: TimelineClip[]): TimelineProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => (
      track.id === trackId
        ? { ...track, clips: [...clips].sort((a, b) => a.startSec - b.startSec) }
        : track
    )),
    updatedAt: new Date().toISOString(),
  };
}

function splitClip(project: TimelineProject, track: TimelineTrack, clip: TimelineClip): TimelineProject {
  if (clip.durationSec < 1) return project;
  const firstDuration = clip.durationSec / 2;
  const secondDuration = clip.durationSec - firstDuration;
  const first: TimelineClip = { ...clip, durationSec: firstDuration };
  const second: TimelineClip = {
    ...clip,
    id: `${clip.id}-split-${Math.random().toString(36).slice(2, 6)}`,
    startSec: clip.startSec + firstDuration,
    durationSec: secondDuration,
    sourceStartSec: (clip.sourceStartSec || 0) + firstDuration,
  };
  return withUpdatedTrack(project, track.id, track.clips.flatMap((candidate) => (
    candidate.id === clip.id ? [first, second] : [candidate]
  )));
}

function removeClip(project: TimelineProject, track: TimelineTrack, clip: TimelineClip): TimelineProject {
  return withUpdatedTrack(project, track.id, track.clips.filter((candidate) => candidate.id !== clip.id));
}

function buildVeoPrompt(project: TimelineProject): VeoBrollRequest {
  const scene = project.scenes[0];
  return {
    prompt: `Cinematic worship documentary B-roll for ${scene?.label || 'opening arrival'}: warm golden church light rays, reverent atmosphere, no fake identifiable people, suitable as an 8 second transition cutaway.`,
    aspect: project.aspect,
    durationSec: 8,
    targetTrackKind: 'broll',
    startSec: scene?.startSec || 0,
  };
}

export function VisualTimelineCanvas({ project, onProjectChange, onRequestVeoBroll, compact = false, selectedSceneId = null, onSelectScene, onEmptyLaneClick, onClearLane, onWipeAll, timeSec = 0, onTimeChange }: VisualTimelineCanvasProps) {
  const [phone, setPhone] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const target = Math.max(1, project.targetDurationSec);
  // F1: the timecode axis. Zoom is fixed at 1 here — F2 makes it a control.
  // Everything that turns seconds into pixels goes through this one scale, so
  // the ruler cannot drift from the clips the way it did on the 390px phone.
  // F2 — zoom. A multiplier on the SAME scale the ruler uses, remembered per
  // project. Loaded lazily so a remount does not reset the operator's view.
  const [zoom, setZoom] = useState<number>(() => loadZoom(project.id));
  useEffect(() => { setZoom(loadZoom(project.id)); }, [project.id]);
  const { ref: scaleRef, scale } = useTimelineScale({ durationSec: target, zoom });

  // The element that actually scrolls. Zoom has to adjust its scrollLeft in
  // the same frame the scale changes, or the view jumps.
  // scaleRef and scrollRef are the SAME element: the scrolling viewport.
  //
  // This must never be an element whose width the scale then sets. Attaching
  // it to the ruler created a feedback loop - measure, widen from the
  // measurement, measure the wider thing - and contentWidth reached 67 MILLION
  // pixels after one click of +. The viewport is the only stable reference:
  // "fits" is defined against it, and it does not grow with its content.
  const scrollRef = scaleRef;

  const applyZoom = (next: number) => {
    const clamped = clampZoom(next);
    if (clamped === zoom) return;

    // Keep the moment under the viewport's left edge where it is. Scaling the
    // scroll origin instead makes the timeline feel like it jumps away.
    const el = scrollRef.current;
    const anchorSec = el && scale.pxPerSecond > 0 ? el.scrollLeft / scale.pxPerSecond : 0;

    setZoom(clamped);
    saveZoom(project.id, clamped);

    if (el) {
      const nextPxPerSecond = scale.pxPerSecond * (clamped / zoom);
      // After React has laid out the wider content, or the assignment is
      // clamped against the OLD scrollWidth and silently lost.
      requestAnimationFrame(() => {
        el.scrollLeft = scrollLeftPreservingAnchor({ anchorSec, anchorOffsetPx: 0, nextPxPerSecond });
      });
    }
  };
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const [openLaneId, setOpenLaneId] = useState<string | null>(null);
  const [brollRowProjectId, setBrollRowProjectId] = useState<string | null>(null);
  useEffect(() => { setSelectedClipId(null); setTimingOpen(false); }, [project.id]);
  const selection = useMemo(() => findClip(project, selectedClipId), [project, selectedClipId]);

  // F3 — a locked lane is inspectable but not editable. Gating the HANDLERS
  // rather than each button means every present and future caller is covered
  // by one rule; the buttons below disable themselves off the same flag so
  // the state is visible, not just enforced.
  const selectionLocked = selection?.track.locked === true || selection?.track.hidden === true;

  const handleSplit = () => {
    if (!selection || !onProjectChange || selectionLocked) return;
    onProjectChange(splitClip(project, selection.track, selection.clip));
  };

  const handleRemove = () => {
    if (!selection || !onProjectChange || selectionLocked) return;
    onProjectChange(removeClip(project, selection.track, selection.clip));
    setSelectedClipId(null);
  };


  // Compact halves the vertical budget per lane without shrinking the text.
  //
  // Full lane: min-h-14 (56px) + p-2 (16px) + space-y-2 gap (8px) = 80px each.
  // Six lanes plus an 80px scene ruler is ~560px — nearly double the 340px
  // strip, so the operator scrolls to see lanes that should all be visible.
  //
  // Compact: min-h-9 (36px) + p-1 (8px) + gap-1 (4px) = 48px each, and a 48px
  // ruler. Six lanes then fit in ~336px. Font sizes are UNCHANGED: the boxes
  // shrink, the labels stay readable.
  const d = compact
    ? {
        wrap: 'p-2',
        stack: 'space-y-1',
        ruler: 'h-12',
        lane: 'min-h-9',
        lanePad: 'p-1',
        laneGap: 'gap-1',
        headPad: 'px-2 py-1',
        clipRow: 'h-9',
        clipHeight: 'h-7',
        emptyRow: 'h-7',
      }
    : {
        wrap: 'p-3',
        stack: 'space-y-3',
        ruler: 'h-20',
        lane: 'min-h-14',
        lanePad: 'p-2',
        laneGap: 'gap-2',
        headPad: 'px-3 py-2',
        clipRow: 'h-12',
        clipHeight: 'h-10',
        emptyRow: 'h-10',
      };

  // Hoisted so the compact strip and the full card render the SAME lanes.
  // Duplicating this block would guarantee the two drift apart.
  // The strip was authored at desktop scale: a 9rem sticky header column, an
  // ml-36 ruler offset to match it, and a 920px minimum width. On a 390px
  // phone that made the ruler and the lanes sit on different grids - the
  // overlap the operator photographed. Phone uses a 6.5rem column, a matching
  // offset, and no width floor, so the lanes scroll instead of colliding.
  // The header now carries the lane name, the clip count, and F3's eye/lock/
  // clear controls. At 9rem the controls left only 44px for text and five of
  // six lane names truncated ("Real f...", "AI B-r..."), which the design
  // shows in full. 11.5rem fits every default lane name.
  // This is ONE constant shared by the ruler, the scene strip and the lane
  // grid, so widening it keeps all three on the same axis.
  // ONE source for the header column, in rem and in px. The px value is
  // DERIVED from the rem value rather than typed twice: the measured viewport
  // includes this column, so the lane area is that much narrower, and a pair
  // that drifted apart would put the ruler back on its own grid — the exact
  // failure this module exists to prevent.
  const HEAD_W_REM = phone ? 3 : 11.5;
  const headW = `${HEAD_W_REM}rem`;
  const HEAD_W_PX = HEAD_W_REM * 16;
  const lanes = (
          <div ref={scrollRef} className={`timeline-lanes min-h-0 min-w-0 flex-1 overflow-auto rounded-xl bg-editor-panel ${d.wrap}`}>
            {/* At zoom > 1 the content is WIDER than the viewport, which is
                what makes the container scroll. The width comes from the same
                scale as the ruler, so they cannot disagree. */}
            {/* The 920px floor keeps six lanes usable at default zoom on a
                narrow desktop. But as a Tailwind min-width it ALWAYS beat the
                inline width, and contentWidth is containerWidth x zoom — so on
                a 1200px timeline zoom 0.5 asked for 600px and 0.25 for 300px,
                both clamped to 920. Zoom Out simply stopped doing anything
                below 1x, and at narrow widths even Fit stayed scrollable.
                Below 1x the operator has explicitly asked for less width, so
                the floor steps aside; at 1x and above it still applies. */}
            <div
              className={`${phone || zoom < 1 ? 'w-full' : 'min-w-[920px]'} ${d.stack}`}
              style={zoom === 1 ? undefined : { width: `calc(${headW} + ${Math.max(1, Math.round(scale.contentWidth - HEAD_W_PX))}px)` }}
            >
              {/* F1 — the timecode axis.
                  Shares headW with the scene strip and the lane grid below, so
                  0:00 sits exactly above clip x=0. The offset is read from ONE
                  constant; duplicating it is what put the ruler and the lanes
                  on different grids before. Hidden on phone, as the scene strip
                  is, rather than rendered misaligned. */}
              {/* Laid out as the LANE ROWS are: a sticky gutter cell plus the
                  content cell. The ruler used a plain marginLeft, which works
                  at zoom 1 but slides under the lane headers as soon as the
                  content scrolls. Reusing the row structure means the gutter
                  stays covered by the same mechanism that already works. */}
              <div
                className="grid items-stretch"
                                style={{ gridTemplateColumns: `${headW} 1fr` }}
                              >
                              <div className="sticky left-0 z-20 bg-editor-panel" aria-hidden="true" />
                              <div
                                className="relative h-7 select-none overflow-hidden"
                aria-label="Time ruler"
              >
                {scale.ticks.map((tick) => (
                  <div
                    key={tick.sec}
                    className="absolute top-0 flex h-full flex-col items-start"
                    style={{ left: `${(tick.sec / target) * 100}%` }}
                  >
                    <span className="h-1.5 w-px bg-editor-text/25" aria-hidden="true" />
                    <span className="mt-0.5 pl-1 text-[9px] font-medium leading-none tabular-nums text-editor-faint">
                      {tick.label}
                    </span>
                  </div>
                ))}
              </div>
              </div>
              <div
                className={`${phone ? 'hidden' : 'grid'} items-stretch`}
                style={{ gridTemplateColumns: `${headW} 1fr` }}
              >
              <div className="sticky left-0 z-20 bg-editor-panel" aria-hidden="true" />
              <div className={`flex ${d.ruler} items-stretch gap-1`} aria-label="Scene ruler">
                {project.scenes.map((scene, index) => {
                  const widthPct = Math.max(8, (scene.targetDurationSec / target) * 100);
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      aria-label={`Scene block: ${scene.label}`}
                      aria-pressed={selectedSceneId === scene.id}
                      draggable
                      onClick={() => onSelectScene?.(scene.id)}
                      className={`group relative min-w-24 rounded-lg border text-left ${d.lanePad} outline-none transition ${
                        selectedSceneId === scene.id
                          ? 'border-editor-accent bg-editor-hover ring-2 ring-editor-accent/40'
                          : `lane ${SCENE_FAMILY[index % SCENE_FAMILY.length]} hover:brightness-[0.97]`
                      }`}
                      style={{ flexBasis: `${widthPct}%` }}
                      title={scene.voiceoverBrief}
                    >
                      <p className="truncate text-xs font-semibold tracking-tight text-editor-text">{scene.label}</p>
                      {!compact && (
                      <p className="mt-0.5 text-[10px] font-medium tabular-nums text-content-tertiary">{formatDuration(scene.startSec)} · {Math.round(scene.targetDurationSec)}s</p>
                    )}
                      {!compact && <div className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-editor-text/15" />}
                    </button>
                  );
                })}
              </div>
              </div>
  
              <div className={d.stack}>
                {project.tracks.map((track) => {
                  if (phone && track.kind === 'broll' && track.clips.length === 0 && brollRowProjectId !== project.id) return null;
                  const Icon = TRACK_ICON[track.kind];
                  return (
                    <div
                      key={track.id}
                      aria-label={`Track lane: ${track.label}`}
                      className={`grid items-stretch ${d.laneGap}`}
                                            style={{ gridTemplateColumns: `${headW} minmax(0, 1fr)` }}
                    >
                      {/* Sticky so the track headers - the clip counts the
                          operator reads while scrubbing - stay in view while
                          the clips scroll horizontally underneath. Needs an
                          OPAQUE background, not bg-white/[0.03], or the clips
                          show through as they pass behind it. */}
                      <div className={phone ? `sticky left-0 z-20 flex flex-col items-stretch rounded-lg bg-lane-bed px-1 py-1 focus-within:z-40 ${openLaneId === track.id ? 'z-40' : ''}` : `sticky left-0 z-20 flex items-center gap-2 rounded-lg bg-lane-bed ${d.headPad}`}>
                        {!phone && <Icon size={15} className="shrink-0 text-editor-dim" />}
                        <div className={phone ? 'sr-only' : 'min-w-0'}>
                          {/* Stored labels can be longer than the column (an
                              existing project still says "AI B-roll /
                              cutaways"), and renaming one in code would not
                              migrate saved projects — so the full name is
                              always available on hover. */}
                          <p title={track.label} className={`truncate font-semibold text-editor-text ${phone ? 'text-[11px] leading-none' : 'text-xs'}`}>
                            {track.label}
                            {phone && <span className="ml-1.5 font-normal text-content-tertiary">{track.clips.length}</span>}
                          </p>
                          {!phone && <p className="text-[10px] font-medium tabular-nums text-content-tertiary">{track.clips.length} clip{track.clips.length === 1 ? '' : 's'}</p>}
                        </div>
                        {/* F3 — lane controls. Eye and lock come before the
                            eraser so the destructive action stays last.
                            ml-auto is on the FIRST of them, so the group sits
                            right whichever buttons are present. */}
                        <LaneActionsMenu phone={phone} label={track.label} icon={<Icon size={18} />} open={openLaneId === track.id} onOpenChange={open => setOpenLaneId(open ? track.id : null)}>
                        {onProjectChange && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onProjectChange(setTrackFlag(project, track.id, 'hidden', !track.hidden)); }}
                            className={`ml-auto shrink-0 rounded p-1 transition hover:bg-editor-hover ${track.hidden ? 'text-editor-accent' : 'text-content-tertiary hover:text-editor-text'}`}
                            aria-label={track.hidden ? `Show ${track.label} lane` : `Hide ${track.label} lane`}
                            aria-pressed={track.hidden === true}
                            title={track.hidden ? `${track.label} is hidden — it will NOT appear in the render. Click to show.` : `Hide ${track.label} — hidden lanes are left out of the render`}
                          >
                            {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        )}
                        {onProjectChange && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onProjectChange(setTrackFlag(project, track.id, 'locked', !track.locked)); }}
                            className={`shrink-0 rounded p-1 transition hover:bg-editor-hover ${track.locked ? 'text-editor-accent' : 'text-content-tertiary hover:text-editor-text'}`}
                            aria-label={track.locked ? `Unlock ${track.label} lane` : `Lock ${track.label} lane`}
                            aria-pressed={track.locked === true}
                            title={track.locked ? `${track.label} is locked — clips still render, but cannot be edited. Click to unlock.` : `Lock ${track.label} — clips stay visible and still render, but cannot be edited`}
                          >
                            {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
                          </button>
                        )}
                        {onClearLane && track.clips.length > 0 && !track.locked && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onClearLane(track.kind); }}
                            className="shrink-0 rounded p-1 text-content-tertiary transition hover:bg-editor-hover hover:text-editor-text"
                            aria-label={`Clear ${track.label} lane`}
                            title={`Clear this lane - removes all ${track.clips.length} clip${track.clips.length === 1 ? '' : 's'} from ${track.label}`}
                          >
                            <Eraser size={12} />
                          </button>
                        )}
                        {phone && track.kind === 'broll' && track.clips.length === 0 && <button type="button" className="min-h-11 rounded px-2 text-xs text-editor-dim" aria-label="Remove empty B-roll row" onClick={() => setBrollRowProjectId(null)}><X size={12} /></button>}
                        </LaneActionsMenu>
                      </div>
  
                      {/* A hidden lane dims so the exclusion is visible at a
                          glance, and stops taking pointer events so a clip
                          cannot be edited into a lane that will not render.

                          The pointer-events half was described here but never
                          implemented — the branch only dimmed. Clips stayed
                          selectable, Mute/Delete still fired, and an empty
                          hidden lane still opened its insertion tool, so an
                          edit could land in a lane the renderer then drops.
                          The eye control sits in the HEADER, outside this
                          element, so making the lane inert never leaves the
                          operator without a way to bring it back. */}
                      <div className={`relative ${d.lane} rounded-lg bg-lane-bed ${d.lanePad} ${track.hidden ? 'opacity-40 pointer-events-none' : ''}`}>
                        {track.clips.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => onEmptyLaneClick?.(track.kind)}
                            disabled={!onEmptyLaneClick}
                            title={onEmptyLaneClick ? 'Open the tool that fills this lane' : undefined}
                            className={`flex ${d.emptyRow} w-full items-center justify-center rounded-md bg-transparent px-2 text-center text-[11px] text-editor-faint transition enabled:hover:text-editor-dim phone:justify-start phone:text-left phone:text-[10px] phone:leading-tight`}
                          >
                            {phone ? `+ Add ${track.kind === 'voiceover' ? 'voice' : track.kind === 'video' ? 'footage' : track.kind === 'broll' ? 'B-roll' : track.kind}` : EMPTY_HINT[track.kind]}
                          </button>
                        ) : (
                          <div className={`relative ${d.clipRow}`}>
                            {track.clips.map((clip) => {
                              const asset = project.assets[clip.assetId];
                              const proxy = proxyLabel(asset);
                              const previewMode = previewModeLabel(asset);
                              const thumb = timelineAssetThumbPath(asset);
                              const leftPct = Math.max(0, Math.min(96, (clip.startSec / target) * 100));
                              // The 5% minimum width used to be unconditional, which
                              // made short clips WIDER than their own slot: three 5s
                              // images on a 270s timeline start 1.85% apart but were
                              // each drawn 5% wide, so every clip overlapped the next
                              // by more than half and the lane looked like one stack
                              // of Mute buttons. Clamp the floor to the gap before the
                              // next clip, so a short clip stays visible without
                              // running over its neighbour.
                              const trueWidthPct = (clip.durationSec / target) * 100;
                              const nextStartPct = track.clips
                                .filter((other) => other.startSec > clip.startSec)
                                .reduce<number | null>((soonest, other) => {
                                  const pct = (other.startSec / target) * 100;
                                  return soonest === null || pct < soonest ? pct : soonest;
                                }, null);
                              const roomPct = (nextStartPct ?? 100) - leftPct;
                              const widthPct = Math.max(
                                Math.min(MIN_CLIP_WIDTH_PCT, roomPct),
                                Math.min(100 - leftPct, trueWidthPct),
                              );
                              // Audio clips carry a peak trace beside the label.
                              // Derived once, because both the label's width and
                              // the trace itself depend on it: the label only
                              // gives up flex-1 when there is something to give
                              // it up to. Width matters as much as kind — see
                              // WAVEFORM_MIN_WIDTH_PCT.
                              const waveform = asset?.kind === 'audio'
                                && Boolean(asset.path)
                                && widthPct >= WAVEFORM_MIN_WIDTH_PCT;
                              const selected = selectedClipId === clip.id;
                              return (
                                <div
                                  key={clip.id}
                                  // Locked = inspect, do not edit. The clip is
                                  // still clickable (so the operator can read
                                  // it and the toolbar can show its details)
                                  // but cannot be dragged.
                                  draggable={!track.locked}
                                  // Selection lives on the CONTAINER: the refactor
                                  // moved it to an inner button, so clicking the
                                  // clip block itself no longer selected it and the
                                  // Split/Remove toolbar stayed disabled.
                                  onClick={() => setSelectedClipId(clip.id)}
                                  aria-label={`Timeline clip: ${asset?.label || clip.assetId}`}
                                  className={`absolute top-1 ${d.clipHeight} rounded-md border px-2 py-1 text-left text-[10px] font-semibold tracking-tight transition ${selected ? 'border-editor-accent bg-editor-accent/30 text-editor-text ring-2 ring-editor-accent/50' : `${CLIP_TONE[track.kind]} hover:brightness-125`}`}
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  title={`${asset?.label || clip.assetId} · ${sourceLabel(asset)} · ${Math.round(clip.durationSec)}s · ${previewMode}`}
                                >
                                  <div className="relative flex h-full items-center gap-1.5 overflow-hidden">
                                    {/* Lane mark. Carries the lane's own ink, so a
                                        clip is identifiable even when its block is
                                        too narrow to show the label. */}
                                    {!compact && (
                                      thumb ? (
                                        /* F5 — the poster frame the server already
                                           extracted at upload. A broken load falls
                                           back to the chip rather than leaving the
                                           browser's torn-image icon in the lane. */
                                        <img
                                          src={thumb}
                                          alt=""
                                          aria-hidden="true"
                                          loading="lazy"
                                          decoding="async"
                                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                          className="h-5 w-7 shrink-0 rounded object-cover"
                                        />
                                      ) : (
                                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded ${LANE_CHIP[track.kind]}`} aria-hidden="true">
                                          <Icon size={11} />
                                        </span>
                                      )
                                    )}
                                    {/* F4 — the peak trace, for audio only, and
                                        absent entirely when the clip has no
                                        peaks: a missing waveform degrades to
                                        the flat clip, it never blocks.

                                        Drawn in compact too. It was gated on
                                        !compact alongside the second text
                                        line, but the two are not the same
                                        problem: a stacked LABEL wrapped and
                                        broke the 28px row, while the trace
                                        costs no height at all. Since the
                                        timeline renders compact by default,
                                        gating it out meant the waveform never
                                        appeared on the screen the operator
                                        uses.

                                        BESIDE the label, not under it. Running
                                        the trace the full width of the clip
                                        put peaks directly behind the filename,
                                        and the two read as one smeared line.
                                        In the reference the label sits on its
                                        own solid ground at the head of the
                                        clip and the waveform takes the space
                                        that is left, so neither competes: the
                                        label keeps its own bed below, and this
                                        flows after it in normal document
                                        order rather than being positioned over
                                        the whole row. */}
                                    <button
                                      type="button"
                                      onClick={() => setSelectedClipId(clip.id)}
                                      /* flex-1 only when nothing else wants
                                         the room. With a waveform beside it the
                                         label shrinks to its own width so the
                                         trace gets the remainder — the label
                                         stretching full-width is what put peaks
                                         behind the text. */
                                      className={`relative min-w-0 text-left ${waveform ? 'max-w-[45%] shrink' : 'flex-1'}`}
                                    >
                                      {/* ONE line, not two. A stacked label inside a
                                          28px compact clip wrapped under the Mute
                                          button and read as broken. */}
                                      <p className="truncate font-semibold leading-tight">{clip.text || asset?.label || clip.assetId}</p>
                                      {!compact && (
                                        <p className="truncate opacity-70">{sourceLabel(asset)} · {Math.round(clip.durationSec)}s{proxy ? ` · ${proxy}` : ''}</p>
                                      )}
                                    </button>
                                    {waveform && (
                                      <ClipWaveform
                                        assetPath={asset!.path!}
                                        /* Sized by its flex box, not by
                                           intrinsic size. It used to carry
                                           h-auto/w-auto, but <canvas> is a
                                           replaced element: `auto` resolves to
                                           its intrinsic 300x150 and wins over
                                           any positioning, so the trace was a
                                           fixed 300x150 block spilling out of
                                           a 17px clip row. ClipWaveform now
                                           pins its own CSS size to 100%. */
                                        className={`pointer-events-none min-w-0 flex-1 self-stretch opacity-40 ${compact ? 'my-0.5' : 'my-1'}`}
                                      />
                                    )}
                                    {/* Controls need ~70px. On a clip narrower
                                        than that they were shrink-0, so they spilled
                                        OUTSIDE the block and three short clips read as
                                        one stack of Mute buttons. Below the threshold
                                        the clip is still selectable and the toolbar
                                        above the lanes acts on the selection. */}
                                    {/* A locked lane hides its per-clip edit
                                        controls entirely: the clip stays
                                        selectable for inspection, but Mute and
                                        Delete are not offered at all. */}
                                    <div className={`flex shrink-0 gap-1 ${phone || track.locked || (widthPct < CONTROLS_MIN_WIDTH_PCT && !selected) ? 'hidden' : ''}`}>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onProjectChange?.({
                                            ...project,
                                            // Target THIS clip's own row. Using
                                            // selection.track here crashed when
                                            // nothing was selected, and muted the
                                            // wrong track when a clip in another
                                            // row was the selected one.
                                            tracks: project.tracks.map((t) =>
                                              t.id === track.id ? {
                                                ...t,
                                                clips: t.clips.map((c) => c.id === clip.id ? { ...c, muted: !c.muted } : c),
                                              } : t,
                                            ),
                                          });
                                        }}
                                        className={`rounded px-1.5 py-0.5 transition ${clip.muted ? 'opacity-45 hover:opacity-70' : 'opacity-70 hover:opacity-100'}`}
                                        title={clip.muted ? 'Unmute clip' : 'Mute clip'}
                                      >
                                        {clip.muted ? 'Muted' : 'Mute'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Remove from THIS clip's own row. Using
                                          // selection.track deleted from the wrong
                                          // track, and the !selection guard made the
                                          // button silently do nothing until some
                                          // other clip had been selected first.
                                          if (!onProjectChange) return;
                                          onProjectChange(removeClip(project, track, clip));
                                          if (selectedClipId === clip.id) setSelectedClipId(null);
                                        }}
                                        className="rounded px-1.5 py-0.5 opacity-70 transition hover:bg-red-500/20 hover:text-red-200 hover:opacity-100"
                                        // Distinct from the toolbar's "Remove clip" so
                                        // accessible-name queries stay unambiguous.
                                        aria-label={`Delete clip: ${asset?.label || clip.assetId}`}
                                        title="Delete this clip"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
  );

  // One dense toolbar carrying everything the tall header used to stack:
  // project identity, the settings badge, selection state, and the clip
  // actions. Split/Remove are icon-only here — the label is in the tooltip and
  // aria-label, which is the trade that buys the lanes their height.
  const compactToolbar = (
    <div className="timeline-toolbar flex flex-wrap items-center gap-2 border-b border-editor-line px-3 py-2 text-[11px] short:gap-1 short:py-1">
      <span className="max-w-36 truncate font-semibold text-editor-text phone:hidden" title={project.title}>{project.title}</span>
      <span className="text-editor-faint phone:hidden">
        {project.scenes.length} scenes · {project.tracks.length} tracks · {formatDuration(project.targetDurationSec)}
      </span>
      <span className="text-editor-faint phone:hidden">·</span>
      <span className="text-editor-dim phone:hidden">
        {project.renderSettings.voiceProvider} VO · {project.aspect}
      </span>
      <span className="flex-1 phone:hidden" />
      <select aria-label="Select timeline clip" value={selectedClipId || ''} onChange={(e) => setSelectedClipId(e.target.value || null)} className="h-11 min-w-0 max-w-60 rounded border border-editor-line bg-editor-panel px-2 text-xs text-editor-text phone:w-full phone:max-w-none">
        <option value="">Select a clip…</option>
        {project.tracks.map((track) => <optgroup key={track.id} label={track.label}>{track.clips.map((clip) => <option key={clip.id} value={clip.id} disabled={track.hidden}>{clip.text || project.assets[clip.assetId]?.label || clip.assetId} · {formatDuration(clip.startSec)}</option>)}</optgroup>)}
      </select>
      {selection ? (
        <span className="max-w-40 truncate text-editor-dim phone:w-full phone:max-w-none">
          {selection.clip.text || selection.asset?.label || selection.clip.assetId}
          <span className="text-editor-faint"> · {Math.round(selection.clip.durationSec)}s</span>
        </span>
      ) : (
        <span className="text-editor-faint phone:hidden">Select a clip to split or remove</span>
      )}
      {/* F2 — zoom. Reads as one control: minus, the level, plus. The level
          is a button because it is also Fit — the fastest way back to seeing
          the whole project, and the reason 1 is on the step ladder. */}
      {(
              <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => applyZoom(nextZoomOut(zoom))}
            disabled={zoom <= MIN_ZOOM}
            className="icon-btn"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            onClick={() => applyZoom(1)}
            disabled={zoom === 1}
            className="min-w-11 rounded px-1 text-[10px] font-semibold tabular-nums text-content-tertiary transition hover:text-editor-text disabled:hover:text-content-tertiary"
            aria-label={`Zoom ${zoom}x. Fit the whole project`}
            title={zoom === 1 ? 'Whole project fits' : 'Fit the whole project'}
          >
            {zoom}x
          </button>
          <button
            type="button"
            onClick={() => applyZoom(nextZoomIn(zoom))}
            disabled={zoom >= MAX_ZOOM}
            className="icon-btn"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={14} />
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={handleSplit}
        disabled={!selection || !onProjectChange || selectionLocked || (selection?.clip.durationSec ?? 0) < 1}
        className="icon-btn"
        aria-label="Split clip"
        title={selectionLocked ? 'This lane is locked/hidden — enable it to edit' : 'Split clip at its midpoint'}
      >
        <Scissors size={14} />
      </button>
      <button type="button" onClick={() => setTimingOpen((v) => !v)} disabled={!selection || !onProjectChange} aria-expanded={timingOpen} className="min-h-11 rounded-md border border-editor-line px-2 text-editor-text disabled:opacity-40">Timing</button>
      <button type="button" disabled={!selection || !onProjectChange || selectionLocked} className="min-h-11 rounded-md border border-editor-line px-2 text-editor-text disabled:opacity-40" onClick={() => {
        if (!selection || !onProjectChange || selectionLocked) return;
        onProjectChange(withUpdatedTrack(project, selection.track.id, selection.track.clips.map((clip) => clip.id === selection.clip.id ? { ...clip, muted: !clip.muted } : clip)));
      }}>{selection?.clip.muted ? 'Unmute selected' : 'Mute selected'}</button>
      <button
        type="button"
        onClick={handleRemove}
        disabled={!selection || !onProjectChange || selectionLocked}
        className="icon-btn-danger"
        aria-label="Remove clip"
        title={selectionLocked ? 'This lane is locked — unlock it to edit' : 'Remove clip'}
      >
        <Trash2 size={14} />
      </button>
      <button
        type="button"
        onClick={() => onRequestVeoBroll?.(buildVeoPrompt(project))}
        className="icon-btn"
        disabled={!onRequestVeoBroll}
        aria-label="Request AI B-roll"
        title="Request AI B-roll"
      >
        <Sparkles size={14} />
      </button>
      {onWipeAll && (
        <button
          type="button"
          onClick={onWipeAll}
          className="icon-btn-danger"
          aria-label="Wipe all lanes"
          title="Start fresh - clears every lane, the source media and the backgrounds"
        >
          <Eraser size={14} />
        </button>
      )}
    </div>
  );

  // Phone: one horizontally scrollable contextual row; no desktop metadata floor.
  const mobileToolbar = (
    <div className="timeline-mobile-tools flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-editor-line px-1 [scrollbar-width:none]" aria-label="Clip tools">
      <select aria-label="Select timeline clip" title={selection ? `${selection.track.label}: ${selection.asset?.label || selection.clip.assetId}` : 'Select a clip'} value={selectedClipId || ''} onChange={(e) => { setSelectedClipId(e.target.value || null); setTimingOpen(false); }} className="h-11 w-28 shrink-0 truncate rounded-md border border-editor-line bg-editor-panel px-2 text-xs text-editor-text">
        <option value="">Select clip</option>
        {project.tracks.map((track) => <optgroup key={track.id} label={track.label}>{track.clips.map((clip) => <option key={clip.id} value={clip.id} disabled={track.hidden}>{track.label} · {clip.text || project.assets[clip.assetId]?.label || clip.assetId}</option>)}</optgroup>)}
      </select>
      {selection ? <>
        <button type="button" className="icon-btn" aria-label="Split clip" title="Split at midpoint" onClick={handleSplit} disabled={selectionLocked || !onProjectChange || selection.clip.durationSec < 1}><Scissors size={18} /></button>
        <button type="button" className="icon-btn" aria-label="Timing" title="Move / trim timing" aria-expanded={timingOpen} onClick={() => setTimingOpen((v) => !v)} disabled={!onProjectChange}><Timer size={18} /></button>
        <button type="button" className="icon-btn" aria-label={selection.clip.muted ? 'Unmute selected' : 'Mute selected'} title={selection.clip.muted ? 'Unmute selected' : 'Mute selected'} disabled={selectionLocked || !onProjectChange} onClick={() => { if (onProjectChange && !selectionLocked) onProjectChange(withUpdatedTrack(project, selection.track.id, selection.track.clips.map((clip) => clip.id === selection.clip.id ? { ...clip, muted: !clip.muted } : clip))); }}>{selection.clip.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <button type="button" className="icon-btn-danger" aria-label="Remove clip" title="Remove clip" onClick={handleRemove} disabled={selectionLocked || !onProjectChange}><Trash2 size={18} /></button>
      </> : <>
        <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => applyZoom(nextZoomOut(zoom))} disabled={zoom <= MIN_ZOOM}><Minus size={18} /></button>
        <button type="button" className="icon-btn text-xs" aria-label={`Zoom ${zoom}x. Fit the whole project`} title="Fit project" onClick={() => applyZoom(1)}>{zoom}x</button>
        <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => applyZoom(nextZoomIn(zoom))} disabled={zoom >= MAX_ZOOM}><Plus size={18} /></button>

        {onWipeAll && <button type="button" className="icon-btn-danger" aria-label="Wipe all lanes" title="Wipe all lanes" onClick={onWipeAll}><Eraser size={18} /></button>}
      </>}
      <button type="button" className="flex min-h-11 shrink-0 items-center gap-1 rounded px-2 text-xs text-editor-dim" aria-label="Add B-roll layer" onClick={() => { setBrollRowProjectId(project.id); setOpenLaneId(null); }}><Plus size={16} />B-roll</button>
    </div>
  );

  const timing = selection && timingOpen && (
    <ClipTimingFields key={`${selection.clip.id}:${selection.clip.startSec}:${selection.clip.sourceStartSec}:${selection.clip.durationSec}`}
      track={selection.track} clip={selection.clip} disabled={!onProjectChange}
      onApply={(values) => {
        const next = editClipTiming(project, selection.clip.id, values);
        if (next === project) return values.startSec === selection.clip.startSec && values.sourceStartSec === (selection.clip.sourceStartSec || 0) && values.durationSec === selection.clip.durationSec;
        onProjectChange?.(next); return true;
      }} />
  );
  const transport = onTimeChange && (
    <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-editor-line px-3">
      <input aria-label="Timeline playhead" type="range" min="0" max={target} step="0.05" value={Math.min(target, timeSec)} onChange={(e) => onTimeChange(Number(e.target.value))} className="h-11 min-w-0 flex-1 accent-primary-400" />
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-editor-dim">{formatDuration(timeSec)} / {formatDuration(target)}</span>
    </div>
  );

  if (compact) {
    return (
      <div className="timeline-canvas relative flex h-full min-w-0 flex-col">
        {transport}
        {phone ? mobileToolbar : compactToolbar}
                {phone && timing ? <div role="dialog" aria-label="Clip timing" className="absolute inset-x-2 bottom-14 z-50 max-h-[80%] overflow-auto rounded-xl border border-editor-line bg-editor-panel p-3 shadow-xl"><div className="flex items-center justify-between"><span className="truncate text-sm font-semibold">{selection?.track.label}</span><button type="button" aria-label="Close timing" className="icon-btn min-h-11 min-w-11" onClick={() => setTimingOpen(false)}><X size={18} /></button></div>{timing}</div> : <div className="max-h-[40%] shrink-0 overflow-auto">{timing}</div>}
        {/* The SCROLLER is the lanes container itself, so the sticky track
            headers have a scroll context to stick within. This wrapper only
            supplies the height - a second overflow here would fight it and
            leave the inner h-full with no resolved parent height. */}
        <div className="flex min-h-0 flex-1 flex-col px-3 py-2 phone:px-1 phone:py-1">
          {lanes}
        </div>
      </div>
    );
  }

  return (
    <Card
      title="Visual timeline"
      tooltip="Select clips to split, remove or edit timing. Split cuts at the midpoint. Use Timing for precise move and trim; pointer drag/drop is not supported yet."
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-content-tertiary">{project.title}</p>
            <p className="text-sm text-content-secondary">
              {project.scenes.length} scenes · {project.tracks.length} tracks · target {formatDuration(project.targetDurationSec)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="rounded-full border border-editor-accent/25 bg-editor-accent/10 px-3 py-1 text-xs text-editor-text">
              Face-safe default · {project.renderSettings.voiceProvider} VO · {project.aspect}
            </div>
            <Button
              variant="secondary"
              className="text-xs px-3 py-1.5"
              onClick={() => onRequestVeoBroll?.(buildVeoPrompt(project))}
              title="Requires official Veo endpoint/API config. Uploaded videos/images can still be inserted without Veo."
            >
              <Sparkles size={14} className="mr-1.5" /> Request AI B-roll
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-editor-accent/35 bg-editor-hover p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-editor-dim">Selected clip</p>
            {selection ? (
              <>
                <p className="mt-1 text-sm text-editor-text">{selection.asset?.label || selection.clip.assetId}</p>
                <p className="text-[11px] text-editor-dim">{selection.track.label} · starts {formatDuration(selection.clip.startSec)} · {Math.round(selection.clip.durationSec)}s</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-editor-dim">Click a clip block in any lane first, then split or remove it here.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {phone && <Button variant="secondary" className="min-h-11 text-xs px-3 py-1.5" disabled={!selection || !onProjectChange || selectionLocked} onClick={() => {
              if (!selection || !onProjectChange || selectionLocked) return;
              onProjectChange(withUpdatedTrack(project, selection.track.id, selection.track.clips.map(clip => clip.id === selection.clip.id ? { ...clip, muted: !clip.muted } : clip)));
            }}>{selection?.clip.muted ? 'Unmute selected' : 'Mute selected'}</Button>}
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={handleSplit} disabled={!selection || !onProjectChange || selectionLocked || selection.clip.durationSec < 1}>
              <Scissors size={14} className="mr-1.5" /> Split clip
            </Button>
            <Button variant="ghost" className="text-xs px-3 py-1.5" onClick={handleRemove} disabled={!selection || !onProjectChange || selectionLocked}>
              <Trash2 size={14} className="mr-1.5" /> Remove clip
            </Button>
          </div>
        </div>

        <button type="button" disabled={!selection || !onProjectChange} onClick={() => setTimingOpen((v) => !v)} aria-expanded={timingOpen} className="min-h-11 rounded border border-editor-line px-3 text-xs">Timing</button>
        {timing}
        {transport}
        {lanes}
      </div>
    </Card>
  );
}
