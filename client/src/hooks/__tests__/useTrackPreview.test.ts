import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackPreview, trackAudioUrl } from '../useTrackPreview';

vi.mock('react-hot-toast', () => ({ __esModule: true, default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

function stubAudio() {
  const made: Array<{ src: string; paused: boolean; fire: (e: string) => void }> = [];
  function FakeAudio(this: any, src: string) {
    const listeners: Record<string, () => void> = {};
    this.src = src;
    this.paused = true;
    this.currentTime = 0;
    this.play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
    this.pause = vi.fn(() => { this.paused = true; });
    this.addEventListener = (e: string, fn: () => void) => { listeners[e] = fn; };
    this.fire = (e: string) => listeners[e]?.();
    made.push(this);
  }
  vi.stubGlobal('Audio', FakeAudio as any);
  return made;
}

afterEach(() => vi.unstubAllGlobals());

describe('useTrackPreview', () => {
  it('play all goes through the list in order and stops at the end', () => {
    const made = stubAudio();
    const { result } = renderHook(() => useTrackPreview());
    act(() => result.current.playAll([{ id: 'a', url: 'A' }, { id: 'b', url: '' }, { id: 'c', url: 'C' }]));
    expect(result.current.playingAll).toBe(true);
    expect(result.current.playingId).toBe('a');
    act(() => made[0].fire('ended'));
    expect(result.current.playingId).toBe('c'); // b has nothing to play
    act(() => made[1].fire('ended'));
    expect(result.current.playingAll).toBe(false);
    expect(result.current.playingId).toBeNull();
  });

  it('pressing play all again stops it', () => {
    const made = stubAudio();
    const { result } = renderHook(() => useTrackPreview());
    act(() => result.current.playAll([{ id: 'a', url: 'A' }]));
    act(() => result.current.playAll([{ id: 'a', url: 'A' }]));
    expect(made[0].paused).toBe(true);
    expect(result.current.playingAll).toBe(false);
  });

  it('a single preview toggles, and switching tracks stops the first', () => {
    const made = stubAudio();
    const { result } = renderHook(() => useTrackPreview());
    act(() => result.current.preview({ id: 'a', url: 'A' }));
    act(() => result.current.preview({ id: 'b', url: 'B' }));
    expect(made[0].paused).toBe(true);
    expect(result.current.playingId).toBe('b');
    act(() => result.current.preview({ id: 'b', url: 'B' }));
    expect(result.current.playingId).toBeNull();
  });
});

describe('trackAudioUrl', () => {
  it('bundled tracks play from /music, uploads from /outputs by file name, refs alone play nothing', () => {
    expect(trackAudioUrl({ previewUrl: '/music/01.mp3' })).toMatch(/\/music\/01\.mp3$/);
    expect(trackAudioUrl({ previewUrl: null, mediaFile: 'user-audio-1.m4a' })).toMatch(/\/outputs\/user-audio-1\.m4a$/);
    expect(trackAudioUrl(undefined, 'C:\\out\\user-audio-9.m4a')).toMatch(/\/outputs\/user-audio-9\.m4a$/);
    expect(trackAudioUrl(undefined, 'mylib:x')).toBe('');
  });
});
