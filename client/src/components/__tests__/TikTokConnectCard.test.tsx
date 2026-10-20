import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { TikTokConnectCard } from '../TikTokConnectCard';
import { api } from '../../lib/api';

const status = (data: Record<string, unknown>) => {
    vi.spyOn(api, 'get').mockResolvedValue({
        ok: true,
        data: { serverConfigured: true, connected: false, source: null, username: '', canConnect: false, ...data },
    } as never);
};

afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
});

describe('TikTokConnectCard', () => {
    it('the owner sees TikTok posting through the server settings, with no buttons', async () => {
        status({ connected: true, source: 'server' });
        render(<TikTokConnectCard />);
        expect(await screen.findByText(/Zernio account set in the server settings/)).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('an admin who has not connected gets a Connect button that goes to Zernio', async () => {
        status({ canConnect: true });
        const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, error: 'Zernio is down' } as never);
        const err = vi.spyOn(toast, 'error').mockImplementation(() => '');
        render(<TikTokConnectCard />);
        fireEvent.click(await screen.findByRole('button', { name: /Connect TikTok/ }));
        await waitFor(() => expect(err).toHaveBeenCalledWith('Zernio is down'));
        expect(post).toHaveBeenCalledWith('/api/social/tiktok/connect');
    });

    it('a connected user sees their username and can disconnect', async () => {
        status({ connected: true, source: 'connected', username: 'grace' });
        render(<TikTokConnectCard />);
        expect(await screen.findByText(/@grace/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    it('a regular user is offered their own Zernio account, or Make or Zapier', async () => {
        status({ canConnect: false });
        render(<TikTokConnectCard />);
        expect(await screen.findByText(/with your own Zernio account below/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Connect TikTok/ })).not.toBeInTheDocument();
        expect(screen.getByLabelText('Zernio API key')).toHaveAttribute('type', 'password');
    });

    it('works with an own key even when the server has no Zernio key', async () => {
        status({ serverConfigured: false });
        render(<TikTokConnectCard />);
        expect(await screen.findByLabelText('Zernio API key')).toBeInTheDocument();
    });

    it('saving a key with one TikTok on it connects it and clears the field', async () => {
        status({ canConnect: false });
        const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { accounts: [{ accountId: 'a1', username: 'mine' }], selected: 'a1' } } as never);
        const ok = vi.spyOn(toast, 'success').mockImplementation(() => '');
        render(<TikTokConnectCard />);
        const field = await screen.findByLabelText('Zernio API key');
        fireEvent.change(field, { target: { value: 'sk_own_user_key_1234abcd' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
        await waitFor(() => expect(ok).toHaveBeenCalledWith('TikTok connected through your Zernio account'));
        expect(post).toHaveBeenCalledWith('/api/social/tiktok/own-key', { apiKey: 'sk_own_user_key_1234abcd' });
    });

    it('a connected own key shows only its last 4 and the TikTok, with Remove key', async () => {
        status({ connected: true, source: 'own_key', username: 'mine', ownKey: { hint: 'abcd', accountId: 'a1', username: 'mine' } });
        render(<TikTokConnectCard />);
        expect(await screen.findByText('abcd')).toBeInTheDocument();
        expect(screen.getByText(/through your own Zernio account/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    });

    it('a saved key with several TikToks asks which one to post to', async () => {
        vi.spyOn(api, 'get').mockImplementation(async (url: string) => (url === '/api/social/tiktok/own-accounts'
            ? { ok: true, data: { accounts: [{ accountId: 'a1', username: 'one' }, { accountId: 'a2', username: 'two' }] } }
            : { ok: true, data: { serverConfigured: true, connected: false, source: null, username: '', canConnect: false, ownKey: { hint: 'abcd', accountId: '', username: '' } } }) as never);
        render(<TikTokConnectCard />);
        expect(await screen.findByLabelText('Which TikTok should auto-publish post to?')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '@two' })).toBeInTheDocument();
    });

    it('reports the result of the sign-in and clears it from the address bar', async () => {
        window.history.replaceState(null, '', '/app/settings?tiktok_error=expired&tab=x');
        status({ canConnect: true });
        const err = vi.spyOn(toast, 'error').mockImplementation(() => '');
        render(<TikTokConnectCard />);
        await screen.findByRole('button', { name: /Connect TikTok/ });
        expect(err).toHaveBeenCalledWith(expect.stringMatching(/expired/), expect.anything());
        expect(window.location.search).toBe('?tab=x');
    });

    it('a successful sign-in shows a success toast', async () => {
        window.history.replaceState(null, '', '/app/settings?tiktok=connected');
        status({ connected: true, source: 'connected', username: 'grace' });
        const ok = vi.spyOn(toast, 'success').mockImplementation(() => '');
        render(<TikTokConnectCard />);
        await screen.findByText(/@grace/);
        expect(ok).toHaveBeenCalledWith('TikTok connected');
        expect(window.location.search).toBe('');
    });
});
