import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/sceneScriptApi', () => ({
  visualLibraryApi: { rerollPrice: vi.fn(), reroll: vi.fn() },
}));
vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));

import { visualLibraryApi } from '../../../lib/sceneScriptApi';
import { ApiError } from '../../../lib/apiError';
import { RerollPanel } from '../RerollPanel';
import type { LibraryClip, RerollJob } from '../../../lib/sceneScriptTypes';

const api = vi.mocked(visualLibraryApi);
const clip: LibraryClip = {
  id: 'c1', prompt: 'A shepherd boy calls out at sunset', promptKnown: true, url: '/c1.mp4', posterUrl: '/c1.jpg',
  durationSec: 8, costUsd: 0.61, aspect: 'portrait', tags: [], rating: null, createdAt: 1,
};
const month = { month: '2026-10', spentUsd: 4.2, reservedUsd: 0.8, capUsd: 30 };
const job = { id: 'j1', status: 'queued' } as RerollJob;

describe('RerollPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.rerollPrice.mockResolvedValue({ price: { seconds: 8, usd: 0.64 }, month, seedance: true });
    api.reroll.mockResolvedValue(job);
  });

  it('shows the price and the month so far before anything is ordered', async () => {
    render(<RerollPanel clip={clip} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect(await screen.findByText(/A new 8 s clip costs about \$0\.64/)).toBeTruthy();
    expect(screen.getByText(/\$5\.00 of \$30\.00 used this month/)).toBeTruthy();
    expect((screen.getByLabelText('Prompt for the new clip') as HTMLTextAreaElement).value).toBe(clip.prompt);
    expect(api.reroll).not.toHaveBeenCalled();
  });

  it('orders with the edited prompt at the price it showed', async () => {
    const onStarted = vi.fn();
    render(<RerollPanel clip={clip} onClose={vi.fn()} onStarted={onStarted} />);
    const button = await screen.findByRole('button', { name: 'Re-roll for $0.64' });
    fireEvent.change(screen.getByLabelText('Prompt for the new clip'), { target: { value: 'A shepherd boy at dawn' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.reroll).toHaveBeenCalledWith('c1', { prompt: 'A shepherd boy at dawn', expectUsd: 0.64 }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(job));
  });

  it('shows the new price when it went up, and asks again', async () => {
    api.reroll.mockRejectedValueOnce(new ApiError('The price is now $0.80. Check it and try again.', 'PRICE_CHANGED', { price: { seconds: 10, usd: 0.8 } }, 409));
    const onStarted = vi.fn();
    render(<RerollPanel clip={clip} onClose={vi.fn()} onStarted={onStarted} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Re-roll for $0.64' }));
    expect(await screen.findByText('The price is now $0.80. Check it and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-roll for $0.80' })).toBeTruthy();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("can't order without a prompt or when AI video is not set up", async () => {
    api.rerollPrice.mockResolvedValueOnce({ price: { seconds: 8, usd: 0.64 }, month, seedance: false });
    const { unmount } = render(<RerollPanel clip={clip} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect(await screen.findByText(/AI video is not set up/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Re-roll for $0.64' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<RerollPanel clip={{ ...clip, prompt: '', promptKnown: false }} onClose={vi.fn()} onStarted={vi.fn()} />);
    const button = await screen.findByRole('button', { name: 'Re-roll for $0.64' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
