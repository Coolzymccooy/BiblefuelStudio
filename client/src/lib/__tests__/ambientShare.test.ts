import { describe, it, expect } from 'vitest';
import { ambientChapters, ambientDescription, ambientTagline, ambientThumbnails, unlinkVerseTimes } from '../ambientShare';
import type { AmbientDrop, AmbientMovement, AmbientProject, AmbientTrackEntry } from '../ambientTypes';

const drop = (atMs: number, reference: string, over: Partial<AmbientDrop> = {}): AmbientDrop =>
  ({ id: reference, atMs, reference, translation: 'kjv', status: 'done', ...over }) as AmbientDrop;
const movement = (startMs: number, endMs: number, over: Partial<AmbientMovement> = {}): AmbientMovement =>
  ({ id: `m${startMs}`, startMs, endMs, imagePrompt: '', imagePath: null, imageStatus: 'done', ...over }) as AmbientMovement;

const project = (drops: AmbientDrop[], movements: AmbientMovement[]): AmbientProject =>
  ({ projectId: 'p1', title: 'God got me', theme: 'Peace in the storm', translation: 'kjv', drops, movements } as AmbientProject);

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

describe('the video record: timeline, scripture and credits', () => {
  const entry = (label: string, startSec: number, durationSec: number, credit = ''): AmbientTrackEntry =>
    ({ ref: `mylib:${label}`, label, credit, startSec, durationSec });
  const session = (builtOrder: AmbientTrackEntry[], drops: AmbientDrop[] = [], over: Partial<AmbientProject> = {}) => ({
    words: drops.length ? 'verses' : 'none', theme: 'Peace, Rest & God’s Presence', translation: 'kjv', targetSec: 7200,
    drops, movements: [], bed: { builtOrder }, ...over,
  }) as unknown as AmbientProject;

  it('every song as it plays, with how long it plays', () => {
    const p = session([entry('Grace', 0, 229), entry('Peace', 223, 351), entry('Grace', 568, 229)]);
    expect(ambientChapters(p)).toEqual([
      { startMs: 0, title: '♪ Grace (3:49)' },
      { startMs: 223_000, title: '♪ Peace (5:51)' },
      { startMs: 568_000, title: '♪ Grace (3:49)' },
    ]);
  });

  it('songs and verses together, in the order they happen, each verse at the moment it is spoken', () => {
    const p = session(
      [entry('Grace', 0, 600), entry('Peace', 594, 600)],
      [drop(90_000, 'Psalms 23:1-2'), drop(700_000, 'John 14:27')],
    );
    expect(ambientChapters(p).map((c) => [c.startMs, c.title])).toEqual([
      [0, '♪ Grace (10:00)'],
      [90_000, '📖 Psalms 23:1-2'],
      [594_000, '♪ Peace (10:00)'],
      [700_000, '📖 John 14:27'],
    ]);
  });

  it('things under ten seconds apart share a line (YouTube ignores shorter chapters)', () => {
    const p = session([entry('Grace', 0, 300), entry('Peace', 294, 300)], [drop(298_000, 'Mark 4:39')]);
    expect(ambientChapters(p).map((c) => c.title)).toEqual(['♪ Grace (5:00)', '♪ Peace (5:00) · 📖 Mark 4:39']);
  });

  it('a verse that failed to voice is left out', () => {
    const p = session([entry('Grace', 0, 600)], [drop(60_000, 'Psalms 46:1'), drop(120_000, 'Nowhere 9:9', { status: 'error' })]);
    expect(ambientChapters(p).map((c) => c.title)).toEqual(['♪ Grace (10:00)', '📖 Psalms 46:1']);
  });

  it('the description: theme, overview, each verse with its words, credits once, then the timeline heading', () => {
    const p = session(
      [entry('Grace', 0, 600, 'Music from Pixabay'), entry('Peace', 594, 600, 'Music from Pixabay'), entry('Mine', 1188, 600)],
      [drop(90_000, 'Psalms 23:1-2', { text: 'The LORD is my shepherd; I shall not want.' })],
    );
    expect(ambientDescription(p)).toBe([
      'Peace, Rest & God’s Presence',
      '2 hours · 3 songs · 1 scripture (KJV)',
      'Scripture (KJV)\nPsalms 23∶1-2 — “The LORD is my shepherd; I shall not want.”',
      'Music credits:\nMusic from Pixabay\nMine',
      'Timeline (♪ music · 📖 scripture):',
    ].join('\n\n'));
  });

  it('a music-only session: songs counted once each, no scripture, a music timeline', () => {
    const p = session([entry('Grace', 0, 300), entry('Peace', 294, 300), entry('Grace', 588, 300)]);
    expect(ambientDescription(p)).toBe('Peace, Rest & God’s Presence\n\n2 hours · 2 songs\n\nMusic credits:\nGrace\nPeace\n\nTimeline (♪ music):');
  });

  it('no heading without a timeline YouTube would show (under three entries)', () => {
    expect(ambientDescription(session([entry('Grace', 0, 300)]))).not.toMatch(/Timeline/);
    expect(ambientDescription(session([]))).toBe('Peace, Rest & God’s Presence\n\n2 hours');
  });

  it('a long passage is quoted, not reprinted', () => {
    const long = 'word '.repeat(200).trim();
    const p = session([entry('Grace', 0, 600)], [drop(1, 'Psalms 119:1-40', { text: long })]);
    const line = ambientDescription(p).split('\n').find((l) => l.startsWith('Psalms'))!;
    expect(line.length).toBeLessThan(300);
    expect(line).toMatch(/ …”$/);
  });

  it('the whole description fits YouTube’s 5000 characters, timeline included, even for a long night of short songs', () => {
    const order = Array.from({ length: 400 }, (_, i) => entry(`A rather long song title number ${i}`, i * 18, 18));
    const drops = Array.from({ length: 30 }, (_, i) => drop(i * 240_000 + 5000, `Psalms ${i + 1}:1-5`, { text: 'word '.repeat(60) }));
    const p = session(order, drops);
    const chapters = ambientChapters(p);
    // Written as the server writes it: H:MM:SS from an hour, MM:SS before.
    const stamp = (ms: number) => {
      const t = Math.floor(ms / 1000);
      const h = Math.floor(t / 3600);
      const mmss = `${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      return h ? `${h}:${mmss}` : mmss;
    };
    const timeline = chapters.map((c) => `${stamp(c.startMs)} ${c.title}`).join('\n');
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    expect(ambientDescription(p).length + 2 + timeline.length).toBeLessThanOrEqual(5000);
  });
});

describe('verse references on YouTube', () => {
  it('the verses in the description are not turned into timestamp links', () => {
    const p = project([drop(1, 'Matthew 11:28-30'), drop(2, 'John 14:27')], [movement(0, 600_000)]);
    const text = ambientDescription(p);
    expect(text).not.toMatch(/\d:\d/);
    expect(text).toContain('Matthew 11∶28-30');
    expect(text).toContain('John 14∶27');
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
