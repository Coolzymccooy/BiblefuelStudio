import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsWordsStep } from '../MomentsWordsStep';
import { momentsApi } from '../../../lib/momentsApi';
import * as errors from '../../../lib/errors';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';

const props = (over = {}) => ({ project: mkMoment(over), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn(), track: vi.fn(), commit: vi.fn() });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(errors, 'toastError').mockImplementation(() => {});
});

describe('MomentsWordsStep', () => {
  it('Suggest fills the title and statements and saves them', async () => {
    vi.spyOn(momentsApi, 'suggest').mockResolvedValue({ title: 'Happy 40th!', statements: ['Grace', 'Rising'], source: 'ai' });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));
    expect(update).toHaveBeenCalledWith('m1', { title: 'Happy 40th!', statements: ['Grace', 'Rising'] });
    expect(await screen.findByLabelText('Statement 2')).toHaveValue('Rising');
    expect(screen.getByLabelText('Title')).toHaveValue('Happy 40th!');
  });

  it('Suggest holds the page busy while it works, then releases it', async () => {
    vi.spyOn(momentsApi, 'suggest').mockResolvedValue({ title: 'T', statements: ['A'], source: 'template' });
    vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props();
    render(<MomentsWordsStep {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));
    await waitFor(() => expect(p.setBusy).toHaveBeenLastCalledWith(false));
    expect(p.setBusy.mock.calls[0]).toEqual([true]);
    expect(p.refresh).toHaveBeenCalled();
  });

  it('a failed Suggest is toasted and leaves the words alone', async () => {
    const failure = new Error('The writer is busy.');
    vi.spyOn(momentsApi, 'suggest').mockRejectedValue(failure);
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props();
    render(<MomentsWordsStep {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));
    await waitFor(() => expect(errors.toastError).toHaveBeenCalledWith(failure));
    expect(update).not.toHaveBeenCalled();
    expect(p.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('with statements already there the button reads Reshuffle', () => {
    render(<MomentsWordsStep {...props({ statements: ['A'] })} />);
    expect(screen.getByRole('button', { name: /reshuffle/i })).toBeInTheDocument();
  });

  it('edits a statement and saves on blur', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ statements: ['Grace'] })} />);
    const field = screen.getByLabelText('Statement 1');
    await userEvent.clear(field);
    await userEvent.type(field, 'Amazing grace');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('m1', { statements: ['Amazing grace'] });
  });

  it('a statement emptied by the user reverts to its previous text and is never saved empty', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ statements: ['Grace'] })} />);
    const field = screen.getByLabelText('Statement 1');
    await userEvent.clear(field);
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
    expect(field).toHaveValue('Grace');
  });

  it('a whitespace-only statement also reverts', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ statements: ['Grace'] })} />);
    const field = screen.getByLabelText('Statement 1');
    await userEvent.clear(field);
    await userEvent.type(field, '   ');
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
    expect(field).toHaveValue('Grace');
  });

  it('a refetch mid-typing does not overwrite a statement or the title being typed', async () => {
    const p = props({ statements: ['Grace'], title: 'Hi' });
    const { rerender } = render(<MomentsWordsStep {...p} />);
    await userEvent.type(screen.getByLabelText('Statement 1'), ' abc');
    await userEvent.type(screen.getByLabelText('Title'), ' you');
    rerender(<MomentsWordsStep {...p} project={mkMoment({ statements: ['Grace'], title: 'Hi' })} />);
    expect(screen.getByLabelText('Statement 1')).toHaveValue('Grace abc');
    expect(screen.getByLabelText('Title')).toHaveValue('Hi you');
  });

  it('saves a changed title on blur and skips an unchanged one', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ title: 'Hi' })} />);
    await userEvent.click(screen.getByLabelText('Title'));
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Title'), '!');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('m1', { title: 'Hi!' });
  });

  it('reorders, deletes and adds statements, each building from the words just saved', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ statements: ['A', 'B'] })} />);
    await userEvent.click(screen.getByRole('button', { name: /move statement 2 up/i }));
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['B', 'A'] });
    await userEvent.click(screen.getByRole('button', { name: /delete statement 1/i }));
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['A'] });
    await userEvent.type(screen.getByLabelText(/new statement/i), 'C{Enter}');
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['A', 'C'] });
    expect(screen.getByLabelText('Statement 2')).toHaveValue('C');
  });

  it('a refused add is toasted and keeps what was typed', async () => {
    const failure = new Error('Too long.');
    vi.spyOn(momentsApi, 'update').mockRejectedValue(failure);
    render(<MomentsWordsStep {...props({ statements: ['A'] })} />);
    await userEvent.type(screen.getByLabelText(/new statement/i), 'B{Enter}');
    await waitFor(() => expect(errors.toastError).toHaveBeenCalledWith(failure));
    expect(screen.getByLabelText(/new statement/i)).toHaveValue('B');
  });

  it('warns when the length uses fewer statements than there are', () => {
    render(<MomentsWordsStep {...props({ statements: ['A', 'B', 'C', 'D', 'E'], lengthSec: 15 })} />);
    expect(screen.getByText(/only the first 3 are used/i)).toBeInTheDocument();
  });

  it('switching to a shorter length while holding more statements shows the warning', () => {
    const five = ['A', 'B', 'C', 'D', 'E'];
    const p = props({ statements: five, lengthSec: 30 });
    const { rerender } = render(<MomentsWordsStep {...p} />);
    expect(screen.queryByText(/only the first/i)).toBeNull();
    rerender(<MomentsWordsStep {...p} project={mkMoment({ statements: five, lengthSec: 15 })} />);
    expect(screen.getByText(/only the first 3 are used/i)).toBeInTheDocument();
  });

  it('a church occasion offers its verse as a statement', async () => {
    vi.spyOn(momentsApi, 'suggest').mockResolvedValue({
      title: 'In loving memory', statements: ['Forever loved'], verse: { reference: 'John 11:35', text: 'Jesus wept.' }, source: 'ai',
    });
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsWordsStep {...props({ occasion: 'memorial' })} />);
    await userEvent.click(screen.getByRole('button', { name: /suggest/i }));
    await userEvent.click(await screen.findByRole('button', { name: /add john 11:35/i }));
    expect(update).toHaveBeenLastCalledWith('m1', { statements: ['Forever loved', '“Jesus wept.” John 11:35'] });
  });

  describe('Add verse at the length limit', () => {
    const suggestVerse = (statements: string[]) => vi.spyOn(momentsApi, 'suggest').mockResolvedValue({
      title: 'T', statements, verse: { reference: 'John 11:35', text: 'Jesus wept.' }, source: 'ai',
    });

    it('is disabled with a hint when the statements already fill the current length', async () => {
      suggestVerse(['A', 'B', 'C']);
      vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
      render(<MomentsWordsStep {...props({ occasion: 'memorial', statements: ['X'], lengthSec: 15 })} />);
      await userEvent.click(screen.getByRole('button', { name: /reshuffle/i }));
      const add = await screen.findByRole('button', { name: /add john 11:35/i });
      expect(add).toBeDisabled();
      expect(screen.getByText(/already at the 3 this length shows/i)).toBeInTheDocument();
    });

    it('is enabled while there is room', async () => {
      suggestVerse(['A', 'B']);
      vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
      render(<MomentsWordsStep {...props({ occasion: 'memorial', statements: ['X'], lengthSec: 15 })} />);
      await userEvent.click(screen.getByRole('button', { name: /reshuffle/i }));
      expect(await screen.findByRole('button', { name: /add john 11:35/i })).toBeEnabled();
    });
  });
  describe('slow saves (deferred, not instant)', () => {
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<ReturnType<typeof mkMoment>>((r) => { resolve = () => r(mkMoment()); });
      return { promise, resolve };
    };

    it('typing in another statement survives while an earlier blur-save is in flight', async () => {
      const d = deferred();
      const update = vi.spyOn(momentsApi, 'update').mockReturnValue(d.promise);
      render(<MomentsWordsStep {...props({ statements: ['A', 'B'] })} />);
      await userEvent.type(screen.getByLabelText('Statement 1'), '1');
      await userEvent.click(screen.getByLabelText('Statement 2'));
      await waitFor(() => expect(update).toHaveBeenCalledWith('m1', { statements: ['A1', 'B'] }));
      await userEvent.type(screen.getByLabelText('Statement 2'), 'xyz');
      d.resolve();
      await waitFor(() => expect(screen.getByLabelText('Statement 1')).toHaveValue('A1'));
      expect(screen.getByLabelText('Statement 2')).toHaveValue('Bxyz');
    });

    it('a move straight after an edit carries the edited text even though the project has not refetched', async () => {
      const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
      render(<MomentsWordsStep {...props({ statements: ['A', 'B'] })} />);
      await userEvent.type(screen.getByLabelText('Statement 1'), '1');
      await userEvent.click(screen.getByRole('button', { name: /move statement 2 up/i }));
      expect(update).toHaveBeenNthCalledWith(1, 'm1', { statements: ['A1', 'B'] });
      expect(update).toHaveBeenNthCalledWith(2, 'm1', { statements: ['B', 'A1'] });
    });

    it('a move queued behind a slow edit still builds from the edit', async () => {
      const d = deferred();
      const update = vi.spyOn(momentsApi, 'update')
        .mockReturnValueOnce(d.promise)
        .mockResolvedValue(mkMoment());
      render(<MomentsWordsStep {...props({ statements: ['A', 'B'] })} />);
      await userEvent.type(screen.getByLabelText('Statement 1'), '1');
      await userEvent.click(screen.getByRole('button', { name: /move statement 2 up/i }));
      expect(update).toHaveBeenCalledTimes(1);
      d.resolve();
      await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
      expect(update).toHaveBeenLastCalledWith('m1', { statements: ['B', 'A1'] });
    });

    it('text fields wait while a structural save is in flight', async () => {
      const d = deferred();
      vi.spyOn(momentsApi, 'update').mockReturnValue(d.promise);
      render(<MomentsWordsStep {...props({ statements: ['A', 'B'] })} />);
      await userEvent.click(screen.getByRole('button', { name: /delete statement 1/i }));
      await waitFor(() => expect(screen.getByLabelText('Statement 1')).toBeDisabled());
      d.resolve();
      await waitFor(() => expect(screen.getByLabelText('Statement 1')).toBeEnabled());
      expect(screen.getByLabelText('Statement 1')).toHaveValue('B');
    });

    it('the title is compared with what was last saved, not the stale project', async () => {
      const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
      render(<MomentsWordsStep {...props({ title: 'Hi' })} />);
      await userEvent.type(screen.getByLabelText('Title'), '!');
      await userEvent.tab();
      await userEvent.click(screen.getByLabelText('Title'));
      await userEvent.tab();
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith('m1', { title: 'Hi!' });
    });
  });
});
