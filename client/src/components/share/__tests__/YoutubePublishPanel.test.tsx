import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api';
import { YoutubePublishPanel } from '../YoutubePublishPanel';

beforeEach(() => vi.restoreAllMocks());

describe('YoutubePublishPanel', () => {
  it('posts title, tags, schedule and thumbnail to the YouTube destination', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'https://www.youtube.com/watch?v=v1', forcedPrivate: true } } as any);
    const onPublished = vi.fn();
    render(
      <YoutubePublishPanel
        videoUrl="/outputs/story/p1/video.mp4"
        initial={{ title: 'Psalms for Sleep', description: 'One hour.' }}
        thumbnailOptions={[{ label: 'Scene 1', path: '/outputs/genImg/p1/part-1.png' }]}
        chapters={[{ startMs: 0, title: 'Welcome' }]}
        onPublished={onPublished}
      />,
    );
    await user.type(screen.getByLabelText(/tags/i), 'psalms, sleep');
    await user.type(screen.getByLabelText(/publish at/i), '2030-01-01T09:00');
    await user.selectOptions(screen.getByLabelText(/thumbnail/i), '/outputs/genImg/p1/part-1.png');
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));

    expect(post).toHaveBeenCalledWith('/api/social/post', expect.objectContaining({
      destination: 'youtube',
      videoUrl: '/outputs/story/p1/video.mp4',
      title: 'Psalms for Sleep',
      description: 'One hour.',
      tags: ['psalms', 'sleep'],
      thumbnailPath: '/outputs/genImg/p1/part-1.png',
      chapters: [{ startMs: 0, title: 'Welcome' }],
      publishAt: expect.stringMatching(/^2030-01-01T/),
    }));
    expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ videoId: 'v1', forcedPrivate: true }));
  });

  it('tells the user when a schedule forced the video private', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'u', forcedPrivate: true } } as any);
    const success = vi.spyOn(toast, 'success');
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/scheduled.*private until/i));
  });

  it('surfaces a thumbnail error without hiding the successful upload', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false, thumbnailError: 'channel not verified' } } as any);
    const err = vi.spyOn(toast, 'error');
    const success = vi.spyOn(toast, 'success');
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(success).toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/thumbnail.*channel not verified/i));
  });

  it('blocks publish with an empty title and does not call the API', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post');
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
  });
});
