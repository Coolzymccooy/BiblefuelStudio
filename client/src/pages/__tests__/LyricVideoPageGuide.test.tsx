import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../../lib/lyricVideoApi', () => ({ lyricVideoApi: { get: vi.fn() } }));
// The steps are covered by their own tests; here only the guide above them matters.
vi.mock('../../components/lyricVideo/SongStep', () => ({ SongStep: () => <div>song step</div> }));
vi.mock('../../components/lyricVideo/LyricsStep', () => ({ LyricsStep: () => <div>lyrics step</div> }));
vi.mock('../../components/lyricVideo/TimingStep', () => ({ TimingStep: () => <div>timing step</div> }));
vi.mock('../../components/lyricVideo/LookStep', () => ({ LookStep: () => <div>look step</div> }));
vi.mock('../../components/lyricVideo/RenderStep', () => ({ RenderStep: () => <div>render step</div> }));
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { LyricVideoPage } from '../LyricVideoPage';
import type { LyricProject } from '../../lib/lyricVideoTypes';

const project = (status: string, song: unknown = { file: 'x', durationSec: 30, coverStill: null }) => ({
  projectId: 'lv_1', title: 'My Time', artist: '', song,
  sheet: { raw: 'a', parsedAt: 't' }, sections: [], lines: [{ id: 'l1', words: [{ text: 'a', start: 0, end: 1 }] }],
  timing: { status }, look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 }, background: null, renders: [],
}) as unknown as LyricProject;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/lyric-video/lv_1']}>
        <Routes><Route path="/app/lyric-video/:projectId" element={<LyricVideoPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TITLE = 'How to make a lyric video';
const STEP_LABELS = ['Upload your song', 'Paste your lyrics', 'Time the lyrics', 'Choose the look', 'Render and download'];

describe('LyricVideoPage guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows the title and the five steps', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('done'));
    renderPage();
    expect(await screen.findByRole('heading', { name: TITLE })).toBeTruthy();
    for (const label of STEP_LABELS) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('You can go back to any step. Your changes are saved.')).toBeTruthy();
  });

  it('shows on a project that opens on the first step too', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('idle', null));
    renderPage();
    expect(await screen.findByText('song step')).toBeTruthy();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
  });

  it('can be dismissed, leaves "Show steps", and comes back from it', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('done'));
    renderPage();
    await screen.findByRole('heading', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss steps' }));
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show steps' }));
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
  });

  it('stays dismissed on a later visit', async () => {
    localStorage.setItem('bf_guide_dismissed_lyric-video', 'true');
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('done'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Show steps' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
  });
});
