import { describe, it, expect } from 'vitest';
import { timelineAssetThumbPath } from './timelineThumb';
import type { TimelineAsset } from './timelineProject';

// The server already writes a first-frame JPEG beside every uploaded video
// (generateVideoThumbnail, run from respondWithBackground at upload time) and
// names it <stem>.jpg in /outputs. So the clip block does not need a new
// stored field that every pre-existing asset would lack — it can DERIVE the
// path. These tests pin that derivation, and the cases where there is no
// honest answer and the clip must fall back to its icon chip.

function asset(over: Partial<TimelineAsset> = {}): TimelineAsset {
  return {
    id: 'a1',
    kind: 'video',
    source: 'upload',
    label: 'SOU001.MP4',
    path: '/outputs/source-video-b7807907.mp4',
    ...over,
  } as TimelineAsset;
}

describe('timelineAssetThumbPath', () => {
  it('derives the sibling JPEG for an uploaded video', () => {
    expect(timelineAssetThumbPath(asset())).toBe('/outputs/source-video-b7807907.jpg');
  });

  it('keeps an explicit thumbPath when the asset carries one', () => {
    // Newer assets may store it directly; a stored value always wins over a
    // guess, so a future server change does not have to fight this helper.
    const a = asset({ thumbPath: '/outputs/custom-poster.jpg' } as Partial<TimelineAsset>);
    expect(timelineAssetThumbPath(a)).toBe('/outputs/custom-poster.jpg');
  });

  it('handles an uppercase extension', () => {
    expect(timelineAssetThumbPath(asset({ path: '/outputs/CLIP.MOV' }))).toBe('/outputs/CLIP.jpg');
  });

  it('handles a stem containing dots', () => {
    expect(timelineAssetThumbPath(asset({ path: '/outputs/take.2.final.mp4' })))
      .toBe('/outputs/take.2.final.jpg');
  });

  it('normalises a windows-style path', () => {
    // Asset paths come from a server running on Windows in dev.
    expect(timelineAssetThumbPath(asset({ path: 'outputs\\clip-7.mp4' })))
      .toBe('/outputs/clip-7.jpg');
  });

  it('returns null for audio — a waveform belongs there, not a frame', () => {
    expect(timelineAssetThumbPath(asset({ kind: 'audio', path: '/outputs/vo.mp3' }))).toBeNull();
  });

  it('returns null for a caption asset', () => {
    expect(timelineAssetThumbPath(asset({ kind: 'caption', path: undefined }))).toBeNull();
  });

  it('returns null when the asset has no path at all', () => {
    expect(timelineAssetThumbPath(asset({ path: undefined }))).toBeNull();
  });

  it('returns null for a remote URL — the server writes no sibling for those', () => {
    expect(timelineAssetThumbPath(asset({ path: 'https://cdn.example.com/a.mp4' }))).toBeNull();
  });

  it('returns null for an image asset — the image IS its own preview', () => {
    // An image clip already renders its own file; deriving a .jpg beside a
    // .png would point at a file that was never written.
    expect(timelineAssetThumbPath(asset({ kind: 'image', path: '/outputs/still.png' }))).toBeNull();
  });

  it('never throws on a malformed asset', () => {
    expect(timelineAssetThumbPath(undefined)).toBeNull();
    expect(timelineAssetThumbPath({} as TimelineAsset)).toBeNull();
  });
});
