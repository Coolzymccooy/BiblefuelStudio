import { describe, it, expect } from 'vitest';
import { looksLikeSoundtrack, normaliseSongName, soundtrackFor } from '../soundtrackMatch';

describe('soundtrackFor', () => {
  it('is null when the project has no source audio', () => {
    expect(soundtrackFor(undefined, false)).toBeNull();
    expect(soundtrackFor({ audioPath: null, durationMs: 0 }, false)).toBeNull();
  });

  it('uses the stored name, the trimmed flag and the length', () => {
    expect(soundtrackFor({ audioPath: '/o/a.mp3', durationMs: 90_000, name: 'Song.mp3', trimmed: true }, false))
      .toEqual({ label: 'Song.mp3', name: 'Song.mp3', trimmed: true, durationMs: 90_000 });
  });

  it('without a name: "your narration" for a narrated story, "your audio" otherwise', () => {
    expect(soundtrackFor({ audioPath: '/o/a.mp3', durationMs: 5000 }, true)?.label).toBe('your narration');
    expect(soundtrackFor({ audioPath: '/o/a.mp3', durationMs: 5000 }, false)?.label).toBe('your audio');
    expect(soundtrackFor({ audioPath: '/o/a.mp3', durationMs: 5000 }, true)?.name).toBeUndefined();
  });
});

describe('normaliseSongName', () => {
  it('ignores extension, case, a trailing copy suffix and extra spaces', () => {
    expect(normaliseSongName('My Song.MP3')).toBe('my song');
    expect(normaliseSongName('My Song (1).mp3')).toBe('my song');
    expect(normaliseSongName('  My   Song (12) ')).toBe('my song');
    expect(normaliseSongName('my song')).toBe('my song');
  });

  it('keeps a dot that is not an extension, and a number that is not a copy suffix', () => {
    expect(normaliseSongName('Psalm 23. Reprise')).toBe('psalm 23. reprise');
    expect(normaliseSongName('Track (2024) live.m4a')).toBe('track (2024) live');
  });

  it('is empty for nothing usable', () => {
    expect(normaliseSongName(undefined)).toBe('');
    expect(normaliseSongName('   ')).toBe('');
  });
});

describe('looksLikeSoundtrack', () => {
  const source = { name: 'Great Is Thy Faithfulness.mp3', durationMs: 215_000 };

  it('matches the same base name whatever the extension, case or copy suffix', () => {
    expect(looksLikeSoundtrack({ name: 'great is thy faithfulness (1).wav' }, source)).toBe(true);
    expect(looksLikeSoundtrack({ name: 'Great Is Thy Faithfulness' }, source)).toBe(true);
  });

  it('does not match a different song, even with the same length', () => {
    expect(looksLikeSoundtrack({ name: 'Peaceful Worship', durationSec: 215 }, source)).toBe(false);
  });

  it('never matches on duration alone', () => {
    expect(looksLikeSoundtrack({ name: 'Other', durationSec: 215.5 }, source)).toBe(false);
    expect(looksLikeSoundtrack({ name: 'Other', durationSec: 215 }, { durationMs: 215_000 })).toBe(false);
  });

  it('counts a name that contains the other only when the lengths agree within 1.5 s', () => {
    const song = { name: 'Amazing Grace.mp3', durationMs: 180_000 };
    expect(looksLikeSoundtrack({ name: 'Amazing Grace - official audio', durationSec: 181 }, song)).toBe(true);
    expect(looksLikeSoundtrack({ name: 'Amazing Grace - official audio', durationSec: 182 }, song)).toBe(false);
    expect(looksLikeSoundtrack({ name: 'Amazing Grace - official audio' }, song)).toBe(false);
  });

  it('does not match short names by containment', () => {
    expect(looksLikeSoundtrack({ name: 'Joy to the World', durationSec: 100 }, { name: 'Joy', durationMs: 100_000 })).toBe(false);
  });

  it('does not match when the source has no name or the candidate has none', () => {
    expect(looksLikeSoundtrack({ name: 'Great Is Thy Faithfulness' }, { durationMs: 215_000 })).toBe(false);
    expect(looksLikeSoundtrack({ name: '' }, source)).toBe(false);
    expect(looksLikeSoundtrack({ name: 'x' }, undefined)).toBe(false);
  });
});
