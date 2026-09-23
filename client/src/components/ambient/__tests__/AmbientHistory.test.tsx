import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ambientApi } from '../../../lib/ambientApi';
import type { AmbientProjectSummary } from '../../../lib/ambientTypes';
import { AmbientHistory } from '../AmbientHistory';

const DAY = 86_400_000;

const summary = (over: Partial<AmbientProjectSummary>): AmbientProjectSummary => ({
  projectId: 'p', title: 'Session', status: 'draft', targetSec: 600, aspect: 'landscape',
  hasVideo: false, lastPublished: null, updatedAt: Date.now() - DAY, ...over,
});

function renderHistory(onOpen = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AmbientHistory onOpen={onOpen} /></QueryClientProvider>);
  return onOpen;
}

beforeEach(() => vi.restoreAllMocks());

describe('AmbientHistory', () => {
  it('lists each session with its state and length, in words', async () => {
    vi.spyOn(ambientApi, 'listProjects').mockResolvedValue([
      summary({ projectId: 'a', title: 'God got me', status: 'done', hasVideo: true, targetSec: 7200 }),
      summary({ projectId: 'b', title: 'Still waters', status: 'draft', targetSec: 600 }),
    ]);
    renderHistory();
    expect(await screen.findByText('God got me')).toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('2 hours')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('10 minutes')).toBeInTheDocument();
  });

  it('opens a finished session on its video, and a draft where it left off', async () => {
    vi.spyOn(ambientApi, 'listProjects').mockResolvedValue([
      summary({ projectId: 'a', title: 'Done one', status: 'done', hasVideo: true }),
      summary({ projectId: 'b', title: 'Draft one' }),
    ]);
    const onOpen = renderHistory();
    await userEvent.click(await screen.findByRole('button', { name: 'Watch or publish Done one' }));
    expect(onOpen).toHaveBeenLastCalledWith('a', true);
    await userEvent.click(screen.getByRole('button', { name: 'Open Draft one' }));
    expect(onOpen).toHaveBeenLastCalledWith('b', false);
  });

  it('a finished status without its video on disk is not offered as watchable', async () => {
    vi.spyOn(ambientApi, 'listProjects').mockResolvedValue([
      summary({ projectId: 'a', title: 'Gone', status: 'done', hasVideo: false }),
    ]);
    renderHistory();
    expect(await screen.findByRole('button', { name: 'Open Gone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /watch or publish/i })).toBeNull();
  });

  it('links to where it was last published', async () => {
    vi.spyOn(ambientApi, 'listProjects').mockResolvedValue([
      summary({
        projectId: 'a', title: 'Done one', status: 'done', hasVideo: true,
        lastPublished: { videoId: 'abcDEF12345', url: 'https://youtu.be/abcDEF12345', privacyStatus: 'unlisted', publishAt: null, at: Date.now() - 2 * DAY },
      }),
    ]);
    renderHistory();
    const link = await screen.findByRole('link', { name: /on youtube · unlisted · 2d ago/i });
    expect(link).toHaveAttribute('href', 'https://youtu.be/abcDEF12345');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('deletes only after a second, explicit click that says the video goes too', async () => {
    vi.spyOn(ambientApi, 'listProjects').mockResolvedValue([
      summary({ projectId: 'a', title: 'Done one', status: 'done', hasVideo: true }),
    ]);
    const del = vi.spyOn(ambientApi, 'deleteProject').mockResolvedValue();
    renderHistory();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Done one' }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete with video' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('a'));
  });

  it('shows nothing when there are no sessions yet', async () => {
    const list = vi.spyOn(ambientApi, 'listProjects').mockResolvedValue([]);
    renderHistory();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Your sessions' })).toBeNull();
  });

  it('collapses a long history behind search and Show all', async () => {
    vi.spyOn(ambientApi, 'listProjects').mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => summary({ projectId: `p${i}`, title: `Session ${i}` })),
    );
    renderHistory();
    expect(await screen.findByText('Session 4')).toBeInTheDocument();
    expect(screen.queryByText('Session 5')).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search sessions' }), '7');
    expect(screen.getByText('Session 7')).toBeInTheDocument();
    expect(screen.queryByText('Session 0')).toBeNull();
  });
});
