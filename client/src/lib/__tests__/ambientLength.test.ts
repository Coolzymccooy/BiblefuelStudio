import { describe, it, expect } from 'vitest';
import {
  LENGTH_PRESETS, formatLength, lengthSummary, renderEstimateMinutes, versesFor,
} from '../ambientLength';

describe('versesFor mirrors the server cadence', () => {
  it('matches the drops the server places', () => {
    // Same numbers as server/src/lib/ambient/dropsAndMovements.test.js.
    expect(versesFor(7200)).toBe(7);
    expect(versesFor(3600)).toBe(3);
    expect(versesFor(600)).toBe(1);
    expect(versesFor(900)).toBe(1);
  });

  it('a session too short for any verse says zero', () => {
    expect(versesFor(60)).toBe(0);
  });
});

describe('formatLength', () => {
  it('reads as words, not a bare number of minutes', () => {
    expect(formatLength(1)).toBe('1 minute');
    expect(formatLength(10)).toBe('10 minutes');
    expect(formatLength(60)).toBe('1 hour');
    expect(formatLength(90)).toBe('1 hour 30 minutes');
    expect(formatLength(120)).toBe('2 hours');
  });
});

describe('renderEstimateMinutes', () => {
  it('uses the measured rate: about a third of the video length', () => {
    expect(renderEstimateMinutes(600)).toBe(3);
    expect(renderEstimateMinutes(3600)).toBe(20);
    expect(renderEstimateMinutes(7200)).toBe(40);
  });

  it('never promises less than a minute', () => {
    expect(renderEstimateMinutes(30)).toBe(1);
  });
});

describe('lengthSummary', () => {
  it('answers the two questions the number cannot', () => {
    expect(lengthSummary(120)).toBe('2 hours · 7 verses · ready in roughly 40 minutes');
    expect(lengthSummary(10)).toBe('10 minutes · 1 verse · ready in roughly 3 minutes');
  });

  it('says plainly when a session cannot hold a verse', () => {
    expect(lengthSummary(1)).toMatch(/too short for a verse/);
  });

  it('is empty rather than nonsense for a blank or invalid entry', () => {
    expect(lengthSummary(0)).toBe('');
    expect(lengthSummary(Number.NaN)).toBe('');
  });
});

describe('LENGTH_PRESETS', () => {
  it('starts with a quick test length and covers the long formats', () => {
    expect(LENGTH_PRESETS.map((p) => p.minutes)).toEqual([10, 30, 60, 120, 180]);
  });
});
