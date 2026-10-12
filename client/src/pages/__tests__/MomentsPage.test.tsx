import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MomentsPage } from '../MomentsPage';
import { momentsApi } from '../../lib/momentsApi';
import { META, mkMoment } from '../../lib/__tests__/momentsFixtures';
import type { MomentSummary } from '../../lib/momentsTypes';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><MomentsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

function summary(i: number, over: Partial<MomentSummary> = {}): MomentSummary {
  return { projectId: `m${i}`, occasion: 'birthday', title: `Moment ${i}`, updatedAt: i, thumb: null, lastFile: null, ...over };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(momentsApi, 'meta').mockResolvedValue(META);
  vi.spyOn(momentsApi, 'list').mockResolvedValue([]);
});

describe('MomentsPage shell', () => {
  it('picking an occasion creates a Moment and opens the photos step', async () => {
    const create = vi.spyOn(momentsApi, 'create').mockResolvedValue(mkMoment());
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /birthday/i }));
    expect(create).toHaveBeenCalledWith('birthday');
    expect(await screen.findByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBe('m1');
  });

  it('lists earlier Moments and reopens one', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([
      { projectId: 'm9', occasion: 'memorial', title: 'In loving memory', updatedAt: 1, thumb: null, lastFile: '/outputs/moment-1.mp4' },
    ]);
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment({ projectId: 'm9', occasion: 'memorial' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /open in loving memory/i }));
    await waitFor(() => expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBe('m9'));
  });

  it('Start new returns to the list', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /start new/i }));
    expect(await screen.findByRole('button', { name: /birthday/i })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBeNull();
  });

  it('opens a Moment whose render was interrupted on the Result step', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(
      mkMoment({ render: { jobId: 'j1', status: 'interrupted', percent: 40, stage: 'Cutting' } }),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Result', pressed: true })).toBeInTheDocument();
  });

  it('opens on Result only once: a later refetch does not pull the user back', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    const failed = mkMoment({ render: { jobId: 'j1', status: 'error', percent: 0, stage: '', error: 'Cancelled.' } });
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(failed);
    const qc = renderPage();
    await screen.findByRole('button', { name: 'Result', pressed: true });
    await userEvent.click(screen.getByRole('button', { name: 'Sound' }));
    get.mockResolvedValue({ ...failed, updatedAt: 5 });
    await qc.invalidateQueries({ queryKey: ['moment', 'm1'] });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Sound', pressed: true })).toBeInTheDocument();
  });

  it('a Moment with no render opens on Photos', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    expect(await screen.findByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
  });

  it('shows an error with Retry when the options fail to load', async () => {
    const meta = vi.spyOn(momentsApi, 'meta').mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/could not load moments/i)).toBeInTheDocument();
    meta.mockResolvedValue(META);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('button', { name: /birthday/i })).toBeInTheDocument();
  });
});

describe('MomentsHistory', () => {
  it('caps a long list and expands with Show all', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue(Array.from({ length: 8 }, (_, i) => summary(i + 1)));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Open Moment 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Moment 6' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show all 8/i }));
    expect(screen.getByRole('button', { name: 'Open Moment 8' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show fewer/i }));
    expect(screen.queryByRole('button', { name: 'Open Moment 6' })).not.toBeInTheDocument();
  });

  it('deleting a Moment asks first, then removes it and refreshes the list', async () => {
    const list = vi.spyOn(momentsApi, 'list')
      .mockResolvedValueOnce([summary(1, { title: 'Tolu 40' })])
      .mockResolvedValue([]);
    const remove = vi.spyOn(momentsApi, 'remove').mockResolvedValue(undefined as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Tolu 40' }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /confirm delete tolu 40/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText('Tolu 40')).not.toBeInTheDocument());
  });

  it('cancelling the delete keeps the Moment', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([summary(1, { title: 'Tolu 40' })]);
    const remove = vi.spyOn(momentsApi, 'remove').mockResolvedValue(undefined as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Tolu 40' }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open Tolu 40' })).toBeInTheDocument();
  });

  it('shows Retry when the list fails to load', async () => {
    const list = vi.spyOn(momentsApi, 'list').mockRejectedValueOnce(new Error('nope'));
    renderPage();
    expect(await screen.findByText(/could not load your moments/i)).toBeInTheDocument();
    list.mockResolvedValue([summary(1)]);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('button', { name: 'Open Moment 1' })).toBeInTheDocument();
  });
});
