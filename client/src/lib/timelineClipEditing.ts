import type { TimelineProject } from './timelineProject';

/** Numeric alternative to pointer editing, using the existing 1x source clock.
 * Sidecar timings are owned by syncSidecarTracks and must not be overwritten. */
export function editClipTiming(project: TimelineProject, clipId: string, timing: {
  startSec: number; sourceStartSec: number; durationSec: number;
}): TimelineProject {
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip || track.locked || track.hidden || clip.id.includes('sidecar-sync')) return project;
  const { startSec, sourceStartSec, durationSec } = timing;
  if (![startSec, sourceStartSec, durationSec].every(Number.isFinite) ||
      startSec < 0 || sourceStartSec < 0 || durationSec < 0.05 ||
      startSec + durationSec > project.targetDurationSec + 1e-6) return project;
  const asset = project.assets[clip.assetId];
  // A still has no source-media end. Unknown media duration is NOT fabricated:
  // only allow trimming within the already selected source interval.
  const limit = asset?.kind === 'image' || asset?.kind === 'effect' || asset?.kind === 'caption'
    ? Infinity : asset?.durationSec ?? ((clip.sourceStartSec || 0) + clip.durationSec);
  if (sourceStartSec + durationSec > limit + 1e-6) return project;
  if (asset?.kind !== 'image' && asset?.kind !== 'effect' && asset?.kind !== 'caption' && asset?.durationSec == null && sourceStartSec < (clip.sourceStartSec || 0)) return project;
  if (clip.startSec === startSec && (clip.sourceStartSec || 0) === sourceStartSec && clip.durationSec === durationSec) return project;
  return { ...project, updatedAt: new Date().toISOString(), tracks: project.tracks.map((t) => t.id !== track.id ? t : {
    ...t, clips: t.clips.map((c) => c.id !== clipId ? c : { ...c, ...timing }).sort((a, b) => a.startSec - b.startSec),
  }) };
}
