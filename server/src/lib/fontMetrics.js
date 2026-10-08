import fs from "fs";

/**
 * Text widths straight from a TrueType font file, so a caption can place a
 * highlighted word where ffmpeg actually draws it.
 *
 * Captions used to assume every glyph is 0.6em wide (true of a typewriter
 * face only), so on any real font the highlighted word was drawn several
 * letters away from itself. This reads the advance widths ffmpeg's drawtext
 * uses (hmtx, through cmap) plus pair kerning from the legacy `kern` table,
 * which is the kerning FreeType applies in prod's ffmpeg 5.1. Advances are
 * rounded per glyph, as drawtext does when it moves the pen in whole pixels.
 *
 * No dependency: only the four or five tables this needs are parsed.
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
  const font = { unitsPerEm, glyphOf: glyphLookup(buf, t.cmap), advanceOf, kerning: kernPairs(buf, t.kern) };
  cache.set(file, font);
  return font;
}

/**
 * Width in pixels of `text` set at `fontSize` in the font at `file`: the
 * distance drawtext's pen travels, which is where the next text would start.
 */
export function measureText(file, text, fontSize) {
  const font = loadFont(file);
  const scale = Number(fontSize) / font.unitsPerEm;
  let width = 0;
  let prev = null;
  for (const ch of String(text || "")) {
    const g = font.glyphOf(ch.codePointAt(0));
    if (prev !== null) width += Math.round((font.kerning.get(prev * 65536 + g) || 0) * scale);
    width += Math.round(font.advanceOf(g) * scale);
    prev = g;
  }
  return width;
}

/** Test seam. */
export function _clearFontCache() { cache.clear(); }
