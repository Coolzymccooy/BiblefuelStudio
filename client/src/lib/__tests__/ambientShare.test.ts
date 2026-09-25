import { describe, it, expect } from 'vitest';
import { ambientChapters, ambientDescription, ambientTagline, ambientThumbnails, unlinkVerseTimes } from '../ambientShare';
import type { AmbientDrop, AmbientMovement, AmbientProject, AmbientTrackEntry } from '../ambientTypes';

const drop = (atMs: number, reference: string, over: Partial<AmbientDrop> = {}): AmbientDrop =>
  ({ id: reference, atMs, reference, translation: 'kjv', status: 'done', ...over }) as AmbientDrop;
const movement = (startMs: number, endMs: number, over: Partial<AmbientMovement> = {}): AmbientMovement =>
  ({ id: `m${startMs}`, startMs, endMs, imagePrompt: '', imagePath: null, imageStatus: 'done', ...over }) as AmbientMovement;

const project = (drops: AmbientDrop[], movements: AmbientMovement[]): AmbientProject =>
  ({ projectId: 'p1', title: 'God got me', theme: 'Peace in the storm', translation: 'kjv', drops, movements } as AmbientProject);

describe('ambientChapters', () => {
  it('one chapter per verse, starting where its picture does', () => {
    const p = project(
      [drop(900_000, 'Psalms 46:1-2'), drop(1_800_000, 'Mark 4:39'), drop(2_700_000, 'Isaiah 26:3')],
      [movement(0, 1_350_000), movement(1_350_000, 2_250_000), movement(2_250_000, 3_600_000)],
    );
    expect(ambientChapters(p)).toEqual([
      { startMs: 0, title: 'Psalms 46:1-2' },
      { startMs: 1_350_000, title: 'Mark 4:39' },
      { startMs: 2_250_000, title: 'Isaiah 26:3' },
    ]);
  });

  it('a verse that failed to voice is not a chapter', () => {
    const p = project(
      [drop(900_000, 'Psalms 46:1-2'), drop(1_800_000, 'Nowhere 9:9', { status: 'error' })],
      [movement(0, 1_350_000), movement(1_350_000, 3_600_000)],
    );
    expect(ambientChapters(p).map((c) => c.title)).toEqual(['Psalms 46:1-2']);
  });
});

describe('ambientDescription', () => {
  it('the theme, then the verses read, so a short session still lists its scripture', () => {
    const p = project([drop(300_000, 'Psalms 46:1-2')], [movement(0, 600_000)]);
    expect(ambientDescription(p)).toBe('Peace in the storm\n\nScripture (KJV): Psalms 46∶1-2');
  });

  it('just the theme when there is no voiced verse', () => {
    expect(ambientDescription(project([], [movement(0, 600_000)]))).toBe('Peace in the storm');
  });
});

describe('ambientThumbnails', () => {
  it('offers each movement picture that exists, by its served URL', () => {
    const p = project([], [
      movement(0, 1, { imageUrl: '/outputs/imagelib-a.png' }),
      movement(1, 2, { imageUrl: null }),
      movement(2, 3, { imageUrl: '/outputs/imagelib-c.jpg' }),
    ]);
    expect(ambientThumbnails(p)).toEqual([
      { label: 'Picture 1', path: '/outputs/imagelib-a.png' },
      { label: 'Picture 3', path: '/outputs/imagelib-c.jpg' },
    ]);
  });
});

describe('tracklist chapters and music credits', () => {
  const entry = (label: string, startSec: number, durationSec: number, credit = ''): AmbientTrackEntry =>
    ({ ref: `mylib:${label}`, label, credit, startSec, durationSec });
  const musicOnly = (builtOrder: AmbientTrackEntry[]) => ({
    words: 'none', theme: 'Soaking worship', drops: [], movements: [],
    bed: { builtOrder },
  }) as unknown as AmbientProject;

  it('a music-only session gets one chapter per track', () => {
    const p = musicOnly([entry('Grace', 0, 300), entry('Peace', 294, 300), entry('Rest', 588, 300)]);
    expect(ambientChapters(p)).toEqual([
      { startMs: 0, title: 'Grace' },
      { startMs: 294_000, title: 'Peace' },
      { startMs: 588_000, title: 'Rest' },
    ]);
  });

  it('drops tracks that play for under ten seconds (a YouTube rule)', () => {
    const p = musicOnly([entry('Grace', 0, 300), entry('Tail', 300, 5)]);
    expect(ambientChapters(p).map((c) => c.title)).toEqual(['Grace']);
  });

  it('verse chapters still win when verses were spoken', () => {
    const p = {
      ...musicOnly([entry('Grace', 0, 300)]),
      words: 'verses',
      drops: [{ id: 'd', atMs: 0, reference: 'John 14:27', status: 'done' }],
      movements: [{ id: 'm', startMs: 0, endMs: 600000 }],
    } as unknown as AmbientProject;
    expect(ambientChapters(p)).toEqual([{ startMs: 0, title: 'John 14:27' }]);
  });

  it('the description credits each source once, falling back to the track name', () => {
    const p = musicOnly([entry('Grace', 0, 300, 'Music from Pixabay'), entry('Peace', 294, 300, 'Music from Pixabay'), entry('Mine', 588, 300)]);
    expect(ambientDescription(p)).toBe('Soaking worship\n\nMusic credits:\nMusic from Pixabay\nMine');
  });

  it('no tracklist yet means no credits block', () => {
    expect(ambientDescription(musicOnly([]))).toBe('Soaking worship');
  });
});

describe('verse references on YouTube', () => {
  it('the verses in the description are not turned into timestamp links', () => {
    const p = project([drop(1, 'Matthew 11:28-30'), drop(2, 'John 14:27')], [movement(0, 600_000)]);
    const text = ambientDescription(p);
    expect(text).not.toMatch(/\d:\d/);
    expect(text).toContain('Matthew 11∶28-30 · John 14∶27');
  });

  it('only a colon between digits changes', () => {
    expect(unlinkVerseTimes('Rest: Psalms 46:10')).toBe('Rest: Psalms 46∶10');
  });
});

describe('ambientTagline', () => {
  const withLength = (targetSec: number, words?: 'none' | 'verses') =>
    ({ ...project([], []), targetSec, ...(words ? { words } : {}) }) as AmbientProject;

  it('says how long and what kind of listening', () => {
    expect(ambientTagline(withLength(7200))).toBe('2 hours · scripture & soaking worship');
    expect(ambientTagline(withLength(3600, 'none'))).toBe('1 hour · soaking worship music');
    expect(ambientTagline(withLength(600))).toBe('10 minutes · scripture & soaking worship');
    expect(ambientTagline(withLength(5400))).toBe('90 minutes · scripture & soaking worship');
  });

  it('leaves the length out when it is unknown', () => {
    expect(ambientTagline(withLength(0))).toBe('scripture & soaking worship');
  });
});
