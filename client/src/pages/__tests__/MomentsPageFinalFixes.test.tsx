import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MomentsPage } from '../MomentsPage';
import { momentsApi } from '../../lib/momentsApi';
import { ApiError } from '../../lib/apiError';
import * as errors from '../../lib/errors';
import { META, mkMoment } from '../../lib/__tests__/momentsFixtures';
import type { MomentProject } from '../../lib/momentsTypes';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><MomentsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

const photoView = (path: string, i: number) => ({ ref: { kind: 'upload' as const, path }, url: `/outputs/${path}-${i}.jpg`, width: 1, height: 1 });
const ready = (over: Partial<MomentProject> = {}) => mkMoment({ photos: ['p1', 'p2', 'p3'].map(photoView), ...over });
const open = () => localStorage.setItem('BF_MOMENTS_ACTIVE', 'm1');

/** The project view the server returns for a PUT: the patch applied over the base. */
const applyPatch = (base: MomentProject, patch: Record<string, unknown>): MomentProject => {
  const photos = patch.photos as Array<{ kind: string; path?: string; id?: string }> | undefined;
  return {
    ...base,
    ...(patch as object),
    photos: photos ? photos.map((r, i) => ({ ref: r as never, url: `/outputs/${r.path ?? r.id}-${i}.jpg`, width: 1, height: 1 })) : base.photos,
  };
};

/** Every GET after the first load hangs, so only the PUT responses can bring the page up to date. */
const delayRefetches = (get: ReturnType<typeof vi.spyOn>) => { get.mockImplementation(() => new Promise(() => {})); };

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(momentsApi, 'meta').mockResolvedValue(META);
  vi.spyOn(momentsApi, 'list').mockResolvedValue([]);
});

describe('every successful PUT lands in the query cache', () => {
  it('two quick library picks keep both, though the GET after the first has not landed', async () => {
    open();
    const base = ready();
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(base);
    vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([
      { id: 'libA', url: '/outputs/a.png', aspect: '9:16', source: 'upload', createdAt: 1 },
      { id: 'libB', url: '/outputs/b.png', aspect: '9:16', source: 'upload', createdAt: 2 },
    ]);
    const update = vi.spyOn(momentsApi, 'update').mockImplementation(async (_id, patch) => applyPatch(base, patch as never));
    renderPage();
    await screen.findByRole('button', { name: 'Photos', pressed: true });
    delayRefetches(get);
    await userEvent.click(screen.getByRole('button', { name: /pick from my pictures/i }));
    await userEvent.click(await screen.findByRole('button', { name: /add library picture 1/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /add library picture 2/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /add library picture 2/i }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    const sent = (update.mock.calls[1][1] as { photos: Array<{ kind: string; id?: string }> }).photos;
    expect(sent.filter((p) => p.kind === 'library').map((p) => p.id)).toEqual(['libA', 'libB']);
  });

  it('removing photo 3 then photo 5 removes the right photos with the GET still pending', async () => {
    open();
    const base = mkMoment({ photos: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(photoView) });
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(base);
    const update = vi.spyOn(momentsApi, 'update').mockImplementation(async (_id, patch) => applyPatch(base, patch as never));
    renderPage();
    await screen.findByRole('button', { name: 'Photos', pressed: true });
    delayRefetches(get);
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 3' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove photo 5' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo 5' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    const paths = (update.mock.calls[1][1] as { photos: Array<{ path: string }> }).photos.map((p) => p.path);
    expect(paths).toEqual(['p1', 'p2', 'p4', 'p5']);
  });

  it('a Words edit survives leaving the step and coming back before the GET lands', async () => {
    open();
    const base = ready({ title: 'Title', statements: ['Grace', 'Rising'] });
    const get = vi.spyOn(momentsApi, 'get').mockResolvedValue(base);
    const update = vi.spyOn(momentsApi, 'update').mockImplementation(async (_id, patch) => applyPatch(base, patch as never));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Words' }));
    delayRefetches(get);
    const first = await screen.findByLabelText('Statement 1');
    await userEvent.clear(first);
    await userEvent.type(first, 'Amazing');
    await userEvent.tab();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await userEvent.click(screen.getByRole('button', { name: 'Style' }));
    await userEvent.click(screen.getByRole('button', { name: 'Words' }));
    const second = await screen.findByLabelText('Statement 2');
    await userEvent.clear(second);
    await userEvent.type(second, 'Second');
    await userEvent.tab();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toEqual({ statements: ['Amazing', 'Second'] });
  });
});

describe('when Make it cannot write the words', () => {
  const GUIDANCE = "Couldn't write words for you right now. Add a title or a statement on the Words step, then press Make it.";

  it('stops with guidance, shows the Words step and does not render (a coded error keeps its own copy)', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    const failure = new ApiError('limit', 'QUOTA_EXCEEDED', { bucket: 'scripts' }, 429);
    vi.spyOn(momentsApi, 'suggest').mockRejectedValue(failure);
    const renderCall = vi.spyOn(momentsApi, 'render');
    const toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    const toastMsg = vi.spyOn(toast, 'error').mockImplementation(() => '');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^make it$/i }));
    await waitFor(() => expect(toastMsg).toHaveBeenCalledWith(GUIDANCE));
    expect(toastErr).toHaveBeenCalledWith(failure);
    expect(renderCall).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Words', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^make it$/i })).toBeEnabled();
  });

  it('a plain failure shows just the guidance', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    vi.spyOn(momentsApi, 'suggest').mockRejectedValue(new Error('Failed to fetch'));
    const toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
    const toastMsg = vi.spyOn(toast, 'error').mockImplementation(() => '');
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^make it$/i }));
    await waitFor(() => expect(toastMsg).toHaveBeenCalledWith(GUIDANCE));
    expect(toastErr).not.toHaveBeenCalled();
  });
});

describe('Make it placement', () => {
  it('hides the sticky Make it on a finished Result, where Shuffle covers it', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready({ title: 'Mine', statements: ['x'], render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4' } }));
    renderPage();
    await screen.findByRole('button', { name: 'Result', pressed: true });
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^make it$/i })).toBeNull();
  });

  it('lifts the sticky Make it above the phone tab bar', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    renderPage();
    const button = await screen.findByRole('button', { name: /^make it$/i });
    const wrap = button.parentElement as HTMLElement;
    expect(wrap.className).toContain('bottom-[calc(76px+env(safe-area-inset-bottom))]');
    expect(wrap.className).toContain('lg:bottom-4');
  });

  it('puts the reason behind a backdrop so it stays legible over the content', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    const reason = await screen.findByText(/add at least 3 photos/i);
    expect(reason.className).toMatch(/bg-/);
  });
});

describe('shell accessibility and storage', () => {
  it('the step buttons are a group, not a tablist', async () => {
    open();
    vi.spyOn(momentsApi, 'get').mockResolvedValue(ready());
    renderPage();
    expect(await screen.findByRole('group', { name: 'Moment step' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('still renders and works when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(momentsApi, 'create').mockResolvedValue(mkMoment());
    vi.spyOn(momentsApi, 'get').mockResolvedValue(mkMoment());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /birthday/i }));
    expect(await screen.findByRole('button', { name: 'Photos', pressed: true })).toBeInTheDocument();
  });
});
