import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';

// toast() is itself callable (a warning), so the module is a callable stub
// that still carries .success and .error for the tests that spy on them.
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: t };
});
import { api } from '../../../lib/api';
import { YoutubePublishPanel } from '../YoutubePublishPanel';

// The preview asks the server for a real picture; tests answer with a stub.
const stubPreview = () => vi.spyOn(api, 'postForBlob').mockResolvedValue({ ok: true, data: new Blob(['jpg'], { type: 'image/jpeg' }) } as any);

beforeEach(() => {
  vi.restoreAllMocks();
  stubPreview();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

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
    await user.selectOptions(screen.getByRole('combobox', { name: /thumbnail/i }), '/outputs/genImg/p1/part-1.png');
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
    // The second argument is what was asked for, so a caller can record the upload.
    expect(onPublished).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: 'v1', forcedPrivate: true }),
      { privacyStatus: 'private', publishAt: expect.stringMatching(/^2030-01-01T/) },
    );
  });

  it('explains that chapters are appended at publish time, only when there are chapters', () => {
    const { rerender } = render(<YoutubePublishPanel videoUrl="/outputs/story/p1/video.mp4" chapters={[{ startMs: 0, title: 'Welcome' }, { startMs: 60_000, title: 'Psalm 23' }, { startMs: 120_000, title: 'Closing' }]} />);
    expect(screen.getByText(/3 chapter timestamps will be added/i)).toBeInTheDocument();
    rerender(<YoutubePublishPanel videoUrl="/outputs/story/p1/video.mp4" />);
    expect(screen.queryByText(/chapter timestamps/i)).not.toBeInTheDocument();
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

  it('sends the tagline with the title, and only when the title is drawn', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false } } as any);
    render(
      <YoutubePublishPanel
        videoUrl="/outputs/a.mp4"
        initial={{ title: 'Be Still, My Soul', thumbnailTitle: true, thumbnailTagline: '2 hours · soaking worship' }}
        thumbnailOptions={[{ label: 'Picture 1', path: '/outputs/genImg/p1/part-1.png' }]}
      />,
    );
    expect(screen.getByLabelText(/line above the title/i)).toHaveValue('2 hours · soaking worship');
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(post).toHaveBeenLastCalledWith('/api/social/post', expect.objectContaining({ thumbnailTitle: true, thumbnailTagline: '2 hours · soaking worship' }));

    await user.click(screen.getByRole('checkbox', { name: /put the title on the thumbnail/i }));
    expect(screen.queryByLabelText(/line above the title/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    expect(post).toHaveBeenLastCalledWith('/api/social/post', expect.objectContaining({ thumbnailTitle: false, thumbnailTagline: '' }));
  });

  it('shows the thumbnail as the server makes it, from the chosen picture, title and tagline', async () => {
    const preview = stubPreview();
    render(
      <YoutubePublishPanel
        videoUrl="/outputs/a.mp4"
        initial={{ title: 'Be Still, My Soul', thumbnailTitle: true, thumbnailTagline: '2 hours' }}
        thumbnailOptions={[{ label: 'Picture 1', path: '/outputs/genImg/p1/part-1.png' }]}
      />,
    );
    expect(await screen.findByAltText(/thumbnail preview/i, {}, { timeout: 2000 })).toHaveAttribute('src', 'blob:preview');
    expect(preview).toHaveBeenCalledWith('/api/social/youtube/thumbnail-preview', {
      thumbnailPath: '/outputs/genImg/p1/part-1.png', title: 'Be Still, My Soul', thumbnailTitle: true, thumbnailTagline: '2 hours',
    }, { timeout: 60_000 });
  });

  it('asks again when the server is still making the last preview', async () => {
    const preview = vi.spyOn(api, 'postForBlob')
      .mockResolvedValueOnce({ ok: false, status: 429, error: 'busy' } as any)
      .mockResolvedValue({ ok: true, data: new Blob(['jpg']) } as any);
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} thumbnailOptions={[{ label: 'P', path: '/outputs/x.png' }]} />);
    expect(await screen.findByAltText(/thumbnail preview/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says why when the preview cannot be made', async () => {
    vi.spyOn(api, 'postForBlob').mockResolvedValue({ ok: false, error: "Couldn't make a thumbnail from that picture" } as any);
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} thumbnailOptions={[{ label: 'P', path: '/outputs/x.png' }]} />);
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent(/couldn't make a thumbnail/i);
  });

  it('warns when the picture went up without its title', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { videoId: 'v1', videoUrl: 'u', forcedPrivate: false, thumbnailWarning: 'went up without it' } } as any);
    const warn = vi.mocked(toast);
    warn.mockClear();
    render(<YoutubePublishPanel videoUrl="/outputs/a.mp4" initial={{ title: 'T' }} />);
    await user.click(screen.getByRole('button', { name: /publish to youtube/i }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('went up without it', expect.objectContaining({ icon: '⚠️' })));
  });
});
