import { describe, it, expect } from 'vitest';
import { formatDuration, humanDuration, soundtrackStats, trackColour, TRACK_PALETTE } from '../soundtrack';

describe('formatDuration', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatDuration(270)).toBe('4:30');
    expect(formatDuration(9.6)).toBe('0:10');
  });
  it('adds hours from an hour up', () => {
    expect(formatDuration(7200)).toBe('2:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('a missing length is a dash', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('—');
  });
});

describe('soundtrackStats', () => {
  it('adds the lengths and takes off each crossfade overlap', () => {
    const s = soundtrackStats({ durations: [270, 204, 168], crossfadeSec: 6 });
    expect(s.totalSec).toBe(270 + 204 + 168 - 12);
    expect(s.unknownCount).toBe(0);
    expect(s.repeats).toBeNull();
  });

  it('says how often the music repeats to fill the video, and how much more would stop it', () => {
    const s = soundtrackStats({ durations: [270, 204, 168, 234, 192], crossfadeSec: 0, targetSec: 7200 });
    expect(s.totalSec).toBe(1068);
    expect(s.repeats).toBeCloseTo(6.74, 2);
    expect(s.shortfallSec).toBe(7200 - 1068);
  });

  it('no shortfall when there is enough music', () => {
    const s = soundtrackStats({ durations: [4000, 4000], crossfadeSec: 6, targetSec: 7200 });
    expect(s.repeats).toBeLessThan(1.01);
    expect(s.shortfallSec).toBe(0);
  });

  it('counts tracks with no known length and leaves them out of the total', () => {
    const s = soundtrackStats({ durations: [200, null, 100], crossfadeSec: 5 });
    expect(s.totalSec).toBe(295);
    expect(s.unknownCount).toBe(1);
  });

  it('an empty list is zero, not negative, and has no repeat figure', () => {
    const s = soundtrackStats({ durations: [], crossfadeSec: 6, targetSec: 7200 });
    expect(s.totalSec).toBe(0);
    expect(s.repeats).toBeNull();
  });
});

describe('trackColour', () => {
  it('is stable for a title and always from the palette', () => {
    expect(trackColour('Prayer Piano')).toBe(trackColour('Prayer Piano'));
    expect(TRACK_PALETTE).toContain(trackColour('Anything at all'));
  });
});

describe('humanDuration', () => {
  it('reads like speech', () => {
    expect(humanDuration(6132)).toBe('1 h 42 min');
    expect(humanDuration(7200)).toBe('2 h');
    expect(humanDuration(720)).toBe('12 min');
    expect(humanDuration(20)).toBe('under a minute');
  });
});
