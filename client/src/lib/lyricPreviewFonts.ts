/**
 * The fonts the live caption preview can draw, keyed by lower-cased family name as
 * JASSUB expects. The caption engine (server/src/lib/kinetic) only ever names the body and
 * hit font of a look (looks.js) and its DejaVu Sans fallback for letters those fonts lack
 * (ẹ, ọ, ṣ ...); the effects take their family from those, never from a literal.
 * lyricPreviewFonts.test.ts checks this list against looks.js and the font folder.
 */
export const CAPTION_FONT_BASE = '/caption-fonts';

export const CAPTION_FONTS: Readonly<Record<string, string>> = Object.freeze({
  'permanent marker': `${CAPTION_FONT_BASE}/PermanentMarker.ttf`,
  knewave: `${CAPTION_FONT_BASE}/Knewave-Regular.ttf`,
  anton: `${CAPTION_FONT_BASE}/Anton.ttf`,
  'playfair display': `${CAPTION_FONT_BASE}/PlayfairDisplay-BoldItalic.ttf`,
  caveat: `${CAPTION_FONT_BASE}/Caveat-Bold.ttf`,
  'dejavu sans': `${CAPTION_FONT_BASE}/DejaVuSans.ttf`,
});

/** The family used for a phrase the look's own fonts cannot draw. */
export const CAPTION_FALLBACK_FONT = 'dejavu sans';
