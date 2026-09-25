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

const instrumental = {
  id: 'i1', label: 'Your Love (instrumental)', mood: 'worship', previewUrl: null, default: false,
  source: 'upload', licence: 'unknown', durationSec: 240, ref: 'mylib:i1', credit: '', derivedFrom: 'mylib:u1',
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

  it('a chosen song that already has an instrumental offers "Use instrumental", which swaps it in place', async () => {
    vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue([bundled, upload, instrumental]);
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: true, amfEncoder: false });
    const onChange = vi.fn();
    render(wrap(<MusicPicker value={{ path: 'library:prayer-piano', paths: ['library:prayer-piano', 'mylib:u1'], volume: 1 }} onChange={onChange} busy={false} multiple />));
    await userEvent.click(await screen.findByRole('button', { name: /use the instrumental of your love/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paths: ['library:prayer-piano', 'mylib:i1'] }));
  });

  it('a loose file in the list (a Timeline upload) can have its vocals removed: it is saved to the library first', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: true, amfEncoder: false });
    const saveSpy = vi.spyOn(libraryApi, 'saveTrackToLibrary').mockResolvedValue({ ...upload, id: 'raw1', label: 'user-audio-9', ref: 'mylib:raw1' } as MusicTrack);
    const onChange = vi.fn();
    const loose = ['C:', 'out', 'user-audio-9.m4a'].join('\\'); // a Windows path, as the server stores it
    render(wrap(<MusicPicker value={{ path: loose, paths: [loose], volume: 1 }} onChange={onChange} busy={false} multiple />));
    await userEvent.click(await screen.findByRole('button', { name: /remove vocals from user-audio-9\.m4a/i }));
    expect(saveSpy).toHaveBeenCalledWith(loose, expect.objectContaining({ label: 'user-audio-9' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paths: ['mylib:raw1'] }));
    expect(await screen.findByRole('dialog', { name: /remove vocals from user-audio-9/i })).toBeInTheDocument();
  });

  it('"Use in this video" in the dialog swaps the original for its instrumental', async () => {
    vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: true, amfEncoder: false });
    vi.spyOn(libraryApi, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(libraryApi, 'getInstrumental').mockResolvedValue({
      jobId: 'j1', status: 'done', percent: 100, error: null, sourceRef: 'mylib:u1', sourcePreview: null, resultFile: 'instrumental-j1.m4a', track: instrumental,
    });
    const onChange = vi.fn();
    render(wrap(<MusicPicker value={{ path: 'mylib:u1', paths: ['mylib:u1'], volume: 1 }} onChange={onChange} busy={false} multiple />));
    const [first] = await screen.findAllByRole('button', { name: /remove vocals from your love/i });
    await userEvent.click(first);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^remove vocals$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /use in this video/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paths: ['mylib:i1'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
