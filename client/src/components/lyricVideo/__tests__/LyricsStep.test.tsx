import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { setSheet: vi.fn(), align: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LyricsStep } from '../LyricsStep';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const base = { projectId: 'lv_1', song: { file: 'x', durationSec: 10, coverStill: null }, sheet: { raw: '', parsedAt: null }, sections: [], lines: [], timing: { status: 'idle' } } as unknown as LyricProject;
const parsed = { ...base, sheet: { raw: 'x', parsedAt: 't', skipped: ['(Talking drum)'] },
  sections: [{ id: 's1', kind: 'chorus', label: 'CHORUS' }],
  lines: [{ id: 'l1', sectionId: 's1', kind: 'lead', text: 'Who talk say?', effect: 'auto' }, { id: 'l2', sectionId: 's1', kind: 'response', text: '(WHO TALK SAY?!)', effect: 'auto' }] } as LyricProject;

describe('LyricsStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the sheet and shows sections, responses and skipped notes', async () => {
    vi.mocked(lyricVideoApi.setSheet).mockResolvedValue(parsed);
    const onChange = vi.fn();
    render(<LyricsStep project={base} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '[CHORUS]\nWho talk say?' } });
    fireEvent.click(screen.getByRole('button', { name: /read lyrics/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(parsed));
    expect(lyricVideoApi.setSheet).toHaveBeenCalledWith('lv_1', '[CHORUS]\nWho talk say?');
  });

  it('shows the parsed result and enables timing', () => {
    render(<LyricsStep project={parsed} onChange={vi.fn()} />);
    expect(screen.getByText('CHORUS')).toBeTruthy();
    expect(screen.getByText('(WHO TALK SAY?!)')).toBeTruthy();
    expect(screen.getByText(/look like notes/i)).toBeTruthy();
    expect(screen.getByText(/Skipped: \(Talking drum\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /time the lyrics/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('indents responses and colours them yellow', () => {
    render(<LyricsStep project={parsed} onChange={vi.fn()} />);
    expect(screen.getByText('(WHO TALK SAY?!)').className).toMatch(/pl-6/);
    expect(screen.getByText('(WHO TALK SAY?!)').className).toMatch(/text-bf-gold/);
    expect(screen.getByText('Who talk say?').className).not.toMatch(/pl-6/);
  });

  it('cannot time lyrics that have not been read or a song that is missing', () => {
    const { rerender } = render(<LyricsStep project={base} onChange={vi.fn()} />);
    expect((screen.getByRole('button', { name: /time the lyrics/i }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<LyricsStep project={{ ...parsed, song: null }} onChange={vi.fn()} />);
    expect((screen.getByRole('button', { name: /time the lyrics/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks to read the lyrics again after they are edited', () => {
    render(<LyricsStep project={parsed} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'something new' } });
    expect((screen.getByRole('button', { name: /time the lyrics/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/read the lyrics again/i)).toBeTruthy();
  });

  it('starts timing and moves on', async () => {
    const running = { ...parsed, timing: { status: 'running' } } as LyricProject;
    vi.mocked(lyricVideoApi.align).mockResolvedValue(running);
    const onChange = vi.fn();
    const onNext = vi.fn();
    render(<LyricsStep project={parsed} onChange={onChange} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /time the lyrics/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(running));
    expect(lyricVideoApi.align).toHaveBeenCalledWith('lv_1');
    expect(onNext).toHaveBeenCalled();
  });

  describe('when the lyrics were timed before', () => {
    const timed = { ...parsed, timing: { status: 'done' } } as LyricProject;
    afterEach(() => vi.restoreAllMocks());

    it('says "again" and does nothing if the user backs out of the warning', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      render(<LyricsStep project={timed} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Time the lyrics again' }));
      expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/render allowance.*moved by hand stay/));
      expect(lyricVideoApi.align).not.toHaveBeenCalled();
    });

    it('times them again once the user agrees', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const running = { ...timed, timing: { status: 'running' } } as LyricProject;
      vi.mocked(lyricVideoApi.align).mockResolvedValue(running);
      const onChange = vi.fn();
      render(<LyricsStep project={timed} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'Time the lyrics again' }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(running));
    });

    it('does not ask the first time', async () => {
      const confirm = vi.spyOn(window, 'confirm');
      vi.mocked(lyricVideoApi.align).mockResolvedValue(parsed);
      render(<LyricsStep project={parsed} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Time the lyrics' }));
      await waitFor(() => expect(lyricVideoApi.align).toHaveBeenCalled());
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  it("shows the server's sentence when the lyrics are refused", async () => {
    vi.mocked(lyricVideoApi.setSheet).mockRejectedValue(new Error('Paste the lyrics, one line per line.'));
    render(<LyricsStep project={base} onChange={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /read lyrics/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Paste the lyrics, one line per line.'));
  });
});
