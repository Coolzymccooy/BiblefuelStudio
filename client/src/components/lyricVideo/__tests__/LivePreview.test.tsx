import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const setTrack = vi.fn();
const setCurrentTime = vi.fn();
const destroy = vi.fn();
const ctor = vi.fn();
vi.mock('jassub', () => ({
  default: class {
    constructor(o: unknown) { ctor(o); }
    setTrack = setTrack;
    setCurrentTime = setCurrentTime;
    destroy = destroy;
  },
}));
vi.mock('jassub/dist/jassub-worker.js?url', () => ({ default: '/w.js' }));
vi.mock('jassub/dist/jassub-worker.wasm?url', () => ({ default: '/w.wasm' }));
vi.mock('jassub/dist/jassub-worker-modern.wasm?url', () => ({ default: '/w-modern.wasm' }));
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { captions: vi.fn() } }));

import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LivePreview } from '../LivePreview';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const project = {
  projectId: 'lv_1', song: { file: '/o/song.m4a', durationSec: 10, coverStill: null }, background: null,
  look: { id: 'studio-lagos-night', energy: 'wild', seed: 1 }, lines: [],
} as unknown as LyricProject;

const withVideoBackground = {
  ...project, background: { kind: 'video', file: '/o/bg.mp4', fit: 'auto' },
} as unknown as LyricProject;

type CtorOpts = { video: HTMLVideoElement; subContent: string; availableFonts: Record<string, string>; [k: string]: unknown };
const firstOpts = () => ctor.mock.calls[0][0] as CtorOpts;

describe('LivePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lyricVideoApi.captions).mockResolvedValue('[Script Info]\nA');
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.pause = vi.fn();
  });
  afterEach(() => cleanup());

  it('starts the caption renderer with the project captions and the Studio fonts', async () => {
    render(<LivePreview project={project} assVersion={1} />);
    expect(screen.getByTestId('lyric-preview')).toBeTruthy();
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const opts = firstOpts();
    expect(opts.subContent).toBe('[Script Info]\nA');
    expect(opts.availableFonts['permanent marker']).toBe('/caption-fonts/PermanentMarker.ttf');
    expect(opts.workerUrl).toBe('/w.js');
    expect(opts.fallbackFont).toBe('dejavu sans');
  });

  it('swaps captions in place when they change', async () => {
    const { rerender } = render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    vi.mocked(lyricVideoApi.captions).mockResolvedValue('[Script Info]\nB');
    rerender(<LivePreview project={project} assVersion={2} />);
    await waitFor(() => expect(setTrack).toHaveBeenCalledWith('[Script Info]\nB'));
    expect(ctor).toHaveBeenCalledTimes(1);
    // A paused preview must redraw the new captions at the current moment.
    await waitFor(() => expect(setCurrentTime).toHaveBeenCalled());
  });

  it('puts the song, not the looping background, on the caption renderer clock', async () => {
    const { container } = render(<LivePreview project={withVideoBackground} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const clock = firstOpts().video;
    expect(clock.getAttribute('src')).toBe('/outputs/song.m4a');
    expect(clock.hasAttribute('controls')).toBe(true);
    const bg = container.querySelector('video[src="/outputs/bg.mp4"]') as HTMLVideoElement;
    expect(bg).toBeTruthy();
    expect(bg).not.toBe(clock);
    expect(bg.muted).toBe(true);
    expect(bg.loop).toBe(true);
    expect(bg.hasAttribute('controls')).toBe(false);
  });

  it('hands the renderer the preview size, the player clock, and the modern wasm', async () => {
    render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const opts = firstOpts();
    expect(opts.video.videoWidth).toBe(360);
    expect(opts.video.videoHeight).toBe(640);
    expect(opts.onDemandRender).toBe(false);
    expect(opts.wasmUrl).toBe('/w.wasm');
    expect(opts.modernWasmUrl).toBe('/w-modern.wasm');
  });

  it("keeps a video song's own picture out of the frame, so only the chosen background shows", async () => {
    render(<LivePreview project={withVideoBackground} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const cls = firstOpts().video.className;
    expect(cls).toContain('object-none');
    expect(cls).toContain('[object-position:100000px_100000px]');
    expect(cls).not.toContain('object-cover');
    expect(firstOpts().video.hasAttribute('controls')).toBe(true);
  });

  describe('background fit (same rule as the render)', () => {
    const sized = (el: HTMLElement, width: number, height: number) => {
      Object.defineProperty(el, 'videoWidth', { value: width, configurable: true });
      Object.defineProperty(el, 'videoHeight', { value: height, configurable: true });
      el.dispatchEvent(new Event('loadedmetadata'));
    };
    const videos = (c: HTMLElement) => c.querySelectorAll('video[src="/outputs/bg.mp4"]');

    it('fills the frame when the picture is the frame shape', async () => {
      const { container } = render(<LivePreview project={withVideoBackground} assVersion={1} />);
      await waitFor(() => expect(ctor).toHaveBeenCalled());
      sized(videos(container)[0] as HTMLElement, 1080, 1920);
      await waitFor(() => expect(videos(container)).toHaveLength(1));
      expect(videos(container)[0].className).toContain('object-cover');
    });

    it('shows a landscape background whole over a blurred, dimmed copy of itself', async () => {
      const { container } = render(<LivePreview project={withVideoBackground} assVersion={1} />);
      await waitFor(() => expect(ctor).toHaveBeenCalled());
      sized(videos(container)[0] as HTMLElement, 1920, 1080);
      await waitFor(() => expect(videos(container)).toHaveLength(2));
      const blurred = container.querySelector('[data-backdrop="blur"]') as HTMLElement;
      const whole = container.querySelector('[data-backdrop="whole"]') as HTMLElement;
      expect(blurred.className).toContain('object-cover');
      expect(blurred.className).toContain('blur');
      expect(blurred.getAttribute('aria-hidden')).toBe('true');
      expect(whole.className).toContain('object-contain');
      expect(whole.className).not.toContain('blur');
    });

    it('honours an explicit contain, and an explicit cover, whatever the shape', async () => {
      const contain = { ...project, background: { kind: 'video', file: '/o/bg.mp4', fit: 'contain' } } as unknown as LyricProject;
      const first = render(<LivePreview project={contain} assVersion={1} />);
      await waitFor(() => expect(ctor).toHaveBeenCalled());
      expect(videos(first.container)).toHaveLength(2);
      first.unmount();
      const cover = { ...project, background: { kind: 'video', file: '/o/bg.mp4', fit: 'cover' } } as unknown as LyricProject;
      const second = render(<LivePreview project={cover} assVersion={1} />);
      await waitFor(() => expect(ctor).toHaveBeenCalledTimes(2));
      sized(videos(second.container)[0] as HTMLElement, 1920, 1080);
      expect(videos(second.container)).toHaveLength(1);
    });

    it('measures a background picture the same way', async () => {
      const img = { ...project, background: { kind: 'image', file: '/o/bg.jpg', fit: 'auto' } } as unknown as LyricProject;
      const { container } = render(<LivePreview project={img} assVersion={1} />);
      await waitFor(() => expect(ctor).toHaveBeenCalled());
      const pic = container.querySelector('img[src="/outputs/bg.jpg"]') as HTMLImageElement;
      Object.defineProperty(pic, 'naturalWidth', { value: 1600, configurable: true });
      Object.defineProperty(pic, 'naturalHeight', { value: 900, configurable: true });
      pic.dispatchEvent(new Event('load'));
      await waitFor(() => expect(container.querySelectorAll('img[src="/outputs/bg.jpg"]')).toHaveLength(2));
    });

    it('plays and pauses both copies of a background with the song', async () => {
      const contain = { ...project, background: { kind: 'video', file: '/o/bg.mp4', fit: 'contain' } } as unknown as LyricProject;
      render(<LivePreview project={contain} assVersion={1} />);
      await waitFor(() => expect(ctor).toHaveBeenCalled());
      const song = firstOpts().video;
      song.dispatchEvent(new Event('play'));
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
      song.dispatchEvent(new Event('pause'));
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
    });
  });

  it('plays, pauses and seeks the background with the song', async () => {
    const { container } = render(<LivePreview project={withVideoBackground} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const song = firstOpts().video;
    const bg = container.querySelector('video[src="/outputs/bg.mp4"]') as HTMLVideoElement;
    Object.defineProperty(bg, 'duration', { value: 4, configurable: true });
    song.dispatchEvent(new Event('play'));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    song.dispatchEvent(new Event('pause'));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    song.currentTime = 9;
    song.dispatchEvent(new Event('seeked'));
    expect(bg.currentTime).toBeCloseTo(1, 5); // 9 s into the song is 1 s into a 4 s loop
  });

  it('starts the background again if the browser paused it while the song plays', async () => {
    const { container } = render(<LivePreview project={withVideoBackground} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const song = firstOpts().video;
    Object.defineProperty(song, 'paused', { value: false, configurable: true });
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    expect((container.querySelector('video[src="/outputs/bg.mp4"]') as HTMLVideoElement).paused).toBe(true);
    song.dispatchEvent(new Event('timeupdate'));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('shows the song over its cover still when there is no background', async () => {
    const withCover = { ...project, song: { ...project.song, coverStill: '/o/cover.jpg' } } as unknown as LyricProject;
    const { container } = render(<LivePreview project={withCover} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/outputs/cover.jpg');
    expect(container.querySelectorAll('video')).toHaveLength(1);
  });

  it('reports the song time', async () => {
    const onTime = vi.fn();
    render(<LivePreview project={project} assVersion={1} onTime={onTime} />);
    await waitFor(() => expect(ctor).toHaveBeenCalled());
    const song = firstOpts().video;
    song.currentTime = 3.5;
    song.dispatchEvent(new Event('timeupdate'));
    expect(onTime).toHaveBeenLastCalledWith(3.5);
  });

  it('shows the video without captions, and builds no renderer, when no line is placed yet', async () => {
    vi.mocked(lyricVideoApi.captions).mockResolvedValue('');
    render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(lyricVideoApi.captions).toHaveBeenCalled());
    await Promise.resolve();
    expect(ctor).not.toHaveBeenCalled();
    expect(screen.getByTestId('lyric-preview').querySelector('video')).toBeTruthy();
  });

  it('clears the captions when the last placed line disappears', async () => {
    const { rerender } = render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    vi.mocked(lyricVideoApi.captions).mockResolvedValue('');
    rerender(<LivePreview project={project} assVersion={2} />);
    await waitFor(() => expect(setTrack).toHaveBeenCalled());
    const blank = setTrack.mock.calls[0][0] as string;
    expect(blank).toContain('[Script Info]');
    expect(blank).not.toContain('Dialogue:');
  });

  it('does not construct a renderer for captions that arrive after unmount', async () => {
    let resolve!: (text: string) => void;
    vi.mocked(lyricVideoApi.captions).mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const { unmount } = render(<LivePreview project={project} assVersion={1} />);
    unmount();
    resolve('[Script Info]\nLate');
    await Promise.resolve();
    await Promise.resolve();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('keeps the newest captions when an older request answers last', async () => {
    const pending: Array<(text: string) => void> = [];
    vi.mocked(lyricVideoApi.captions).mockImplementation(() => new Promise<string>((r) => { pending.push(r); }));
    const { rerender } = render(<LivePreview project={project} assVersion={1} />);
    rerender(<LivePreview project={project} assVersion={2} />);
    pending[1]('[Script Info]\nNEW');
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    pending[0]('[Script Info]\nOLD');
    await Promise.resolve();
    await Promise.resolve();
    expect(firstOpts().subContent).toBe('[Script Info]\nNEW');
    expect(setTrack).not.toHaveBeenCalledWith('[Script Info]\nOLD');
  });

  it('destroys the renderer on unmount', async () => {
    const { unmount } = render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the old renderer and builds a fresh one when the project changes', async () => {
    const { rerender } = render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(1));
    rerender(<LivePreview project={{ ...project, projectId: 'lv_2' }} assVersion={1} />);
    await waitFor(() => expect(ctor).toHaveBeenCalledTimes(2));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(setTrack).not.toHaveBeenCalled();
  });

  it('survives a caption fetch failure', async () => {
    vi.mocked(lyricVideoApi.captions).mockRejectedValue(new Error('offline'));
    render(<LivePreview project={project} assVersion={1} />);
    await waitFor(() => expect(lyricVideoApi.captions).toHaveBeenCalled());
    expect(screen.getByTestId('lyric-preview')).toBeTruthy();
    expect(ctor).not.toHaveBeenCalled();
  });
});
