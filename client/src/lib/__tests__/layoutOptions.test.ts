import { describe, it, expect } from 'vitest';
import { LAYOUT_OPTIONS, LAYOUT_VALUES, DEFAULT_LAYOUT } from '../layoutOptions';

// These values must mirror the server's videoFilters.js listLayouts() set, or
// a picked layout silently degrades to "center" on the server.
const SERVER_LAYOUTS = ['center', 'center-large', 'bottom-center', 'bottom-left', 'staggered'];

describe('layoutOptions', () => {
  it('exposes exactly the server-supported layout values', () => {
    expect([...LAYOUT_VALUES].sort()).toEqual([...SERVER_LAYOUTS].sort());
  });

  it('defaults to center and lists it first', () => {
    expect(DEFAULT_LAYOUT).toBe('center');
    expect(LAYOUT_OPTIONS[0].value).toBe('center');
  });

  it('every option has a non-empty human label', () => {
    for (const opt of LAYOUT_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
    }
  });
});
