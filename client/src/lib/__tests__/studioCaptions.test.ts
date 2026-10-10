import { describe, it, expect } from 'vitest';
import { SEED_MAX, isStudioLook, readableLook, lookSlug, nextSeed, randomSeed } from '../studioCaptions';

describe('studioCaptions', () => {
  it('recognises Studio look ids', () => {
    expect(isStudioLook('studio-lagos-night')).toBe(true);
    expect(isStudioLook('hero-bold')).toBe(false);
    expect(isStudioLook(undefined)).toBe(false);
    expect(isStudioLook(null)).toBe(false);
  });

  it('turns a look id into a readable name', () => {
    expect(readableLook('studio-lagos-night')).toBe('Lagos Night');
  });

  it('lookSlug strips the Studio prefix and leaves other ids alone', () => {
    expect(lookSlug('studio-lagos-night')).toBe('lagos-night');
    expect(lookSlug('hero-bold')).toBe('hero-bold');
    expect(lookSlug('my-studio-look')).toBe('my-studio-look');
  });

  it('nextSeed never returns the current seed', () => {
    expect(nextSeed(3, () => 3 / SEED_MAX)).toBe(4);
    expect(nextSeed(SEED_MAX - 1, () => (SEED_MAX - 1) / SEED_MAX)).toBe(0);
    expect(nextSeed(undefined, () => 0.5)).toBe(Math.floor(0.5 * SEED_MAX));
  });

  it('randomSeed stays in range', () => {
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s < SEED_MAX).toBe(true);
  });
});
