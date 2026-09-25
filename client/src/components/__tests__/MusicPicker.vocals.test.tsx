import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPicker } from '../MusicPicker';
import * as libraryApi from '../../lib/musicLibraryApi';
import type { MusicTrack } from '../../lib/musicLibraryApi';

const upload = {
  id: 'u1', label: 'Your Love', mood: 'worship', previewUrl: null, default: false,
  source: 'upload', licence: 'unknown', durationSec: 240, ref: 'mylib:u1', credit: '',
} as MusicTrack;
const bundled = {
  id: 'prayer-piano', label: 'Prayer Piano', mood: 'calm', previewUrl: '/music/prayer-piano.mp3', default: true,
  source: 'bundled', licence: 'pixabay-cleared', durationSec: null, ref: 'library:prayer-piano', credit: 'Music from Pixabay',
} as MusicTrack;

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue([bundled, upload]);
});

describe('MusicPicker — remove vocals', () => {
  it('offers "Remove vocals" on a chosen upload and in the library, never on bundled tracks', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: true, amfEncoder: false });
    render(wrap(<MusicPicker value={{ path: 'mylib:u1', paths: ['mylib:u1', 'library:prayer-piano'], volume: 1 }} onChange={() => {}} busy={false} multiple />));
    const buttons = await screen.findAllByRole('button', { name: /remove vocals from your love/i });
    expect(buttons).toHaveLength(2); // chosen row + library row
    expect(screen.queryByRole('button', { name: /remove vocals from prayer piano/i })).not.toBeInTheDocument();
  });

  it('opens the dialog for the chosen track', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: true, amfEncoder: false });
    render(wrap(<MusicPicker value={{ path: 'mylib:u1', paths: ['mylib:u1'], volume: 1 }} onChange={() => {}} busy={false} multiple />));
    const [first] = await screen.findAllByRole('button', { name: /remove vocals from your love/i });
    await userEvent.click(first);
    const dialog = screen.getByRole('dialog', { name: /remove vocals from your love/i });
    expect(within(dialog).getByRole('button', { name: /^remove vocals$/i })).toBeInTheDocument();
  });

  it('shows nothing when vocal removal is not set up', async () => {
    const caps = vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
    render(wrap(<MusicPicker value={{ path: 'mylib:u1', paths: ['mylib:u1'], volume: 1 }} onChange={() => {}} busy={false} multiple />));
    await vi.waitFor(() => expect(caps).toHaveBeenCalled());
    await screen.findAllByText('Your Love');
    expect(screen.queryByRole('button', { name: /remove vocals/i })).not.toBeInTheDocument();
  });
});
