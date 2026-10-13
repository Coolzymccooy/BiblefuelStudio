import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../../lib/lyricVideoApi', () => ({ lyricVideoApi: { get: vi.fn() } }));
// The steps are covered by their own tests; here only the page's handling of them matters.
vi.mock('../../components/lyricVideo/SongStep', () => ({ SongStep: () => <div>song step</div> }));
vi.mock('../../components/lyricVideo/LyricsStep', () => ({ LyricsStep: () => <div>lyrics step</div> }));
vi.mock('../../components/lyricVideo/TimingStep', () => ({
  TimingStep: ({ project }: { project: { timing: { status: string } } }) => <div>timing step ({project.timing.status})</div>,
}));
vi.mock('../../components/lyricVideo/LookStep', () => ({ LookStep: () => <div>look step</div> }));
vi.mock('../../components/lyricVideo/RenderStep', () => ({
  RenderStep: () => <div>render step <video data-testid="result" controls /></div>,
}));
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { LyricVideoPage } from '../LyricVideoPage';
import type { LyricProject } from '../../lib/lyricVideoTypes';

const project = (status: string) => ({
  projectId: 'lv_1', title: 'My Time', artist: '', song: { file: 'x', durationSec: 30, coverStill: null },
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
  return qc;
}

describe('LyricVideoPage steps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays on Timing when a run that was in progress finishes, so the lines to check are seen', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('running'));
    const qc = renderPage();
    expect(await screen.findByText('timing step (running)')).toBeTruthy();
    act(() => { qc.setQueryData(['lyric-project', 'lv_1'], project('done')); });
    expect(await screen.findByText('timing step (done)')).toBeTruthy();
    expect(screen.queryByText('look step')).toBeNull();
  });

  it('opens a finished project on the Look step', async () => {
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('done'));
    renderPage();
    expect(await screen.findByText('look step')).toBeTruthy();
  });

  it('silences the finished video when you leave the Render step, and keeps it for when you return', async () => {
    const pause = vi.fn();
    HTMLMediaElement.prototype.pause = pause;
    vi.mocked(lyricVideoApi.get).mockResolvedValue(project('done'));
    renderPage();
    await screen.findByText('look step');
    fireEvent.click(screen.getByRole('button', { name: /render$/i }));
    expect(screen.getByText(/render step/)).toBeTruthy();
    expect(pause).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /look$/i }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByTestId('result').closest('[hidden]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /render$/i }));
    expect(screen.getByTestId('result').closest('[hidden]')).toBeNull();
  });
});
