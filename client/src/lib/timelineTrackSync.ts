/**
 * Mirror the page's "sidecar" state onto the timeline's own tracks.
 *
 * Two timeline models coexist on the Timeline page: the sidecar state the
 * panels edit (musicPaths, caption lines) and `documentaryProject.tracks`,
 * which is what the operator SEES in the strip. Only the first was ever fed to
 * the renderer, so adding a music bed or transcribing captions left the Music
 * bed and Captions lanes reading "0 clips" — the timeline disagreed with the
 * app about what the video contained.
 *
 * This projects the sidecar state onto those two lanes so the strip tells the
 * truth. It is PURE and IDEMPOTENT: same input, same project reference back, so
 * it is safe to call from an effect without looping.
 */
import type { TimelineProject, TimelineClip, TimelineAsset } from './timelineProject';

export interface SidecarState {
  musicPaths: string[];
  captionLines: string[];
}

/** Assets this module owns. Anything else on these lanes is left alone. */
const OWNED_TAG = 'sidecar-sync';

function fileLabel(path: string): string {
  return path.split(/[\/]/).pop() || 'audio';
}

/** Deterministic ids: identical input must produce an identical project. */
function assetId(kind: string, key: string): string {
  return `asset-${OWNED_TAG}-${kind}-${key}`;
}
function clipId(kind: string, key: string): string {
  return `clip-${OWNED_TAG}-${kind}-${key}`;
}

function buildMusic(paths: string[], targetSec: number) {
  const assets: TimelineAsset[] = [];
  const clips: TimelineClip[] = [];
  if (paths.length === 0) return { assets, clips };

  // Split the runtime evenly. The renderer decides actual playback order and
  // looping; the lane only has to show that music is present and in what order.
  const each = targetSec / paths.length;
  paths.forEach((path, i) => {
    const key = String(i);
    assets.push({
      id: assetId('music', key),
      kind: 'audio',
      source: 'upload',
      label: fileLabel(path),
      path,
      tags: [OWNED_TAG, 'music'],
    });
    clips.push({
      id: clipId('music', key),
      assetId: assetId('music', key),
      startSec: Math.round(each * i),
      durationSec: Math.round(each),
      transform: { fit: 'cover' },
    });
  });
  return { assets, clips };
}

function buildCaptions(lines: string[], targetSec: number) {
  const assets: TimelineAsset[] = [];
  const clips: TimelineClip[] = [];
  if (lines.length === 0) return { assets, clips };

  // One clip PER LINE, each carrying its text. The renderer burns
  // `clip.text` between the clip's start and end; a single lane-wide clip
  // with only a label rendered NO captions at all (the picture played, the
  // words never appeared). Lines split the runtime evenly - the same slots
  // the live stage uses, so preview and render agree. The one shared asset
  // keeps the lane header's count ("N caption lines").
  assets.push({
    id: assetId('captions', 'all'),
    kind: 'caption',
    source: 'system',
    label: `${lines.length} caption line${lines.length === 1 ? '' : 's'}`,
    tags: [OWNED_TAG, 'captions'],
  });
  const slot = targetSec / lines.length;
  lines.forEach((line, i) => {
    clips.push({
      id: clipId('captions', String(i)),
      assetId: assetId('captions', 'all'),
      startSec: Math.round(i * slot * 1000) / 1000,
      durationSec: Math.round(slot * 1000) / 1000,
      transform: { fit: 'cover' },
      text: line,
    });
  });
  return { assets, clips };
}

export function syncSidecarTracks(
  project: TimelineProject,
  state: SidecarState,
): TimelineProject {
  const targetSec = Math.max(1, project.targetDurationSec);
  const music = buildMusic(state.musicPaths, targetSec);
  const captions = buildCaptions(state.captionLines, targetSec);

  const desired: Record<string, { assets: TimelineAsset[]; clips: TimelineClip[] }> = {
    music,
    captions,
  };

  // Idempotence check BEFORE building a new object, so an effect calling this
  // on every render does not loop forever.
  const unchanged = Object.entries(desired).every(([kind, next]) => {
    const current = project.tracks.find((t) => t.kind === kind)?.clips || [];
    const owned = current.filter((c) => c.id.includes(OWNED_TAG));
    const foreign = current.filter((c) => !c.id.includes(OWNED_TAG));
    // Compare the ASSET each clip points at, not just the clip id. Ids are
    // positional (music-0, music-1), so swapping one bed for another keeps
    // every id and duration identical - comparing those alone returned "no
    // change" and the lane kept showing the OLD filename.
    return (
      foreign.length === 0 &&
      owned.length === next.clips.length &&
      owned.every((c, i) => {
        const want = next.clips[i];
        const have = project.assets[c.assetId];
        const wantAsset = [...music.assets, ...captions.assets].find((a) => a.id === want.assetId);
        return (
          c.id === want.id &&
          c.durationSec === want.durationSec &&
          (c.text || '') === (want.text || '') &&
          have?.path === wantAsset?.path &&
          have?.label === wantAsset?.label
        );
      })
    );
  });
  if (unchanged) return project;

  const assets = { ...project.assets };
  // Drop every asset this module previously owned, then re-add the current set.
  // Without this, changing the music bed would leave the old asset behind and
  // the project would grow on every edit.
  for (const id of Object.keys(assets)) {
    if (id.includes(OWNED_TAG)) delete assets[id];
  }
  for (const a of [...music.assets, ...captions.assets]) assets[a.id] = a;

  return {
    ...project,
    assets,
    tracks: project.tracks.map((t) => {
      const next = desired[t.kind];
      if (!next) return t;
      // Preserve anything the operator placed on these lanes by hand.
      const foreign = t.clips.filter((c) => !c.id.includes(OWNED_TAG));
      return { ...t, clips: [...foreign, ...next.clips].sort((a, b) => a.startSec - b.startSec) };
    }),
  };
}
