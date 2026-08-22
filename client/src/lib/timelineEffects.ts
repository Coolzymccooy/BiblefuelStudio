/**
 * Effects-track helpers.
 *
 * The renderer has been able to compose transitions, glow, colour grades and
 * light leaks for some time (server/src/lib/timelineRender/effects.js), but no
 * UI could create an effect clip, so the Effects lane was permanently empty and
 * its "Add transitions, glow, grade and light leaks" hint was a promise nothing
 * kept. These helpers are the missing half.
 *
 * All functions are PURE: they take a project and return a new one. Nothing
 * here touches React state or storage — the caller does that in a separate
 * statement, which is what keeps effects out of state updaters.
 */
import type {
  TimelineProject,
  TimelineClip,
  TimelineEffectKind,
  TimelineEffectOptions,
  TimelineAsset,
} from './timelineProject';

/** Longest a transition may run. It joins two scenes, so it must stay short. */
const MAX_TRANSITION_SEC = 1;
const DEFAULT_TRANSITION_SEC = 0.6;
/** A look/glow that runs the whole scene is usually wrong; start modest. */
const DEFAULT_EFFECT_SEC = 4;

/**
 * Per-effect defaults, chosen to match the server's own fallbacks so an effect
 * added with one click renders identically to one configured by hand.
 */
export const DEFAULT_EFFECT_OPTIONS: Record<TimelineEffectKind, TimelineEffectOptions> = {
  transition: { style: 'fade' },
  glow: { intensity: 0.45, radius: 12 },
  grade: { look: 'warm' },
  lightleak: { colour: 'warm', intensity: 0.5, angle: 45 },
};

const EFFECT_LABELS: Record<TimelineEffectKind, string> = {
  transition: 'Transition',
  glow: 'Glow',
  grade: 'Grade',
  lightleak: 'Light leak',
};

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Human label for a clip block, e.g. "Grade · cinematic". */
export function effectClipLabel(
  effect: TimelineEffectKind,
  options: TimelineEffectOptions = {},
): string {
  const base = EFFECT_LABELS[effect] || effect;
  const detail = options.style || options.look || options.colour;
  return detail ? `${base} · ${detail}` : base;
}

export interface AddEffectInput {
  sceneId: string;
  effect: TimelineEffectKind;
  options?: TimelineEffectOptions;
  durationSec?: number;
}

/**
 * Attach an effect to a scene. Returns the project unchanged if the scene or
 * the effects track is missing, so a stale id can never throw mid-render.
 */
export function addEffectToScene(
  project: TimelineProject,
  input: AddEffectInput,
): TimelineProject {
  const scene = project.scenes.find((s) => s.id === input.sceneId);
  const track = project.tracks.find((t) => t.kind === 'effects');
  if (!scene || !track) return project;

  const options = { ...DEFAULT_EFFECT_OPTIONS[input.effect], ...(input.options || {}) };
  const isTransition = input.effect === 'transition';

  // A transition JOINS the previous scene to this one, so it straddles the
  // boundary. Everything else sits inside the scene and is clamped to it —
  // an effect running past its scene would bleed into the next one.
  const durationSec = isTransition
    ? Math.min(MAX_TRANSITION_SEC, input.durationSec ?? DEFAULT_TRANSITION_SEC)
    : Math.min(scene.targetDurationSec, input.durationSec ?? DEFAULT_EFFECT_SEC);
  const startSec = isTransition
    ? Math.max(0, scene.startSec - durationSec / 2)
    : scene.startSec;

  const asset: TimelineAsset = {
    id: makeId('asset-effect'),
    kind: 'effect',
    source: 'system',
    label: effectClipLabel(input.effect, options),
    tags: ['effect', input.effect],
  };

  const clip: TimelineClip = {
    id: makeId('clip-effect'),
    assetId: asset.id,
    startSec,
    durationSec,
    transform: { fit: 'cover' },
    effect: input.effect,
    effectOptions: options,
  };

  return {
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
    tracks: project.tracks.map((t) =>
      t.kind === 'effects'
        ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.startSec - b.startSec) }
        : t,
    ),
    updatedAt: project.updatedAt,
  };
}

/** Remove one effect clip and the asset it owned. */
export function removeEffectClip(project: TimelineProject, clipId: string): TimelineProject {
  const track = project.tracks.find((t) => t.kind === 'effects');
  const clip = track?.clips.find((c) => c.id === clipId);
  if (!track || !clip) return project;

  // Drop the asset too: effect assets are owned by exactly one clip, so
  // leaving them behind would grow the project on every add/remove cycle.
  const assets = { ...project.assets };
  delete assets[clip.assetId];

  return {
    ...project,
    assets,
    tracks: project.tracks.map((t) =>
      t.kind === 'effects' ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
    ),
  };
}

export interface RenderableEffect {
  effect: TimelineEffectKind;
  startSec: number;
  durationSec: number;
  options: TimelineEffectOptions;
}

/**
 * Flatten the effects track into the payload the renderer consumes. The key
 * names match what normalizeEffectClip() reads on the server; changing them
 * here silently drops effects from the render.
 */
export function collectEffectsForRender(project: TimelineProject): RenderableEffect[] {
  const track = project.tracks.find((t) => t.kind === 'effects');
  if (!track) return [];
  return track.clips
    .filter((c) => Boolean(c.effect))
    .map((c) => ({
      effect: c.effect as TimelineEffectKind,
      startSec: c.startSec,
      durationSec: c.durationSec,
      options: c.effectOptions || {},
    }))
    .sort((a, b) => a.startSec - b.startSec);
}
