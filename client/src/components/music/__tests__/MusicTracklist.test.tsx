import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPicker } from '../../MusicPicker';
import * as libraryApi from '../../../lib/musicLibraryApi';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const t = (id: string, label: string, durationSec: number | null, extra: Partial<MusicTrack> = {}): MusicTrack => ({
  id, label, mood: 'calm', previewUrl: `/music/${id}.mp3`, default: false, source: 'bundled',
  licence: 'pixabay-cleared', durationSec, ref: `library:${id}`, credit: 'Music from Pixabay', ...extra,
});
const LIB = [
  t('a', 'Peaceful Worship', 204),
  t('b', 'Prayer Piano', 168),
  { ...t('u', 'Your Love', 270), source: 'upload', licence: 'unknown', ref: 'mylib:u', previewUrl: null, mediaFile: 'user-audio-1.m4a', credit: '' } as MusicTrack,
];

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue(LIB);
  vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
});

describe('MusicPicker — album layout', () => {
  const paths = ['library:a', 'library:b', 'mylib:u'];

  it('shows the music total (crossfades removed), the video length, and how often it repeats', async () => {
    render(wrap(<MusicPicker multiple variant="full" targetSec={7200} crossfadeSec={6} value={{ path: paths[0], paths, volume: 0.8 }} onChange={() => {}} busy={false} reorderable />));
    const header = await screen.findByRole('region', { name: /soundtrack/i });
    await within(header).findByText('10:30'); // 204 + 168 + 270 - 2×6 = 630 s
    expect(header).toHaveTextContent('2:00:00');
    expect(header).toHaveTextContent(/repeats 11\.4×/);
    expect(header).toHaveTextContent(/add about 1 h 50 min more music/i);
  });

  it('says the music fills the video when it does', async () => {
    render(wrap(<MusicPicker multiple variant="full" targetSec={600} crossfadeSec={0} value={{ path: paths[0], paths, volume: 0.8 }} onChange={() => {}} busy={false} reorderable />));
    const header = await screen.findByRole('region', { name: /soundtrack/i });
    await within(header).findByText(/fills the video/i);
    expect(header).not.toHaveTextContent(/add about/i);
  });

  it('lists each track with its length, and counts cleared and missing licences', async () => {
    render(wrap(<MusicPicker multiple variant="full" targetSec={7200} value={{ path: paths[0], paths, volume: 0.8 }} onChange={() => {}} busy={false} reorderable />));
    const list = await screen.findByRole('list', { name: /chosen tracks/i });
    await within(list).findByText('Your Love');
    expect(within(list).getByText('4:30')).toBeInTheDocument();
    expect(screen.getByText(/✓ 2 cleared/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 licence missing/i })).toBeInTheDocument();
  });

  it('clicking a row\'s licence badge marks that track cleared', async () => {
    const update = vi.spyOn(libraryApi, 'updateTrack').mockResolvedValue(LIB[2]);
    render(wrap(<MusicPicker multiple variant="full" value={{ path: paths[0], paths, volume: 0.8 }} onChange={() => {}} busy={false} reorderable />));
    const list = await screen.findByRole('list', { name: /chosen tracks/i });
    await userEvent.click(await within(list).findByTitle(/licence is not recorded/i));
    expect(update).toHaveBeenCalledWith('u', { licence: 'cleared' });
  });

  it('puts the host\'s settings in the bar above the list', async () => {
    render(wrap(<MusicPicker multiple variant="full" toolbar={<span>Crossfade control</span>} value={{ path: null, paths: [], volume: 0.8 }} onChange={() => {}} busy={false} />));
    expect(await screen.findByText('Crossfade control')).toBeInTheDocument();
    expect(screen.getByText(/no music yet/i)).toBeInTheDocument();
  });

  it('the compact layout keeps the total and the list, without the big header', async () => {
    render(wrap(<MusicPicker multiple value={{ path: paths[0], paths, volume: 0.8 }} onChange={() => {}} busy={false} />));
    await screen.findByText('Your Love');
    expect(screen.queryByRole('region', { name: /soundtrack/i })).toBeNull();
    expect(screen.getByText('10:42')).toBeInTheDocument(); // no crossfade given
    expect(screen.getByText(/shuffled/i)).toBeInTheDocument();
  });

  it('an upload plays from its output file', async () => {
    render(wrap(<MusicPicker multiple value={{ path: 'mylib:u', paths: ['mylib:u'], volume: 0.8 }} onChange={() => {}} busy={false} />));
    expect(await screen.findByRole('button', { name: /preview your love/i })).toBeEnabled();
  });
});
