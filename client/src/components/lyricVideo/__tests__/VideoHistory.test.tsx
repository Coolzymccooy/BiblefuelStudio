import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { renders: vi.fn() } }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { VideoHistory, POLL_MS, PAGE_SIZE } from '../VideoHistory';
import type { LyricHistoryItem } from '../../../lib/lyricVideoTypes';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><VideoHistory /></MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}

const base = { projectId: 'lv_1', title: 'I Know the Driver', artist: 'Sthill Waters', aspect: 'portrait', quality: '720p' } as const;
const done = (n: number, extra: Partial<LyricHistoryItem> = {}): LyricHistoryItem => ({
  ...base, jobId: `done-${n}`, status: 'done', at: '2026-10-15T12:00:00.000Z', durationSec: 182, file: `C:\\out\\v${n}.mp4`, ...extra,
});
const running = (extra: Partial<LyricHistoryItem> = {}): LyricHistoryItem => ({
  ...base, jobId: 'run-1', status: 'running', at: '2026-10-15T12:30:00.000Z', progress: 45, ...extra,
});
const failed = (extra: Partial<LyricHistoryItem> = {}): LyricHistoryItem => ({
  ...base, jobId: 'fail-1', status: 'failed', at: '2026-10-14T12:00:00.000Z', error: 'The video could not be made. Try again, or choose a different background.', ...extra,
});
const serve = (items: LyricHistoryItem[]) => vi.mocked(lyricVideoApi.renders).mockResolvedValue(items);

describe('VideoHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows nothing while loading', () => {
    vi.mocked(lyricVideoApi.renders).mockReturnValue(new Promise(() => {}));
    setup();
    expect(screen.queryByRole('heading', { name: 'Your videos' })).toBeNull();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it('says where videos will appear when there are none yet', async () => {
    serve([]);
    setup();
    expect(await screen.findByRole('heading', { name: 'Your videos' })).toBeTruthy();
    expect(screen.getByText('Videos you make will be listed here.')).toBeTruthy();
  });

  it('says so, in one line, when the list could not be loaded', async () => {
    vi.mocked(lyricVideoApi.renders).mockRejectedValue(new Error('boom'));
    setup();
    expect(await screen.findByText('Your videos could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('a finished video shows its song, its details and Watch, Download and Open song', async () => {
    serve([done(1)]);
    setup();
    const row = (await screen.findByText('I Know the Driver')).closest('li') as HTMLElement;
    expect(within(row).getByText('Sthill Waters')).toBeTruthy();
    expect(within(row).getByText('Portrait · 720p · 3:02 · 15/10/2026')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Watch I Know the Driver' })).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Download I Know the Driver' }).getAttribute('href'))
      .toMatch(/\/outputs\/v1\.mp4\?dl=I%20Know%20the%20Driver\.mp4$/);
    expect(within(row).getByRole('link', { name: 'Open song I Know the Driver' }).getAttribute('href')).toBe('/app/lyric-video/lv_1');
  });

  it('a running video shows its progress and Open song, and no Watch', async () => {
    serve([running()]);
    setup();
    const row = (await screen.findByText('Rendering… 45%')).closest('li') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Open song I Know the Driver' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /watch/i })).toBeNull();
    expect(within(row).queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('a failed video shows its sentence in the danger colour, and Open song', async () => {
    serve([failed()]);
    setup();
    const sentence = await screen.findByText('Failed: The video could not be made. Try again, or choose a different background.');
    expect(sentence.className).toContain('text-bf-danger');
    const row = sentence.closest('li') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Open song I Know the Driver' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /watch/i })).toBeNull();
  });

  it('Watch opens a player under that row, and opening another closes the first', async () => {
    serve([done(1, { title: 'First' }), done(2, { title: 'Second', jobId: 'done-2' })]);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Watch First' }));
    const players = () => document.querySelectorAll('video');
    expect(players()).toHaveLength(1);
    expect(players()[0].getAttribute('src')).toMatch(/\/outputs\/v1\.mp4$/);
    expect(players()[0].hasAttribute('controls')).toBe(true);
    expect((screen.getByRole('button', { name: 'Watch First' }).closest('li') as HTMLElement).contains(players()[0])).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Second' }));
    expect(players()).toHaveLength(1);
    expect(players()[0].getAttribute('src')).toMatch(/\/outputs\/v2\.mp4$/);
    expect((screen.getByRole('button', { name: 'Watch Second' }).closest('li') as HTMLElement).contains(players()[0])).toBe(true);
  });

  it('Watch again closes the player', async () => {
    serve([done(1)]);
    setup();
    const watch = await screen.findByRole('button', { name: 'Watch I Know the Driver' });
    fireEvent.click(watch);
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(watch.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(watch);
    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(watch.getAttribute('aria-expanded')).toBe('false');
  });

  it('puts running videos on top, then the rest as the server ordered them', async () => {
    serve([done(1, { title: 'Newest done', at: '2026-10-15T12:00:00.000Z' }), failed({ title: 'Older failed' }), running({ title: 'Still going' })]);
    setup();
    await screen.findByText('Still going');
    const titles = screen.getAllByRole('listitem').map((li) => li.querySelector('.font-medium')?.textContent);
    expect(titles).toEqual(['Still going', 'Newest done', 'Older failed']);
  });

  it('shows the newest 20 and reveals the next 20 with Show more', async () => {
    serve(Array.from({ length: 45 }, (_, i) => done(i, { jobId: `d${i}`, title: `Song ${i}` })));
    setup();
    await screen.findByText('Song 0');
    expect(screen.getAllByRole('listitem')).toHaveLength(PAGE_SIZE);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(PAGE_SIZE * 2);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(45);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('has no Show more when everything fits', async () => {
    serve([done(1)]);
    setup();
    await screen.findByText('I Know the Driver');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  describe('refreshing', () => {
    const interval = (qc: QueryClient): unknown => {
      const query = qc.getQueryCache().find({ queryKey: ['lyric-renders'] });
      const option = query?.observers[0]?.options.refetchInterval;
      return typeof option === 'function' ? option(query as never) : option;
    };

    it('asks again every 5 seconds while a video is being made', async () => {
      serve([running(), done(1)]);
      const qc = setup();
      await screen.findByText('Rendering… 45%');
      expect(POLL_MS).toBe(5000);
      expect(interval(qc)).toBe(5000);
    });

    it('does not poll when nothing is running', async () => {
      serve([done(1), failed()]);
      const qc = setup();
      await screen.findAllByText('I Know the Driver');
      expect(interval(qc)).toBe(false);
    });

    it('stops polling once the video is no longer running', async () => {
      serve([running()]);
      const qc = setup();
      await screen.findByText('Rendering… 45%');
      expect(interval(qc)).toBe(5000);
      serve([done(1)]);
      await qc.refetchQueries({ queryKey: ['lyric-renders'] });
      await screen.findByRole('button', { name: 'Watch I Know the Driver' });
      expect(interval(qc)).toBe(false);
    });
  });
});
