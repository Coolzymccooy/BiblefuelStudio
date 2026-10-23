import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CastPanel } from '../CastPanel';
import type { SceneScriptProject } from '../../../lib/sceneScriptTypes';

const voices = [{ id: 'v1', label: 'Voice one' }, { id: 'v2', label: 'Voice two' }];

// A fresh object every call, as each poll deserialises a new project.
const project = (lead = 'A man in a grey coat') => ({
  cast: { Narrator: { voice: 'v1', rate: '0%', pitch: '0%' } },
  look: { lead, peopleNote: '', style: '' },
}) as unknown as SceneScriptProject;

const lead = () => document.getElementById('look-lead') as HTMLTextAreaElement;

function renderPanel(p: SceneScriptProject) {
  return render(<CastPanel project={p} voices={voices as never} rooms={['small']} onEdit={vi.fn()} />);
}

describe('CastPanel', () => {
  it('keeps an unsaved edit when a poll brings the same saved project', () => {
    const { rerender } = renderPanel(project());
    fireEvent.change(lead(), { target: { value: 'A woman in white' } });
    rerender(<CastPanel project={project()} voices={voices as never} rooms={['small']} onEdit={vi.fn()} />);
    expect(lead().value).toBe('A woman in white');
    expect(screen.getByRole('button', { name: 'Save cast and look' })).not.toBeDisabled();
  });

  it('takes the saved value when the project itself changes', () => {
    const { rerender } = renderPanel(project());
    rerender(<CastPanel project={project('A shepherd boy')} voices={voices as never} rooms={['small']} onEdit={vi.fn()} />);
    expect(lead().value).toBe('A shepherd boy');
  });
});
