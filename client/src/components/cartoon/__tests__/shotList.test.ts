import { describe, it, expect } from 'vitest';
import { asOrdered, canChain, referencedCast, shotPriceUsd } from '../shotList';
import { listNames, waitingCast } from '../cast';
import type { CartoonCastEntry, CartoonProject, CartoonShot } from '../../../lib/cartoonTypes';

const member = (name: string, approved = true, url: string | null = `/p/${name}.png`): CartoonCastEntry => ({
  name, look: `${name} look`, voice: '', approved, shelfId: null,
  portrait: url ? { status: 'done', url, error: null } : null,
});

const shot = (over: Partial<CartoonShot>): CartoonShot => ({
  id: 'sh1', sceneId: 'a', speaker: null, line: null, action: null, note: '', seconds: 4, firstFrame: 'fresh', clip: null, ...over,
});

function project(over: Partial<CartoonProject> = {}): CartoonProject {
  return {
    cast: { Eli: member('Eli'), Pip: member('Pip'), Naomi: member('Naomi'), Boaz: member('Boaz') },
    scenes: [{ id: 'a', place: 'Hillside', note: '' }, { id: 'b', place: 'Field where Naomi waits', note: 'wide' }],
    shots: [],
    ...over,
  } as unknown as CartoonProject;
}

describe('referencedCast', () => {
  it('names the speaker first, then the others in the scene in order of appearance', () => {
    const shots = [
      shot({ id: 'sh1', sceneId: 'a', speaker: 'Eli', line: 'Pip?', action: 'Pip hides behind a rock' }),
      shot({ id: 'sh2', sceneId: 'a', speaker: 'Pip', line: 'Here!', firstFrame: 'chain' }),
    ];
    const p = project({ shots });
    expect(referencedCast(p, shots[1])).toEqual([]);
    expect(referencedCast(p, { ...shots[1], firstFrame: 'fresh' })).toEqual(['Pip', 'Eli']);
    expect(referencedCast(p, shots[0])).toEqual(['Eli', 'Pip']);
  });

  it('counts names in the place and note first, as whole words only, and stops at three', () => {
    const shots = [
      shot({ id: 'sh3', sceneId: 'b', speaker: 'Boaz', line: 'Hello', action: 'Eli and Pip run in; Elisha watches' }),
    ];
    const p = project({ shots });
    expect(referencedCast(p, shots[0])).toEqual(['Boaz', 'Naomi', 'Eli']);
  });

  it('leaves out characters without an approved portrait', () => {
    const shots = [shot({ id: 'sh1', speaker: 'Eli', line: 'Hi', action: 'Pip bleats' })];
    const p = project({ shots, cast: { Eli: member('Eli', false), Pip: member('Pip', true) } as never });
    expect(referencedCast(p, shots[0])).toEqual(['Pip']);
  });
});

describe('asOrdered and canChain', () => {
  it('treats the first shot of the film as a new angle whatever it says', () => {
    const first = shot({ firstFrame: 'chain' });
    expect(asOrdered(first, 0).firstFrame).toBe('fresh');
    expect(asOrdered(first, 1).firstFrame).toBe('chain');
    expect(canChain(0)).toBe(false);
    expect(canChain(1)).toBe(true);
  });
});

describe('shotPriceUsd', () => {
  const estimate = { seconds: 20, usd: 1.5 } as CartoonProject['estimate'];
  it('prices a shot at the estimate\'s own rate per second', () => {
    expect(shotPriceUsd(estimate, shot({ seconds: 4 }))).toBeCloseTo(0.3);
  });
  it('uses what a finished clip cost, and gives null when there is no rate to use', () => {
    expect(shotPriceUsd(estimate, shot({ clip: { status: 'done', costUsd: 0.42 } }))).toBe(0.42);
    expect(shotPriceUsd({ seconds: 0, usd: 0 } as CartoonProject['estimate'], shot({}))).toBeNull();
  });
});

describe('waitingCast', () => {
  it('lists every character, speakers included, without an approved finished portrait', () => {
    const p = project({
      cast: { Eli: member('Eli', true), Pip: member('Pip', false), Naomi: member('Naomi', true, null) } as never,
      shots: [shot({ speaker: 'Eli', line: 'Hi' })],
    });
    expect(waitingCast(p)).toEqual(['Pip', 'Naomi']);
  });
  it('reads names as a sentence', () => {
    expect(listNames(['Eli'])).toBe('Eli');
    expect(listNames(['Eli', 'Pip'])).toBe('Eli and Pip');
    expect(listNames(['Eli', 'Pip', 'Naomi'])).toBe('Eli, Pip and Naomi');
  });
});
