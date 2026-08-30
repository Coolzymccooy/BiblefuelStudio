import { describe, it, expect } from 'vitest';
import { api } from '../api';

/**
 * The Timeline preview modal fed a RAW server path straight into <video src>,
 * while every other media surface in the app resolves through api.mediaUrl().
 * A raw path is not a servable URL, so the modal opened, showed 0:00, and never
 * played — while Download (which uses api.downloadMedia) worked from the same
 * value, and the Trim dialog (which uses api.mediaUrl) played fine.
 *
 * These lock the contract that anything given to a media element goes through
 * mediaUrl first.
 */
describe('api.mediaUrl', () => {
  it('resolves a server path to a servable outputs URL', () => {
    // In this environment mediaBaseUrl is empty, so the result is relative.
    // What matters is that it always lands on /outputs/<basename> rather than
    // being passed through untouched.
    expect(api.mediaUrl('/outputs/source-video-23a2ea85.mp4'))
      .toBe(`${api.mediaBaseUrl}/outputs/source-video-23a2ea85.mp4`);
  });

  it('accepts a bare filename', () => {
    expect(api.mediaUrl('clip.mp4')).toContain('/outputs/clip.mp4');
  });

  it('takes only the basename, so a nested path cannot escape the outputs dir', () => {
    const url = api.mediaUrl('/app/outputs/nested/deep/clip.mp4');
    expect(url).toContain('/outputs/clip.mp4');
    expect(url).not.toContain('nested');
  });

  it('normalises Windows separators', () => {
    expect(api.mediaUrl('C:\\outputs\\clip.mp4')).toContain('/outputs/clip.mp4');
  });

  it('returns empty string for empty input rather than a broken URL', () => {
    // A <video src=""> is inert; a <video src="undefined"> fires a 404.
    expect(api.mediaUrl('')).toBe('');
    expect(api.mediaUrl(null)).toBe('');
    expect(api.mediaUrl(undefined)).toBe('');
  });
});
