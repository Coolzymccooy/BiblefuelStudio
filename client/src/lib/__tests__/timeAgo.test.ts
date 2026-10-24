import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from '../timeAgo';

describe('timeAgo', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('gives nothing for an empty or unreadable time', () => {
    expect(timeAgo('')).toBe('');
    expect(timeAgo('not a date')).toBe('');
  });

  it('says just now inside the first minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:30Z'));
    expect(timeAgo('2026-10-23T12:00:00Z')).toBe('just now');
  });

  it('counts minutes, hours and days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
    expect(timeAgo('2026-10-23T11:55:00Z')).toBe('5 min ago');
    expect(timeAgo('2026-10-23T09:00:00Z')).toBe('3 h ago');
    expect(timeAgo('2026-10-20T12:00:00Z')).toBe('3 d ago');
  });
});
