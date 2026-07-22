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
}

const TRACK_ICON: Record<TimelineTrackKind, typeof Film> = {
  video: Film,
  broll: Sparkles,
  voiceover: Mic2,
  music: Music,
  captions: Subtitles,
  effects: Wand2,
};

const EMPTY_HINT: Record<TimelineTrackKind, string> = {
  video: 'Drop or insert video clips here',
  broll: 'Generate Veo B-roll or add cutaways',
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

export function VisualTimelineCanvas({ project, onProjectChange, onRequestVeoBroll }: VisualTimelineCanvasProps) {
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
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => onRequestVeoBroll?.(buildVeoPrompt(project))}>
              <Sparkles size={14} className="mr-1.5" /> Generate Veo B-roll
            </Button>
          </div>
        </div>

        {selection && (
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">Selected clip</p>
              <p className="mt-1 text-sm text-emerald-50">{selection.asset?.label || selection.clip.assetId}</p>
              <p className="text-[11px] text-emerald-100/70">{selection.track.label} · starts {formatDuration(selection.clip.startSec)} · {Math.round(selection.clip.durationSec)}s</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={handleSplit} disabled={!onProjectChange || selection.clip.durationSec < 1}>
                <Scissors size={14} className="mr-1.5" /> Split clip
              </Button>
              <Button variant="ghost" className="text-xs px-3 py-1.5" onClick={handleRemove} disabled={!onProjectChange}>
                <Trash2 size={14} className="mr-1.5" /> Remove clip
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="min-w-[920px] space-y-3">
            <div className="ml-36 flex h-20 items-stretch gap-1" aria-label="Scene ruler">
              {project.scenes.map((scene) => {
                const widthPct = Math.max(8, (scene.targetDurationSec / target) * 100);
                return (
                  <div
                    key={scene.id}
                    aria-label={`Scene block: ${scene.label}`}
                    draggable
                    className="group relative min-w-28 rounded-lg border border-primary-500/25 bg-gradient-to-br from-primary-500/15 to-amber-500/10 p-2 shadow-inner outline-none transition hover:border-primary-300/60"
                    style={{ flexBasis: `${widthPct}%` }}
                    title={scene.voiceoverBrief}
                  >
                    <p className="truncate text-[11px] font-semibold text-primary-100">{scene.label}</p>
                    <p className="mt-1 text-[10px] text-content-tertiary">{formatDuration(scene.startSec)} · {Math.round(scene.targetDurationSec)}s</p>
                    <div className="absolute inset-x-2 bottom-2 h-1 rounded-full bg-primary-400/30" />
                  </div>
                );
              })}
            </div>

            <div className="space-y-2">
              {project.tracks.map((track) => {
                const Icon = TRACK_ICON[track.kind];
                return (
                  <div
                    key={track.id}
                    aria-label={`Track lane: ${track.label}`}
                    className="grid grid-cols-[9rem_1fr] items-stretch gap-2"
                  >
                    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <Icon size={15} className="text-primary-200" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-gray-100">{track.label}</p>
                        <p className="text-[10px] text-content-tertiary">{track.clips.length} clip{track.clips.length === 1 ? '' : 's'}</p>
                      </div>
                    </div>

                    <div className="relative min-h-14 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-2">
                      {track.clips.length === 0 ? (
                        <div className="flex h-10 items-center justify-center rounded-md bg-black/20 text-[11px] text-content-tertiary">
                          {EMPTY_HINT[track.kind]}
                        </div>
                      ) : (
                        <div className="relative h-12">
                          {track.clips.map((clip) => {
                            const asset = project.assets[clip.assetId];
                            const proxy = proxyLabel(asset);
                            const previewMode = previewModeLabel(asset);
                            const leftPct = Math.max(0, Math.min(96, (clip.startSec / target) * 100));
                            const widthPct = Math.max(5, Math.min(100 - leftPct, (clip.durationSec / target) * 100));
                            const selected = selectedClipId === clip.id;
                            return (
                              <button
                                key={clip.id}
                                type="button"
                                aria-label={`Timeline clip: ${asset?.label || clip.assetId}`}
                                draggable
                                onClick={() => setSelectedClipId(clip.id)}
                                className={`absolute top-1 h-10 rounded-md border px-2 py-1 text-left text-[10px] shadow-sm transition ${selected ? 'border-emerald-200 bg-emerald-400/30 text-white ring-2 ring-emerald-300/40' : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-50 hover:border-emerald-200/70'}`}
                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                title={`${asset?.label || clip.assetId} · ${sourceLabel(asset)} · ${Math.round(clip.durationSec)}s · ${previewMode}`}
                              >
                                <p className="truncate font-semibold">{asset?.label || clip.assetId}</p>
                                <p className="truncate text-emerald-100/75">{sourceLabel(asset)} · {Math.round(clip.durationSec)}s{proxy ? ` · ${proxy}` : ''}</p>
                              </button>
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
      </div>
    </Card>
  );
}
