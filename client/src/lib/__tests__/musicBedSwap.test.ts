import { describe, it, expect } from 'vitest';
import { swapIntoMusicBed } from '../musicBedSwap';

describe('swapIntoMusicBed', () => {
  it('takes the song’s place, keeping the order', () => {
    expect(swapIntoMusicBed(['/outputs/song.m4a', 'library:devotional'], 'mylib:i1', ['mylib:s1', '/outputs/song.m4a']))
      .toEqual(['mylib:i1', 'library:devotional']);
  });

  it('matches the song by its library ref too', () => {
    expect(swapIntoMusicBed(['library:devotional', 'mylib:s1'], 'mylib:i1', ['mylib:s1', '/outputs/song.m4a']))
      .toEqual(['library:devotional', 'mylib:i1']);
  });

  it('joins the end when the song was not on the bed', () => {
    expect(swapIntoMusicBed(['library:devotional'], 'mylib:i1', ['mylib:s1'])).toEqual(['library:devotional', 'mylib:i1']);
  });

  it('never lists the instrumental twice', () => {
    expect(swapIntoMusicBed(['/outputs/song.m4a', 'mylib:s1', 'mylib:i1'], 'mylib:i1', ['mylib:s1', '/outputs/song.m4a'])).toEqual(['mylib:i1']);
  });
});
