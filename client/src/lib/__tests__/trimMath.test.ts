import { describe, it, expect } from 'vitest';
import { clampTime, snap, pxToTime, timeToPct, enforceHandles } from '../trimMath';

describe('trimMath', () => {
  it('clampTime keeps t within [0, duration]', () => {
    expect(clampTime(-2, 10)).toBe(0);
    expect(clampTime(12, 10)).toBe(10);
    expect(clampTime(4, 10)).toBe(4);
  });

  it('snap rounds to 0.1s', () => {
    expect(snap(1.234)).toBe(1.2);
    expect(snap(1.27)).toBe(1.3);
  });

  it('pxToTime maps pixel offset to time across a width', () => {
    expect(pxToTime(0, 200, 10)).toBe(0);
    expect(pxToTime(200, 200, 10)).toBe(10);
    expect(pxToTime(100, 200, 10)).toBe(5);
    expect(pxToTime(-50, 200, 10)).toBe(0);
    expect(pxToTime(999, 200, 10)).toBe(10);
  });

  it('timeToPct returns 0..100', () => {
    expect(timeToPct(0, 10)).toBe(0);
    expect(timeToPct(5, 10)).toBe(50);
    expect(timeToPct(10, 10)).toBe(100);
    expect(timeToPct(5, 0)).toBe(0);
  });

  it('enforceHandles keeps start < end with a minimum gap when moving start', () => {
    const r = enforceHandles('start', 9.9, { start: 2, end: 10 }, 10, 0.5);
    expect(r.end).toBe(10);
    expect(r.start).toBeLessThanOrEqual(9.5);
  });

  it('enforceHandles keeps end > start with a minimum gap when moving end', () => {
    const r = enforceHandles('end', 2.1, { start: 2, end: 10 }, 10, 0.5);
    expect(r.start).toBe(2);
    expect(r.end).toBeGreaterThanOrEqual(2.5);
  });

  it('enforceHandles clamps to [0, duration]', () => {
    const r = enforceHandles('end', 99, { start: 2, end: 10 }, 10, 0.5);
    expect(r.end).toBe(10);
  });
});
