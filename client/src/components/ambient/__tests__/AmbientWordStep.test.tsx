import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmbientWordStep } from '../AmbientWordStep';
import { ambientApi } from '../../../lib/ambientApi';
import type { AmbientDrop, AmbientProject, AmbientStatus } from '../../../lib/ambientTypes';

beforeEach(() => vi.restoreAllMocks());

const drop = (over: Partial<AmbientDrop> = {}): AmbientDrop => ({
  id: 'd1',
  atMs: 900_000,
  reference: 'Psalms 46:1-2',
  status: 'pending',
  ...over,
});

const project = (status: AmbientStatus, drops: AmbientDrop[]): AmbientProject => ({
  projectId: 'p1',
  title: 'Peace in the storm',
  theme: 'peace in the storm',
  translation: 'kjv',
  targetSec: 7200,
  aspect: 'landscape',
  status,
  bed: { mode: 'assemble', trackRefs: [], filePath: null, crossfadeSec: 6, volume: 0.85 },
  drops,
  movements: [],
  motion: 'still',
  captionPreset: 'default',
  duck: { threshold: 0.02, ratio: 8, attackMs: 20, releaseMs: 800 },
  render: { jobId: null, outputPath: null, status: null },
  error: null,
  createdAt: 0,
  updatedAt: 0,
});

function renderStep(p: AmbientProject) {
  return render(
    <AmbientWordStep project={p} busy={false} setBusy={() => {}} refresh={() => {}} />,
  );
}

/**
 * "Suggest verses" fills the list with references and nothing else — the text
 * and audio arrive later, from "Voice all". Pending is therefore the correct
 * state to show. A SPINNER is not: nothing is running, so it span forever and
 * read as work in progress that never finished.
 */
describe('AmbientWordStep drop status', () => {
  it('a freshly suggested drop reads as waiting, not as working', () => {
    const { container } = renderStep(project('draft', [drop()]));
    expect(screen.getByText(/not voiced/i)).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('once voicing starts, the same drop does show a spinner', () => {
    const { container } = renderStep(project('voicing', [drop()]));
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByText(/voicing/i)).toBeInTheDocument();
  });

  it('a voiced drop reads Voiced and never spins', () => {
    const { container } = renderStep(project('ready_to_render', [
      drop({ status: 'done', audioPath: '/a.mp3', text: 'God is our refuge', durationMs: 8000 }),
    ]));
    expect(screen.getByText('Voiced')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('a failed drop shows its reason and never spins, even mid-voicing', () => {
    const { container } = renderStep(project('voicing', [
      drop({ status: 'error', error: 'bible api 404' }),
    ]));
    expect(screen.getByText(/bible api 404/)).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});

describe('AmbientWordStep — music only', () => {
  it('switching to music only saves it and hides the verse tools', async () => {
    const setWords = vi.spyOn(ambientApi, 'setWords').mockResolvedValue({} as never);
    const refresh = vi.fn();
    const p = project('draft', []);
    const { rerender } = render(
      <AmbientWordStep project={{ ...p, words: 'verses' }} busy={false} setBusy={() => {}} refresh={refresh} />,
    );
    await userEvent.click(screen.getByRole('switch', { name: /music only/i }));
    expect(setWords).toHaveBeenCalledWith(p.projectId, 'none');
    rerender(<AmbientWordStep project={{ ...p, words: 'none' }} busy={false} setBusy={() => {}} refresh={refresh} />);
    expect(screen.queryByRole('button', { name: /suggest verses/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no verses will be spoken/i)).toBeInTheDocument();
  });
});
