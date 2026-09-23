import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as api from '../../lib/musicLibraryApi';
import { storyApi } from '../../lib/storyApi';
import { MusicPicker } from '../MusicPicker';

// Spy on the toast module so a save failure's warning (vs. the old silent
// "Music added" success) is directly assertable.
vi.mock('react-hot-toast', () => {
  const fn: any = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  return { __esModule: true, default: fn };
});
import toast from 'react-hot-toast';

const TRACKS = [
  { id: 'peaceful-worship', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/01.mp3', default: true, source: 'bundled', licence: 'pixabay-cleared', durationSec: null, ref: 'library:peaceful-worship' },
  { id: 'joyful-praise', label: 'Joyful Praise', mood: 'joyful', previewUrl: '/music/06.mp3', default: false, source: 'bundled', licence: 'pixabay-cleared', durationSec: null, ref: 'library:joyful-praise' },
];

function renderWith(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  vi.restoreAllMocks();
  // toast's members are plain vi.fn()s from the mock factory above, not
  // vi.spyOn() spies — restoreAllMocks() only resets the latter, so call
  // history would otherwise leak from one test into the next.
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.success as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  vi.spyOn(api, 'fetchMusicLibrary').mockResolvedValue(TRACKS as any);
});

describe('MusicPicker on a phone', () => {
  // The button opens the hidden <input>, not the drop zone. With only
  // "audio/*" there, iOS has no file types to match files in the Files app
  // against; listing them is what lets a downloaded .m4a/.caf be picked.
  for (const multiple of [false, true]) {
    it(`the ${multiple ? 'track list' : 'single'} upload input names the iPhone audio types`, async () => {
      const { container } = renderWith(
        <MusicPicker value={{ path: null, volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} multiple={multiple} />,
      );
      await screen.findAllByText(/upload/i);
      const inputs = [...container.querySelectorAll('input[type="file"]')];
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        const accept = input.getAttribute('accept') ?? '';
        for (const ext of ['audio/*', '.mp3', '.m4a', '.wav', '.aiff', '.caf']) expect(accept).toContain(ext);
      }
    });
  }
});

describe('MusicPicker', () => {
  it('"Use default audio" sets the default library ref', async () => {
    const onChange = vi.fn();
    renderWith(<MusicPicker value={{ path: null, volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /use default audio/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'library:peaceful-worship' }));
  });

  it('selecting a library track sets its ref', async () => {
    const onChange = vi.fn();
    renderWith(<MusicPicker value={{ path: null, volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    const select = await screen.findByLabelText(/music library/i);
    await screen.findByRole('option', { name: /joyful praise/i });
    await userEvent.selectOptions(select, 'joyful-praise');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'library:joyful-praise' }));
  });

  it('remove clears the music', async () => {
    const onChange = vi.fn();
    renderWith(<MusicPicker value={{ path: 'library:joyful-praise', volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    await userEvent.click(await screen.findByRole('button', { name: /remove music/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: null }));
  });

  describe('multiple mode', () => {
    it('appends a library track to the ordered list', async () => {
      const onChange = vi.fn();
      renderWith(<MusicPicker multiple value={{ path: 'library:peaceful-worship', paths: ['library:peaceful-worship'], volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
      const select = await screen.findByLabelText(/add music from library/i);
      await screen.findByRole('option', { name: /joyful praise/i });
      await userEvent.selectOptions(select, 'joyful-praise');
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        paths: ['library:peaceful-worship', 'library:joyful-praise'],
        path: 'library:peaceful-worship',
      }));
    });

    it('removes a track by index, keeping order', async () => {
      const onChange = vi.fn();
      renderWith(<MusicPicker multiple value={{ path: 'library:peaceful-worship', paths: ['library:peaceful-worship', 'library:joyful-praise'], volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
      const removeButtons = await screen.findAllByRole('button', { name: /remove track/i });
      await userEvent.click(removeButtons[0]);
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        paths: ['library:joyful-praise'],
        path: 'library:joyful-praise',
      }));
    });
  });

  describe('library management', () => {
    // A bundled track (cleared) plus a saved upload (licence not yet set by
    // the operator) - exactly the mix that should produce exactly one badge.
    const MANAGED_TRACKS = [
      { id: 'peaceful-worship', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/01.mp3', default: true, source: 'bundled', licence: 'pixabay-cleared', durationSec: null, ref: 'library:peaceful-worship' },
      { id: 'u1', label: 'My Bed', mood: 'calm', previewUrl: null, default: false, source: 'upload', licence: 'unknown', durationSec: 182, ref: 'mylib:u1' },
    ];

    beforeEach(() => {
      vi.spyOn(api, 'fetchMusicLibrary').mockResolvedValue(MANAGED_TRACKS as any);
    });

    it('warns on a track whose licence is unknown, and only that one', async () => {
      renderWith(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
      const list = await screen.findByRole('list');
      await within(list).findByText('My Bed');
      // Ruling: "not badged" must be checked by counting badges, not by
      // querying a title that no real element would ever have.
      expect(within(list).getAllByTitle(/licence is not recorded/i)).toHaveLength(1);
    });

    // Finding 6: PATCH /api/music/:id and updateTrack had zero callers, so an
    // upload was permanently badged with no way to act on the warning. The
    // badge itself is now the control.
    it('clicking the licence badge clears it via updateTrack', async () => {
      const update = vi.spyOn(api, 'updateTrack').mockResolvedValue({
        id: 'u1', label: 'My Bed', mood: 'calm', previewUrl: null, default: false,
        source: 'upload', licence: 'cleared', durationSec: 182, ref: 'mylib:u1',
      });
      renderWith(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
      const list = await screen.findByRole('list');
      const badge = await within(list).findByTitle(/licence is not recorded/i);
      await userEvent.click(badge);
      expect(update).toHaveBeenCalledWith('u1', { licence: 'cleared' });
    });

    it('the licence badge is absent for a track that is already cleared', async () => {
      vi.spyOn(api, 'fetchMusicLibrary').mockResolvedValue([
        { id: 'peaceful-worship', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/01.mp3', default: true, source: 'bundled', licence: 'pixabay-cleared', durationSec: null, ref: 'library:peaceful-worship' },
        { id: 'u1', label: 'My Bed', mood: 'calm', previewUrl: null, default: false, source: 'upload', licence: 'cleared', durationSec: 182, ref: 'mylib:u1' },
      ] as any);
      renderWith(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
      const list = await screen.findByRole('list');
      await within(list).findByText('My Bed');
      expect(within(list).queryAllByTitle(/licence is not recorded/i)).toHaveLength(0);
    });

    it('offers to forget a saved upload but never a bundled track', async () => {
      renderWith(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
      await screen.findByText('My Bed', { selector: 'span' });
      expect(screen.getByRole('button', { name: /forget My Bed/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /forget Peaceful Worship/i })).not.toBeInTheDocument();
    });

    it('forgetting a track deletes it from the library and refreshes the list', async () => {
      const del = vi.spyOn(api, 'deleteTrack').mockResolvedValue(undefined);
      renderWith(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={vi.fn()} busy={false} />);
      await screen.findByText('My Bed', { selector: 'span' });
      await userEvent.click(screen.getByRole('button', { name: /forget My Bed/i }));
      expect(del).toHaveBeenCalledWith('u1');
    });

    // The picker used to hard-code `library:${id}` for every selection, so a
    // `mylib:` ref (what the server's resolver actually understands for a
    // saved upload) could never be produced. Selecting an uploaded track must
    // store the listing's own `ref`, not a constructed `library:` string.
    it('selecting a saved upload from the library select stores its mylib ref', async () => {
      const onChange = vi.fn();
      renderWith(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={onChange} busy={false} />);
      const select = await screen.findByLabelText(/music library/i);
      await screen.findByRole('option', { name: /my bed/i });
      await userEvent.selectOptions(select, 'u1');
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'mylib:u1' }));
    });

    // trackLabel() only recognised `library:` — an uploaded track's stored
    // `mylib:` ref would otherwise render as the raw ref string.
    it('displays an uploaded track by its label, not its raw mylib ref', async () => {
      renderWith(<MusicPicker multiple value={{ path: 'mylib:u1', paths: ['mylib:u1'], volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} />);
      expect((await screen.findAllByText('My Bed')).length).toBeGreaterThan(0);
      expect(screen.queryByText('mylib:u1')).not.toBeInTheDocument();
    });

    // The multi-mode "add from library" select uses the same t.ref pattern as
    // the single-mode select tested above; regression-test it separately
    // since it is a distinct code path (emitPaths, not onChange directly).
    it('multi-mode: selecting a saved upload from the library appends its mylib ref', async () => {
      const onChange = vi.fn();
      renderWith(<MusicPicker multiple value={{ path: null, paths: [], volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
      const select = await screen.findByLabelText(/add music from library/i);
      await screen.findByRole('option', { name: /my bed/i });
      await userEvent.selectOptions(select, 'u1');
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        paths: ['mylib:u1'],
        path: 'mylib:u1',
      }));
    });
  });

  describe('upload then save to library', () => {
    // The riskiest untested path: upload() calls storyApi.uploadAudio, then
    // tries to save the result to the library, and must emit a usable value
    // either way. Both branches need direct coverage, not inspection.
    function renderWithClient(ui: React.ReactElement) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      const result = render(React.createElement(QueryClientProvider, { client: qc }, ui));
      return { ...result, invalidateSpy };
    }

    function fileInput(): HTMLInputElement {
      return document.querySelector('input[type="file"]') as HTMLInputElement;
    }

    it('save succeeds: emits the saved track\'s mylib ref, not the raw upload path', async () => {
      const uploadedPath = '/data/tenant42/uploads/audio/my-bed.mp3';
      vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue(uploadedPath);
      const save = vi.spyOn(api, 'saveTrackToLibrary').mockResolvedValue({
        id: 'u2', label: 'my-bed', mood: 'calm', previewUrl: null, default: false,
        source: 'upload', licence: 'unknown', durationSec: null, ref: 'mylib:u2',
      });
      const onChange = vi.fn();
      const { invalidateSpy } = renderWithClient(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={onChange} busy={false} />);

      const file = new File(['audio-bytes'], 'my-bed.mp3', { type: 'audio/mpeg' });
      fireEvent.change(fileInput(), { target: { files: [file] } });

      await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: 'mylib:u2' })));
      // Never the raw absolute path once the save succeeded.
      expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ path: uploadedPath }));
      expect(save).toHaveBeenCalledWith(uploadedPath, { label: 'my-bed' });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['music-library'] });
    });

    it('save fails: falls back to the raw uploaded path, so the upload is not lost', async () => {
      const uploadedPath = '/data/tenant42/uploads/audio/my-bed.mp3';
      vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue(uploadedPath);
      vi.spyOn(api, 'saveTrackToLibrary').mockRejectedValue(new Error('library save failed'));
      const onChange = vi.fn();
      renderWithClient(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={onChange} busy={false} />);

      const file = new File(['audio-bytes'], 'my-bed.mp3', { type: 'audio/mpeg' });
      fireEvent.change(fileInput(), { target: { files: [file] } });

      await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: uploadedPath })));
    });

    // Finding 4: a failed library save used to be completely silent — the
    // bare `catch {}` swallowed the error and `toast.success('Music added')`
    // still fired unconditionally, so the operator had no idea the track
    // wouldn't be reusable in other projects. The upload itself is fine
    // (raw-path fallback, covered above), so this must be a warning, not
    // toast.error.
    it('save fails: warns the operator instead of silently claiming success', async () => {
      const uploadedPath = '/data/tenant42/uploads/audio/my-bed.mp3';
      vi.spyOn(storyApi, 'uploadAudio').mockResolvedValue(uploadedPath);
      vi.spyOn(api, 'saveTrackToLibrary').mockRejectedValue(new Error('library save failed'));
      const onChange = vi.fn();
      renderWithClient(<MusicPicker value={{ path: null, volume: 0.3 }} onChange={onChange} busy={false} />);

      const file = new File(['audio-bytes'], 'my-bed.mp3', { type: 'audio/mpeg' });
      fireEvent.change(fileInput(), { target: { files: [file] } });

      await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ path: uploadedPath })));
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.stringMatching(/library/i), expect.objectContaining({ icon: expect.any(String) }));
    });
  });

  describe('preview playback', () => {
    // stubGlobal leaks past this file otherwise - it broke SceneCard's suite.
    afterEach(() => { vi.unstubAllGlobals(); });

    // The operator could start a preview and had no way to stop it: the handler
    // was play-only, so clicking again just built a second Audio element.
    function stubAudio() {
      const play = vi.fn().mockResolvedValue(undefined);
      const pause = vi.fn();
      const instances: any[] = [];
      // A real constructor function: vitest warns that an arrow mockImplementation
      // is not usable as a constructor, and `new Audio()` then yields an object
      // whose play/pause are not these spies.
      function FakeAudio(this: any) {
        this.play = play;
        this.pause = pause;
        this.currentTime = 0;
        this.addEventListener = vi.fn();
        instances.push(this);
      }
      vi.stubGlobal('Audio', FakeAudio as any);
      return { play, pause, instances };
    }

    it('stops the clip when the playing track is clicked again', async () => {
      const { play, pause } = stubAudio();
      renderWith(<MusicPicker value={{ path: 'library:peaceful-worship', volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} />);
      const btn = await screen.findByRole('button', { name: /preview/i });
      await userEvent.click(btn);
      expect(play).toHaveBeenCalledTimes(1);
      // The control must now offer to STOP, not to play again.
      const stop = await screen.findByRole('button', { name: /stop/i });
      await userEvent.click(stop);
      expect(pause).toHaveBeenCalled();
      expect(play).toHaveBeenCalledTimes(1);
    });

    it('does not stack Audio elements when previewing repeatedly', async () => {
      const { instances } = stubAudio();
      renderWith(<MusicPicker value={{ path: 'library:peaceful-worship', volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} />);
      const btn = await screen.findByRole('button', { name: /preview/i });
      await userEvent.click(btn);
      await userEvent.click(await screen.findByRole('button', { name: /stop/i }));
      await userEvent.click(await screen.findByRole('button', { name: /preview/i }));
      // Two plays, two elements - not a new element per click with the old
      // one still running.
      expect(instances.length).toBe(2);
    });
  });
});
