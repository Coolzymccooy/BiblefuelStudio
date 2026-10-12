import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MomentsPhotosStep } from '../MomentsPhotosStep';
import { MomentsDetailsStep } from '../MomentsDetailsStep';
import { MomentsWordsStep } from '../MomentsWordsStep';
import { MomentsSoundStep } from '../MomentsSoundStep';
import { MomentsStyleStep } from '../MomentsStyleStep';
import { MomentsResult } from '../MomentsResult';
import { MomentsHistory } from '../MomentsHistory';
import { momentsApi } from '../../../lib/momentsApi';
import * as upload from '../../../lib/mediaUpload';
import * as errors from '../../../lib/errors';
import { ApiError } from '../../../lib/apiError';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';
import type { MomentPhoto } from '../../../lib/momentsTypes';

vi.mock('../../MusicPicker', () => ({ MusicPicker: () => <div /> }));

const photo = (n: number): MomentPhoto => ({ ref: { kind: 'upload', path: `bg-image-${n}.jpg` }, url: `/outputs/bg-image-${n}.jpg`, width: 1, height: 1 });
const stepProps = (over = {}) => ({ project: mkMoment(over), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn(), track: vi.fn(), commit: vi.fn() });
const withClient = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);
const deferred = <T,>() => {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

let toastErr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([]);
  vi.spyOn(momentsApi, 'songWindow').mockResolvedValue({ durationSec: 120, autoStartSec: 10, tempo: 100 } as never);
  toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
});

describe('each step hands a saved project to the page', () => {
  it('Photos', async () => {
    const saved = mkMoment({ heroIndex: 2 });
    vi.spyOn(momentsApi, 'update').mockResolvedValue(saved);
    const p = stepProps({ photos: [photo(1), photo(2), photo(3)] });
    render(withClient(<MomentsPhotosStep {...p} />));
    await userEvent.click(screen.getByRole('button', { name: /make photo 3 the hero/i }));
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });

  it('Photos, for each photo of an upload batch', async () => {
    vi.spyOn(upload, 'uploadMedia').mockResolvedValue({ file: '/data/out/bg-image-a.jpg' } as never);
    const saved = mkMoment();
    vi.spyOn(momentsApi, 'update').mockResolvedValue(saved);
    const p = stepProps();
    render(withClient(<MomentsPhotosStep {...p} />));
    await userEvent.upload(screen.getByLabelText(/add photos/i), [new File(['a'], 'a.jpg', { type: 'image/jpeg' })]);
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });

  it('Details', async () => {
    const saved = mkMoment({ details: { name: 'Tolu' } });
    vi.spyOn(momentsApi, 'update').mockResolvedValue(saved);
    const p = stepProps();
    render(<MomentsDetailsStep {...p} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Tolu');
    await userEvent.tab();
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });

  it('Words', async () => {
    const saved = mkMoment({ statements: ['Grace!'] });
    vi.spyOn(momentsApi, 'update').mockResolvedValue(saved);
    const p = stepProps({ statements: ['Grace'] });
    render(<MomentsWordsStep {...p} />);
    const field = screen.getByLabelText('Statement 1');
    await userEvent.clear(field);
    await userEvent.type(field, 'Grace!');
    await userEvent.tab();
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });

  it('Sound', async () => {
    const saved = mkMoment({ sound: { song: null, voiceover: null } });
    vi.spyOn(momentsApi, 'update').mockResolvedValue(saved);
    const p = stepProps();
    render(withClient(<MomentsSoundStep {...p} />));
    await userEvent.click(screen.getByRole('button', { name: /no music/i }));
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });

  it('Sound voiceover', async () => {
    const saved = mkMoment();
    vi.spyOn(momentsApi, 'voiceover').mockResolvedValue(saved);
    const p = stepProps();
    render(withClient(<MomentsSoundStep {...p} />));
    await userEvent.type(screen.getByLabelText('Voiceover script'), 'Hello there');
    await userEvent.click(screen.getByRole('button', { name: /make voiceover/i }));
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });

  it('Style', async () => {
    const saved = mkMoment({ style: 'hype' });
    vi.spyOn(momentsApi, 'update').mockResolvedValue(saved);
    const p = stepProps();
    render(<MomentsStyleStep {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /hype/i }));
    await waitFor(() => expect(p.commit).toHaveBeenCalledWith(saved));
  });
});

describe('Details saves go through a serial chain', () => {
  it('a second blur waits for the first save, so they cannot land out of order', async () => {
    const first = deferred<ReturnType<typeof mkMoment>>();
    const update = vi.spyOn(momentsApi, 'update')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(mkMoment());
    render(<MomentsDetailsStep {...stepProps()} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Tolu');
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText('Age or milestone'), '40');
    await userEvent.tab();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(mkMoment()); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1]).toEqual({ details: { name: 'Tolu', milestone: '40' } });
  });
});

describe('Words is read-only while a render runs', () => {
  it('locks the title, statements and the new-statement field', () => {
    const running = { jobId: 'j', status: 'running' as const, percent: 10, stage: 'prepare' };
    render(<MomentsWordsStep {...stepProps({ title: 'T', statements: ['A'], render: running })} />);
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Statement 1')).toBeDisabled();
    expect(screen.getByLabelText('New statement')).toBeDisabled();
  });
});

describe('touch targets', () => {
  it('photo star, remove and move buttons have padding for a 24 px target', () => {
    render(withClient(<MomentsPhotosStep {...stepProps({ photos: [photo(1), photo(2), photo(3)] })} />));
    for (const name of [/make photo 2 the hero/i, /remove photo 2/i, /move photo 2 earlier/i, /move photo 2 later/i]) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bp-1\.5\b/);
    }
  });

  it('statement up, down and delete buttons have padding for a 24 px target', () => {
    render(<MomentsWordsStep {...stepProps({ statements: ['A', 'B', 'C'] })} />);
    for (const name of [/move statement 2 up/i, /move statement 2 down/i, /delete statement 2/i]) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bp-1\.5\b/);
    }
  });
});

describe('a photo refused during an upload batch is named by its file', () => {
  const batch = async (refusal: Error) => {
    vi.spyOn(upload, 'uploadMedia')
      .mockResolvedValueOnce({ file: '/data/out/bg-image-a.jpg' } as never)
      .mockResolvedValueOnce({ file: '/data/out/bg-image-b.jpg' } as never);
    vi.spyOn(momentsApi, 'update').mockResolvedValueOnce(mkMoment()).mockRejectedValueOnce(refusal);
    render(withClient(<MomentsPhotosStep {...stepProps()} />));
    const jpg = (n: string) => new File([n], n, { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText(/add photos/i), [jpg('a.jpg'), jpg('holiday.jpg')]);
    await waitFor(() => expect(toastErr).toHaveBeenCalledTimes(1));
    return toastErr.mock.calls[0][0] as Error;
  };

  it('swaps the slot number for the file name and keeps a coded error coded', async () => {
    const shown = await batch(new ApiError('Photo 2: that photo is too large.', 'TOO_LARGE', { a: 1 }, 400));
    expect(shown.message).toBe('holiday.jpg: that photo is too large.');
    expect(shown).toMatchObject({ code: 'TOO_LARGE', status: 400, payload: { a: 1 } });
  });

  it('prefixes a message that carries no slot number', async () => {
    const shown = await batch(new Error('Not found.'));
    expect(shown.message).toBe('holiday.jpg: Not found.');
  });
});

describe('Result announces progress politely', () => {
  it('the stage text is a polite live region', () => {
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'running', percent: 42, stage: 'shots' } })} onShuffle={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} busy={false} />);
    expect(screen.getByText(/cutting your photos/i)).toHaveAttribute('aria-live', 'polite');
  });
});

describe('History delete', () => {
  it('sends one DELETE however many times the confirm is pressed', async () => {
    vi.spyOn(momentsApi, 'list').mockResolvedValue([
      { projectId: 'm1', occasion: 'birthday', title: 'Tolu 40', updatedAt: 1, thumb: null, lastFile: null },
    ]);
    const remove = vi.spyOn(momentsApi, 'remove').mockImplementation(() => new Promise(() => {}));
    render(withClient(<MomentsHistory meta={META} onOpen={vi.fn()} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Tolu 40' }));
    const confirm = screen.getByRole('button', { name: /confirm delete tolu 40/i });
    await act(async () => { confirm.click(); confirm.click(); });
    fireEvent.click(confirm);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
