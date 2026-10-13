import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MomentsPage } from '../MomentsPage';
import { momentsApi } from '../../lib/momentsApi';
import { ApiError } from '../../lib/apiError';
import * as upload from '../../lib/mediaUpload';
import * as errors from '../../lib/errors';
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

  it('keeps Start new beside the title and lets the step tabs scroll on their own row', async () => {
    localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    const group = await screen.findByRole('group', { name: 'Moment step' });
    const startNew = screen.getByRole('button', { name: /start new/i });
    const header = screen.getByRole('heading', { level: 1 }).parentElement?.parentElement;
    // On a phone the six tabs are wider than the screen. Sharing a row with
    // them pushed Start new off the right edge and the page scrolled sideways.
    expect(header?.contains(startNew)).toBe(true);
    expect(header?.contains(group)).toBe(false);
    expect(group.parentElement).toHaveClass('overflow-x-auto');
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

describe('Make it', () => {
  const ready = (over = {}) => mkMoment({
    photos: [1, 2, 3].map((n) => ({ ref: { kind: 'upload' as const, path: `p${n}` }, url: `/outputs/p${n}.jpg`, width: 1, height: 1 })),
    ...over,
  });
  const open = () => localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');

  it('is disabled until there are 3 photos', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    expect(await screen.findByRole('button', { name: /^make it$/i })).toBeDisabled();
    expect(screen.getByText(/add at least 3 photos/i)).toBeInTheDocument();
  });

  it('with empty words, suggests and saves them first, then renders once even on a double press', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    const suggest = vi.spyOn(momentsApi, 'suggest').mockResolvedValue({ title: 'Happy birthday!', statements: ['A'], source: 'template' });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(ready());
    let resolveRender: (v: string) => void = () => {};
    const renderCall = vi.spyOn(momentsApi, 'render').mockImplementation(() => new Promise((r) => { resolveRender = r; }));
    renderPage();
    const button = await screen.findByRole('button', { name: /^make it$/i });
    // Both clicks land before React re-renders, so only a ref guard (not the busy state) can stop the second.
    await act(async () => { button.click(); button.click(); });
    await waitFor(() => expect(renderCall).toHaveBeenCalledTimes(1));
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('m1', { title: 'Happy birthday!', statements: ['A'] });
    expect(suggest.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(renderCall.mock.invocationCallOrder[0]);
    await act(async () => { resolveRender('job-1'); });
    expect(await screen.findByRole('button', { name: 'Result', pressed: true })).toBeInTheDocument();
    expect(renderCall).toHaveBeenCalledTimes(1);
  });

  it('with words already written, renders straight away', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['Mine too'] }));
    const suggest = vi.spyOn(momentsApi, 'suggest');
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-1');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^make it$/i }));
    await waitFor(() => expect(renderCall).toHaveBeenCalledWith('m1', undefined));
    expect(suggest).not.toHaveBeenCalled();
  });

  it('waits for a pending blur-save before rendering', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['Mine too'] }));
    let finishSave: () => void = () => {};
    const update = vi.spyOn(momentsApi, 'update').mockImplementation(() => new Promise((r) => { finishSave = () => r(ready()); }));
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-1');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Occasion' }));
    await userEvent.type(await screen.findByLabelText(/name/i), 'Tolu');
    await userEvent.tab();
    await waitFor(() => expect(update).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /^make it$/i }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(renderCall).not.toHaveBeenCalled();
    await act(async () => { finishSave(); });
    await waitFor(() => expect(renderCall).toHaveBeenCalledTimes(1));
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(renderCall.mock.invocationCallOrder[0]);
  });

  it('decides about suggesting from the words as saved, not the stale page copy', async () => {
    open();
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    let finishSave: () => void = () => {};
    vi.spyOn(momentsApi, 'update').mockImplementation(() => new Promise((r) => { finishSave = () => r(ready()); }));
    const suggest = vi.spyOn(momentsApi, 'suggest');
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-1');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Occasion' }));
    await userEvent.type(await screen.findByLabelText(/name/i), 'Tolu');
    await userEvent.tab();
    await userEvent.click(screen.getByRole('button', { name: /^make it$/i }));
    // By the time the save lands the server holds written words.
    get.mockResolvedValue(ready({ title: 'Typed', statements: ['Typed too'] }));
    await act(async () => { finishSave(); });
    await waitFor(() => expect(renderCall).toHaveBeenCalledTimes(1));
    expect(suggest).not.toHaveBeenCalled();
  });

  it('is disabled while a photo batch is uploading', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([]);
    vi.spyOn(upload, 'uploadMedia').mockReturnValue(new Promise(() => {}));
    const renderCall = vi.spyOn(momentsApi, 'render');
    renderPage();
    await screen.findByRole('button', { name: 'Photos', pressed: true });
    await userEvent.upload(screen.getByLabelText(/add photos/i), [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => expect(screen.getByRole('button', { name: /^make it$/i })).toBeDisabled());
    expect(renderCall).not.toHaveBeenCalled();
  });

  it('a Moment whose render was interrupted shows Make it again, not a spinner, and retries', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['x'], render: { jobId: 'j', status: 'interrupted', percent: 40, stage: 'shots' } }));
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-2');
    renderPage();
    await screen.findByRole('button', { name: 'Result', pressed: true });
    expect(screen.queryByRole('progressbar')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /make it again/i }));
    await waitFor(() => expect(renderCall).toHaveBeenCalledWith('m1', undefined));
  });

  it('Shuffle renders again with a new seed', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['x'], render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4' } }));
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-2');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Result' }));
    await userEvent.click(await screen.findByRole('button', { name: /shuffle/i }));
    await waitFor(() => expect(renderCall).toHaveBeenCalledWith('m1', expect.any(Number)));
  });

  it('Cancel stops the render and refreshes', async () => {
    open();
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ render: { jobId: 'j', status: 'running', percent: 30, stage: 'shots' } }));
    const cancel = vi.spyOn(momentsApi, 'cancel').mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(cancel).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('reports a failed Cancel with toastError', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ render: { jobId: 'j', status: 'running', percent: 30, stage: 'shots' } }));
    const failure = new ApiError('nope', '', {}, 500);
    vi.spyOn(momentsApi, 'cancel').mockRejectedValue(failure);
    const toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith(failure));
  });

  it('a refused render (quota, 409) is reported with toastError and unlocks Make it', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['x'] }));
    const failure = new ApiError('limit', 'QUOTA_EXCEEDED', {}, 429);
    vi.spyOn(momentsApi, 'render').mockRejectedValue(failure);
    const toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^make it$/i }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith(failure));
    expect(screen.getByRole('button', { name: /^make it$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
  });

  it('keeps suggested words visible on the Words step when the render is then refused', async () => {
    open();
    const saved = ready({ title: 'Happy birthday!', statements: ['Cheers'] });
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    vi.spyOn(momentsApi, 'suggest').mockResolvedValue({ title: 'Happy birthday!', statements: ['Cheers'], source: 'template' });
    vi.spyOn(momentsApi, 'update').mockImplementation(async () => {
      get.mockResolvedValue(saved);
      return saved;
    });
    vi.spyOn(momentsApi, 'render').mockRejectedValue(new ApiError('limit', 'QUOTA_EXCEEDED', {}, 429));
    vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Words' }));
    await userEvent.click(screen.getByRole('button', { name: /^make it$/i }));
    expect(await screen.findByDisplayValue('Cheers')).toBeInTheDocument();
  });

  it('never suggests over words the server already holds, even when the page copy still reads empty', async () => {
    open();
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    const suggest = vi.spyOn(momentsApi, 'suggest');
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-1');
    renderPage();
    const button = await screen.findByRole('button', { name: /^make it$/i });
    // The words were saved after the page last loaded; its copy has not caught up.
    get.mockResolvedValue(ready({ title: 'Typed', statements: ['Typed too'] }));
    await userEvent.click(button);
    await waitFor(() => expect(renderCall).toHaveBeenCalledTimes(1));
    expect(suggest).not.toHaveBeenCalled();
  });

  it('opens a finished Moment restored from storage on its video', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4' } }));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Result', pressed: true })).toBeInTheDocument();
    expect(document.querySelector('video')?.getAttribute('src')).toContain('/outputs/moment-1.mp4');
  });

  it('stays busy until the refetch after a render lands, so the old video is not live beside the new render', async () => {
    open();
    const done = ready({ title: 'Mine', statements: ['x'], render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4' } });
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(done);
    vi.spyOn(momentsApi, 'render').mockResolvedValue('job-2');
    renderPage();
    const shuffle = await screen.findByRole('button', { name: /shuffle/i });
    let landRefetch: (m: ReturnType<typeof mkMoment>) => void = () => {};
    get.mockImplementation(() => new Promise((r) => { landRefetch = r; }));
    await userEvent.click(shuffle);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeDisabled();
    // The finished Result has no sticky Make it (Shuffle covers it); the only live control is Shuffle, and it is locked.
    expect(screen.queryByRole('button', { name: /^make it$/i })).toBeNull();
    await act(async () => { landRefetch({ ...done, render: { jobId: 'job-2', status: 'running', percent: 0, stage: 'waiting' } }); });
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  });

  it('a double click on Cancel sends one cancel', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ render: { jobId: 'j', status: 'running', percent: 30, stage: 'shots' } }));
    const cancel = vi.spyOn(momentsApi, 'cancel').mockImplementation(() => new Promise(() => {}));
    renderPage();
    const button = await screen.findByRole('button', { name: /cancel/i });
    await act(async () => { button.click(); button.click(); });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['error', { jobId: 'j', status: 'error' as const, percent: 0, stage: 'error', error: 'Cancelled.' }],
    ['interrupted', { jobId: 'j', status: 'interrupted' as const, percent: 40, stage: 'shots' }],
  ])('a %s render shows a single Make it button, the Result step\'s own', async (_name, render) => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['x'], render }));
    renderPage();
    await screen.findByRole('button', { name: 'Result', pressed: true });
    expect(screen.getAllByRole('button', { name: /make it/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /make it again/i })).toBeInTheDocument();
  });

  it('a Words blur-save does not disable Make it, and the render waits for it', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['Mine too'] }));
    let finishSave: () => void = () => {};
    const update = vi.spyOn(momentsApi, 'update').mockImplementation(() => new Promise((r) => { finishSave = () => r(ready()); }));
    const renderCall = vi.spyOn(momentsApi, 'render').mockResolvedValue('job-1');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Words' }));
    await userEvent.type(await screen.findByLabelText('Title'), '!');
    await userEvent.tab();
    await waitFor(() => expect(update).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: /^make it$/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(renderCall).not.toHaveBeenCalled();
    await act(async () => { finishSave(); });
    await waitFor(() => expect(renderCall).toHaveBeenCalledTimes(1));
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(renderCall.mock.invocationCallOrder[0]);
  });
});
