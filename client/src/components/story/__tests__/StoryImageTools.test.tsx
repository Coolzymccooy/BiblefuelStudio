import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StoryProject, StoryScene } from '../../../lib/storyTypes';

const putOwnImage = vi.fn();
vi.mock('../../../lib/storyImages', async (orig) => ({
  ...(await orig<typeof import('../../../lib/storyImages')>()),
  putOwnImage: (...args: unknown[]) => putOwnImage(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', async (orig) => {
  const real = (await orig<typeof import('react-hot-toast')>()).default;
  return { default: Object.assign((...a: Parameters<typeof real>) => real(...a), real, { success: toastSuccess }) };
});

import { StoryImageTools } from '../StoryImageTools';

function scene(i: number, done: boolean): StoryScene {
  return {
    id: `s${i + 1}`, text: `Words ${i + 1}`, startMs: i * 5000, endMs: i * 5000 + 5000, imagePrompt: `prompt ${i + 1}`,
    imagePath: done ? '/x.png' : null, imageStatus: done ? 'done' : 'error', promptEditedByUser: false,
  };
}

function project(scenes: StoryScene[]): StoryProject {
  return {
    projectId: 'p1', title: 'Starting Small', style: 'heavenly-atmosphere', status: 'generating_images',
    source: { audioPath: null, durationMs: 0 }, transcript: { words: [], hash: null }, scenes,
    music: { path: null, volume: 0.3 }, captionPreset: 'default',
    render: { jobId: null, outputPath: null, status: null }, error: null, createdAt: 0, updatedAt: 0,
  };
}

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  putOwnImage.mockReset().mockResolvedValue({});
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('StoryImageTools', () => {
  it('Copy all for AI copies the whole brief in one go', async () => {
    render(<StoryImageTools project={project([scene(0, true), scene(1, false)])} busy={false} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /copy all for ai/i }));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('Scene 1 ·');
    expect(text).toContain('Scene 2 ·');
    expect(text).toContain('FULL TRANSCRIPT');
  });

  it('Copy missing only leaves out the scenes that already have a picture', async () => {
    render(<StoryImageTools project={project([scene(0, true), scene(1, false)])} busy={false} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /copy missing only/i }));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).not.toContain('Scene 1 ·');
    expect(text).toContain('Scene 2 ·');
  });

  it('offers Copy missing only only when some scenes have pictures and some do not', () => {
    render(<StoryImageTools project={project([scene(0, false), scene(1, false)])} busy={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /copy missing only/i })).not.toBeInTheDocument();
  });

  it('Upload several puts each picture on the next scene that needs one', async () => {
    const onChanged = vi.fn();
    render(<StoryImageTools project={project([scene(0, true), scene(1, false), scene(2, false)])} busy={false} onChanged={onChanged} />);
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Image files for several scenes'), [b, a]);
    await waitFor(() => expect(putOwnImage).toHaveBeenCalledTimes(2));
    expect(putOwnImage.mock.calls.map((c) => [c[1], (c[2] as File).name])).toEqual([['s2', 'a.png'], ['s3', 'b.png']]);
    expect(onChanged).toHaveBeenCalled();
  });

  it('the done toast does not call a clip a picture', async () => {
    toastSuccess.mockReset();
    render(<StoryImageTools project={project([scene(0, false), scene(1, false)])} busy={false} onChanged={vi.fn()} />);
    // Some Android pickers ignore accept, so a clip can come in here too.
    await userEvent.upload(screen.getByLabelText('Image files for several scenes'), [
      new File(['v'], 'clip.mp4', { type: 'video/mp4' }),
    ], { applyAccept: false });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const text = String(toastSuccess.mock.calls[0][0]);
    expect(text).toBe('Added to the scene');
    expect(text).not.toMatch(/picture/i);
  });

  it('the done toast counts several scenes without calling them pictures', async () => {
    toastSuccess.mockReset();
    render(<StoryImageTools project={project([scene(0, false), scene(1, false)])} busy={false} onChanged={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Image files for several scenes'), [
      new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.mp4', { type: 'video/mp4' }),
    ], { applyAccept: false });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(String(toastSuccess.mock.calls[0][0])).toBe('Added to 2 scenes');
  });

  it('stops when images start generating, since every later upload would be refused', async () => {
    putOwnImage.mockRejectedValueOnce(Object.assign(new Error('Images are still being generated.'), { code: 'IMAGES_RUNNING' }));
    render(<StoryImageTools project={project([scene(0, false), scene(1, false)])} busy={false} onChanged={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText('Image files for several scenes'), [
      new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(putOwnImage).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(putOwnImage).toHaveBeenCalledTimes(1);
  });
});
