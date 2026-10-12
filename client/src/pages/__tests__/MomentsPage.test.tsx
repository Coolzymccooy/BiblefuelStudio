import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MomentsPage } from '../MomentsPage';
import { momentsApi } from '../../lib/momentsApi';
import { ApiError } from '../../lib/apiError';
import * as upload from '../../lib/mediaUpload';
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

  it('locks the step tabs and Start new while a photo batch is uploading', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([]);
    vi.spyOn(upload, 'uploadMedia').mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByRole('button', { name: 'Photos', pressed: true });
    expect(screen.getByRole('button', { name: 'Sound' })).toBeEnabled();
    await userEvent.upload(screen.getByLabelText(/add photos/i), [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sound' })).toBeDisabled());
    expect(screen.getByRole('button', { name: /start new/i })).toBeDisabled();
  });

  it('lists earlier Moments and reopens one', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([
      { projectId: 'm9', occasion: 'memorial', title: 'In loving memory', updatedAt: 1, thumb: null, lastFile: '/outputs/moment-1.mp4' },
    ]);
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment({
      projectId: 'm9', occasion: 'memorial',
      render: { jobId: 'j1', status: 'done', percent: 100, stage: '', file: '/outputs/moment-1.mp4' },
    }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /open in loving memory/i }));
    await waitFor(() => expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBe('m9'));
    // A finished Moment opens straight onto its video.
    expect(await screen.findByRole('button', { name: 'Result', pressed: true })).toBeInTheDocument();
  });

  it('shows the occasion label from the options, not the raw id', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([summary(1, { title: '', occasion: 'memorial' })]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Open Memorial' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open memorial' })).not.toBeInTheDocument();
  });

  it('falls back to the raw id when the occasion is unknown', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([summary(1, { title: '', occasion: 'retirement' })]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Open retirement' })).toBeInTheDocument();
  });

  it('shows the spinner, not the picker, while the active Moment is loading', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    let resolveGet: (m: ReturnType<typeof mkMoment>) => void = () => {};
    vi.spyOn(momentsApi, 'get').mockReturnValue(new Promise((r) => { resolveGet = r; }));
    renderPage();
    await waitFor(() => expect(momentsApi.get).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole('button', { name: /birthday/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/your moments will appear here/i)).not.toBeInTheDocument();
    await act(async () => { resolveGet(mkMoment()); });
    expect(await screen.findByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
  });

  it('forgets an active Moment that no longer exists and shows the picker', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'gone');
    vi.spyOn(momentsApi, 'get').mockRejectedValue(new ApiError('Moment not found', '', {}, 404));
    renderPage();
    expect(await screen.findByRole('button', { name: /birthday/i })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBeNull();
  });

  it('keeps the active Moment on another failure, with Retry and Start new', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    const get = vi.spyOn(momentsApi, 'get').mockRejectedValue(new ApiError('Server error', '', {}, 500));
    renderPage();
    expect(await screen.findByText(/couldn't open your last moment/i, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBe('m1');
    get.mockResolvedValue(mkMoment());
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
  });

  it('Start new from the open-failed state returns to the picker', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockRejectedValue(new ApiError('Server error', '', {}, 500));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /start new/i }, { timeout: 3000 }));
    expect(await screen.findByRole('button', { name: /birthday/i })).toBeInTheDocument();
    expect(localStorage.getItem('BF_MOMENTS_ACTIVE')).toBeNull();
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

describe('MomentsPage polling', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('refetches a running Moment every 2.5 s and stops once it is done', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    const running = mkMoment({ render: { jobId: 'j1', status: 'running', percent: 30, stage: 'Cutting' } });
    const done = mkMoment({ render: { jobId: 'j1', status: 'done', percent: 100, stage: '', file: '/outputs/moment-1.mp4' } });
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValueOnce(running).mockResolvedValue(done);
    renderPage();
    await screen.findByRole('button', { name: 'Result', pressed: true });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
