import type { TimelineClip, TimelineProject, TimelineTrack } from './timelineProject';

/** The numeric editor commits all three clocks together. Only VO currently
 * renders all three: atrim(source in, duration) then adelay(composition start).
 * Main footage ignores these clocks; B-roll only gates an overlay window (and
 * can become the main input); music loops from zero. Do not promise partial
 * support for those lanes, captions or effects through this editor. */
export function clipTimingUnavailableReason(track: TimelineTrack, clip: TimelineClip): string | undefined {
  if (track.locked || track.hidden || clip.id.includes('sidecar-sync')) {
    return 'Timing is read-only: this lane is locked/hidden, or follows the Captions / Music tool.';
  }
  if (track.kind !== 'voiceover') {
    return 'Timing is not available for this track. Numeric Start, Source in and Duration edits are supported only for Voice-over export.';
  }
  return undefined;
}

/** Numeric alternative to pointer editing, using the existing 1x source clock.
 * Sidecar timings are owned by syncSidecarTracks and must not be overwritten. */
export function editClipTiming(project: TimelineProject, clipId: string, timing: {
  startSec: number; sourceStartSec: number; durationSec: number;
}): TimelineProject {
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip || clipTimingUnavailableReason(track, clip)) return project;
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
