import { describe, it, expect } from 'vitest';
import { ambientStatusMeta, publishedLabel } from '../ambientHistory';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-23T12:00:00Z');

describe('ambientStatusMeta', () => {
  it('names each state in plain words', () => {
    expect(ambientStatusMeta('done')).toEqual({ label: 'Finished', tone: 'done' });
    expect(ambientStatusMeta('generating_images').label).toBe('Making pictures');
    expect(ambientStatusMeta('error').tone).toBe('error');
  });
});

describe('publishedLabel', () => {
  it('privacy and how long ago', () => {
    expect(publishedLabel({ videoId: 'v', url: 'u', privacyStatus: 'public', publishAt: null, at: NOW - 2 * DAY }, NOW)).toBe('Public · 2d ago');
  });

  it('a scheduled upload says when it goes out, until it has', () => {
    const entry = { videoId: 'v', url: 'u', privacyStatus: 'private' as const, publishAt: '2026-10-01T09:00:00.000Z', at: NOW };
    expect(publishedLabel(entry, NOW)).toMatch(/^Scheduled for /);
    expect(publishedLabel(entry, Date.parse('2026-10-02T00:00:00Z'))).toMatch(/^Private · /);
  });
});
