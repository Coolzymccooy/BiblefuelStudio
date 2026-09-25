import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { ApplyThumbnail } from '../ApplyThumbnail';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const design = { path: '/outputs/genImg/p1/part-1.png', title: 'Be Still, My Soul', withTitle: true, tagline: '2 hours' };

beforeEach(() => vi.restoreAllMocks());

describe('ApplyThumbnail', () => {
  it('puts the designed thumbnail on a video this session already published', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true } } as any);
    render(<ApplyThumbnail design={design} videos={[{ videoId: 'Awlj9uLvOCQ', label: 'Public · yesterday' }]} />);
    await user.click(screen.getByRole('button', { name: /update thumbnail on youtube/i }));
    expect(post).toHaveBeenCalledWith('/api/social/youtube/thumbnail', {
      videoId: 'Awlj9uLvOCQ', thumbnailPath: design.path, title: 'Be Still, My Soul', thumbnailTitle: true, thumbnailTagline: '2 hours',
    });
  });

  it('takes a pasted link for any other video, and waits for a real one', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { ok: true } } as any);
    render(<ApplyThumbnail design={design} videos={[]} />);
    const button = screen.getByRole('button', { name: /update thumbnail on youtube/i });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/youtube link/i), 'not a link');
    expect(screen.getByText(/isn’t a youtube video link/i)).toBeInTheDocument();
    expect(button).toBeDisabled();
    await user.clear(screen.getByLabelText(/youtube link/i));
    await user.type(screen.getByLabelText(/youtube link/i), 'https://youtu.be/Awlj9uLvOCQ');
    await user.click(button);
    expect(post).toHaveBeenCalledWith('/api/social/youtube/thumbnail', expect.objectContaining({ videoId: 'Awlj9uLvOCQ' }));
  });

  it('offers "another video" alongside the published ones', async () => {
    const user = userEvent.setup();
    render(<ApplyThumbnail design={design} videos={[{ videoId: 'Awlj9uLvOCQ', label: 'Public · yesterday' }]} />);
    expect(screen.queryByLabelText(/youtube link/i)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /video/i }), '__other__');
    expect(screen.getByLabelText(/youtube link/i)).toBeInTheDocument();
  });

  it('shows nothing without a picture to use', () => {
    const { container } = render(<ApplyThumbnail design={{ ...design, path: '' }} videos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
