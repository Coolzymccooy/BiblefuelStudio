import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AmbientSoundStep, addImportedToBed } from '../AmbientSoundStep';
import { ambientApi } from '../../../lib/ambientApi';
import * as libraryApi from '../../../lib/musicLibraryApi';
import type { AmbientProject } from '../../../lib/ambientTypes';

const project = {
  projectId: 'p1', targetSec: 7200, status: 'draft', motion: 'still',
  bed: { mode: 'assemble', trackRefs: [], filePath: null, crossfadeSec: 6, volume: 0.85 },
} as unknown as AmbientProject;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue([]);
});

describe('AmbientSoundStep', () => {
  it('lets a whole folder of tracks be added to the library from where the bed is chosen', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AmbientSoundStep project={project} busy={false} setBusy={() => {}} refresh={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Add tracks to your library')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose tracks to add')).toHaveAttribute('multiple');
  });

  it("imported tracks join the video's bed as it is now, after what's there, without repeats", async () => {
    // The import can finish after the step was left, so the merge reads the
    // bed fresh rather than from the step's last render.
    vi.spyOn(ambientApi, 'getProject').mockResolvedValue({
      ...project, bed: { ...project.bed, trackRefs: ['library:prayer-piano', 'mylib:a'] },
    } as AmbientProject);
    const setBed = vi.spyOn(ambientApi, 'setBed').mockResolvedValue({ ok: true } as never);
    await addImportedToBed('p1', ['mylib:a', 'mylib:b']);
    expect(setBed).toHaveBeenCalledWith('p1', { trackRefs: ['library:prayer-piano', 'mylib:a', 'mylib:b'] });
  });

  it('offers to add imported tracks to the bed only when the bed is built from tracks', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AmbientSoundStep project={{ ...project, bed: { ...project.bed, mode: 'file' } } as AmbientProject} busy={false} setBusy={() => {}} refresh={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('checkbox', { name: /add them to this video/i })).not.toBeInTheDocument();
  });
});

describe('AmbientSoundStep — imported tracks the licence check holds back', () => {
  it('says so in a toast, which is still seen if the step was left mid-import', async () => {
    const { reportImportGate } = await import('../AmbientSoundStep');
    const toastMod = (await import('react-hot-toast')).default;
    const error = vi.spyOn(toastMod, 'error').mockImplementation(() => '');
    reportImportGate([{ id: 'u9', label: 'Mystery Mix', licence: 'unknown' }]);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Mystery Mix.*licence/i), expect.anything());
  });
});
