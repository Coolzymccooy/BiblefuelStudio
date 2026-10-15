/**
 * Branding plan: when does a lyric video show its logo, artist name, intro credit and end card,
 * and how long is the video? Pure arithmetic over the numbers the caller already has (the
 * caption bands' hide windows and the last caption's end come from captionBands.js), so the ASS
 * builder, the ffmpeg builder, the route and the client can all agree on one answer.
 */

export const SHORTS_TRIM_SEC = 179;
/** A song whose last caption leaves less than this much tail gets extended by it. */
export const TAIL_SEC = 3;
export const END_CARD_SEC = 4;
/** When the "song by" intro credit is on screen. */
export const INTRO = [0.8, 7.4];
/** Fade for branding appearing and leaving, in seconds. */
export const FADE = 0.25;

const SHORTS_FADE_SEC = 3;
const EXTENDED_FADE_SEC = 1.5;
/** A song counts as stopping abruptly when its sound runs to within this of the file's end. */
const ABRUPT_END_SEC = 0.3;
const END_CARD_GAP_SEC = 0.2;
const END_CARD_MIN_SEC = 2;
const BAND_MIN_SEC = 1;
const INTRO_MIN_SEC = 1.5;
/** Shorts must be 3:00 or less, so a line may not run past 2:58.5 when we cut at 2:59. */
const TRIM_LINE_LIMIT_SEC = 178.5;
const TRIM_MIN_SOURCE_SEC = 180;
const TRIM_MAX_SOURCE_SEC = 190;
/** Absorbs float noise in length comparisons (7.4 - 0.8 is not exactly 6.6). */
const EPS = 1e-9;

/** Where the band sits, as fractions of the frame. Landscape and square share the wide layout. */
const LAYOUT = {
  tall: { top: 0.115, left: 0.04, logoH: 0.055, textFs: 0.026, gap: 0.015 },
  wide: { top: 0.05, left: 0.04, logoH: 0.08, textFs: 0.036, gap: 0.012 },
};
/** The logo fits a box this many times wider than it is tall. */
const LOGO_MAX_ASPECT = 3;
/** Space between the band's bottom edge and the box, as a fraction of the frame height. */
const BAND_PAD = 0.01;

const round2 = (x) => Number(x.toFixed(2));

/** Interval helpers. Every list is sorted and non-overlapping. */

/** The gaps in `[lo, hi]` not covered by `windows` (which may be unsorted, overlapping or outside). */
function complement(windows, [lo, hi]) {
  const clipped = (windows || [])
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let cursor = lo;
  for (const [a, b] of clipped) {
    if (a > cursor) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (hi > cursor) gaps.push([cursor, hi]);
  return gaps;
}

/** The parts of `pieces` that fall inside `window`. */
function intersect(pieces, [lo, hi]) {
  return pieces
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)])
    .filter(([a, b]) => b > a);
}

/** The parts of `pieces` outside `window`. */
function subtract(pieces, window) {
  return pieces.flatMap((piece) => complement([window], piece));
}

/** Drops pieces shorter than `min` seconds. */
function minLength(pieces, min) {
  return pieces.filter(([a, b]) => b - a >= min - EPS);
}

const roundPieces = (pieces) => pieces.map(([a, b]) => [round2(a), round2(b)]);

/** Nearest even integer, at least 2: video encoders want even dimensions. */
const even = (n) => Math.max(2, 2 * Math.round(n / 2));

/**
 * Whether the Shorts trim (cut to 2:59) is offered, and whether it is safe. It is offered for
 * portrait songs of 3:00 to 3:10, and refused when a lyric line would be cut off.
 */
export function shortsTrimOffer({ aspect, durationSec, lines } = {}) {
  const offered = aspect === "portrait" && durationSec >= TRIM_MIN_SOURCE_SEC && durationSec <= TRIM_MAX_SOURCE_SEC;
  if (!offered) return { offered: false, allowed: false, reason: "Only for portrait songs between 3:00 and 3:10." };
  const cutsALine = (lines || []).some((l) => Number.isFinite(l?.end) && l.end > TRIM_LINE_LIMIT_SEC);
  if (cutsALine) return { offered: true, allowed: false, reason: "A lyric line ends after 2:58, so trimming would cut it." };
  return { offered: true, allowed: true, reason: "" };
}

/**
 * Pixel geometry of the branding band for a w x h frame: the logo box, where the artist name
 * starts (anchored left-centre) and the band's bottom edge. With no logo the box height still
 * sets the text position, so the band is the same size either way.
 */
export function bandGeometry({ w, h, logo }) {
  const L = w >= h ? LAYOUT.wide : LAYOUT.tall;
  const top = L.top * h;
  const boxH = even(L.logoH * h);
  let logoBox = null;
  let boxW = 0;
  if (logo && logo.width > 0 && logo.height > 0) {
    boxW = even(Math.min(LOGO_MAX_ASPECT * boxH, Math.round((boxH * logo.width) / logo.height)));
    logoBox = { x: Math.round(L.left * w), y: Math.round(top), w: boxW, h: boxH };
  }
  return {
    logo: logoBox,
    text: {
      x: Math.round(L.left * w + (logoBox ? boxW + L.gap * w : 0)),
      y: Math.round(top + boxH / 2),
      fs: Math.round(L.textFs * h),
    },
    bandBottom: Math.round(top + boxH + BAND_PAD * h),
  };
}

/** Video length and audio shaping: Shorts trim, tail extension, or the song as it is. */
function planTiming({ durationSec, audibleEnd, captionsEnd, endCardOn, trim }) {
  if (trim) {
    return {
      totalSec: SHORTS_TRIM_SEC,
      audio: {
        inputSec: SHORTS_TRIM_SEC, padToSec: SHORTS_TRIM_SEC,
        fadeFromSec: SHORTS_TRIM_SEC - SHORTS_FADE_SEC, fadeSec: SHORTS_FADE_SEC,
      },
    };
  }
  const extended = endCardOn && durationSec - captionsEnd < TAIL_SEC;
  const totalSec = extended ? durationSec + TAIL_SEC : durationSec;
  const abrupt = extended && audibleEnd >= durationSec - ABRUPT_END_SEC;
  return {
    totalSec,
    audio: {
      inputSec: durationSec,
      padToSec: totalSec,
      fadeFromSec: abrupt ? durationSec - EXTENDED_FADE_SEC : 0,
      fadeSec: abrupt ? EXTENDED_FADE_SEC : 0,
    },
  };
}

/** The end card takes the last 4 s but never covers a caption that is still showing. */
function planEndCard({ totalSec, captionsEnd, endCardOn }) {
  if (!endCardOn) return null;
  const start = Math.max(totalSec - END_CARD_SEC, captionsEnd + END_CARD_GAP_SEC);
  return totalSec - start < END_CARD_MIN_SEC ? null : { start, end: totalSec };
}

const DEFAULT_OPTIONS = { logo: true, intro: true, endCard: true };

/** Every toggle that is missing or not a boolean takes its default (on). */
function withDefaults(options) {
  const given = options && typeof options === "object" ? options : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_OPTIONS).map(([key, dflt]) => [key, typeof given[key] === "boolean" ? given[key] : dflt]),
  );
}

/**
 * Plans the branding for one render. `hideWindows` are the (padded, merged) windows where
 * captions reach the band; `captionsEnd` is when the last caption leaves the screen.
 * `aspect` and `lines` let the plan check the Shorts trim itself: a trim that is not allowed is
 * planned as no trim at all (the route refuses it earlier; this is defence in depth).
 */
export function planBranding({
  durationSec, audibleEnd, captionsEnd: rawCaptionsEnd, hideWindows, options: rawOptions, hasLogo, artist, shortsTrim, aspect, lines,
}) {
  const options = withDefaults(rawOptions);
  // A missing or broken caption end means "no captions", not NaN all through the plan.
  const captionsEnd = Number.isFinite(rawCaptionsEnd) ? rawCaptionsEnd : 0;
  const trim = Boolean(shortsTrim) && shortsTrimOffer({ aspect, durationSec, lines }).allowed;
  const { totalSec, audio } = planTiming({ durationSec, audibleEnd, captionsEnd, endCardOn: options.endCard, trim });
  const endCard = planEndCard({ totalSec, captionsEnd, endCardOn: options.endCard });

  // The intro credit and the logo toggle are independent, so work from the visible stretch.
  const visible = complement(hideWindows, [0, endCard ? endCard.start : totalSec]);
  const bandPieces = options.logo ? minLength(visible, BAND_MIN_SEC) : [];
  const intro = options.intro ? minLength(intersect(visible, INTRO), INTRO_MIN_SEC) : [];
  const named = typeof artist === "string" && artist.trim() !== "";
  // The name only steps aside for intro pieces that actually show, so a dropped short piece
  // leaves the name on screen rather than a bare logo.
  const wordmark = named ? minLength(intro.reduce(subtract, bandPieces), BAND_MIN_SEC) : [];

  return {
    totalSec: round2(totalSec),
    audio: {
      inputSec: round2(audio.inputSec),
      padToSec: round2(audio.padToSec),
      fadeFromSec: round2(audio.fadeFromSec),
      fadeSec: round2(audio.fadeSec),
    },
    bandPieces: roundPieces(bandPieces),
    intro: roundPieces(intro),
    wordmark: roundPieces(wordmark),
    showLogo: Boolean(options.logo && hasLogo),
    endCard: endCard ? { start: round2(endCard.start), end: round2(endCard.end) } : null,
  };
}
