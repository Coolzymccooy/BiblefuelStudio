import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GRADES, UNREFINED, isUnrefined, playbackFor, previewStyle } from '../refine';

describe('refine helpers', () => {
  it('treats the clip as made as unrefined', () => {
    expect(isUnrefined(UNREFINED)).toBe(true);
    expect(isUnrefined({ ...UNREFINED, flip: true })).toBe(false);
    expect(isUnrefined({ ...UNREFINED, grade: 'warm' })).toBe(false);
  });

  it('keeps the same grades as the render', () => {
    expect(Object.keys(GRADES)).toEqual(['none', 'warm', 'cool', 'golden', 'faded', 'vivid', 'mono']);
    expect(GRADES.none).toBe('');
  });

  it("uses exactly the render's grade filters", () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../../../../server/src/lib/sceneScript/refine.js'), 'utf8');
    for (const [name, css] of Object.entries(GRADES)) {
      expect(server).toContain(`${name}: "${css}"`);
    }
  });

  it('previews mirror, zoom, framing and grade', () => {
    const style = previewStyle({ ...UNREFINED, flip: true, zoom: 1.5, x: 1, y: -1, grade: 'mono' });
    expect(style.filter).toBe(GRADES.mono);
    expect(style.transform).toBe('translate(-25%, 25%) scale(-1.5, 1.5)');
    expect(previewStyle(null)).toEqual({ filter: undefined, transform: 'translate(0%, 0%) scale(1, 1)' });
  });

  it('works out speed and a held end the way the render does', () => {
    expect(playbackFor(null, 8, 6)).toEqual({ rate: 1, hold: 0, clipSec: 8 });
    const slow = playbackFor({ ...UNREFINED, in: 2, out: 4 }, 8, 6);
    expect(slow.rate).toBe(0.5);
    expect(slow.hold).toBeCloseTo(6 - (2 - 0.08) / 0.5);
    expect(slow.clipSec).toBe(2);
    expect(playbackFor({ ...UNREFINED, rate: 1.5 }, 12, 6).rate).toBe(1.5);
    expect(playbackFor({ ...UNREFINED, rate: 2 }, 8, 6).rate).toBeCloseTo((8 - 0.08) / 6);
  });
});
