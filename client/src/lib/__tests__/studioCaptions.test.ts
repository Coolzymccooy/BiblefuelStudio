import { describe, it, expect } from 'vitest';
import {
  SEED_MAX, isStudioLook, readableLook, lookSlug, nextSeed, randomSeed, normaliseEnergy, normaliseSeed,
} from '../studioCaptions';

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

  it('normaliseEnergy keeps a known energy and replaces anything else with the fallback', () => {
    expect(normaliseEnergy('calm', 'lively')).toBe('calm');
    expect(normaliseEnergy('lively', 'calm')).toBe('lively');
    expect(normaliseEnergy('wild', 'calm')).toBe('wild');
    for (const bad of ['loud', 'Wild', '', null, undefined, 3, {}]) {
      expect(normaliseEnergy(bad, 'lively')).toBe('lively');
      expect(normaliseEnergy(bad, 'calm')).toBe('calm');
    }
  });

  it('normaliseSeed keeps an integer seed in range', () => {
    expect(normaliseSeed(0)).toBe(0);
    expect(normaliseSeed(42)).toBe(42);
    expect(normaliseSeed(SEED_MAX)).toBe(SEED_MAX);
  });

  it('normaliseSeed replaces anything else with a fresh random seed in range', () => {
    for (const bad of [-1, 1.5, SEED_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY, '42', '', null, undefined, true, {}]) {
      const s = normaliseSeed(bad);
      expect(Number.isInteger(s) && s >= 0 && s <= SEED_MAX, `${String(bad)} -> ${s}`).toBe(true);
    }
  });

  it('randomSeed stays in range', () => {
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s < SEED_MAX).toBe(true);
  });
});
