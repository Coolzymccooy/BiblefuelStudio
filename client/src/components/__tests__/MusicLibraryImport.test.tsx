import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MusicLibraryImport, _resetImportState } from '../MusicLibraryImport';
import * as libraryApi from '../../lib/musicLibraryApi';
import { storyApi } from '../../lib/storyApi';

const mp3 = (name: string) => new File(['x'], name, { type: 'audio/mpeg' });

function renderImport(existing: Array<{ label: string; ref?: string }> = [], onAdded?: (refs: string[]) => void) {
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue(existing as libraryApi.MusicTrack[]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MusicLibraryImport busy={false} onAdded={onAdded} /></QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); _resetImportState(); });

describe('MusicLibraryImport', () => {
  it('takes many tracks at once and saves each with the chosen licence and a tidy name', async () => {
    const upload = vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => `/out/${name}`);
    const save = vi.spyOn(libraryApi, 'saveTrackToLibrary').mockResolvedValue({} as libraryApi.MusicTrack);
    const success = vi.spyOn(toast, 'success').mockImplementation(() => '');
    renderImport();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /licence/i }), 'youtube-audio-library');
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('Pastoral - Asher Fulero.mp3'), mp3('Tratak - Jesse Gallagher.mp3')]);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith('/out/Pastoral - Asher Fulero.mp3', { label: 'Pastoral — Asher Fulero', licence: 'youtube-audio-library' });
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringMatching(/2 tracks added/)));
  });

  it('uploads one at a time, so 33 tracks never go up at once', async () => {
    let inFlight = 0;
    let most = 0;
    vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => {
      inFlight += 1; most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return `/out/${name}`;
    });
    vi.spyOn(libraryApi, 'saveTrackToLibrary').mockResolvedValue({} as libraryApi.MusicTrack);
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    renderImport();
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('a.mp3'), mp3('b.mp3'), mp3('c.mp3')]);
    await waitFor(() => expect(libraryApi.saveTrackToLibrary).toHaveBeenCalledTimes(3));
    expect(most).toBe(1);
  });

  it('skips tracks already in the library', async () => {
    const upload = vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => `/out/${name}`);
    vi.spyOn(libraryApi, 'saveTrackToLibrary').mockResolvedValue({} as libraryApi.MusicTrack);
    const success = vi.spyOn(toast, 'success').mockImplementation(() => '');
    renderImport([{ label: 'Pastoral — Asher Fulero' }]);
    await screen.findByLabelText(/choose tracks/i);
    await waitFor(() => expect(libraryApi.fetchMusicLibrary).toHaveBeenCalled());
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('Pastoral - Asher Fulero.mp3'), mp3('Tratak - Jesse Gallagher.mp3')]);
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringMatching(/1 track added.*1 already/)));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('one failure does not stop the rest, and is named', async () => {
    vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => {
      if (name.startsWith('bad')) throw new Error('too big');
      return `/out/${name}`;
    });
    vi.spyOn(libraryApi, 'saveTrackToLibrary').mockResolvedValue({} as libraryApi.MusicTrack);
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    renderImport();
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('bad.mp3'), mp3('good.mp3')]);
    await waitFor(() => expect(libraryApi.saveTrackToLibrary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/bad/), expect.anything()));
  });

  it('a track that uploaded but failed to save is not uploaded again on retry', async () => {
    const upload = vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => `/out/${name}`);
    const save = vi.spyOn(libraryApi, 'saveTrackToLibrary')
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValue({} as libraryApi.MusicTrack);
    vi.spyOn(toast, 'error').mockImplementation(() => '');
    const success = vi.spyOn(toast, 'success').mockImplementation(() => '');
    renderImport();
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('Tratak - Jesse Gallagher.mp3')]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('Tratak - Jesse Gallagher.mp3')]);
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringMatching(/1 track added/)));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('/out/Tratak - Jesse Gallagher.mp3', expect.anything());
  });

  it('leaving the step mid-import and coming back shows it still running, and blocks a second one', async () => {
    let release: () => void = () => {};
    const upload = vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => {
      await new Promise<void>((r) => { release = r; });
      return `/out/${name}`;
    });
    vi.spyOn(libraryApi, 'saveTrackToLibrary').mockResolvedValue({} as libraryApi.MusicTrack);
    vi.spyOn(toast, 'success').mockImplementation(() => '');
    const first = renderImport();
    await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('a.mp3'), mp3('b.mp3')]);
    await screen.findByRole('status');
    first.unmount();

    renderImport();
    expect(await screen.findByRole('status')).toHaveTextContent(/adding 1 of 2/i);
    expect(screen.getByRole('button', { name: /choose tracks/i })).toBeDisabled();
    release();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    release();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  describe('adding to this video as well', () => {
    const saveAs = () => vi.spyOn(libraryApi, 'saveTrackToLibrary')
      .mockImplementation(async (_p, meta) => ({ ref: `mylib:${meta?.label}` }) as libraryApi.MusicTrack);

    it('is offered, ticked, and hands over every chosen track, including ones already in the library', async () => {
      vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => `/out/${name}`);
      saveAs();
      vi.spyOn(toast, 'success').mockImplementation(() => '');
      const onAdded = vi.fn();
      renderImport([{ label: 'Pastoral — Asher Fulero', ref: 'mylib:old' }], onAdded);
      expect(screen.getByRole('checkbox', { name: /add them to this video/i })).toBeChecked();
      await waitFor(() => expect(libraryApi.fetchMusicLibrary).toHaveBeenCalled());
      await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('Pastoral - Asher Fulero.mp3'), mp3('Tratak - Jesse Gallagher.mp3')]);
      await waitFor(() => expect(onAdded).toHaveBeenCalledWith(['mylib:old', 'mylib:Tratak — Jesse Gallagher']));
    });

    it('unticked, the tracks only go to the library', async () => {
      vi.spyOn(storyApi, 'uploadAudio').mockImplementation(async (_f, name) => `/out/${name}`);
      saveAs();
      const success = vi.spyOn(toast, 'success').mockImplementation(() => '');
      const onAdded = vi.fn();
      renderImport([], onAdded);
      await userEvent.click(screen.getByRole('checkbox', { name: /add them to this video/i }));
      await userEvent.upload(screen.getByLabelText(/choose tracks/i), [mp3('a.mp3')]);
      await waitFor(() => expect(success).toHaveBeenCalled());
      expect(onAdded).not.toHaveBeenCalled();
    });

    it('is not offered where there is no video bed to add to', () => {
      renderImport();
      expect(screen.queryByRole('checkbox', { name: /add them to this video/i })).not.toBeInTheDocument();
    });
  });
});
