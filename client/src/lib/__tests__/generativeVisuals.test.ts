import { describe, it, expect } from 'vitest';
import { applyGeneratedVisuals, type BgItem } from '../generativeVisuals';

const bg = (id: string): BgItem => ({ id, url: id, previewUrl: id, image: id, kind: 'video' });
const gen = (id: string): BgItem => ({ id, url: id, previewUrl: id, image: id, kind: 'image' });

describe('applyGeneratedVisuals', () => {
  it('replace mode swaps the list entirely', () => {
    const out = applyGeneratedVisuals([bg('a'), bg('b')], [gen('g1'), gen('g2')], 'replace', 4);
    expect(out.map((x) => x.id)).toEqual(['g1', 'g2']);
  });

  it('alongside mode appends after existing', () => {
    const out = applyGeneratedVisuals([bg('a')], [gen('g1'), gen('g2')], 'alongside', 4);
    expect(out.map((x) => x.id)).toEqual(['a', 'g1', 'g2']);
  });

  it('never exceeds max (alongside)', () => {
    const out = applyGeneratedVisuals([bg('a'), bg('b'), bg('c')], [gen('g1'), gen('g2')], 'alongside', 4);
    expect(out).toHaveLength(4);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'g1']);
  });

  it('dedups by id', () => {
    const out = applyGeneratedVisuals([bg('a')], [gen('a'), gen('g1')], 'alongside', 4);
    expect(out.map((x) => x.id)).toEqual(['a', 'g1']);
  });

  it('replace also respects max', () => {
    const out = applyGeneratedVisuals([], [gen('g1'), gen('g2'), gen('g3'), gen('g4'), gen('g5')], 'replace', 4);
    expect(out).toHaveLength(4);
  });
});
