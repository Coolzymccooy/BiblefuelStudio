import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AmbientSoundStep } from '../AmbientSoundStep';
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
});
