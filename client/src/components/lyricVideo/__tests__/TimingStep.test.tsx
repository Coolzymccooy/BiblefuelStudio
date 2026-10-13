import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { patchLine: vi.fn(), align: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
// A stand-in preview: a song player the test can seek, and a button that reports a playing time.
vi.mock('../LivePreview', () => ({
  LivePreview: ({ onTime, assVersion }: { onTime?: (t: number) => void; assVersion: number }) => (
    <div data-testid="lyric-preview" data-ass-version={assVersion}>
      <video controls data-testid="song-player" />
      <video data-backdrop data-testid="backdrop" />
      <button type="button" onClick={() => onTime?.(6)}>tick 6</button>
    </div>
  ),
}));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { TimingStep } from '../TimingStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const line = (id: string, start: number, flag: 'check' | null = null) =>
  ({ id, sectionId: 's1', kind: 'lead', text: `line ${id}`, effect: 'auto', start, end: start + 1, flag, words: [{ text: 'x', start, end: start + 1 }] });
const unplaced = (id: string) => ({ id, sectionId: 's1', kind: 'lead', text: `line ${id}`, effect: 'auto', flag: 'check' });
const done = { projectId: 'lv_1', song: { file: 'x', durationSec: 30, coverStill: null }, sections: [{ id: 's1', kind: 'verse', label: 'VERSE 1' }],
  lines: [line('l1', 1), line('l2', 5, 'check'), line('l3', 9)], timing: { status: 'done' } } as unknown as LyricProject;

describe('TimingStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists lines, tags the flagged one and counts it', () => {
    render(<TimingStep project={done} onChange={vi.fn()} />);
    expect(screen.getByText('1 line to check')).toBeTruthy();
    expect(screen.getAllByText(/check this line/i)).toHaveLength(1);
  });

  it('says so when every line is timed', () => {
    render(<TimingStep project={{ ...done, lines: [line('l1', 1), line('l3', 9)] } as unknown as LyricProject} onChange={vi.fn()} />);
    expect(screen.getByText('Every line is timed.')).toBeTruthy();
  });

  it('warns when most lines could not be heard', () => {
    const mostly = { ...done, lines: [line('l1', 1, 'check'), line('l2', 5, 'check'), line('l3', 9)] } as unknown as LyricProject;
    render(<TimingStep project={mostly} onChange={vi.fn()} />);
    expect(screen.getByText(/most lines could not be heard/i)).toBeTruthy();
  });

  it('shows the preview with a plain-English label', async () => {
    render(<TimingStep project={done} onChange={vi.fn()} />);
    expect(await screen.findByTestId('lyric-preview')).toBeTruthy();
    expect(screen.getByText('Preview (tall frame)')).toBeTruthy();
  });

  it('nudges a line, saves it and refreshes the preview', async () => {
    const next = { ...done } as LyricProject;
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(next);
    const onChange = vi.fn();
    render(<TimingStep project={done} onChange={onChange} />);
    const preview = await screen.findByTestId('lyric-preview');
    expect(preview.getAttribute('data-ass-version')).toBe('1');
    fireEvent.click(screen.getAllByRole('button', { name: '+0.1 s' })[1]);
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l2', { start: 5.1 }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
    await waitFor(() => expect(screen.getByTestId('lyric-preview').getAttribute('data-ass-version')).toBe('2'));
  });

  it('uses the real minus sign for the earlier button', async () => {
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(done);
    render(<TimingStep project={done} onChange={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '−0.1 s' })[1]);
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l2', { start: 4.9 }));
  });

  it("'Start here' moves the line to where the preview is playing", async () => {
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(done);
    render(<TimingStep project={done} onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'tick 6' }));
    fireEvent.click(screen.getAllByRole('button', { name: /start here/i })[1]);
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l2', { start: 6 }));
  });

  it("'Play from here' jumps the song player to the line and plays it", async () => {
    const play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.play = play;
    render(<TimingStep project={done} onChange={vi.fn()} />);
    const player = (await screen.findByTestId('song-player')) as HTMLVideoElement;
    fireEvent.click(screen.getAllByRole('button', { name: /play from here/i })[2]);
    expect(player.currentTime).toBe(9);
    expect(play).toHaveBeenCalled();
    expect((screen.getByTestId('backdrop') as HTMLVideoElement).currentTime).toBe(0);
  });

  it('gives a line that was never placed no time buttons and never tries to move it', () => {
    const mixed = { ...done, lines: [line('l1', 1), unplaced('l2'), line('l3', 9)] } as unknown as LyricProject;
    render(<TimingStep project={mixed} onChange={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: '+0.1 s' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /start here/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /play from here/i })).toHaveLength(2);
    expect(screen.getByText(/not timed yet/i)).toBeTruthy();
    expect(screen.getByText('line l2')).toBeTruthy();
  });

  it('survives a project where no line was placed at all', () => {
    const none = { ...done, lines: [unplaced('l1'), unplaced('l2')] } as unknown as LyricProject;
    render(<TimingStep project={none} onChange={vi.fn()} />);
    expect(screen.queryAllByRole('button', { name: '+0.1 s' })).toHaveLength(0);
    expect(screen.getAllByText(/not timed yet/i)).toHaveLength(2);
    expect(screen.getByText(/most lines could not be heard/i)).toBeTruthy();
  });

  it('shows progress while timing runs and the error when it fails', () => {
    const { rerender } = render(<TimingStep project={{ ...done, timing: { status: 'running', progress: { step: 'listening', window: 3 } } }} onChange={vi.fn()} />);
    expect(screen.getByText(/listening to your song/i)).toBeTruthy();
    expect(screen.getByText(/part 3/i)).toBeTruthy();
    rerender(<TimingStep project={{ ...done, timing: { status: 'error', error: 'The speech service is busy (429)' } }} onChange={vi.fn()} />);
    expect(screen.getByText(/speech service is busy/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('tries timing again after an error', async () => {
    const running = { ...done, timing: { status: 'running' } } as LyricProject;
    vi.mocked(lyricVideoApi.align).mockResolvedValue(running);
    const onChange = vi.fn();
    render(<TimingStep project={{ ...done, timing: { status: 'error', error: 'nope' } }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(running));
    expect(lyricVideoApi.align).toHaveBeenCalledWith('lv_1');
  });

  it('offers to time the lyrics when it has not been run yet', async () => {
    const running = { ...done, timing: { status: 'running' } } as LyricProject;
    vi.mocked(lyricVideoApi.align).mockResolvedValue(running);
    const onChange = vi.fn();
    render(<TimingStep project={{ ...done, timing: { status: 'idle' } }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /time the lyrics/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(running));
  });
});
