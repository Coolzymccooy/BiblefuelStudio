import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { uploadSong: vi.fn() } }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { SongStep } from '../SongStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const empty = { projectId: 'lv_1', title: 'My Time', artist: 'Sthill Waters', song: null, lines: [], timing: { status: 'idle' } } as unknown as LyricProject;
const withSong = { ...empty, song: { file: '/o/song.mp3', durationSec: 181.4, coverStill: '/o/cover.jpg' } } as unknown as LyricProject;

const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;

describe('SongStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the song and artist and asks for the song file', () => {
    const { container } = render(<SongStep project={empty} onChange={vi.fn()} />);
    expect(screen.getByText('My Time')).toBeTruthy();
    expect(screen.getByText(/Sthill Waters/)).toBeTruthy();
    expect(fileInput(container).accept).toBe('audio/*,video/*');
  });

  it('uploads the picked song, shows progress and moves on', async () => {
    const updated = withSong;
    vi.mocked(lyricVideoApi.uploadSong).mockImplementation(async (_id, _file, onProgress) => { onProgress?.(40); return updated; });
    const onChange = vi.fn();
    const onNext = vi.fn();
    const { container } = render(<SongStep project={empty} onChange={onChange} onNext={onNext} />);
    const file = new File(['x'], 'song.mp3', { type: 'audio/mpeg' });
    fireEvent.change(fileInput(container), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(lyricVideoApi.uploadSong).toHaveBeenCalledWith('lv_1', file, expect.any(Function));
    expect(onNext).toHaveBeenCalled();
  });

  it("shows the server's sentence when the song is refused", async () => {
    vi.mocked(lyricVideoApi.uploadSong).mockRejectedValue(new Error('That song is longer than 15 minutes. Trim it and upload again.'));
    const { container } = render(<SongStep project={empty} onChange={vi.fn()} />);
    fireEvent.change(fileInput(container), { target: { files: [new File(['x'], 'long.mp3')] } });
    expect(await screen.findByText(/longer than 15 minutes/)).toBeTruthy();
    // The upload button is usable again.
    expect((screen.getByRole('button', { name: /upload/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the song length and its cover once uploaded', () => {
    render(<SongStep project={withSong} onChange={vi.fn()} />);
    expect(screen.getByText('Song: 3:01')).toBeTruthy();
    expect(screen.getByRole('img', { name: /cover/i }).getAttribute('src')).toMatch(/cover\.jpg$/);
  });

  it('warns that a new song clears the timing once lines are timed', () => {
    const timed = { ...withSong, timing: { status: 'done' } } as unknown as LyricProject;
    render(<SongStep project={timed} onChange={vi.fn()} />);
    expect(screen.getByText(/timing will be cleared/i)).toBeTruthy();
  });
});
