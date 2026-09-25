import { describe, it, expect } from 'vitest';
import { api } from '../api';

describe('api.mediaUrl', () => {
  it('serves a bare filename from /outputs', () => {
    expect(api.mediaUrl('clip.mp4')).toMatch(/\/outputs\/clip\.mp4$/);
  });

  it('takes the basename of a storage path', () => {
    expect(api.mediaUrl('uploads/nested/clip.mp4')).toMatch(/\/outputs\/clip\.mp4$/);
  });

  it('PRESERVES an already-served /outputs path, including subdirectories', () => {
    // The timeline renderer writes to /outputs/timeline/<file>.mp4. Stripping
    // to the basename produced /outputs/<file>.mp4, which 404s - so a
    // successful render played nothing.
    const p = '/outputs/timeline/timeline-abc.mp4';
    expect(api.mediaUrl(p)).toMatch(/\/outputs\/timeline\/timeline-abc\.mp4$/);
  });

  it('passes an absolute URL through untouched', () => {
    const u = 'https://cdn.example.com/a/b/clip.mp4';
    expect(api.mediaUrl(u)).toBe(u);
  });

  it('returns empty for nothing', () => {
    expect(api.mediaUrl('')).toBe('');
    expect(api.mediaUrl(null)).toBe('');
    expect(api.mediaUrl(undefined)).toBe('');
  });
});
