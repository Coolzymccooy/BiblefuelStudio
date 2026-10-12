import { describe, it, expect } from 'vitest';
import {
  canMake, statementLimit, statementOverflow, removePhoto, movePhoto, verseStatement, newSeed, isRunning,
} from '../momentsWizard';
import type { MomentMeta, MomentPhoto, MomentProject } from '../momentsTypes';

const meta = {
  occasions: [], styles: [], lengths: [15, 30, 60],
  limits: { statements: { 15: 3, 30: 5, 60: 8 }, maxStatements: 8, title: 40, statement: 60, detail: 80, minPhotos: 3, maxPhotos: 20 },
} as MomentMeta;
const photo = (n: number): MomentPhoto => ({ ref: { kind: 'upload', path: `p${n}` }, url: `/outputs/p${n}.jpg`, width: 1, height: 1 });
const project = (over: Partial<MomentProject> = {}) => ({
  projectId: 'm1', occasion: 'birthday', photos: [photo(1), photo(2), photo(3)], heroIndex: 0, statements: [], title: '',
  lengthSec: 15, render: null, ...over,
}) as MomentProject;

describe('canMake', () => {
  it('needs the minimum photos', () => {
    expect(canMake(project(), meta).ok).toBe(true);
    const r = canMake(project({ photos: [photo(1), photo(2)] }), meta);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/3 photos/);
  });
  it('is off while rendering', () => {
    expect(canMake(project({ render: { jobId: 'j', status: 'running', percent: 10, stage: 'shots' } }), meta).ok).toBe(false);
  });
});

describe('statement limits', () => {
  it('follow the length', () => {
    expect(statementLimit(15, meta)).toBe(3);
    expect(statementLimit(60, meta)).toBe(8);
  });
  it('count the statements past the limit', () => {
    expect(statementOverflow(project({ statements: ['a', 'b', 'c', 'd', 'e'] }), meta)).toBe(2);
    expect(statementOverflow(project({ statements: ['a'] }), meta)).toBe(0);
  });
});

describe('photo bookkeeping', () => {
  it('removing the hero falls back to the first photo', () => {
    const r = removePhoto([photo(1), photo(2), photo(3)], 1, 1);
    expect(r.photos.map((p) => p.url)).toEqual(['/outputs/p1.jpg', '/outputs/p3.jpg']);
    expect(r.heroIndex).toBe(0);
  });
  it('removing a photo before the hero keeps the star on the same photo', () => {
    const r = removePhoto([photo(1), photo(2), photo(3)], 2, 0);
    expect(r.heroIndex).toBe(1);
    expect(r.photos[r.heroIndex].url).toBe('/outputs/p3.jpg');
  });
  it('moving photos keeps the star on its photo', () => {
    const r = movePhoto([photo(1), photo(2), photo(3)], 0, 0, 2);
    expect(r.photos.map((p) => p.url)).toEqual(['/outputs/p2.jpg', '/outputs/p3.jpg', '/outputs/p1.jpg']);
    expect(r.heroIndex).toBe(2);
  });
  it('a move out of range changes nothing', () => {
    const list = [photo(1), photo(2)];
    expect(movePhoto(list, 0, 0, -1)).toEqual({ photos: list, heroIndex: 0 });
  });
});

describe('verseStatement', () => {
  it('quotes a short verse with its reference', () => {
    expect(verseStatement({ reference: 'John 11:35', text: 'Jesus wept.' }, 60)).toBe('“Jesus wept.” John 11:35');
  });
  it('falls back to the reference when the verse is too long', () => {
    expect(verseStatement({ reference: 'John 3:16', text: 'x'.repeat(80) }, 60)).toBe('John 3:16');
  });
});

describe('seeds and status', () => {
  it('newSeed is an integer in range and changes', () => {
    const a = newSeed();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(2147483647);
    expect(new Set(Array.from({ length: 20 }, newSeed)).size).toBeGreaterThan(1);
  });
  it('isRunning only while a render runs', () => {
    expect(isRunning(project())).toBe(false);
    expect(isRunning(project({ render: { jobId: 'j', status: 'running', percent: 0, stage: '' } }))).toBe(true);
    expect(isRunning(project({ render: { jobId: 'j', status: 'interrupted', percent: 0, stage: '' } }))).toBe(false);
  });
});
