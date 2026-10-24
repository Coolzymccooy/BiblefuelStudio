import { describe, it, expect } from 'vitest';
import type { CartoonClip, CartoonShot } from '../../../lib/cartoonTypes';
import { clipStatusLabel, monthLeftUsd, postCaption, posterOptions, priceOfShots, rateUsdPerSec, retryShotIds } from '../film';

const shot = (id: string, clip: CartoonClip | null, seconds = 4): CartoonShot => ({
  id, sceneId: 'a', speaker: 'Eli', line: 'Hi', action: null, note: '', seconds, firstFrame: 'chain', clip,
});

describe('film rules', () => {
  it('names every clip state, and a waiting shot names the shot before it', () => {
    const labels = (['queued', 'generating', 'done', 'refused', 'error'] as const).map((status) => clipStatusLabel(shot('s', { status }), 1));
    expect(labels).toEqual(['Queued', 'Making', 'Done', 'Refused', 'Failed']);
    expect(clipStatusLabel(shot('s', { status: 'waiting' }), 3)).toBe('Waiting for shot 3');
    expect(clipStatusLabel(shot('s', null), 0)).toBe('Not made yet');
  });

  it('retries nothing until a shot has failed, and never a done or in-flight shot', () => {
    expect(retryShotIds([shot('a', { status: 'waiting' })])).toEqual([]);
    const shots = [shot('a', { status: 'done' }), shot('b', { status: 'refused' }), shot('c', { status: 'waiting' }), shot('d', { status: 'generating' })];
    expect(retryShotIds(shots)).toEqual(['b', 'c']);
  });

  it('prices shots from an estimate\'s own rate', () => {
    expect(rateUsdPerSec({ seconds: 0, usd: 0 })).toBeNull();
    const rate = rateUsdPerSec({ seconds: 10, usd: 1 });
    expect(priceOfShots([shot('a', null, 4), shot('b', null, 6)], rate)).toBeCloseTo(1);
    expect(priceOfShots([shot('a', null)], null)).toBeNull();
  });

  it('counts reservations against what is left this month, never below zero', () => {
    expect(monthLeftUsd({ spentUsd: 40, capUsd: 50, reservedUsd: 2.5 })).toBe(7.5);
    expect(monthLeftUsd({ spentUsd: 60, capUsd: 50 })).toBe(0);
    expect(monthLeftUsd(null)).toBeNull();
  });

  it('writes the post caption from the title and verse', () => {
    const meta = { title: 'The Lost Lamb', verse: { reference: 'Luke 15:4', text: 'Go after the lost sheep.' }, aspect: 'portrait' as const, style: 'x' };
    expect(postCaption({ meta })).toBe('The Lost Lamb\n\n“Go after the lost sheep.”\nLuke 15:4');
    expect(postCaption({ meta: { ...meta, verse: { reference: 'Luke 15:4', text: '' } } })).toBe('The Lost Lamb\n\nLuke 15:4');
  });

  it('offers done clips\' poster frames in shot order', () => {
    const shots = [shot('a', { status: 'done', posterUrl: '/p/a.jpg' }), shot('b', { status: 'error', posterUrl: '/p/b.jpg' }), shot('c', { status: 'done', posterUrl: '/p/c.jpg' })];
    expect(posterOptions(shots)).toEqual([{ label: 'Shot 1', path: '/p/a.jpg' }, { label: 'Shot 3', path: '/p/c.jpg' }]);
  });
});
