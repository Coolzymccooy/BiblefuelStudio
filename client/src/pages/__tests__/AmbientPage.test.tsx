import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AmbientPage } from '../AmbientPage';
import { ambientApi } from '../../lib/ambientApi';
import { api } from '../../lib/api';
import type { AmbientProject } from '../../lib/ambientTypes';

function mkProject(overrides: Partial<AmbientProject> = {}): AmbientProject {
  return {
    projectId: 'a1',
    title: 'Peace Bed',
    theme: 'Peace in the storm',
    translation: 'kjv',
    targetSec: 7200,
    aspect: 'landscape',
    status: 'draft',
    bed: {
      mode: 'assemble', trackRefs: [], filePath: null, crossfadeSec: 6, volume: 0.85,
      builtPath: null, builtHash: null, allowUncleared: false,
    },
    drops: [
      { id: 'd1', atMs: 900_000, reference: 'John 14:27', translation: 'kjv', status: 'pending', text: null, audioPath: null, durationMs: null },
      { id: 'd2', atMs: 1_800_000, reference: 'Psalm 23:1', translation: 'kjv', status: 'error', error: 'lookup failed', text: null, audioPath: null, durationMs: null },
    ],
    movements: [
      { id: 'm1', startMs: 0, endMs: 900_000, imagePrompt: 'p', imagePath: null, imageUrl: null, imageStatus: 'pending' },
    ],
    motion: 'still',
    captions: 'none',
    captionPreset: 'cinematic-default',
    duck: { threshold: 0.02, ratio: 8, attackMs: 20, releaseMs: 800 },
    render: { jobId: null, outputPath: null, status: null },
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AmbientProject;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(AmbientPage)),
  );
}

const CATALOGUE = {
  ok: true,
  data: {
    ok: true,
    animations: [{ id: 'pop-in', label: 'Pop in', renderable: true }],
    motions: [
      { id: 'words', label: 'Word by word' },
      { id: 'lines', label: 'Line by line' },
    ],
  },
};

const MUSIC_LIBRARY = { ok: true, data: { ok: true, tracks: [] } };

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.includes('/api/tts/animations')) return CATALOGUE as any;
    if (url.includes('/api/music/library')) return MUSIC_LIBRARY as any;
    return { ok: false, status: 404, error: 'not mocked' } as any;
  });
});

describe('AmbientPage', () => {
  it('creates the session at the length picked from the presets', async () => {
    const create = vi.spyOn(ambientApi, 'createProject').mockResolvedValue(mkProject({ targetSec: 3600 }));
    vi.spyOn(ambientApi, 'getProject').mockResolvedValue(mkProject({ targetSec: 3600 }));
    renderPage();
    await userEvent.type(screen.getByLabelText(/title/i), 'Still Waters');
    await userEvent.type(screen.getByLabelText(/theme/i), 'Rest');
    await userEvent.click(screen.getByRole('button', { name: /1 hour/ }));
    await userEvent.click(screen.getByRole('button', { name: /create project/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][2]).toBe(3600);
  });

  it('shows the creation form when there is no active project', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /ambient/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
  });

  it('renders all four steps for an active project', async () => {
    localStorage.setItem('BF_AMBIENT_ACTIVE', 'a1');
    vi.spyOn(ambientApi, 'getProject').mockResolvedValue(mkProject());
    const user = userEvent.setup();
    renderPage();

    // Sound (default step)
    expect(await screen.findByText('Music bed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Word' }));
    expect(await screen.findByRole('button', { name: /suggest verses/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Look' }));
    expect(await screen.findByRole('button', { name: /generate images/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Render' }));
    // Both the step tab and the render action are labelled "Render" once this
    // step is active.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Render' })).toHaveLength(2));
  });

  it('shows the licence warning on a 409 and resends with allowUncleared on "use anyway"', async () => {
    localStorage.setItem('BF_AMBIENT_ACTIVE', 'a1');
    const project = mkProject();
    vi.spyOn(ambientApi, 'getProject').mockResolvedValue(project);
    const setBed = vi.spyOn(ambientApi, 'setBed')
      .mockResolvedValueOnce({ ok: false, uncleared: [{ id: 't1', label: 'Unknown Track' }] })
      .mockResolvedValueOnce({ ok: true, project: mkProject({ bed: { ...project.bed, mode: 'file' } }) });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Music bed');
    await user.click(screen.getByRole('button', { name: 'Upload one mix' }));

    expect(await screen.findByText(/unrecorded licence/i)).toBeInTheDocument();
    expect(screen.getByText('Unknown Track')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /use anyway/i }));

    await waitFor(() => expect(setBed).toHaveBeenLastCalledWith('a1', { mode: 'file', allowUncleared: true }));
  });

  it('patches drop edits through PATCH /:id/drops', async () => {
    localStorage.setItem('BF_AMBIENT_ACTIVE', 'a1');
    const project = mkProject();
    vi.spyOn(ambientApi, 'getProject').mockResolvedValue(project);
    const patchDrops = vi.spyOn(ambientApi, 'patchDrops').mockResolvedValue(project);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Word' }));
    const refInput = await screen.findByDisplayValue('John 14:27');
    await user.clear(refInput);
    await user.type(refInput, 'Isaiah 26:3');
    fireEvent.blur(refInput);

    await waitFor(() => expect(patchDrops).toHaveBeenCalled());
    const lastCallArgs = patchDrops.mock.calls[patchDrops.mock.calls.length - 1];
    expect(lastCallArgs[0]).toBe('a1');
    const sentDrop = lastCallArgs[1].find((d: any) => d.id === 'd1');
    expect(sentDrop?.reference).toBe('Isaiah 26:3');
  });

  it('sends a caption change through PATCH /:id/captions', async () => {
    localStorage.setItem('BF_AMBIENT_ACTIVE', 'a1');
    const project = mkProject();
    vi.spyOn(ambientApi, 'getProject').mockResolvedValue(project);
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project } } as any);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Look' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Captions' }), 'on');

    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith('/api/ambient/a1/captions', { captions: 'kinetic' }));
  });
});
