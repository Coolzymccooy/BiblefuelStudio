import type { TimelineProject, TimelineTrack } from './timelineProject';

/**
 * Hidden lanes, and the warning that stops one shipping silently.
 *
 * Hiding a lane excludes it from the render — normal NLE behaviour, decided
 * 2026-09-17. It is also the one editorial setting that can ship the WRONG
 * video without any error: hide the music bed to check a cut, forget, render
 * next week, and the sermon goes out silent. The server honours `hidden` in
 * both the validator and the plan builder; this is the client half, which
 * makes sure the operator is told before it happens.
 */

export interface HiddenLaneWarning {
  /** Lane labels, in lane order. */
  labels: string[];
  /** Ready to show in a confirm dialog. */
  message: string;
}

/** Track flags the lane controls can set. */
export type TrackFlag = 'hidden' | 'locked';

function tracksOf(project: TimelineProject | undefined): TimelineTrack[] {
  return Array.isArray(project?.tracks) ? project.tracks : [];
}

/**
 * What Render must say before it runs, or null when there is nothing to say.
 *
 * A hidden lane with NO clips is ignored: hiding an empty lane changes no
 * output, and warning about it would teach the operator to dismiss the dialog
 * unread — which would defeat the warning that matters.
 */
export function hiddenLaneWarning(project: TimelineProject): HiddenLaneWarning | null {
  const labels = tracksOf(project)
    .filter((track) => track?.hidden === true && Array.isArray(track.clips) && track.clips.length > 0)
    .map((track) => track.label || track.kind);

  if (labels.length === 0) return null;

  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const lanes = labels.length === 1 ? 'lane is' : 'lanes are';

  return {
    labels,
    message: `The ${list} ${lanes} hidden, so ${labels.length === 1 ? 'it' : 'they'} will not appear in the render. Render anyway?`,
  };
}

/** True when any lane would be left out of the render. */
export function hasHiddenLanes(project: TimelineProject): boolean {
  return hiddenLaneWarning(project) !== null;
}

/**
 * Set a lane flag, returning a new project. Immutable, as every other
 * timeline edit here is, and stamped so it persists like one.
 */
export function setTrackFlag(
  project: TimelineProject,
  trackId: string,
  flag: TrackFlag,
  value: boolean,
): TimelineProject {
  return {
    ...project,
    tracks: tracksOf(project).map((track) => (
      track.id === trackId ? { ...track, [flag]: value } : track
    )),
    updatedAt: new Date().toISOString(),
  };
}
