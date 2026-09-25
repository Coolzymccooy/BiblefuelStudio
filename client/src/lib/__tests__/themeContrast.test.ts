import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TRACK_PALETTE } from '../soundtrack';

/**
 * Text must be readable in every theme. These are the colour tokens the music
 * list uses for words, measured against every surface they sit on, to WCAG AA
 * for normal text (4.5:1). Adding a text token to the list, or retuning a
 * theme, is checked here rather than by eye.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');

function themeVars(theme: string): Record<string, string> {
  const start = css.indexOf(`:root[data-theme='${theme}'] {`);
  if (start < 0) throw new Error(`no ${theme} theme block`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--bf-([a-zA-Z0-9]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
  return vars;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ['cream', 'sub', 'muted', 'gold', 'success', 'warn', 'danger'];
const SURFACES = ['bg', 'card', 'card2'];

describe('text is legible in every theme', () => {
  for (const theme of ['dark', 'calm', 'light']) {
    const v = themeVars(theme);
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        it(`${theme}: ${text} on ${surface} is at least 4.5:1`, () => {
          expect(v[text], `--bf-${text} missing in ${theme}`).toBeTruthy();
          expect(contrast(v[text], v[surface])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${theme}: button text (bg) on gold is at least 4.5:1`, () => {
      expect(contrast(v.bg, v.gold)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('white is legible on every track-tile colour', () => {
    for (const c of TRACK_PALETTE) expect(contrast('#ffffff', c), c).toBeGreaterThanOrEqual(4.5);
  });
});
