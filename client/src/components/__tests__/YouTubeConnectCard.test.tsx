import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { YouTubeConnectCard } from '../YouTubeConnectCard';
import { api } from '../../lib/api';

const status = (data: Record<string, unknown>) => {
    vi.spyOn(api, 'get').mockResolvedValue({
        ok: true,
        data: { serverConfigured: true, connected: true, channelTitle: 'Sthill Waters', channelId: 'c1', connectedAt: '', ...data },
    } as never);
};

afterEach(() => vi.restoreAllMocks());

describe('YouTubeConnectCard', () => {
    it('a connection made before playlists asks for one reconnect', async () => {
        status({ canUsePlaylists: false });
        render(<YouTubeConnectCard />);
        expect(await screen.findByText(/reconnect once to let studio add your videos to playlists/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
    });

    it('a connection that can use playlists shows no reconnect', async () => {
        status({ canUsePlaylists: true });
        render(<YouTubeConnectCard />);
        expect(await screen.findByText(/sthill waters/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/reconnect once/i)).not.toBeInTheDocument();
    });
});
