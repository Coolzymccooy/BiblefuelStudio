import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { toStory: vi.fn(), useStoryVideo: vi.fn() } }));
vi.mock('../../../lib/storyApi', () => ({ storyApi: { animateRates: vi.fn(), getProject: vi.fn() } }));

import toast from 'react-hot-toast';
import { useAuth } from '../../../hooks/useAuth';
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { storyApi } from '../../../lib/storyApi';
import { MusicVideoCard } from '../MusicVideoCard';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const line = (id: string, start: number) => ({
  id, sectionId: 's1', kind: 'lead', text: `line ${id}`, effect: 'auto', start, end: start + 3, words: [{ text: 'x', start, end: start + 3 }],
});
// Verse 0-12 s and chorus 12-24 s: two scenes of 12 s, so 24 clip seconds.
const project = {
  projectId: 'lv_1', title: 'Grace', artist: 'SW',
  song: { file: '/o/song.m4a', durationSec: 24, coverStill: null },
  sections: [{ id: 's1', kind: 'verse', label: 'Verse', start: 0 }, { id: 's2', kind: 'chorus', label: 'Chorus', start: 12 }],
  lines: [line('l1', 1), line('l2', 6), { ...line('l3', 13), sectionId: 's2' }],
  timing: { status: 'done' }, background: null, renders: [],
} as unknown as LyricProject;
const rates = { configured: true, usdPerSecond: { standard: 0.1, high: 0.2 }, monthSpentUsd: 0, reservedUsd: 0, capUsd: 50 };

function renderCard(p: LyricProject, onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
  return { onChange, ...render(<MusicVideoCard project={p} onChange={onChange} />, { wrapper: wrap }) };
}

describe('MusicVideoCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState({ isSuperAdmin: true });
    vi.mocked(storyApi.animateRates).mockResolvedValue(rates);
  });

  it('is hidden from anyone but a super admin, who never asks for the rates', () => {
    useAuth.setState({ isSuperAdmin: false });
    renderCard(project);
    expect(screen.queryByRole('heading', { name: 'AI music video' })).toBeNull();
    expect(storyApi.animateRates).not.toHaveBeenCalled();
  });

  it('is hidden until the timing is done', () => {
    renderCard({ ...project, timing: { status: 'running' } } as LyricProject);
    expect(screen.queryByRole('heading', { name: 'AI music video' })).toBeNull();
  });

  it('shows the fields, with animate on and the clip estimate', async () => {
    renderCard(project);
    expect(screen.getByRole('heading', { name: 'AI music video' })).toBeTruthy();
    expect(screen.getByLabelText(/how the singer looks/i)).toBeTruthy();
    expect(screen.getByLabelText(/^shape$/i)).toBeTruthy();
    const animate = await screen.findByRole('checkbox', { name: /animate the scenes/i });
    expect((animate as HTMLInputElement).checked).toBe(true);
    expect(await screen.findByText('about 2 clips · ≈ $2.40')).toBeTruthy();
  });

  it('without AI motion on the server, offers still pictures only', async () => {
    vi.mocked(storyApi.animateRates).mockResolvedValue({ ...rates, configured: false });
    renderCard(project);
    expect(await screen.findByText(/still pictures/i)).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /animate the scenes/i })).toBeNull();
  });

  it('makes the music video and opens it in Story Video', async () => {
    vi.mocked(lyricVideoApi.toStory).mockResolvedValue('sp-9');
    renderCard(project);
    await screen.findByText('about 2 clips · ≈ $2.40');
    await userEvent.type(screen.getByLabelText(/how the singer looks/i), 'a man in an olive shirt');
    fireEvent.change(screen.getByLabelText(/^shape$/i), { target: { value: 'landscape' } });
    await userEvent.click(screen.getByRole('button', { name: 'Make AI music video' }));
    await waitFor(() => expect(lyricVideoApi.toStory).toHaveBeenCalledWith('lv_1', { aspect: 'landscape', character: 'a man in an olive shirt', aiMotion: true }));
    expect(navigate).toHaveBeenCalledWith('/app/story?project=sp-9');
  });

  it('sends animate off when it is unticked, and says why a refusal happened', async () => {
    vi.mocked(lyricVideoApi.toStory).mockRejectedValue(new Error('Run Timing first.'));
    renderCard(project);
    await userEvent.click(await screen.findByRole('checkbox', { name: /animate the scenes/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Make AI music video' }));
    await waitFor(() => expect(lyricVideoApi.toStory).toHaveBeenCalledWith('lv_1', { aspect: 'portrait', character: '', aiMotion: false }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Run Timing first.'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('once linked, opens the Story project; the background button waits for its render', async () => {
    vi.mocked(storyApi.getProject).mockResolvedValue({ projectId: 'sp-1', status: 'generating_images', render: { status: null } } as never);
    renderCard({ ...project, musicVideo: { storyProjectId: 'sp-1', createdAt: 'x' } } as LyricProject);
    expect(screen.getByRole('link', { name: 'Open in Story Video' }).getAttribute('href')).toBe('/app/story?project=sp-1');
    await waitFor(() => expect(storyApi.getProject).toHaveBeenCalledWith('sp-1'));
    expect(screen.queryByRole('button', { name: 'Use as lyric background' })).toBeNull();
  });

  it('uses the finished Story video as the background', async () => {
    const next = { ...project, background: { file: '/o/story/sp-1/video.mp4', kind: 'video', fit: 'auto' } } as LyricProject;
    vi.mocked(storyApi.getProject).mockResolvedValue({ projectId: 'sp-1', status: 'done', render: { status: 'done', outputPath: '/o/v.mp4' } } as never);
    vi.mocked(lyricVideoApi.useStoryVideo).mockResolvedValue(next);
    const { onChange } = renderCard({ ...project, musicVideo: { storyProjectId: 'sp-1', createdAt: 'x' } } as LyricProject);
    await userEvent.click(await screen.findByRole('button', { name: 'Use as lyric background' }));
    await waitFor(() => expect(lyricVideoApi.useStoryVideo).toHaveBeenCalledWith('lv_1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
  });
});
