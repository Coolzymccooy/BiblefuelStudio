import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CAPTION_FONTS, CAPTION_FALLBACK_FONT, CAPTION_FONT_BASE } from '../lyricPreviewFonts';

const SERVER_ROOT = path.resolve(__dirname, '../../../../server');
const FONT_DIR = path.join(SERVER_ROOT, 'assets/fonts');
const LOOKS_SOURCE = path.join(SERVER_ROOT, 'src/lib/kinetic/looks.js');

interface Face { file: string; family: string }

/**
 * Every `{ file: "X.ttf", family: "Y" }` the caption engine declares: each look's body and hit
 * font plus FALLBACK_FONT. Read as text because Vite will not load a file outside the client root.
 */
function engineFaces(): Face[] {
  const source = fs.readFileSync(LOOKS_SOURCE, 'utf8');
  return [...source.matchAll(/file:\s*"([^"]+)",\s*family:\s*"([^"]+)"/g)].map((m) => ({ file: m[1], family: m[2] }));
}

describe('caption fonts for the live preview', () => {
  it('names every family the caption engine can draw, lower-cased, served from /caption-fonts', () => {
    const faces = engineFaces();
    expect(faces.length).toBeGreaterThanOrEqual(7); // 3 looks x (body + hit) + the fallback
    for (const face of faces) {
      expect(CAPTION_FONTS[face.family.toLowerCase()], face.family).toBe(`${CAPTION_FONT_BASE}/${face.file}`);
    }
  });

  it('points the fallback at the family the engine falls back to', () => {
    const source = fs.readFileSync(LOOKS_SOURCE, 'utf8');
    const fallback = /FALLBACK_FONT\s*=\s*Object\.freeze\(\{\s*file:\s*"[^"]+",\s*family:\s*"([^"]+)"/.exec(source);
    expect(fallback).toBeTruthy();
    expect(CAPTION_FALLBACK_FONT).toBe(fallback![1].toLowerCase());
    expect(CAPTION_FONTS[CAPTION_FALLBACK_FONT]).toBeTruthy();
  });

  it('only names font files that exist in server/assets/fonts', () => {
    for (const url of Object.values(CAPTION_FONTS)) {
      const file = url.slice(CAPTION_FONT_BASE.length + 1);
      expect(fs.existsSync(path.join(FONT_DIR, file)), file).toBe(true);
    }
  });

  it('uses lower-case keys only (the renderer looks fonts up lower-cased)', () => {
    for (const key of Object.keys(CAPTION_FONTS)) expect(key).toBe(key.toLowerCase());
  });
});
