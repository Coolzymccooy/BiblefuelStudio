import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The accent gold must actually look like GOLD.
//
// The operator called the chocolate/gold highlights "poor, and not friendly to
// the eye". The cause was measurable: light-mode --accent was #8a6d33, only
// 46% saturated at 37% lightness - that reads brown, not gold. It had been
// darkened purely so WHITE text on it would clear 4.5:1.
//
// Chasing contrast with white text is what muddied it. Two tokens with two
// jobs fixes it: --accent stays dark for TEXT on light chrome, --accent-fill
// is a rich gold for filled surfaces that carry dark ink.

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

/**
 * Read a custom property's LIGHT-theme value. The light block is declared
 * after the dark defaults, so the last match is the light one.
 */
function lightToken(name: string): string {
  const re = new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{6})', 'g');
  const all = [...css.matchAll(re)];
  expect(all.length, name + ' not found in index.css').toBeGreaterThan(0);
  return all[all.length - 1][1];
}

function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  return (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)) * 100;
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  const h =
    mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

const INK = '#1c1a15';
const WHITE = '#ffffff';

describe('accent palette', () => {
  it('the FILL accent reads as gold, not brown', () => {
    const fill = lightToken('accent-fill');
    expect(saturation(fill), fill + ' is too desaturated to read as gold').toBeGreaterThanOrEqual(55);
    expect(hue(fill)).toBeGreaterThanOrEqual(35);
    expect(hue(fill)).toBeLessThanOrEqual(50);
  });

  it('dark ink on the fill accent is comfortably legible', () => {
    // This is what lets the gold stay saturated: white text on gold forces it
    // dark and muddy, which is exactly how #8a6d33 came about.
    expect(contrast(lightToken('accent-fill'), INK)).toBeGreaterThanOrEqual(4.5);
  });

  it('the text accent still passes as TEXT on white', () => {
    // text-editor-accent is used for labels and thin rules on light chrome,
    // so this token MUST stay dark - it cannot become the rich gold.
    expect(contrast(lightToken('accent'), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('the text accent is warmer than the muddy brown it replaced', () => {
    // #8a6d33 sat at 46% saturation. Holding the contrast while lifting
    // saturation is what turns brown back into gold.
    expect(saturation(lightToken('accent'))).toBeGreaterThan(55);
  });

  it('the editor accent matches the app text accent', () => {
    // Two golds drifting apart is what left the editor chrome muddy while
    // the rest of the app looked different.
    expect(lightToken('editor-accent')).toBe(lightToken('accent'));
  });

  it('both themes define the fill pair', () => {
    // A filled button loses its text colour if the pair exists in only one
    // theme, so assert both are present rather than just the light value.
    const fills = [...css.matchAll(/--accent-fill\s*:\s*(#[0-9a-fA-F]{6})/g)];
    const inks = [...css.matchAll(/--accent-ink\s*:\s*(#[0-9a-fA-F]{6})/g)];
    expect(fills.length).toBeGreaterThanOrEqual(2);
    expect(inks.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Ink, not white, on filled gold.
//
// Raising the gold's saturation only works if what sits ON it is dark. The
// shared Button already uses text-black for its primary variant, but several
// call sites hardcode text-white on bg-primary-500 - which measured 3.09:1
// even against the OLD darker gold, and is worse against the new one.

describe('filled gold controls carry dark ink', () => {
  const SRC = path.resolve(process.cwd(), 'src');

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && /\.tsx$/.test(e.name) ? [full] : [];
    });
  }

  it('no element paints white text on a filled gold background', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        // Same className, both classes: that is white-on-gold.
        if (/bg-primary-500/.test(line) && /text-white/.test(line)) {
          offenders.push(path.relative(SRC, file));
          break;
        }
      }
    }
    expect(offenders, 'white text on filled gold is illegible').toEqual([]);
  });
});
