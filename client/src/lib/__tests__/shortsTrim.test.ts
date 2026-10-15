import { describe, it, expect } from 'vitest';
import { shortsTrimOffer } from '../shortsTrim';
import type { LyricProject } from '../lyricVideoTypes';

const song = (durationSec: number, ends: Array<number | undefined> = [60]) =>
  ({ song: { file: 'a.mp3', durationSec, coverStill: null }, lines: ends.map((end, i) => ({ id: `l${i}`, end })) }) as unknown as LyricProject;

describe('shortsTrimOffer', () => {
  it('offers and allows a portrait song of 185 s whose lines all end in time', () => {
    expect(shortsTrimOffer(song(185), 'portrait')).toEqual({ offered: true, allowed: true, reason: '' });
  });

  it('offers it at both ends of the 3:00 to 3:10 range', () => {
    expect(shortsTrimOffer(song(180), 'portrait').offered).toBe(true);
    expect(shortsTrimOffer(song(190), 'portrait').offered).toBe(true);
  });

  it('does not offer it for a short or long song', () => {
    const reason = 'Only for portrait songs between 3:00 and 3:10.';
    expect(shortsTrimOffer(song(179.9), 'portrait')).toEqual({ offered: false, allowed: false, reason });
    expect(shortsTrimOffer(song(190.1), 'portrait')).toEqual({ offered: false, allowed: false, reason });
  });

  it('does not offer it for a landscape or square frame', () => {
    expect(shortsTrimOffer(song(185), 'landscape').offered).toBe(false);
    expect(shortsTrimOffer(song(185), 'square').offered).toBe(false);
  });

  it('does not offer it when the song has no length yet', () => {
    expect(shortsTrimOffer({ song: null, lines: [] } as unknown as LyricProject, 'portrait').offered).toBe(false);
  });

  it('refuses with a plain sentence when a line ends after 2:58.5', () => {
    expect(shortsTrimOffer(song(185, [60, 178.6]), 'portrait')).toEqual({
      offered: true, allowed: false, reason: 'A lyric line ends after 2:58, so trimming would cut it.',
    });
  });

  it('allows a line that ends exactly at 2:58.5 and ignores lines that were never timed', () => {
    expect(shortsTrimOffer(song(185, [178.5, undefined]), 'portrait').allowed).toBe(true);
  });
});
