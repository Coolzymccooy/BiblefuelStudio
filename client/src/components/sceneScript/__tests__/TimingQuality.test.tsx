import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProductionBar } from '../ProductionBar';
import type { SceneScriptProject } from '../../../lib/sceneScriptTypes';

function fixture(quality?: string): SceneScriptProject {
  return {
    lines: [{ audio: { words: [{ text: 'Hello', start: 0, end: quality === 'unresolved' ? 0 : 1 }], ...(quality ? { timing: { quality } } : {}) } }],
    captions: { enabled: true }, timeline: null, needsVoice: false,
    running: { voice: false, shots: false, render: false }, shots: [],
    render: { status: 'idle' }, blockers: [],
    estimate: { clips: 0, refetch: 0, spentUsd: 0 },
  } as unknown as SceneScriptProject;
}
function mount(project: SceneScriptProject) {
  const onRender = vi.fn();
  render(<ProductionBar project={project} month={null} seedance busy={null} onVoice={vi.fn()} onSuggest={vi.fn()} onOrder={vi.fn()} onCancelShots={vi.fn()} onCancelRender={vi.fn()} onRender={onRender} />);
  return onRender;
}
describe('Scene Script visible timing quality', () => {
  it('blocks unresolved caption exports instead of silently losing words', () => {
    const onRender = mount(fixture('unresolved'));
    expect(screen.getByRole('alert').textContent).toContain('Caption export blocked');
    const button = screen.getByRole('button', { name: 'Render video' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRender).not.toHaveBeenCalled();
  });
  it('permits caption-free output while keeping the unresolved warning', () => {
    const onRender = mount({ ...fixture('unresolved'), captions: { enabled: false } });
    expect(screen.getByText(/Unresolved word timing/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Render video' }));
    expect(onRender).toHaveBeenCalledOnce();
  });
  it('shows unknown for legacy projects, not verified', () => {
    mount(fixture());
    expect(screen.getByText(/Timing quality unknown/)).toBeTruthy();
  });
  it('exposes native provider evidence without promising acoustic accuracy', () => {
    mount(fixture('native'));
    expect(screen.getByText(/Native provider timing — not acoustically verified/)).toBeTruthy();
  });
});
