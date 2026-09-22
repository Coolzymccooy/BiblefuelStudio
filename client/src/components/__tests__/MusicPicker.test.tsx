import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as api from '../../lib/musicLibraryApi';
import { MusicPicker } from '../MusicPicker';

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
  vi.spyOn(api, 'fetchMusicLibrary').mockResolvedValue(TRACKS as any);
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
