// Effects track composition.
//
// The Effects lane advertises "transitions, glow, grade and light leaks" but
// nothing composed it — clips dropped there were skipped. This module turns an
// effects clip into the ffmpeg filter fragment that realises it.
//
// An effects clip is identified by `effect` (the kind) rather than by a media
// path, because most of these are generated filters rather than files. A clip
// with no recognised `effect` is reported as unsupported rather than silently
// ignored, so the operator always learns why nothing happened.
//
// SCOPE: these are the four the UI promises. Everything is a real ffmpeg
// filter — nothing is faked or approximated into a no-op, because an effect
// that silently does nothing is exactly the problem this replaces.

/** Effect kinds this renderer can compose. */
export const SUPPORTED_EFFECTS = Object.freeze(['transition', 'glow', 'grade', 'lightleak']);

/** Transition styles, mapped to their ffmpeg xfade transition name. */
export const TRANSITION_STYLES = Object.freeze({
  fade: 'fade',
  dissolve: 'dissolve',
  wipeleft: 'wipeleft',
  wiperight: 'wiperight',
  slideup: 'slideup',
  slidedown: 'slidedown',
  circleopen: 'circleopen',
  radial: 'radial',
});

/** Colour-grade looks. Values are eq/curve parameters, not presets by name. */
export const GRADE_LOOKS = Object.freeze({
  // Warm, slightly lifted — the default "worship" look.
  warm: { contrast: 1.06, brightness: 0.02, saturation: 1.12, gamma_r: 1.05, gamma_b: 0.96 },
  // Cool and clean, for testimony/interview segments.
  cool: { contrast: 1.08, brightness: 0.0, saturation: 0.95, gamma_r: 0.97, gamma_b: 1.06 },
  // Filmic: crushed a touch, desaturated highlights.
  cinematic: { contrast: 1.15, brightness: -0.02, saturation: 0.92, gamma_r: 1.02, gamma_b: 1.02 },
  // Punchy for praise/dance sections.
  vivid: { contrast: 1.12, brightness: 0.03, saturation: 1.3, gamma_r: 1.0, gamma_b: 1.0 },
});

const DEFAULT_TRANSITION_SEC = 0.6;
const DEFAULT_EFFECT_SEC = 2;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize an effects clip into a predictable shape.
 * @param {object} clip
 * @returns {{kind:string, startSec:number, durationSec:number, options:object}}
 */
export function normalizeEffectClip(clip) {
  const kind = String(clip?.effect || clip?.kind || '').trim().toLowerCase();
  const startSec = Math.max(0, num(clip?.startSec, 0));
  const durationSec = Math.max(
    0.1,
    num(clip?.durationSec, kind === 'transition' ? DEFAULT_TRANSITION_SEC : DEFAULT_EFFECT_SEC),
  );
  return { kind, startSec, durationSec, options: clip?.options || clip || {} };
}

/**
 * Is this clip something the renderer can compose?
 * @param {object} clip
 */
export function isSupportedEffect(clip) {
  return SUPPORTED_EFFECTS.includes(normalizeEffectClip(clip).kind);
}

/**
 * Build an xfade transition between two video streams.
 *
 * xfade OVERLAPS its inputs, so the caller must account for the borrowed time
 * — see sceneTransitions.js, which solves the same problem for story videos.
 * `offset` is measured on the accumulated timeline, not the outgoing clip.
 *
 * @param {{
 *   clip: object,
 *   fromLabel: string,
 *   toLabel: string,
 *   outLabel: string,
 *   maxDurationSec?: number
 * }} params
 * @returns {string} an ffmpeg filtergraph fragment
 */
export function buildTransitionFilter({ clip, fromLabel, toLabel, outLabel, maxDurationSec }) {
  const { startSec, durationSec, options } = normalizeEffectClip(clip);
  const requested = String(options.style || clip?.style || 'fade').toLowerCase();
  // Unknown styles fall back rather than passing an invalid name to ffmpeg,
  // which would fail the whole render for one bad clip.
  const transition = TRANSITION_STYLES[requested] || TRANSITION_STYLES.fade;

  const cap = Number.isFinite(Number(maxDurationSec)) ? Number(maxDurationSec) : Infinity;
  const duration = Math.max(0.1, Math.min(durationSec, cap));

  return `${fromLabel}${toLabel}xfade=transition=${transition}:duration=${duration}:offset=${startSec}${outLabel}`;
}
