import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as api from '../../lib/musicLibraryApi';
import { MusicPicker } from '../MusicPicker';

const TRACKS = [
  { id: 'peaceful-worship', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/01.mp3', default: true },
  { id: 'joyful-praise', label: 'Joyful Praise', mood: 'joyful', previewUrl: '/music/06.mp3', default: false },
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
