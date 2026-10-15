import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LyricStepper } from '../LyricStepper';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const project = (renders: unknown[]) => ({
  projectId: 'lv_1', title: 'T', artist: '', song: { file: 'x', durationSec: 30, coverStill: null },
  sheet: { raw: 'a', parsedAt: 't' }, sections: [], lines: [{ id: 'l1', words: [{ text: 'a', start: 0, end: 1 }] }],
  timing: { status: 'done' }, look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 }, background: null, renders,
}) as unknown as LyricProject;

const ticked = (name: RegExp) => screen.getByRole('button', { name }).querySelector('svg') !== null;

describe('LyricStepper', () => {
  it('ticks the steps before the one open, and not Render before any video is made', () => {
    render(<LyricStepper project={project([])} step="render" onStep={vi.fn()} />);
    expect(ticked(/song/i)).toBe(true);
    expect(ticked(/look/i)).toBe(true);
    expect(ticked(/render/i)).toBe(false);
  });

  it('ticks Render once a video has been made, on any step', () => {
    const made = project([{ jobId: 'j1', aspect: 'portrait', quality: '720p', file: 'lyric-1.mp4', durationSec: 30, at: '2026-10-15T00:00:00Z' }]);
    const { rerender } = render(<LyricStepper project={made} step="render" onStep={vi.fn()} />);
    expect(ticked(/render/i)).toBe(true);
    rerender(<LyricStepper project={made} step="look" onStep={vi.fn()} />);
    expect(ticked(/render/i)).toBe(true);
  });
});
