import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { InstrumentalDialog } from '../InstrumentalDialog';
import * as lib from '../../lib/musicLibraryApi';
import type { MusicTrack } from '../../lib/musicLibraryApi';

vi.mock('react-hot-toast', () => {
  const fn: any = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  return { __esModule: true, default: fn };
});
import toast from 'react-hot-toast';

const track = { id: 't1', label: 'Song', licence: 'unknown', source: 'upload', ref: 'mylib:t1' } as MusicTrack;
const job = (status: lib.InstrumentalJob['status'], extra: Partial<lib.InstrumentalJob> = {}) =>
  ({ jobId: 'j1', status, percent: 0, error: null, sourceRef: 'mylib:t1', sourcePreview: 'song.mp3', resultFile: null, ...extra });

beforeEach(() => {
  vi.restoreAllMocks();
  (toast as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.success as unknown as ReturnType<typeof vi.fn>).mockClear();
  (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('InstrumentalDialog', () => {
  it('runs, shows progress, then previews both versions and keeps', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental')
      .mockResolvedValueOnce(job('running', { percent: 40 }))
      .mockResolvedValue(job('done', { percent: 100, resultFile: 'instrumental-j1.m4a' }));
    const keep = vi.spyOn(lib, 'keepInstrumental').mockResolvedValue({ ...track, id: 'n', label: 'Song (instrumental)' });
    const onKept = vi.fn();
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={onKept} pollMs={1} />);
    fireEvent.click(screen.getByRole('radio', { name: /fast/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    expect(lib.startInstrumental).toHaveBeenCalledWith('t1', 'fast');
    await screen.findByText(/40%/);
    await screen.findByLabelText(/instrumental preview/i);
    expect(screen.getByLabelText(/original preview/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    await waitFor(() => expect(onKept).toHaveBeenCalledWith(expect.objectContaining({ label: 'Song (instrumental)' })));
    expect(keep).toHaveBeenCalledWith('j1');
  });

  it("says the licence carries over", () => {
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} />);
    expect(screen.getByText(/keeps the original's licence/i)).toBeInTheDocument();
  });

  it('shows the error when separation fails', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('error', { error: 'out of memory' }));
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    await screen.findByText(/out of memory/);
  });

  it('discard throws the result away and closes', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('done', { resultFile: 'instrumental-j1.m4a' }));
    const discard = vi.spyOn(lib, 'discardInstrumental').mockResolvedValue();
    const onClose = vi.fn();
    render(<InstrumentalDialog track={track} onClose={onClose} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    fireEvent.click(await screen.findByRole('button', { name: /discard/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(discard).toHaveBeenCalledWith('j1');
  });

  // Task 10 ruling: cancelInstrumental / discardInstrumental now THROW on
  // failure. The dialog must not silently swallow that — it shows a toast
  // and still closes (the server sweeps the leftover job either way).
  it('shows a toast and still closes when discard fails', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('done', { resultFile: 'instrumental-j1.m4a' }));
    vi.spyOn(lib, 'discardInstrumental').mockRejectedValue(new Error('Failed to discard the instrumental'));
    const onClose = vi.fn();
    render(<InstrumentalDialog track={track} onClose={onClose} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    fireEvent.click(await screen.findByRole('button', { name: /discard/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Failed to discard the instrumental');
  });

  it('shows the poll error instead of "Removing vocals… 0%" forever when the first poll never lands', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockRejectedValue(new Error('network down'));
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    // Tolerates a few transient misses before giving up — must not stall
    // forever on the generic "0%" text with no way out.
    await screen.findByText(/network down/, {}, { timeout: 2000 });
    expect(screen.queryByText(/removing vocals… 0%/i)).toBeNull();
  });

  it('retries a transient poll failure instead of failing on the first miss', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental')
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(job('running', { percent: 55 }));
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    await screen.findByText(/55%/);
    expect(screen.queryByText(/blip/)).toBeNull();
  });

  it('disables Remove vocals while startInstrumental is in flight', async () => {
    let resolveStart: (id: string) => void = () => {};
    vi.spyOn(lib, 'startInstrumental').mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));
    render(<InstrumentalDialog track={track} onClose={() => {}} onKept={() => {}} pollMs={1} />);
    const button = screen.getByRole('button', { name: /remove vocals/i });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    resolveStart('j1');
    await waitFor(() => expect(lib.startInstrumental).toHaveBeenCalled());
  });

  it('shows a toast and still closes when cancel fails', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('running', { percent: 10 }));
    vi.spyOn(lib, 'cancelInstrumental').mockRejectedValue(new Error('Failed to cancel vocal removal'));
    const onClose = vi.fn();
    render(<InstrumentalDialog track={track} onClose={onClose} onKept={() => {}} pollMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Failed to cancel vocal removal');
  });
});
