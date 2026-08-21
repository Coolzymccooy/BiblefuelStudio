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

/**
 * Build a timed bloom/glow.
 *
 * A real bloom is a blurred, brightened copy of the frame blended back over
 * the original — not a brightness bump, which just washes the image out. The
 * source is split, one leg blurred and lifted, then blended with `screen` so
 * highlights bloom while shadows stay put.
 *
 * `enable` gates the BLEND, so the effect appears only for the clip's window
 * and the untouched frame passes through the rest of the time.
 *
 * @param {{clip: object, inLabel: string, outLabel: string, index?: number}} params
 * @returns {string} an ffmpeg filtergraph fragment
 */
export function buildGlowFilter({ clip, inLabel, outLabel, index = 0 }) {
  const { startSec, durationSec, options } = normalizeEffectClip(clip);
  const end = startSec + durationSec;

  // 0..1. Clamped because a >1 opacity is invalid and a negative one silently
  // disables the effect, which is the failure mode this module exists to avoid.
  const intensity = Math.max(0, Math.min(1, num(options.intensity ?? clip?.intensity, 0.45)));
  const radius = Math.max(1, Math.min(50, num(options.radius ?? clip?.radius, 12)));

  // Unique intermediate labels so multiple glows can chain in one graph.
  const base = `gb${index}`;
  const src = `[${base}src]`;
  const blur = `[${base}blur]`;

  return (
    `${inLabel}split=2${src}${blur};` +
    // Lift the blurred leg before blending so the bloom reads as light,
    // not as a grey haze.
    `${blur}gblur=sigma=${radius},eq=brightness=0.06:saturation=1.05[${base}lit];` +
    `${src}[${base}lit]blend=all_mode=screen:all_opacity=${intensity}` +
    `:enable='between(t,${startSec},${end})'${outLabel}`
  );
}

/**
 * Build a timed colour grade.
 *
 * Named looks are the common case (a church picks "warm" for worship, "cool"
 * for testimony), but every parameter can be overridden individually so the
 * looks are a starting point rather than a cage.
 *
 * All values are clamped to ffmpeg's valid `eq` ranges. Out-of-range input
 * makes ffmpeg reject the whole filtergraph, which would fail an entire
 * service render because of one mistyped number.
 *
 * @param {{clip: object, inLabel: string, outLabel: string}} params
 * @returns {string} an ffmpeg filtergraph fragment
 */
export function buildGradeFilter({ clip, inLabel, outLabel }) {
  const { startSec, durationSec, options } = normalizeEffectClip(clip);
  const end = startSec + durationSec;

  const lookName = String(options.look ?? clip?.look ?? 'warm').toLowerCase();
  const look = GRADE_LOOKS[lookName] || GRADE_LOOKS.warm;

  const pick = (key, fallback, min, max) => {
    const raw = options[key] ?? clip?.[key] ?? fallback;
    return Math.max(min, Math.min(max, num(raw, fallback)));
  };

  // Ranges per ffmpeg's eq filter documentation.
  const contrast = pick('contrast', look.contrast, -2, 2);
  const brightness = pick('brightness', look.brightness, -1, 1);
  const saturation = pick('saturation', look.saturation, 0, 3);
  const gammaR = pick('gamma_r', look.gamma_r, 0.1, 10);
  const gammaB = pick('gamma_b', look.gamma_b, 0.1, 10);

  return (
    `${inLabel}eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}` +
    `:gamma_r=${gammaR}:gamma_b=${gammaB}` +
    `:enable='between(t,${startSec},${end})'${outLabel}`
  );
}

/** Light-leak colours, as ffmpeg gradient stop pairs. */
export const LEAK_COLOURS = Object.freeze({
  warm: { c0: '0xff8a3d', c1: '0xffd98a' },
  cool: { c0: '0x3d9bff', c1: '0x8ad8ff' },
  gold: { c0: '0xffb347', c1: '0xfff3c4' },
});

/**
 * Build a timed light leak.
 *
 * A leak is a soft coloured gradient washing across the frame, blended with
 * `screen` so it ADDS light rather than covering the image. It is generated
 * rather than loaded from a file, so no asset shipping is required and it
 * scales to any canvas size.
 *
 * The opacity ramps up and back down across the clip instead of switching on:
 * a hard on/off reads as a glitch, not as light falling across a lens. The
 * ramp is expressed as a time function so a single gradient input can serve
 * the whole effect.
 *
 * @param {{clip: object, inLabel: string, outLabel: string, width: number, height: number, index?: number}} params
 * @returns {string} an ffmpeg filtergraph fragment
 */
export function buildLightLeakFilter({ clip, inLabel, outLabel, width, height, index = 0 }) {
  const { startSec, durationSec, options } = normalizeEffectClip(clip);
  const end = startSec + durationSec;
  const w = Math.max(2, Math.round(num(width, 1280)));
  const h = Math.max(2, Math.round(num(height, 720)));

  const colourName = String(options.colour ?? clip?.colour ?? 'warm').toLowerCase();
  const colour = LEAK_COLOURS[colourName] || LEAK_COLOURS.warm;

  const peak = Math.max(0, Math.min(1, num(options.intensity ?? clip?.intensity, 0.5)));
  const angle = Math.round(num(options.angle ?? clip?.angle, 45));

  const base = `ll${index}`;
  const grad = `[${base}grad]`;

  // The ramp CANNOT go on blend's all_opacity: that option takes a constant,
  // and passing a time expression makes ffmpeg reject the filtergraph
  // ("Undefined constant or missing '('"). Caught by rendering, not by unit
  // tests — the string looked perfectly reasonable.
  //
  // Instead the gradient itself is faded in and out, so the leak still swells
  // and recedes rather than popping on, and blend keeps a constant opacity.
  const fadeSec = Math.max(0.1, Math.min(durationSec / 2, 0.6));
  const fadeOutStart = Math.max(0, durationSec - fadeSec);

  // The gradient runs from the leak colour to BLACK, not to a second bright
  // colour: with `screen` blending, black is a no-op, so the leak falls off to
  // nothing across the frame instead of washing the whole image. An earlier
  // version blended two bright stops and produced a solid pink rectangle that
  // covered the shot — visible only by looking at a rendered frame.
  //
  // A heavy blur after rotation hides the rotated rectangle's hard corners,
  // which otherwise read as a graphic overlay rather than light on a lens.
  const softness = Math.round(Math.max(w, h) * 0.12);

  return (
    `gradients=s=${w}x${h}:c0=${colour.c0}:c1=0x000000:x0=0:y0=0:x1=${Math.round(w * 0.7)}:y1=${Math.round(h * 0.7)}` +
    `:nb_colors=2:speed=0.005:duration=${Math.max(1, Math.ceil(end))}${grad};` +
    `${grad}rotate=${angle}*PI/180:c=black@0:ow=${w}:oh=${h},` +
    `gblur=sigma=${softness},` +
    `fade=t=in:st=0:d=${fadeSec}:alpha=1,` +
    `fade=t=out:st=${fadeOutStart}:d=${fadeSec}:alpha=1,` +
    `tpad=start_duration=${startSec}:start_mode=clone[${base}rot];` +
    `${inLabel}[${base}rot]blend=all_mode=screen:all_opacity=${peak}` +
    `:enable='between(t,${startSec},${end})'${outLabel}`
  );
}
