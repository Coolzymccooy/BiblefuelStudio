/**
 * ASS events for a lyric video's branding: the artist name line, the intro credit and the end
 * card. Only `Dialogue:` lines come back (no header); the caller adds them to the caption
 * events and the `Kinetic` style from kinetic/ass.js.
 *
 * Branding text keeps the user's own capitalisation (the look's `uppercase` is not applied).
 * Every user string goes through assEscape, so `{`, `}` and `\` can never open an override.
 */
import { assEscape, assColour, assTime, fitSize, widthAt } from "../kinetic/text.js";
import { fontsFor } from "../kinetic/effects/common.js";

const GOLD = "#E6C47A";
const LAYER_BAND = 20;
const LAYER_CARD_TEXT = 21;
const NAME_FLOOR_FS = 14;
const BAND_BORD = 2;
const NAME_RIGHT_EDGE = 0.88;
const CARD_WIDTH = 0.84;
const ELLIPSIS = "…";
const NOTE = "♪";
const EM_DASH = "—";

/** Y of the end card's title and its two sizes, as fractions of the frame height. */
const CARD = {
  tall: { yLogo: 0.58, yPlain: 0.47, title: 0.05, by: 0.032 },
  wide: { yLogo: 0.62, yPlain: 0.47, title: 0.065, by: 0.04 },
};
const BY_OFFSET = 0.07;

/** ASS colour in the short `&HBBGGRR&` form. */
const colour = (hex) => assColour(hex).replace("&H00", "&H");

/** User text made safe for a Dialogue and tidy: no overrides, no control characters, one space between words. */
const clean = (s) => assEscape(s ?? "").replace(/\s+/gu, " ").trim();

const dialogue = (layer, [start, end], tags, text) =>
  `Dialogue: ${layer},${assTime(start)},${assTime(end)},Kinetic,,0,0,0,,{${tags}}${text}`;

/** The body font for the whole line (fontsFor falls back for missing glyphs), the largest size that fits, and whether it does. */
function layOut(look, text, preferred, maxWidth, min) {
  const font = fontsFor(look, text).body;
  let fs = fitSize(font.file, [text], preferred, maxWidth, min);
  while (fs > min && widthAt(font.file, text, fs) > maxWidth) fs -= 1;
  return { font, fs, fits: widthAt(font.file, text, fs) <= maxWidth };
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The first `n` whole letters of `text` (an accent stays with its letter), then an ellipsis. */
const cutAt = (graphemes, n) => `${graphemes.slice(0, n).join("").trimEnd()}${ELLIPSIS}`;

/**
 * Cuts parts[index] to the longest prefix (by grapheme cluster) that makes the line fit, and
 * returns the parts and layout. When even a bare ellipsis does not fit, that part is left as an
 * ellipsis and the caller moves on to the next part.
 */
function cutPart(parts, index, measure) {
  const graphemes = Array.from(GRAPHEMES.segment(parts[index]), (s) => s.segment);
  const withCut = (n) => parts.map((p, i) => (i === index ? cutAt(graphemes, n) : p));
  let best = { parts: withCut(0), ...measure(withCut(0)) };
  let lo = 1;
  let hi = graphemes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = withCut(mid);
    const laid = measure(candidate);
    if (laid.fits) { best = { parts: candidate, ...laid }; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/**
 * Fits `wrap(parts)` into `maxWidth` with `bord` of outline each side: shrinks the size first,
 * and when even the floor size is too wide cuts the parts in order (the title, then the artist),
 * each by whole letters and ending in an ellipsis. `wrap` puts the parts into the full line.
 */
function fitLine({ look, parts, wrap, preferred, maxWidth, bord, min }) {
  const room = Math.max(1, maxWidth - 2 * bord);
  const measure = (p) => {
    const text = wrap(p);
    return { text, ...layOut(look, text, preferred, room, min) };
  };
  let result = { parts, ...measure(parts) };
  for (let i = 0; i < parts.length && !result.fits; i += 1) {
    result = cutPart(result.parts, i, measure);
  }
  return result;
}

/** The common head of the name line and the intro credit: left-centre, gold, small outline. */
function bandTags({ geometry, fitted }) {
  const { x, y } = geometry.text;
  return `\\an4\\pos(${x},${y})\\fn${fitted.font.family}\\fs${fitted.fs}\\c${colour(GOLD)}\\bord${BAND_BORD}\\shad1\\fad(250,250)`;
}

function bandMaxWidth({ geometry, w }) {
  return NAME_RIGHT_EDGE * w - geometry.text.x;
}

/** The artist's name, once per stretch where the logo is showing without the intro credit. */
function nameEvents({ plan, geometry, look, artist, w }) {
  const name = clean(artist);
  if (!name || !plan.wordmark.length) return [];
  const fitted = fitLine({
    look, parts: [name], wrap: ([s]) => s, preferred: geometry.text.fs, maxWidth: bandMaxWidth({ geometry, w }), bord: BAND_BORD, min: NAME_FLOOR_FS,
  });
  const tags = bandTags({ geometry, fitted });
  return plan.wordmark.map((piece) => dialogue(LAYER_BAND, piece, tags, fitted.text));
}

/** `♪ {title} — song by {artist}`, or `♪ {title}` when there is no artist. */
function introEvents({ plan, geometry, look, title, artist, w }) {
  const song = clean(title);
  if (!song || !plan.intro.length) return [];
  const by = clean(artist);
  const wrap = ([s, a]) => (a ? `${NOTE} ${s} ${EM_DASH} song by ${a}` : `${NOTE} ${s}`);
  const fitted = fitLine({
    look, parts: by ? [song, by] : [song], wrap, preferred: geometry.text.fs, maxWidth: bandMaxWidth({ geometry, w }), bord: BAND_BORD, min: NAME_FLOOR_FS,
  });
  const tags = bandTags({ geometry, fitted });
  return plan.intro.map((piece) => dialogue(LAYER_BAND, piece, tags, fitted.text));
}

/** One centred line of end card text. */
function cardLine({ look, user, wrap, y, size, colourHex, bord, span, w }) {
  const fitted = fitLine({ look, parts: [user], wrap, preferred: size, maxWidth: CARD_WIDTH * w, bord, min: NAME_FLOOR_FS });
  const tags = `\\an5\\pos(${Math.round(w / 2)},${Math.round(y)})\\fn${fitted.font.family}\\fs${fitted.fs}`
    + `\\c${colour(colourHex ?? fitted.font.colour)}\\bord${bord}\\shad1\\fad(500,0)`;
  return dialogue(LAYER_CARD_TEXT, span, tags, fitted.text);
}

/** A dim over the whole frame, then the title and "Song by" artist. */
function endCardEvents({ plan, look, title, artist, w, h }) {
  if (!plan.endCard) return [];
  const span = [plan.endCard.start, plan.endCard.end];
  const dim = dialogue(
    LAYER_BAND, span,
    "\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c&H000000&\\1a&H21&\\fad(400,0)",
    `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\\p0}`,
  );
  const shape = CARD[w < h ? "tall" : "wide"];
  const y = (plan.showLogo ? shape.yLogo : shape.yPlain) * h;
  const out = [dim];
  const song = clean(title);
  const by = clean(artist);
  const common = { look, span, w, wrap: ([s]) => s };
  if (song) out.push(cardLine({ ...common, user: song, y, size: shape.title * h, bord: 3 }));
  if (by) {
    out.push(cardLine({
      ...common, user: by, wrap: ([s]) => `Song by ${s}`, y: y + BY_OFFSET * h, size: shape.by * h, colourHex: GOLD, bord: 2,
    }));
  }
  return out;
}

/**
 * The branding's Dialogue lines for one render. `plan` is planBranding's answer and `geometry`
 * is bandGeometry's for the same frame, so the text sits where the logo box leaves it.
 */
export function brandingEvents({ plan, geometry, look, title, artist, w, h }) {
  const args = { plan, geometry, look, title, artist, w, h };
  return [...nameEvents(args), ...introEvents(args), ...endCardEvents(args)];
}
