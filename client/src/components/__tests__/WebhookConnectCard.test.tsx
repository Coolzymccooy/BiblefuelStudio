import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebhookConnectCard } from '../WebhookConnectCard';
import { api } from '../../lib/api';

const failing = {
    id: 'w1',
    name: 'Make',
    url: 'https://hook.eu1.make.com/abc',
    enabled: true,
    lastSuccessAt: new Date(Date.now() - 7 * 86400_000).toISOString(),
    lastFailureAt: new Date(Date.now() - 14 * 3600_000).toISOString(),
    lastFailureMessage: 'Webhook failed: 400 Queue is full.',
    failureCount: 24,
};

const load = (data: Record<string, unknown>) => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data } as never);
};

afterEach(() => vi.restoreAllMocks());

describe('WebhookConnectCard', () => {
    it('names Make and Zapier as what the card connects', async () => {
        load({ webhooks: [], tiktokDirect: false });
        render(<WebhookConnectCard />);
        expect(await screen.findByText('Auto-publish with Make or Zapier')).toBeInTheDocument();
        expect(screen.queryByText(/straight through Zernio/)).not.toBeInTheDocument();
    });

    it('says TikTok keeps posting when it goes straight through Zernio', async () => {
        load({ webhooks: [failing], tiktokDirect: true });
        render(<WebhookConnectCard />);
        expect(await screen.findByText(/TikTok posts go straight through Zernio/)).toBeInTheDocument();
    });

    it('a failed delivery says what to do, in the danger colour', async () => {
        load({ webhooks: [failing], tiktokDirect: false });
        render(<WebhookConnectCard />);
        expect(await screen.findByText('Webhook failed: 400 Queue is full.')).toHaveClass('text-bf-danger');
        expect(screen.getByText(/empty the webhook's queue first/)).toBeInTheDocument();
        expect(screen.getByText('14 h ago')).toHaveClass('text-bf-danger');
    });

    it('the delete button names the webhook it removes', async () => {
        load({ webhooks: [failing], tiktokDirect: false });
        render(<WebhookConnectCard />);
        expect(await screen.findByRole('button', { name: 'Remove webhook Make' })).toBeInTheDocument();
    });
});
