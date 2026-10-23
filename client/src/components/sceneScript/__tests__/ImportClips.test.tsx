import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/mediaUpload', () => ({ uploadMedia: vi.fn() }));
vi.mock('../../../lib/sceneScriptApi', () => ({ visualLibraryApi: { importClip: vi.fn() } }));
vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));

import { uploadMedia } from '../../../lib/mediaUpload';
import { visualLibraryApi } from '../../../lib/sceneScriptApi';
import { toastError } from '../../../lib/errors';
import { ImportClips } from '../ImportClips';

const file = (name: string, size = 1000) => {
  const f = new File(['x'], name, { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

function choose(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe('ImportClips', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads each clip and imports it with the description as its prompt', async () => {
    vi.mocked(uploadMedia).mockImplementation(async (_f, name) => ({ file: `bg-video-${name}` }) as never);
    vi.mocked(visualLibraryApi.importClip).mockResolvedValue({} as never);
    const onImported = vi.fn();
    render(<ImportClips onImported={onImported} />);
    fireEvent.change(screen.getByPlaceholderText('A still lake at dawn'), { target: { value: '  A lake at dawn ' } });
    choose([file('a.mp4'), file('b.mp4')]);
    await waitFor(() => expect(screen.getByText('2 of 2 imported.')).toBeTruthy());
    expect(visualLibraryApi.importClip).toHaveBeenNthCalledWith(1, { uploadPath: 'bg-video-a.mp4', prompt: 'A lake at dawn' });
    expect(visualLibraryApi.importClip).toHaveBeenNthCalledWith(2, { uploadPath: 'bg-video-b.mp4', prompt: 'A lake at dawn' });
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('keeps going past a clip that fails and names it', async () => {
    vi.mocked(uploadMedia).mockImplementation(async (_f, name) => ({ file: `bg-video-${name}` }) as never);
    vi.mocked(visualLibraryApi.importClip)
      .mockRejectedValueOnce(new Error('That file is not a video clip.'))
      .mockResolvedValueOnce({} as never);
    render(<ImportClips onImported={vi.fn()} />);
    choose([file('bad.mp4'), file('good.mp4')]);
    await waitFor(() => expect(screen.getByText('1 of 2 imported. Not imported: bad.mp4.')).toBeTruthy());
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('refuses a clip over the size cap before uploading it', async () => {
    const onImported = vi.fn();
    render(<ImportClips onImported={onImported} />);
    choose([file('huge.mp4', 201 * 1024 * 1024)]);
    await waitFor(() => expect(screen.getByText('0 of 1 imported. Not imported: huge.mp4.')).toBeTruthy());
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
  });
});
