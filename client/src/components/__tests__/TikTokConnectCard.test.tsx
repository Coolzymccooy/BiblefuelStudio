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

    it('a regular user is told connecting is admin-only and pointed at Make or Zapier', async () => {
        status({ canConnect: false });
        render(<TikTokConnectCard />);
        expect(await screen.findByText(/open to admins for now/)).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('says when the server has no Zernio key', async () => {
        status({ serverConfigured: false });
        render(<TikTokConnectCard />);
        expect(await screen.findByText(/not set up on this server yet/)).toBeInTheDocument();
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
