import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Toaster } from 'react-hot-toast';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MomentsPhotosStep } from '../MomentsPhotosStep';
import { momentsApi } from '../../../lib/momentsApi';
import * as upload from '../../../lib/mediaUpload';
import * as errors from '../../../lib/errors';
import { ApiError } from '../../../lib/apiError';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';
import type { MomentPhoto } from '../../../lib/momentsTypes';

const photo = (n: number): MomentPhoto => ({ ref: { kind: 'upload', path: `bg-image-${n}.jpg` }, url: `/outputs/bg-image-${n}.jpg`, width: 1, height: 1 });
const props = (over = {}) => ({ project: mkMoment({ photos: [photo(1), photo(2), photo(3)], heroIndex: 0, ...over }), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn(), track: vi.fn(), commit: vi.fn() });

function renderStep(p: ReturnType<typeof props>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MomentsPhotosStep {...p} />
    </QueryClientProvider>,
  );
}

const jpg = (name: string) => new File([name], name, { type: 'image/jpeg' });
const ref = (name: string) => ({ kind: 'upload', path: `/data/out/bg-image-${name}.jpg` });

let toastErr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([]);
  toastErr = vi.spyOn(errors, 'toastError').mockImplementation(() => {});
});

describe('MomentsPhotosStep', () => {
  it('uploads each file in turn and saves after every photo', async () => {
    const up = vi.spyOn(upload, 'uploadMedia')
      .mockResolvedValueOnce({ file: '/data/out/bg-image-a.jpg' } as never)
      .mockResolvedValueOnce({ file: '/data/out/bg-image-b.jpg' } as never);
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props({ photos: [] });
    renderStep(p);
    await userEvent.upload(screen.getByLabelText(/add photos/i), [jpg('a.jpg'), jpg('b.jpg')]);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(up).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][1]).toEqual({ photos: [ref('a')], heroIndex: 0 });
    expect(update.mock.calls.at(-1)?.[1]).toEqual({ photos: [ref('a'), ref('b')], heroIndex: 0 });
    await waitFor(() => expect(p.refresh).toHaveBeenCalledTimes(2));
  });

  it('tells the page it is busy for the whole batch', async () => {
    let release: (v: never) => void = () => {};
    vi.spyOn(upload, 'uploadMedia').mockReturnValue(new Promise((r) => { release = r as never; }));
    vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = props({ photos: [] });
    renderStep(p);
    await userEvent.upload(screen.getByLabelText(/add photos/i), [jpg('a.jpg')]);
    await waitFor(() => expect(p.setBusy).toHaveBeenCalledWith(true));
    expect(p.setBusy).not.toHaveBeenCalledWith(false);
    release({ file: '/data/out/bg-image-a.jpg' } as never);
    await waitFor(() => expect(p.setBusy).toHaveBeenLastCalledWith(false));
  });

  it('drops the extra files and says how much room is left', async () => {
    const up = vi.spyOn(upload, 'uploadMedia').mockResolvedValue({ file: '/data/out/bg-image-a.jpg' } as never);
    vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const full = Array.from({ length: 18 }, (_, i) => photo(i + 1));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Toaster /><MomentsPhotosStep {...props({ photos: full })} /></QueryClientProvider>);
    await userEvent.upload(screen.getByLabelText(/add photos/i), [jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
    expect(await screen.findByText('Only room for 2 more photos (max 20).')).toBeInTheDocument();
    await waitFor(() => expect(up).toHaveBeenCalledTimes(2));
  });

  it('at the limit, adding is disabled and a hint says why', () => {
    renderStep(props({ photos: Array.from({ length: 20 }, (_, i) => photo(i + 1)) }));
    expect(screen.getByRole('button', { name: /add photos/i })).toBeDisabled();
    expect(screen.getByText(/most a moment can hold \(20 photos\)/i)).toBeInTheDocument();
  });

  it('a photo that fails to upload costs only itself', async () => {
    vi.spyOn(upload, 'uploadMedia')
      .mockResolvedValueOnce({ file: '/data/out/bg-image-a.jpg' } as never)
      .mockRejectedValueOnce(new Error('Upload failed'))
      .mockResolvedValueOnce({ file: '/data/out/bg-image-c.jpg' } as never);
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(props({ photos: [] }));
    await userEvent.upload(screen.getByLabelText(/add photos/i), [jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[0][1]).toEqual({ photos: [ref('a')], heroIndex: 0 });
    expect(update.mock.calls[1][1]).toEqual({ photos: [ref('a'), ref('c')], heroIndex: 0 });
    expect(toastErr).toHaveBeenCalledTimes(1);
  });

  it('a photo the server refuses is skipped and the rest are kept', async () => {
    vi.spyOn(upload, 'uploadMedia')
      .mockResolvedValueOnce({ file: '/data/out/bg-image-a.jpg' } as never)
      .mockResolvedValueOnce({ file: '/data/out/bg-image-b.jpg' } as never)
      .mockResolvedValueOnce({ file: '/data/out/bg-image-c.jpg' } as never);
    const refusal = new ApiError('Photo 2: that photo is too large.', '', {}, 400);
    const update = vi.spyOn(momentsApi, 'update')
      .mockResolvedValueOnce(mkMoment())
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce(mkMoment());
    renderStep(props({ photos: [] }));
    await userEvent.upload(screen.getByLabelText(/add photos/i), [jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(update.mock.calls[2][1]).toEqual({ photos: [ref('a'), ref('c')], heroIndex: 0 });
    expect(toastErr.mock.calls[0][0]).toMatchObject({ message: 'b.jpg: that photo is too large.' });
  });

  it('only accepts jpeg, png and webp, so iPhones convert HEIC', () => {
    renderStep(props());
    expect(screen.getByLabelText(/add photos/i)).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });

  it('picking from the library sends the library id', async () => {
    vi.spyOn(momentsApi, 'libraryImages').mockResolvedValue([
      { id: 'lib1', url: '/outputs/lib1.png', aspect: '9:16', source: 'upload', createdAt: 1 },
    ]);
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(props());
    await userEvent.click(screen.getByRole('button', { name: /pick from my pictures/i }));
    await userEvent.click(await screen.findByRole('button', { name: /add library picture 1/i }));
    expect(update.mock.calls[0][1]).toEqual({
      photos: [
        { kind: 'upload', path: 'bg-image-1.jpg' }, { kind: 'upload', path: 'bg-image-2.jpg' }, { kind: 'upload', path: 'bg-image-3.jpg' },
        { kind: 'library', id: 'lib1' },
      ],
      heroIndex: 0,
    });
  });

  it('starring a photo makes it the hero', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(props());
    await userEvent.click(screen.getByRole('button', { name: /make photo 3 the hero/i }));
    expect(update.mock.calls[0][1]).toEqual({ heroIndex: 2 });
  });

  it('removing the hero sends the new list with the hero reset', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(props({ heroIndex: 1 }));
    await userEvent.click(screen.getByRole('button', { name: /remove photo 2/i }));
    expect(update.mock.calls[0][1]).toEqual({
      photos: [{ kind: 'upload', path: 'bg-image-1.jpg' }, { kind: 'upload', path: 'bg-image-3.jpg' }],
      heroIndex: 0,
    });
  });

  it('moving a photo later keeps the star on it', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    renderStep(props());
    await userEvent.click(screen.getByRole('button', { name: /move photo 1 later/i }));
    expect(update.mock.calls[0][1]).toEqual({
      photos: [{ kind: 'upload', path: 'bg-image-2.jpg' }, { kind: 'upload', path: 'bg-image-1.jpg' }, { kind: 'upload', path: 'bg-image-3.jpg' }],
      heroIndex: 1,
    });
  });

  it('says how many more photos are needed', () => {
    renderStep(props({ photos: [photo(1)] }));
    expect(screen.getByText(/add 2 more photos/i)).toBeInTheDocument();
  });

  it('a server refusal is toasted and nothing is lost', async () => {
    const refusal = new Error('Photo 2: that photo was not found.');
    vi.spyOn(momentsApi, 'update').mockRejectedValue(refusal);
    const p = props();
    renderStep(p);
    await userEvent.click(screen.getByRole('button', { name: /make photo 2 the hero/i }));
    await waitFor(() => expect(toastErr).toHaveBeenCalledWith(refusal));
    expect(p.setBusy).toHaveBeenLastCalledWith(false);
  });
});
