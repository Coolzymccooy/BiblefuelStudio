import { describe, it, expect } from 'vitest';
import { firstOpenStep, reachableSteps } from '../lyricSteps';
import type { LyricProject } from '../lyricVideoTypes';

const make = (extra: Record<string, unknown> = {}) =>
  ({ song: null, lines: [], timing: { status: 'idle' }, ...extra }) as unknown as LyricProject;
const song = { file: 'x', durationSec: 10, coverStill: null };
const lines = [{ id: 'l1' }];

describe('firstOpenStep', () => {
  it('starts with the song', () => expect(firstOpenStep(make())).toBe('song'));
  it('then the lyrics', () => expect(firstOpenStep(make({ song }))).toBe('lyrics'));
  it('stays on the lyrics until timing has been started', () => {
    expect(firstOpenStep(make({ song, lines }))).toBe('lyrics');
  });
  it('follows timing while it runs or has failed', () => {
    expect(firstOpenStep(make({ song, lines, timing: { status: 'running' } }))).toBe('timing');
    expect(firstOpenStep(make({ song, lines, timing: { status: 'error' } }))).toBe('timing');
  });
  it('moves on to the look once timing is done', () => {
    expect(firstOpenStep(make({ song, lines, timing: { status: 'done' } }))).toBe('look');
  });
  it('reopens on the render while a video is being made (R43)', () => {
    expect(firstOpenStep(make({ song, lines, timing: { status: 'done' }, render: { activeJobId: 'j1' } }))).toBe('render');
    expect(firstOpenStep(make({ song, lines, timing: { status: 'done' }, render: null }))).toBe('look');
  });
});

describe('reachableSteps', () => {
  it('opens each step only once the one before it has made what it needs', () => {
    expect(reachableSteps(make())).toEqual({ song: true, lyrics: false, timing: false, look: false, render: false });
    expect(reachableSteps(make({ song }))).toMatchObject({ lyrics: true, timing: false });
    expect(reachableSteps(make({ song, lines }))).toMatchObject({ timing: true, look: false, render: false });
    expect(reachableSteps(make({ song, lines, timing: { status: 'done' } }))).toMatchObject({ look: true, render: true });
  });
});
