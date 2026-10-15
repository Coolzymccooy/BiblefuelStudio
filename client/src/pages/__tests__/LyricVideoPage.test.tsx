import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../../lib/lyricVideoApi', () => ({
  lyricVideoApi: { list: vi.fn(), prefs: vi.fn(), create: vi.fn(), get: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { LyricVideoPage } from '../LyricVideoPage';
import type { LyricProject } from '../../lib/lyricVideoTypes';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/app/lyric-video" element={<LyricVideoPage />} />
          <Route path="/app/lyric-video/:projectId" element={<LyricVideoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const project = (extra: Record<string, unknown> = {}) => ({
  projectId: 'lv_1', title: 'My Time', artist: 'Sthill Waters', song: null, sheet: { raw: '', parsedAt: null },
  sections: [], lines: [], timing: { status: 'idle' }, look: { id: 'studio-lagos-night', energy: 'lively', seed: 1 },
  background: null, renders: [], ...extra,
}) as unknown as LyricProject;

describe('LyricVideoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lyricVideoApi.list).mockResolvedValue([]);
    vi.mocked(lyricVideoApi.prefs).mockResolvedValue({ artist: 'Sthill Waters' });
  });

  it('links to the open-source credits in small print, on the start screen and in a song (R41)', async () => {
    renderAt('/app/lyric-video');
    const link = await screen.findByRole('link', { name: 'Open-source credits' });
    expect(link.getAttribute('href')).toBe('/third-party-notices.txt');
    expect(link.getAttribute('target')).toBe('_blank');
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project());
    renderAt('/app/lyric-video/lv_1'); // a second page, alongside the first
    await waitFor(() => expect(lyricVideoApi.get).toHaveBeenCalledWith('lv_1'));
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Open-source credits' })).toHaveLength(2));
  });

  it('shows the start screen with the remembered artist', async () => {
    renderAt('/app/lyric-video');
    expect(await screen.findByRole('heading', { level: 1, name: /lyric video/i })).toBeTruthy();
    expect(await screen.findByDisplayValue('Sthill Waters')).toBeTruthy();
  });

  it('starts a project and opens it', async () => {
    vi.mocked(lyricVideoApi.create).mockResolvedValue(project());
    renderAt('/app/lyric-video');
    await screen.findByDisplayValue('Sthill Waters');
    fireEvent.change(screen.getByLabelText(/song title/i), { target: { value: 'My Time' } });
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await waitFor(() => expect(lyricVideoApi.create).toHaveBeenCalledWith('My Time', 'Sthill Waters'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/app/lyric-video/lv_1'));
  });

  it('needs a title before it starts', async () => {
    renderAt('/app/lyric-video');
    await screen.findByDisplayValue('Sthill Waters');
    expect((screen.getByRole('button', { name: /start/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists earlier songs', async () => {
    vi.mocked(lyricVideoApi.list).mockResolvedValue([
      { projectId: 'lv_9', title: 'Old Song', artist: 'A', updatedAt: '2026-10-01T10:00:00Z', hasRender: true },
    ]);
    renderAt('/app/lyric-video');
    const link = await screen.findByRole('link', { name: /old song/i });
    expect(link.getAttribute('href')).toBe('/app/lyric-video/lv_9');
  });

  it('opens a project on its first unfinished step and lets you move between steps', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project());
    renderAt('/app/lyric-video/lv_1');
    expect(await screen.findByText('My Time')).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload/i })).toBeTruthy(); // Song step
    // Lyrics needs a song first.
    expect((screen.getByRole('button', { name: /lyrics/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens at the Lyrics step once the song is in', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project({ song: { file: 'x', durationSec: 30, coverStill: null } }));
    renderAt('/app/lyric-video/lv_1');
    expect(await screen.findByRole('button', { name: /read lyrics/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /song$/i }));
    expect(await screen.findByText(/Song: 0:30/)).toBeTruthy();
  });

  it('says so when the project cannot be opened', async () => {
    vi.mocked(lyricVideoApi.get).mockRejectedValue(new Error('That song project was not found'));
    renderAt('/app/lyric-video/lv_404');
    expect(await screen.findByText('That song project was not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: /your songs/i }).getAttribute('href')).toBe('/app/lyric-video');
    expect(toast.error).not.toHaveBeenCalled();
  });
});
