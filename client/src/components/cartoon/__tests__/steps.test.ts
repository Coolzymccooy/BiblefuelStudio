import { describe, it, expect } from 'vitest';
import { reachableSteps, furthestStep } from '../steps';
import type { CartoonProject } from '../../../lib/cartoonTypes';

const member = (approved: boolean) => ({
  name: 'Eli', look: 'a boy', voice: 'bright', approved, shelfId: null,
  portrait: approved ? { status: 'done', url: '/p.png', error: null } : null,
});
const shot = (status: string | null) => ({
  id: 's1', sceneId: 'a', speaker: 'Eli', line: 'Hi', action: null, note: '', seconds: 4, firstFrame: 'fresh',
  clip: status ? { status } : null,
});

function project(over: Record<string, unknown> = {}): CartoonProject {
  return {
    meta: { title: 'T', verse: { reference: '', text: '' }, aspect: 'portrait', style: 'family3d' },
    cast: { Eli: member(false), Pip: member(true) },
    shots: [shot(null), shot(null)],
    shotListApproved: false,
    ...over,
  } as unknown as CartoonProject;
}

describe('reachableSteps', () => {
  it('opens each step only once the ones before it are satisfied', () => {
    expect(reachableSteps(null)).toEqual(['script']);
    expect(reachableSteps(project())).toEqual(['script', 'cast']);

    const cast = { Eli: member(true), Pip: member(true) };
    expect(reachableSteps(project({ cast }))).toEqual(['script', 'cast', 'style', 'shots']);
    expect(reachableSteps(project({ cast, meta: { title: 'T', style: '' } }))).toEqual(['script', 'cast', 'style']);

    expect(reachableSteps(project({ cast, shotListApproved: true }))).toEqual(['script', 'cast', 'style', 'shots', 'film']);
    expect(reachableSteps(project({ cast, shotListApproved: true, shots: [shot('done'), shot('generating')] })))
      .toEqual(['script', 'cast', 'style', 'shots', 'film']);
    expect(reachableSteps(project({ cast, shotListApproved: true, shots: [shot('done'), shot('done')] })))
      .toEqual(['script', 'cast', 'style', 'shots', 'film', 'finish']);
  });

  it('never skips a step: an approved shot list counts for nothing while a portrait is unapproved', () => {
    expect(reachableSteps(project({ shotListApproved: true, shots: [shot('done')] }))).toEqual(['script', 'cast']);
  });

  it('opens a project at its furthest reachable step', () => {
    expect(furthestStep(null)).toBe('script');
    expect(furthestStep(project())).toBe('cast');
  });
});
