import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { ShareKitPanel } from '../ShareKitPanel';

beforeEach(() => vi.restoreAllMocks());

function mockGets() {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/social/config') return { ok: true, data: { webhooks: [{ id: 'w1', name: 'Zapier hook' }], buffer: { profileIds: [] } } } as any;
    if (url === '/api/jobs') return { ok: true, data: { jobs: [{ id: 'job12345678', status: 'done', type: 'render_video', createdAt: new Date().toISOString(), result: { outFile: 'C:/srv/outputs/video-1.mp4' } }] } } as any;
    if (url === '/api/media/video-list') return { ok: true, data: { items: [] } } as any;
    return { ok: false } as any;
  });
}

describe('ShareKitPanel', () => {
  it('loads webhooks and rendered videos through the same calls the Render page makes', async () => {
    mockGets();
    render(<ShareKitPanel lines={'Line one\nLine two'} />);
    expect(await screen.findByRole('option', { name: 'Zapier hook' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /job12345/ })).toBeInTheDocument();
  });

  it('posts the caption built from the lines to the chosen destination', async () => {
    const user = userEvent.setup();
    mockGets();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true } as any);
    render(<ShareKitPanel lines={'Line one\nLine two'} latestRenderFile="outputs/video-9.mp4" />);
    await screen.findByRole('option', { name: 'Zapier hook' });
    await user.click(screen.getByRole('button', { name: /share now/i }));
    expect(post).toHaveBeenCalledWith('/api/social/post', expect.objectContaining({
      destination: 'webhook',
      caption: 'Line one Line two',
      webhookId: 'w1',
    }));
  });
});
