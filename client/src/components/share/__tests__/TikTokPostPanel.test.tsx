import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api';
import { TikTokPostPanel } from '../TikTokPostPanel';

const VIDEO = '/outputs/cartoons/c1/film.mp4';
const CAPTION = 'The Lost Lamb\n\n“Leave the ninety-nine.”\nLuke 15:4';

function stubStatus(data: Record<string, unknown>) {
  return vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data });
}
const connected = { connected: true, source: 'connected', username: 'graceposts', canConnect: false };

beforeEach(() => vi.restoreAllMocks());

describe('TikTokPostPanel', () => {
  it('posts the video and caption to TikTok once, now, and says so quietly', async () => {
    stubStatus(connected);
    let answer: (v: unknown) => void = () => {};
    const post = vi.spyOn(api, 'post').mockImplementation(() => new Promise((resolve) => { answer = resolve as (v: unknown) => void; }));
    render(<TikTokPostPanel videoUrl={VIDEO} caption={CAPTION} title="The Lost Lamb" />);
    const button = await screen.findByRole('button', { name: 'Post to TikTok' });
    expect(screen.getByText(/@graceposts/)).toBeInTheDocument();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/social/post', { destination: 'tiktok', videoUrl: VIDEO, caption: CAPTION, title: 'The Lost Lamb' });
    answer({ ok: true, status: 200, data: { ok: true, results: [{ destination: 'tiktok', ok: true, error: '', draft: false }] } });
    expect(await screen.findByText('Posted to TikTok.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post to TikTok' })).toBeDisabled();
  });

  it('a draft delivery says the video is waiting in the TikTok inbox', async () => {
    stubStatus(connected);
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, results: [{ destination: 'tiktok', ok: true, error: '', draft: true }] } });
    render(<TikTokPostPanel videoUrl={VIDEO} caption={CAPTION} title="The Lost Lamb" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Post to TikTok' }));
    expect(await screen.findByText(/inbox as a draft/)).toBeInTheDocument();
  });

  it('with no TikTok connected, points to Settings instead of offering a post', async () => {
    stubStatus({ connected: false, source: null, username: '', canConnect: true });
    const post = vi.spyOn(api, 'post');
    render(<TikTokPostPanel videoUrl={VIDEO} caption={CAPTION} title="The Lost Lamb" />);
    expect(await screen.findByRole('link', { name: 'Connect TikTok in Settings' })).toHaveAttribute('href', '/app/settings');
    expect(screen.queryByRole('button', { name: 'Post to TikTok' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("an error shows the server's sentence and the button can be pressed again", async () => {
    stubStatus(connected);
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 400, error: 'Zernio publish failed: 207 Video is too short' });
    render(<TikTokPostPanel videoUrl={VIDEO} caption={CAPTION} title="The Lost Lamb" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Post to TikTok' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Zernio publish failed: 207 Video is too short');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post to TikTok' })).toBeEnabled());
  });
});
