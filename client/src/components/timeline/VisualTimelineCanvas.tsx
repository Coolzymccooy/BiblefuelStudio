import { useMemo, useState } from 'react';
import { Film, Mic2, Music, Scissors, Sparkles, Subtitles, Trash2, Wand2 } from 'lucide-react';
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
  project: TimelineProject;
  onProjectChange?: (project: TimelineProject) => void;
  onRequestVeoBroll?: (request: VeoBrollRequest) => void;
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
}

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

const EMPTY_HINT: Record<TimelineTrackKind, string> = {
  video: 'Inserted videos appear here in sequence',
  broll: 'Add images, uploaded cutaways, or configured AI B-roll here',
  voiceover: 'Add Chatterbox/Fish scene briefs',
  music: 'Add soundtrack bed or worship-safe music',
  captions: 'Add kinetic captions and scripture callouts',
  effects: 'Add transitions, glow, grade and light leaks',
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

export function VisualTimelineCanvas({ project, onProjectChange, onRequestVeoBroll, compact = false }: VisualTimelineCanvasProps) {
  const target = Math.max(1, project.targetDurationSec);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const selection = useMemo(() => findClip(project, selectedClipId), [project, selectedClipId]);

  const handleSplit = () => {
    if (!selection || !onProjectChange) return;
    onProjectChange(splitClip(project, selection.track, selection.clip));
  };

  const handleRemove = () => {
    if (!selection || !onProjectChange) return;
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
  const lanes = (
          <div className={`min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-xl border border-white/10 bg-black/25 ${d.wrap}`}>
            <div className={`min-w-[920px] ${d.stack}`}>
              <div className={`ml-36 flex ${d.ruler} items-stretch gap-1`} aria-label="Scene ruler">
                {project.scenes.map((scene) => {
                  const widthPct = Math.max(8, (scene.targetDurationSec / target) * 100);
                  return (
                    <div
                      key={scene.id}
                      aria-label={`Scene block: ${scene.label}`}
                      draggable
                      className={`group relative min-w-24 rounded-lg border border-primary-500/25 bg-gradient-to-br from-primary-500/15 to-amber-500/10 ${d.lanePad} shadow-inner outline-none transition hover:border-primary-300/60`}
                      style={{ flexBasis: `${widthPct}%` }}
                      title={scene.voiceoverBrief}
                    >
                      <p className="truncate text-[11px] font-semibold text-primary-100">{scene.label}</p>
                      {!compact && (
                      <p className="mt-1 text-[10px] text-content-tertiary">{formatDuration(scene.startSec)} · {Math.round(scene.targetDurationSec)}s</p>
                    )}
                      {!compact && <div className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-primary-400/30" />}
                    </div>
                  );
                })}
              </div>
  
              <div className={d.stack}>
                {project.tracks.map((track) => {
                  const Icon = TRACK_ICON[track.kind];
                  return (
                    <div
                      key={track.id}
                      aria-label={`Track lane: ${track.label}`}
                      className={`grid grid-cols-[9rem_1fr] items-stretch ${d.laneGap}`}
                    >
                      {/* Sticky so the track headers - the clip counts the
                          operator reads while scrubbing - stay in view while
                          the clips scroll horizontally underneath. Needs an
                          OPAQUE background, not bg-white/[0.03], or the clips
                          show through as they pass behind it. */}
                      <div className={`sticky left-0 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-[#141210] ${d.headPad}`}>
                        <Icon size={15} className="text-primary-200" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-gray-100">{track.label}</p>
                          <p className="text-[10px] text-content-tertiary">{track.clips.length} clip{track.clips.length === 1 ? '' : 's'}</p>
                        </div>
                      </div>
  
                      <div className={`relative ${d.lane} rounded-lg border border-dashed border-white/10 bg-white/[0.02] ${d.lanePad}`}>
                        {track.clips.length === 0 ? (
                          <div className={`flex ${d.emptyRow} items-center justify-center rounded-md bg-black/20 text-[11px] text-content-tertiary`}>
                            {EMPTY_HINT[track.kind]}
                          </div>
                        ) : (
                          <div className={`relative ${d.clipRow}`}>
                            {track.clips.map((clip) => {
                              const asset = project.assets[clip.assetId];
                              const proxy = proxyLabel(asset);
                              const previewMode = previewModeLabel(asset);
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
                              const selected = selectedClipId === clip.id;
                              return (
                                <div
                                  key={clip.id}
                                  draggable
                                  // Selection lives on the CONTAINER: the refactor
                                  // moved it to an inner button, so clicking the
                                  // clip block itself no longer selected it and the
                                  // Split/Remove toolbar stayed disabled.
                                  onClick={() => setSelectedClipId(clip.id)}
                                  aria-label={`Timeline clip: ${asset?.label || clip.assetId}`}
                                  className={`absolute top-1 ${d.clipHeight} rounded-md border px-2 py-1 text-left text-[10px] shadow-sm transition ${selected ? 'border-emerald-200 bg-emerald-400/30 text-white ring-2 ring-emerald-300/40' : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-50 hover:border-emerald-200/70'}`}
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  title={`${asset?.label || clip.assetId} · ${sourceLabel(asset)} · ${Math.round(clip.durationSec)}s · ${previewMode}`}
                                >
                                  <div className="flex h-full items-center gap-1 overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedClipId(clip.id)}
                                      className="min-w-0 flex-1 text-left"
                                    >
                                      {/* ONE line, not two. A stacked label inside a
                                          28px compact clip wrapped under the Mute
                                          button and read as broken. */}
                                      <p className="truncate font-semibold leading-tight">{asset?.label || clip.assetId}</p>
                                      {!compact && (
                                        <p className="truncate text-emerald-100/75">{sourceLabel(asset)} · {Math.round(clip.durationSec)}s{proxy ? ` · ${proxy}` : ''}</p>
                                      )}
                                    </button>
                                    {/* Controls need ~70px. On a clip narrower
                                        than that they were shrink-0, so they spilled
                                        OUTSIDE the block and three short clips read as
                                        one stack of Mute buttons. Below the threshold
                                        the clip is still selectable and the toolbar
                                        above the lanes acts on the selection. */}
                                    <div className={`flex shrink-0 gap-1 ${widthPct < CONTROLS_MIN_WIDTH_PCT && !selected ? 'hidden' : ''}`}>
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
                                        className={`rounded px-1.5 py-0.5 transition ${clip.muted ? 'bg-amber-400/30 text-amber-100' : 'bg-black/30 text-emerald-100 hover:bg-black/50'}`}
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
                                        className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-100 hover:bg-red-500/20 hover:text-red-200 transition"
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
    <div className="flex flex-wrap items-center gap-2 border-b border-editor-line px-3 py-2 text-[11px]">
      <span className="font-semibold text-editor-text">{project.title}</span>
      <span className="text-editor-faint">
        {project.scenes.length} scenes · {project.tracks.length} tracks · {formatDuration(project.targetDurationSec)}
      </span>
      <span className="text-editor-faint">·</span>
      <span className="text-editor-dim">
        {project.renderSettings.voiceProvider} VO · {project.aspect}
      </span>
      <span className="flex-1" />
      {selection ? (
        <span className="truncate text-editor-dim">
          {selection.asset?.label || selection.clip.assetId}
          <span className="text-editor-faint"> · {Math.round(selection.clip.durationSec)}s</span>
        </span>
      ) : (
        <span className="text-editor-faint">Select a clip to split or remove</span>
      )}
      <button
        type="button"
        onClick={handleSplit}
        disabled={!selection || !onProjectChange || (selection?.clip.durationSec ?? 0) < 1}
        className="icon-btn"
        aria-label="Split clip"
        title="Split clip"
      >
        <Scissors size={14} />
      </button>
      <button
        type="button"
        onClick={handleRemove}
        disabled={!selection || !onProjectChange}
        className="icon-btn-danger"
        aria-label="Remove clip"
        title="Remove clip"
      >
        <Trash2 size={14} />
      </button>
      <button
        type="button"
        onClick={() => onRequestVeoBroll?.(buildVeoPrompt(project))}
        className="icon-btn"
        aria-label="Request AI B-roll"
        title="Request AI B-roll"
      >
        <Sparkles size={14} />
      </button>
    </div>
  );

  if (compact) {
    return (
      <div className="flex h-full flex-col">
        {compactToolbar}
        {/* The SCROLLER is the lanes container itself, so the sticky track
            headers have a scroll context to stick within. This wrapper only
            supplies the height - a second overflow here would fight it and
            leave the inner h-full with no resolved parent height. */}
        <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
          {lanes}
        </div>
      </div>
    );
  }

  return (
    <Card
      title="Visual timeline"
      tooltip="CapCut-like multi-track timeline foundation. Scene and clip blocks are draggable-ready; the next slice will add real drop/reorder/trim interactions."
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
            <div className="rounded-full border border-primary-500/20 bg-primary-500/10 px-3 py-1 text-xs text-primary-100">
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

        <div className="flex flex-col gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">Selected clip</p>
            {selection ? (
              <>
                <p className="mt-1 text-sm text-emerald-50">{selection.asset?.label || selection.clip.assetId}</p>
                <p className="text-[11px] text-emerald-100/70">{selection.track.label} · starts {formatDuration(selection.clip.startSec)} · {Math.round(selection.clip.durationSec)}s</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-emerald-50/80">Click a clip block in any lane first, then split or remove it here.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={handleSplit} disabled={!selection || !onProjectChange || selection.clip.durationSec < 1}>
              <Scissors size={14} className="mr-1.5" /> Split clip
            </Button>
            <Button variant="ghost" className="text-xs px-3 py-1.5" onClick={handleRemove} disabled={!selection || !onProjectChange}>
              <Trash2 size={14} className="mr-1.5" /> Remove clip
            </Button>
          </div>
        </div>

        {lanes}
      </div>
    </Card>
  );
}
