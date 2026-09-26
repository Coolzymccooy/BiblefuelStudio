import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InstrumentalModal } from '../InstrumentalModal';
import * as lib from '../../lib/musicLibraryApi';
import type { MusicTrack } from '../../lib/musicLibraryApi';

vi.mock('react-hot-toast', () => {
  const fn: any = vi.fn();
  fn.success = vi.fn();
  fn.error = vi.fn();
  return { __esModule: true, default: fn };
});

const track = { id: 't1', label: 'Song', licence: 'unknown', source: 'upload', ref: 'mylib:t1' } as MusicTrack;
const job = (status: lib.InstrumentalJob['status'], extra: Partial<lib.InstrumentalJob> = {}) =>
  ({ jobId: 'j1', status, percent: 0, error: null, sourceRef: 'mylib:t1', sourcePreview: 'song.mp3', resultFile: null, track: null, ...extra });

beforeEach(() => { vi.restoreAllMocks(); });

describe('InstrumentalModal', () => {
  it('minimises a running job to a small progress pill and opens it again', async () => {
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental').mockResolvedValue(job('running', { where: 'laptop', laptopOnline: true, percent: 49 }));
    render(<InstrumentalModal track={track} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    fireEvent.click(await screen.findByRole('button', { name: /minimise/i }));
    // The dialog and its backdrop are gone; the page is usable.
    expect(screen.queryByRole('dialog')).toBeNull();
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent(/removing vocals on your laptop/i);
    expect(pill).toHaveTextContent(/49%/);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('the pill says when the instrumental is ready', async () => {
    const saved = { ...track, id: 'n', label: 'Song (instrumental)', ref: 'mylib:n' } as MusicTrack;
    vi.spyOn(lib, 'startInstrumental').mockResolvedValue('j1');
    vi.spyOn(lib, 'getInstrumental')
      .mockResolvedValueOnce(job('running', { percent: 90 }))
      .mockResolvedValue(job('done', { percent: 100, resultFile: 'instrumental-j1.m4a', track: saved }));
    render(<InstrumentalModal track={track} onClose={() => {}} onSaved={() => {}} pollMs={5} />);
    fireEvent.click(screen.getByRole('button', { name: /remove vocals/i }));
    fireEvent.click(await screen.findByRole('button', { name: /minimise/i }));
    expect(await screen.findByText(/instrumental ready/i)).toBeInTheDocument();
  });

  it('there is nothing to minimise before a job starts', () => {
    render(<InstrumentalModal track={track} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByRole('button', { name: /minimise/i })).toBeNull();
  });
});
