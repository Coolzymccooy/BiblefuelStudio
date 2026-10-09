import fs from "fs";
import * as hb from "harfbuzzjs";

/**
 * Text widths straight from a TrueType font file, so a caption can place a
 * highlighted word where ffmpeg actually draws it.
 *
 * Captions used to assume every glyph is 0.6em wide (true of a typewriter
 * face only), so on any real font the highlighted word was drawn several
 * letters away from itself.
 *
 * How text is set depends on the ffmpeg doing the drawing (see
 * drawtextKerning.js), and each mode measures it that way:
 *   "shaped"  6.1 and later shape text with HarfBuzz: ligatures ("fi"),
 *             GPOS kerning, contextual forms. Measured with HarfBuzz itself
 *             (harfbuzzjs), as hmtx plus a kern table missed all of that and
 *             put a lit word ~15px off in Playfair and Caveat.
 *   "legacy"  5.1 (prod) does no shaping: hmtx advances, rounded per glyph
 *             to whole pixels, plus FreeType's legacy kerning, which it asks
 *             for at the two CHARACTER CODES as if they were glyph ids, so a
 *             kerned font gets whatever pair sits at those ids. Wrong, but it
 *             is what gets drawn, so it is what must be measured.
 *   "none"    hmtx advances only.
 */

const cache = new Map();

function tableDirectory(buf) {
  const tables = {};
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    tables[buf.toString("latin1", rec, rec + 4)] = { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) };
  }
  return tables;
}

function cmapFormat4(buf, at) {
  const segX2 = buf.readUInt16BE(at + 6);
  const ends = at + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segX2; s += 2) {
      if (cp > buf.readUInt16BE(ends + s)) continue;
      const start = buf.readUInt16BE(starts + s);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltas + s);
      const ro = buf.readUInt16BE(rangeOffsets + s);
      if (ro === 0) return (cp + delta) & 0xffff;
      const gAt = rangeOffsets + s + ro + (cp - start) * 2;
      const g = buf.readUInt16BE(gAt);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

function cmapFormat12(buf, at) {
  const groups = buf.readUInt32BE(at + 12);
  return (cp) => {
    for (let i = 0; i < groups; i += 1) {
      const g = at + 16 + i * 12;
      const start = buf.readUInt32BE(g);
      if (cp < start) return 0;
      if (cp <= buf.readUInt32BE(g + 4)) return buf.readUInt32BE(g + 8) + (cp - start);
    }
    return 0;
  };
}

function glyphLookup(buf, cmap) {
  const n = buf.readUInt16BE(cmap.offset + 2);
  const subtables = [];
  for (let i = 0; i < n; i += 1) {
    const rec = cmap.offset + 4 + i * 8;
    subtables.push({ platform: buf.readUInt16BE(rec), encoding: buf.readUInt16BE(rec + 2), at: cmap.offset + buf.readUInt32BE(rec + 4) });
  }
  // Full Unicode first, then the BMP, then anything Unicode-flavoured.
  const rank = (t) => {
    const format = buf.readUInt16BE(t.at);
    if (format === 12 && (t.platform === 3 || t.platform === 0)) return 0;
    if (format === 4 && t.platform === 3 && t.encoding === 1) return 1;
    if (format === 4 && t.platform === 0) return 2;
    return 9;
  };
  const best = subtables.sort((a, b) => rank(a) - rank(b))[0];
  if (!best || rank(best) === 9) throw new Error("font has no Unicode cmap");
  return buf.readUInt16BE(best.at) === 12 ? cmapFormat12(buf, best.at) : cmapFormat4(buf, best.at);
}

function kernPairs(buf, kern) {
  const pairs = new Map();
  if (!kern || buf.readUInt16BE(kern.offset) !== 0) return pairs; // only the Windows/OpenType layout
  let at = kern.offset + 4;
  for (let t = buf.readUInt16BE(kern.offset + 2); t > 0; t -= 1) {
    const length = buf.readUInt16BE(at + 2);
    const coverage = buf.readUInt16BE(at + 4);
    // Format 0, horizontal, not cross-stream or minimum values.
    if ((coverage >> 8) === 0 && (coverage & 0x7) === 0x1) {
      const n = buf.readUInt16BE(at + 6);
      for (let i = 0; i < n; i += 1) {
        const p = at + 14 + i * 6;
        pairs.set(buf.readUInt16BE(p) * 65536 + buf.readUInt16BE(p + 2), buf.readInt16BE(p + 4));
      }
    }
    at += length;
  }
  return pairs;
}

/** The parsed font at `file`, read once and kept. Throws on an unreadable font. */
export function loadFont(file) {
  const hit = cache.get(file);
  if (hit) return hit;
  const buf = fs.readFileSync(file);
  const t = tableDirectory(buf);
  for (const need of ["head", "hhea", "hmtx", "cmap"]) {
    if (!t[need]) throw new Error(`font ${file} has no ${need} table`);
  }
  const unitsPerEm = buf.readUInt16BE(t.head.offset + 18);
  const numHMetrics = buf.readUInt16BE(t.hhea.offset + 34);
  const advanceOf = (g) => buf.readUInt16BE(t.hmtx.offset + Math.min(g, numHMetrics - 1) * 4);
  // libass sizes text by the font's CELL (Windows ascent + descent), not its
  // em, like VSFilter. Kinetic captions measure with this to know how wide a
  // \fs size really draws.
  const os2 = t["OS/2"];
  const winCell = os2 ? buf.readUInt16BE(os2.offset + 74) + buf.readUInt16BE(os2.offset + 76) : 0;
  const hheaCell = buf.readInt16BE(t.hhea.offset + 4) - buf.readInt16BE(t.hhea.offset + 6);
  const cellUnits = winCell || hheaCell || unitsPerEm;
  const font = { unitsPerEm, cellUnits, glyphOf: glyphLookup(buf, t.cmap), advanceOf, kerning: kernPairs(buf, t.kern), hasGpos: Boolean(t.GPOS) };
  cache.set(file, font);
  return font;
}

/**
 * Where drawtext's pen stands, in pixels, when it reaches character `upTo`
 * (a string index) of `text` set at `fontSize` in the font at `file`. By
 * default that is the end: the text's width. The whole text is set, so
 * kerning or a ligature across `upTo` counts as it does when the whole row is
 * drawn: in "AVA you", the pen at "you" includes any kerning of the space
 * against the "y". `kerning` is "shaped", "legacy" or "none", as above.
 */
export function measureText(file, text, fontSize, { kerning = "shaped", upTo } = {}) {
  const str = String(text || "");
  const end = upTo ?? str.length;
  if (kerning === "shaped") return shapedPen(file, str, fontSize, end);
  const font = loadFont(file);
  const scale = Number(fontSize) / font.unitsPerEm;
  let pen = 0;
  let prev = null;
  let at = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const g = font.glyphOf(cp);
    if (prev !== null) pen += Math.round((pairKern(font, kerning, prev, { cp, g }) || 0) * scale);
    if (at >= end) return pen; // the kern before this character counts; its advance does not
    pen += Math.round(font.advanceOf(g) * scale);
    prev = { cp, g };
    at += ch.length;
  }
  return pen;
}

function pairKern(font, mode, prev, cur) {
  if (mode === "legacy") return prev.cp > 0xffff || cur.cp > 0xffff ? 0 : font.kerning.get(prev.cp * 65536 + cur.cp);
  return 0;
}

const shapers = new Map();

function shaperFor(file) {
  const hit = shapers.get(file);
  if (hit) return hit;
  const data = fs.readFileSync(file);
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const font = new hb.Font(new hb.Face(new hb.Blob(bytes)));
  shapers.set(file, font);
  return font;
}

/**
 * The pen at `end` the way ffmpeg 6.1+ sets text: HarfBuzz at the font size
 * in 1/64 px (what hb_ft gives drawtext), every glyph that starts before
 * `end` advancing the pen. drawtext keeps the sub-pixel remainder rather than
 * rounding per glyph, so only the total is rounded.
 *
 * A font with a legacy `kern` table and no GPOS (Permanent Marker) is kerned
 * from that table by ffmpeg's HarfBuzz, but harfbuzzjs is built without it,
 * so those pairs are added here, onto the first glyph of each pair as
 * HarfBuzz does.
 */
function shapedPen(file, str, fontSize, end) {
  const font = shaperFor(file);
  const scale = Math.round(Number(fontSize) * 64);
  font.setScale(scale, scale);
  const buf = new hb.Buffer();
  buf.addText(str);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  const positions = buf.getGlyphPositions();
  const glyphs = buf.getGlyphInfos();
  const table = loadFont(file);
  const kernTable = !table.hasGpos && table.kerning.size > 0;
  let pen64 = 0;
  glyphs.forEach((glyph, k) => {
    if (glyph.cluster >= end) return;
    pen64 += positions[k].xAdvance;
    const next = glyphs[k + 1];
    if (kernTable && next) {
      pen64 += Math.round(((table.kerning.get(glyph.codepoint * 65536 + next.codepoint) || 0) * scale) / table.unitsPerEm);
    }
  });
  // The whole width rounds up, exactly as drawtext's text_w; a pen part-way
  // in rounds to the nearest pixel, as the glyph there is drawn at its
  // sub-pixel spot and the lit word can only start on a whole pixel.
  return end >= str.length ? Math.ceil(pen64 / 64) : Math.round(pen64 / 64);
}

/** Test seam. */
export function _clearFontCache() {
  cache.clear();
  shapers.clear();
}
